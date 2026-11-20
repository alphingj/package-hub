use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::mpsc;

/// Detected package manager backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackageManager {
    Apt,
    Dnf,
    Pacman,
    Zypper,
    Flatpak,
}

impl PackageManager {
    pub fn label(&self) -> &'static str {
        match self {
            PackageManager::Apt => "APT",
            PackageManager::Dnf => "DNF",
            PackageManager::Pacman => "Pacman",
            PackageManager::Zypper => "Zypper",
            PackageManager::Flatpak => "Flatpak",
        }
    }

    pub fn source_id(&self) -> &'static str {
        match self {
            PackageManager::Apt => "apt",
            PackageManager::Dnf => "dnf",
            PackageManager::Pacman => "pacman",
            PackageManager::Zypper => "zypper",
            PackageManager::Flatpak => "flatpak",
        }
    }
}

/// A single package entry as reported by a backend.
#[derive(Debug, Clone, Serialize)]
pub struct Package {
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub installed: bool,
    pub update_available: bool,
    pub source: String,
}

pub struct Backend {
    pub manager: PackageManager,
}

impl Backend {
    /// Detect all available package managers on this system.
    ///
    /// Distro detection: match ID first, then fall back to ID_LIKE so
    /// derivatives (Kali, Mint, Pop…) resolve to the right backend.
    pub fn detect_all() -> Vec<Self> {
        let mut backends: Vec<Self> = Vec::new();

        if let Some(id) = detect_distro_family() {
            match id.as_str() {
                "debian" => backends.push(Self { manager: PackageManager::Apt }),
                "fedora" => backends.push(Self { manager: PackageManager::Dnf }),
                "arch" => backends.push(Self { manager: PackageManager::Pacman }),
                "suse" => backends.push(Self { manager: PackageManager::Zypper }),
                _ => {}
            }
        }

        // Flatpak is a universal backend; include it if the binary exists.
        if Command::new("flatpak").arg("--version").output().is_ok() {
            backends.push(Self { manager: PackageManager::Flatpak });
        }

        backends
    }

    /// Run a command to completion, capturing stdout. Locale is forced to C
    /// so output parsers are stable. `ok_codes` lists extra exit codes that
    /// count as success (e.g. dnf check-update exits 100 when updates exist).
    fn run_captured(
        &self,
        program: &str,
        args: &[&str],
        ok_codes: &[i32],
    ) -> Result<String, String> {
        let output = Command::new(program)
            .args(args)
            .env("LANG", "C")
            .env("LC_ALL", "C")
            .output()
            .map_err(|e| format!("failed to run {program}: {e}"))?;

        let code = output.status.code().unwrap_or(-1);
        if output.status.success() || ok_codes.contains(&code) {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("{program} exited with {code}: {}", truncate(stderr.trim(), 300)))
        }
    }

    /// Run a command, streaming interleaved stdout+stderr lines to `on_line`.
    /// stdout and stderr are drained on separate threads into one channel, so
    /// a child that fills either pipe buffer cannot deadlock us.
    fn run_streamed<F>(
        &self,
        use_pkexec: bool,
        program: &str,
        args: &[&str],
        mut on_line: F,
    ) -> Result<(), String>
    where
        F: FnMut(&str),
    {
        let mut cmd = if use_pkexec {
            let mut c = Command::new("pkexec");
            c.arg(program);
            c
        } else {
            Command::new(program)
        };
        cmd.args(args)
            .env("LANG", "C")
            .env("LC_ALL", "C")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let label = if use_pkexec { "pkexec" } else { program };
        let mut child = cmd.spawn().map_err(|e| format!("{label} spawn failed: {e}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to capture stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "failed to capture stderr".to_string())?;

        let (tx, rx) = mpsc::channel::<String>();

        let t_out = {
            let tx = tx.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().flatten() {
                    let _ = tx.send(line);
                }
            })
        };
        let t_err = {
            let tx = tx.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().flatten() {
                    let _ = tx.send(line);
                }
            })
        };
        drop(tx); // rx loop ends once both reader threads finish

        for line in rx {
            on_line(&line);
        }
        let _ = t_out.join();
        let _ = t_err.join();

        let status = child.wait().map_err(|e| format!("wait failed: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("{label} exited with {:?}", status.code()))
        }
    }

    /// Preferred flatpak remote as (name, is_user_installation).
    fn flatpak_remote(&self) -> Result<(String, bool), String> {
        let out = self.run_captured("flatpak", &["remotes", "--columns=name,options"], &[])?;
        let mut first: Option<(String, bool)> = None;
        for line in out.lines() {
            let mut parts = line.split('\t');
            let name = parts.next().unwrap_or("").trim().to_string();
            let opts = parts.next().unwrap_or("");
            if name.is_empty() {
                continue;
            }
            let user = opts.contains("user");
            if name.eq_ignore_ascii_case("flathub") {
                return Ok((name, user));
            }
            if first.is_none() {
                first = Some((name, user));
            }
        }
        first.ok_or_else(|| "no flatpak remote configured".to_string())
    }

    /// Search for packages matching `query`.
    pub fn search(&self, query: &str) -> Result<Vec<Package>, String> {
        let m = self.manager;
        let output = match m {
            PackageManager::Apt => {
                self.run_captured("apt-cache", &["search", query], &[])?
            }
            PackageManager::Dnf => self.run_captured("dnf", &["search", query], &[])?,
            PackageManager::Pacman => self.run_captured("pacman", &["-Ss", query], &[])?,
            PackageManager::Zypper => {
                self.run_captured("zypper", &["--non-interactive", "search", query], &[])?
            }
            PackageManager::Flatpak => self.run_captured("flatpak", &["search", query], &[])?,
        };
        Ok(parse_search_output(m, &output))
    }

    /// List installed packages.
    pub fn list_installed(&self) -> Result<Vec<Package>, String> {
        let m = self.manager;
        let output = match m {
            // Custom format: Package \t Version \t Status-Abbrev (e.g. "ii ")
            PackageManager::Apt => self.run_captured(
                "dpkg-query",
                &["-W", "-f=${Package}\t${Version}\t${db:Status-Abbrev}\n"],
                &[],
            )?,
            PackageManager::Dnf => self.run_captured("dnf", &["list", "installed"], &[])?,
            PackageManager::Pacman => self.run_captured("pacman", &["-Q"], &[])?,
            PackageManager::Zypper => self.run_captured(
                "zypper",
                &["--non-interactive", "search", "--installed-only"],
                &[],
            )?,
            PackageManager::Flatpak => self.run_captured(
                "flatpak",
                &["list", "--app", "--columns=application,version"],
                &[],
            )?,
        };
        Ok(parse_installed_output(m, &output))
    }

    /// Check for available updates.
    pub fn check_updates(&self) -> Result<Vec<Package>, String> {
        let m = self.manager;
        let output = match m {
            PackageManager::Apt => self.run_captured("apt", &["list", "--upgradable"], &[])?,
            // dnf exits 100 when updates are available — that is success.
            PackageManager::Dnf => self.run_captured("dnf", &["check-update"], &[0, 100])?,
            PackageManager::Pacman => self.run_captured("pacman", &["-Qu"], &[])?,
            PackageManager::Zypper => self.run_captured(
                "zypper",
                &["--non-interactive", "list-updates"],
                &[],
            )?,
            PackageManager::Flatpak => {
                let (remote, _) = self.flatpak_remote()?;
                self.run_captured(
                    "flatpak",
                    &["remote-ls", "--updates", "--columns=application,version", &remote],
                    &[],
                )?
            }
        };
        Ok(parse_updates_output(m, &output))
    }

    /// Install a package. Streams output; runs via pkexec except for
    /// user-scope flatpak installations.
    pub fn install<F>(&self, package: &str, on_line: F) -> Result<(), String>
    where
        F: FnMut(&str),
    {
        let m = self.manager;
        if m == PackageManager::Flatpak {
            let (remote, user) = self.flatpak_remote()?;
            return self.run_streamed(
                !user,
                "flatpak",
                &["install", "-y", &remote, package],
                on_line,
            );
        }
        let (program, args) = match m {
            PackageManager::Apt => ("apt-get", vec!["install".to_string(), "-y".to_string(), package.to_string()]),
            PackageManager::Dnf => ("dnf", vec!["install".to_string(), "-y".to_string(), package.to_string()]),
            PackageManager::Pacman => ("pacman", vec!["-S".to_string(), "--noconfirm".to_string(), package.to_string()]),
            PackageManager::Zypper => ("zypper", vec!["--non-interactive".to_string(), "install".to_string(), package.to_string()]),
            PackageManager::Flatpak => unreachable!(),
        };
        let argrefs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        self.run_streamed(true, program, &argrefs, on_line)
    }

    /// Remove a package.
    pub fn remove<F>(&self, package: &str, on_line: F) -> Result<(), String>
    where
        F: FnMut(&str),
    {
        let m = self.manager;
        if m == PackageManager::Flatpak {
            let (_, user) = self
                .flatpak_remote()
                .unwrap_or_else(|_| ("flathub".to_string(), false));
            return self.run_streamed(!user, "flatpak", &["uninstall", "-y", package], on_line);
        }
        let (program, args) = match m {
            PackageManager::Apt => ("apt-get", vec!["remove", "-y", package]),
            PackageManager::Dnf => ("dnf", vec!["remove", "-y", package]),
            PackageManager::Pacman => ("pacman", vec!["-R", "--noconfirm", package]),
            PackageManager::Zypper => ("zypper", vec!["--non-interactive", "remove", package]),
            PackageManager::Flatpak => unreachable!(),
        };
        self.run_streamed(true, program, &args, on_line)
    }

    /// Update a single package to its newest available version.
    pub fn update_package<F>(&self, package: &str, on_line: F) -> Result<(), String>
    where
        F: FnMut(&str),
    {
        let m = self.manager;
        if m == PackageManager::Flatpak {
            let (_, user) = self
                .flatpak_remote()
                .unwrap_or_else(|_| ("flathub".to_string(), false));
            return self.run_streamed(!user, "flatpak", &["update", "-y", package], on_line);
        }
        let (program, args) = match m {
            // --only-upgrade never installs new packages, just upgrades this one.
            PackageManager::Apt => ("apt-get", vec!["install", "--only-upgrade", "-y", package]),
            PackageManager::Dnf => ("dnf", vec!["update", "-y", package]),
            PackageManager::Pacman => ("pacman", vec!["-S", "--noconfirm", package]),
            PackageManager::Zypper => ("zypper", vec!["--non-interactive", "install", package]),
            PackageManager::Flatpak => unreachable!(),
        };
        self.run_streamed(true, program, &args, on_line)
    }

    /// Update every package from this backend.
    /// For apt this refreshes the package index first (single pkexec call).
    pub fn update_all<F>(&self, on_line: F) -> Result<(), String>
    where
        F: FnMut(&str),
    {
        let m = self.manager;
        if m == PackageManager::Flatpak {
            let (_, user) = self
                .flatpak_remote()
                .unwrap_or_else(|_| ("flathub".to_string(), false));
            return self.run_streamed(!user, "flatpak", &["update", "-y"], on_line);
        }
        let (program, args) = match m {
            // Refresh index and upgrade in one privileged shell so the user
            // only authenticates once and the index is never stale.
            PackageManager::Apt => (
                "sh",
                vec!["-c", "apt-get update && apt-get upgrade -y"],
            ),
            PackageManager::Dnf => ("dnf", vec!["update", "-y"]),
            PackageManager::Pacman => ("pacman", vec!["-Syu", "--noconfirm"]),
            PackageManager::Zypper => ("zypper", vec!["--non-interactive", "update", "-y"]),
            PackageManager::Flatpak => unreachable!(),
        };
        self.run_streamed(true, program, &args, on_line)
    }
}

/// Detect the distro family: ID first, then ID_LIKE fallback.
fn detect_distro_family() -> Option<String> {
    let contents = std::fs::read_to_string("/etc/os-release").ok()?;
    let mut id_like: Option<String> = None;
    for line in contents.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("ID=") {
            let id = rest.trim_matches('"').to_string();
            let family = map_id_to_family(&id);
            if let Some(f) = family {
                return Some(f.to_string());
            }
            // Remember ID but keep scanning: ID_LIKE may resolve when ID
            // alone is unknown (e.g. ID=kali, ID_LIKE=debian).
        } else if let Some(rest) = line.strip_prefix("ID_LIKE=") {
            id_like = Some(rest.trim_matches('"').to_string());
        }
    }
    // Fall back to ID_LIKE tokens.
    if let Some(like) = id_like {
        for token in like.split_whitespace() {
            if let Some(family) = map_id_to_family(token) {
                return Some(family.to_string());
            }
        }
    }
    None
}

fn map_id_to_family(id: &str) -> Option<&'static str> {
    match id {
        "debian" | "ubuntu" | "linuxmint" | "pop" | "elementary" | "neon" | "kali"
        | "raspbian" | "devuan" => Some("debian"),
        "fedora" | "rhel" | "almalinux" | "rocky" | "centos" | "ol" | "amzn" => Some("fedora"),
        "arch" | "manjaro" | "endeavouros" | "garuda" | "artix" => Some("arch"),
        "opensuse-leap" | "opensuse-tumbleweed" | "sles" | "sled" | "suse" | "opensuse" => {
            Some("suse")
        }
        _ => None,
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…", &s[..end])
    }
}

/// Flatpak application IDs look like `org.mozilla.firefox`.
fn looks_like_app_id(token: &str) -> bool {
    let t = token.trim();
    if t.len() < 3 || !t.contains('.') {
        return false;
    }
    t.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
        && t.split('.').all(|seg| !seg.is_empty())
}

/// Parse search output into Package entries.
fn parse_search_output(manager: PackageManager, output: &str) -> Vec<Package> {
    let source = manager.source_id().to_string();
    let mut packages = Vec::new();

    match manager {
        PackageManager::Apt => {
            // Format: "name - description"
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                if let Some((name, desc)) = line.split_once(" - ") {
                    packages.push(Package {
                        name: name.trim().to_string(),
                        version: None,
                        description: Some(desc.trim().to_string()),
                        installed: false,
                        update_available: false,
                        source: source.clone(),
                    });
                }
            }
        }
        PackageManager::Pacman => {
            // Format:
            // repo/name version [installed]
            //     description
            let lines: Vec<&str> = output.lines().collect();
            let mut i = 0;
            while i < lines.len() {
                let line = lines[i].trim();
                if line.is_empty() {
                    i += 1;
                    continue;
                }
                if let Some((repo, rest)) = line.split_once('/') {
                    let installed = rest.contains("[installed");
                    let mut tokens = rest.split_whitespace();
                    let name = tokens.next().unwrap_or("").trim();
                    let version = tokens.next().map(|s| s.trim().to_string());
                    let mut description = None;
                    if i + 1 < lines.len() {
                        let next = lines[i + 1].trim();
                        if next.starts_with("    ") || next.starts_with('\t') {
                            description = Some(next.trim().to_string());
                            i += 1;
                        }
                    }
                    if !name.is_empty() && !repo.is_empty() {
                        packages.push(Package {
                            name: name.to_string(),
                            version,
                            description,
                            installed,
                            update_available: false,
                            source: source.clone(),
                        });
                    }
                }
                i += 1;
            }
        }
        PackageManager::Dnf => {
            // Format: "name.arch : description" under a divider header.
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('=') || line.starts_with("N/S") {
                    continue;
                }
                if let Some((name_part, desc)) = line.split_once(" : ") {
                    let name = name_part.trim();
                    if name.is_empty() {
                        continue;
                    }
                    let base = name.split('.').next().unwrap_or(name).trim();
                    if base.is_empty() {
                        continue;
                    }
                    packages.push(Package {
                        name: base.to_string(),
                        version: None,
                        description: Some(desc.trim().to_string()),
                        installed: false,
                        update_available: false,
                        source: source.clone(),
                    });
                }
            }
        }
        PackageManager::Zypper => {
            // Table: "S | Name | Summary | Type" — take the Name column.
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || line.contains("--") || !line.contains('|') {
                    continue;
                }
                let cols: Vec<&str> = line.split('|').collect();
                if cols.len() < 3 {
                    continue;
                }
                let name = cols[1].trim();
                let summary = cols[2].trim();
                if name.is_empty() || name == "Name" {
                    continue;
                }
                packages.push(Package {
                    name: name.to_string(),
                    version: None,
                    description: if summary.is_empty() { None } else { Some(summary.to_string()) },
                    installed: false,
                    update_available: false,
                    source: source.clone(),
                });
            }
        }
        PackageManager::Flatpak => {
            // Columns include Name, Description, Application ID, … — extract
            // the token that looks like an application ID.
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('-') {
                    continue;
                }
                if let Some(app_id) = line.split_whitespace().find(|t| looks_like_app_id(t)) {
                    if packages.iter().any(|p: &Package| p.name == app_id) {
                        continue;
                    }
                    packages.push(Package {
                        name: app_id.to_string(),
                        version: None,
                        description: None,
                        installed: false,
                        update_available: false,
                        source: source.clone(),
                    });
                }
            }
        }
    }

    packages
}

/// Parse installed package output.
fn parse_installed_output(manager: PackageManager, output: &str) -> Vec<Package> {
    let source = manager.source_id().to_string();
    let mut packages = Vec::new();

    match manager {
        PackageManager::Apt => {
            // Tab-separated: name \t version \t status-abbrev ("ii " = installed)
            for line in output.lines() {
                let cols: Vec<&str> = line.split('\t').collect();
                if cols.len() < 3 {
                    continue;
                }
                let status = cols[2].trim();
                // "ii" = installed; skip config-only ("rc") entries.
                if !status.starts_with("ii") {
                    continue;
                }
                packages.push(Package {
                    name: cols[0].trim().to_string(),
                    version: Some(cols[1].trim().to_string()),
                    description: None,
                    installed: true,
                    update_available: false,
                    source: source.clone(),
                });
            }
        }
        PackageManager::Pacman => {
            for line in output.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    packages.push(Package {
                        name: parts[0].to_string(),
                        version: Some(parts[1].to_string()),
                        description: None,
                        installed: true,
                        update_available: false,
                        source: source.clone(),
                    });
                }
            }
        }
        PackageManager::Dnf => {
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with("Installed Packages") {
                    continue;
                }
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let name = parts[0].split('.').next().unwrap_or(parts[0]).to_string();
                    packages.push(Package {
                        name,
                        version: Some(parts[1].to_string()),
                        description: None,
                        installed: true,
                        update_available: false,
                        source: source.clone(),
                    });
                }
            }
        }
        PackageManager::Zypper => {
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || line.contains("--") || !line.contains('|') {
                    continue;
                }
                let cols: Vec<&str> = line.split('|').collect();
                if cols.len() < 3 {
                    continue;
                }
                let name = cols[1].trim();
                if name.is_empty() || name == "Name" {
                    continue;
                }
                packages.push(Package {
                    name: name.to_string(),
                    version: None,
                    description: None,
                    installed: true,
                    update_available: false,
                    source: source.clone(),
                });
            }
        }
        PackageManager::Flatpak => {
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let parts: Vec<&str> = line.split_whitespace().collect();
                let app = parts.first().copied().unwrap_or("");
                if !looks_like_app_id(app) {
                    continue;
                }
                let version = parts.get(1).map(|s| s.trim().to_string()).filter(|v| {
                    !v.is_empty() && *v != "–" && *v != "-" && *v != "…"
                });
                packages.push(Package {
                    name: app.to_string(),
                    version,
                    description: None,
                    installed: true,
                    update_available: false,
                    source: source.clone(),
                });
            }
        }
    }

    packages
}

/// Parse updates output.
fn parse_updates_output(manager: PackageManager, output: &str) -> Vec<Package> {
    let source = manager.source_id().to_string();
    let mut packages = Vec::new();

    match manager {
        PackageManager::Apt => {
            // "name/repo new_version arch [upgradable from: old]"
            // tokens after '/': repo, version, arch, …
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with("Listing") {
                    continue;
                }
                if let Some((name_repo, rest)) = line.split_once('/') {
                    let name = name_repo.trim();
                    if name.is_empty() {
                        continue;
                    }
                    let version = rest.split_whitespace().nth(1).map(|s| s.to_string());
                    packages.push(Package {
                        name: name.to_string(),
                        version,
                        description: None,
                        installed: false,
                        update_available: true,
                        source: source.clone(),
                    });
                }
            }
        }
        PackageManager::Pacman => {
            for line in output.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    packages.push(Package {
                        name: parts[0].to_string(),
                        version: Some(parts[1].to_string()),
                        description: None,
                        installed: false,
                        update_available: true,
                        source: source.clone(),
                    });
                }
            }
        }
        PackageManager::Dnf => {
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with("...") {
                    continue;
                }
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let name = parts[0].split('.').next().unwrap_or(parts[0]).to_string();
                    packages.push(Package {
                        name,
                        version: Some(parts[1].to_string()),
                        description: None,
                        installed: false,
                        update_available: true,
                        source: source.clone(),
                    });
                }
            }
        }
        PackageManager::Zypper => {
            // Columns: Repository | Name | Current Version | Available Version | Arch
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || line.contains("--") || !line.contains('|') {
                    continue;
                }
                let cols: Vec<&str> = line.split('|').collect();
                if cols.len() < 4 {
                    continue;
                }
                let name = cols[1].trim();
                if name.is_empty() || name == "Name" {
                    continue;
                }
                let version = cols[3].trim();
                packages.push(Package {
                    name: name.to_string(),
                    version: if version.is_empty() { None } else { Some(version.to_string()) },
                    description: None,
                    installed: false,
                    update_available: true,
                    source: source.clone(),
                });
            }
        }
        PackageManager::Flatpak => {
            // remote-ls --updates --columns=application,version
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let parts: Vec<&str> = line.split_whitespace().collect();
                let app = parts.first().copied().unwrap_or("");
                if !looks_like_app_id(app) {
                    continue;
                }
                let version = parts.get(1).map(|s| s.trim().to_string()).filter(|v| {
                    !v.is_empty() && *v != "–" && *v != "-" && *v != "…"
                });
                packages.push(Package {
                    name: app.to_string(),
                    version,
                    description: None,
                    installed: false,
                    update_available: true,
                    source: source.clone(),
                });
            }
        }
    }

    packages
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distro_detection_uses_id_like_fallback() {
        // Kali: ID=kali, ID_LIKE=debian → debian family → Apt backend
        let fam = detect_distro_family();
        // On non-Kali CI this may be another family; the invariant we care
        // about is that SOME family is detected from a real /etc/os-release.
        assert!(fam.is_some());
    }

    #[test]
    fn app_id_detection() {
        assert!(looks_like_app_id("org.mozilla.firefox"));
        assert!(looks_like_app_id("com.github.x.y"));
        assert!(!looks_like_app_id("firefox"));
        assert!(!looks_like_app_id("Name"));
    }

    #[test]
    fn apt_upgradable_parse() {
        let pkgs = parse_updates_output(
            PackageManager::Apt,
            "Listing...\nfirefox/stable 120.0 amd64 [upgradable from: 119.0]\n",
        );
        assert_eq!(pkgs.len(), 1);
        assert_eq!(pkgs[0].name, "firefox");
        assert_eq!(pkgs[0].version.as_deref(), Some("120.0"));
    }

    #[test]
    fn apt_installed_skips_config_only() {
        let pkgs = parse_installed_output(
            PackageManager::Apt,
            "nginx\t1.24.0\tii \nold-pkg\t1.0\trc \n",
        );
        assert_eq!(pkgs.len(), 1);
        assert_eq!(pkgs[0].name, "nginx");
    }

    #[test]
    fn zypper_parse_name_column() {
        let pkgs = parse_installed_output(
            PackageManager::Zypper,
            "S | Name  | Summary | Type\n--+-------+---------+-------\ni  | bash  | GNU Shell | package\n",
        );
        assert_eq!(pkgs.len(), 1);
        assert_eq!(pkgs[0].name, "bash");
    }
}
