use serde::Serialize;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};

/// Detected package manager backend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
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

    /// Returns the base command name (without pkexec).
    pub fn binary(&self) -> &'static str {
        match self {
            PackageManager::Apt => "apt-get",
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
    pub fn detect_all() -> Vec<Self> {
        let mut backends: Vec<Self> = Vec::new();

        // Distro-based detection from /etc/os-release
        if let Ok(contents) = std::fs::read_to_string("/etc/os-release") {
            if let Some(id) = parse_os_release_id(&contents) {
                match id.as_str() {
                    "ubuntu" | "debian" | "linuxmint" | "pop" | "elementary" | "neon" => {
                        backends.push(Self { manager: PackageManager::Apt });
                    }
                    "fedora" | "rhel" | "almalinux" | "rocky" | "centos" => {
                        backends.push(Self { manager: PackageManager::Dnf });
                    }
                    "arch" | "manjaro" | "endeavouros" => {
                        backends.push(Self { manager: PackageManager::Pacman });
                    }
                    "opensuse-leap" | "opensuse-tumbleweed" | "sles" => {
                        backends.push(Self { manager: PackageManager::Zypper });
                    }
                    _ => {}
                }
            }
        }

        // Flatpak is a universal backend; include it if the binary exists.
        if Command::new("flatpak").arg("--version").output().is_ok() {
            backends.push(Self { manager: PackageManager::Flatpak });
        }

        backends
    }

    /// Run a command and capture combined stdout as a String.
    fn capture(&self, args: &[&str]) -> Result<String, String> {
        let mut cmd = Command::new(self.manager.binary());
        cmd.args(args);
        let output = cmd.output().map_err(|e| format!("spawn failed: {e}"))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!(
                "command failed (exit {:?}): {}",
                output.status.code(),
                stderr.trim()
            ))
        }
    }

    /// Run a privileged command via pkexec, streaming stdout lines to a callback.
    pub fn privileged<F>(&self, args: &[&str], mut on_line: F) -> Result<(), String>
    where
        F: FnMut(&str),
    {
        let mut cmd = Command::new("pkexec");
        cmd.arg(self.manager.binary());
        cmd.args(args);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("pkexec spawn failed: {e}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to capture pkexec stdout".to_string())?;
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            if let Ok(line) = line {
                on_line(&line);
            }
        }

        let stderr = BufReader::new(
            child.stderr.take().ok_or_else(|| "failed to capture pkexec stderr".to_string())?,
        );
        for line in stderr.lines() {
            if let Ok(line) = line {
                on_line(&line);
            }
        }

        let status = child.wait().map_err(|e| format!("wait failed: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "pkexec command failed with exit code {:?}",
                status.code()
            ))
        }
    }

    /// Search for packages matching `query`.
    pub fn search(&self, query: &str) -> Result<Vec<Package>, String> {
        let output = match self.manager {
            PackageManager::Apt => self.capture(&["cache", "search", query])?,
            PackageManager::Dnf => self.capture(&["search", query])?,
            PackageManager::Pacman => self.capture(&["-Ss", query])?,
            PackageManager::Zypper => self.capture(&["search", query])?,
            PackageManager::Flatpak => self.capture(&["search", query])?,
        };

        Ok(parse_search_output(&self.manager, &output))
    }

    /// List installed packages.
    pub fn list_installed(&self) -> Result<Vec<Package>, String> {
        let output = match self.manager {
            PackageManager::Apt => self.capture(&["dpkg-query", "-W", "-f=${Package} ${Version} ${db:Status-Abbrev}\n"])?,
            PackageManager::Dnf => self.capture(&["list", "--installed"])?,
            PackageManager::Pacman => self.capture(&["-Q"])?,
            PackageManager::Zypper => self.capture(&["search", "--installed-only"])?,
            PackageManager::Flatpak => self.capture(&["list", "--app"])?.to_string(),
        };

        Ok(parse_installed_output(&self.manager, &output))
    }

    /// Check for available updates.
    pub fn check_updates(&self) -> Result<Vec<Package>, String> {
        let output = match self.manager {
            PackageManager::Apt => self.capture(&["list", "--upgradable"])?,
            PackageManager::Dnf => self.capture(&["check-update"])?,
            PackageManager::Pacman => self.capture(&["-Qu"])?,
            PackageManager::Zypper => self.capture(&["list-updates"])?,
            PackageManager::Flatpak => self.capture(&["update", "--dry-run"])?,
        };

        Ok(parse_updates_output(&self.manager, &output))
    }

    /// Install a package via pkexec, streaming output to `on_line`.
    pub fn install<F>(&self, package: &str, mut on_line: F) -> Result<(), String>
    where
        F: FnMut(&str),
    {
        let args = match self.manager {
            PackageManager::Apt => vec!["install", "-y", package],
            PackageManager::Dnf => vec!["install", "-y", package],
            PackageManager::Pacman => vec!["-S", "--noconfirm", package],
            PackageManager::Zypper => vec!["install", "-y", package],
            PackageManager::Flatpak => vec!["install", "-y", "flathub", package],
        };
        self.privileged(&args, &mut on_line)
    }

    /// Remove a package via pkexec, streaming output to `on_line`.
    pub fn remove<F>(&self, package: &str, mut on_line: F) -> Result<(), String>
    where
        F: FnMut(&str),
    {
        let args = match self.manager {
            PackageManager::Apt => vec!["remove", "-y", package],
            PackageManager::Dnf => vec!["remove", "-y", package],
            PackageManager::Pacman => vec!["-R", "--noconfirm", package],
            PackageManager::Zypper => vec!["remove", "-y", package],
            PackageManager::Flatpak => vec!["uninstall", "-y", package],
        };
        self.privileged(&args, &mut on_line)
    }

    /// Update all packages via pkexec, streaming output to `on_line`.
    pub fn update_all<F>(&self, mut on_line: F) -> Result<(), String>
    where
        F: FnMut(&str),
    {
        let args = match self.manager {
            PackageManager::Apt => vec!["upgrade", "-y"],
            PackageManager::Dnf => vec!["update", "-y"],
            PackageManager::Pacman => vec!["-Syu", "--noconfirm"],
            PackageManager::Zypper => vec!["update", "-y"],
            PackageManager::Flatpak => vec!["update", "-y"],
        };
        self.privileged(&args, &mut on_line)
    }
}

/// Parse the ID= value from /etc/os-release.
fn parse_os_release_id(contents: &str) -> Option<String> {
    for line in contents.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("ID=") {
            return Some(rest.trim_matches('"').to_string());
        }
        if let Some(rest) = line.strip_prefix("ID_LIKE=") {
            let like = rest.trim_matches('"');
            // Fallback: check ID_LIKE for debian/fedora/arch/suse
            for token in like.split_whitespace() {
                match token {
                    "debian" => return Some("debian".to_string()),
                    "ubuntu" => return Some("ubuntu".to_string()),
                    "fedora" => return Some("fedora".to_string()),
                    "arch" => return Some("arch".to_string()),
                    "suse" | "opensuse" => return Some("opensuse-leap".to_string()),
                    _ => {}
                }
            }
        }
    }
    None
}

/// Parse search output into Package entries.
fn parse_search_output(manager: &PackageManager, output: &str) -> Vec<Package> {
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
                        source: "apt".to_string(),
                    });
                }
            }
        }
        PackageManager::Pacman => {
            // Format:
            // repo/name version
            //     description
            let lines: Vec<&str> = output.lines().collect();
            let mut i = 0;
            while i < lines.len() {
                let line = lines[i].trim();
                if line.is_empty() {
                    i += 1;
                    continue;
                }
                // repo/name version
                if let Some(rest) = line.split_once('/') {
                    let name_part = rest.1;
                    let name = name_part.split_whitespace().next().unwrap_or("").trim();
                    let mut description = None;
                    if i + 1 < lines.len() {
                        let next = lines[i + 1].trim();
                        if next.starts_with("    ") || next.starts_with('\t') {
                            description = Some(next.trim().to_string());
                            i += 1;
                        }
                    }
                    if !name.is_empty() {
                        packages.push(Package {
                            name: name.to_string(),
                            version: None,
                            description,
                            installed: false,
                            update_available: false,
                            source: "pacman".to_string(),
                        });
                    }
                }
                i += 1;
            }
        }
        PackageManager::Dnf | PackageManager::Zypper | PackageManager::Flatpak => {
            // Tabular output; skip header, take first column as name.
            for (idx, line) in output.lines().enumerate() {
                if idx == 0 {
                    continue; // skip header
                }
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let name = line.split_whitespace().next().unwrap_or("").trim();
                if !name.is_empty() && name != "Name" && name != "Last" {
                    packages.push(Package {
                        name: name.to_string(),
                        version: None,
                        description: None,
                        installed: false,
                        update_available: false,
                        source: manager.label().to_lowercase(),
                    });
                }
            }
        }
    }

    packages
}

/// Parse installed package output.
fn parse_installed_output(manager: &PackageManager, output: &str) -> Vec<Package> {
    let mut packages = Vec::new();

    match manager {
        PackageManager::Apt => {
            // Format: "name version ii" (ii = installed)
            for line in output.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    packages.push(Package {
                        name: parts[0].to_string(),
                        version: Some(parts[1].to_string()),
                        description: None,
                        installed: true,
                        update_available: false,
                        source: "apt".to_string(),
                    });
                }
            }
        }
        PackageManager::Pacman => {
            // Format: "name version"
            for line in output.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    packages.push(Package {
                        name: parts[0].to_string(),
                        version: Some(parts[1].to_string()),
                        description: None,
                        installed: true,
                        update_available: false,
                        source: "pacman".to_string(),
                    });
                }
            }
        }
        PackageManager::Dnf => {
            // Format: "name.arch version repo"
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with("Installed Packages") {
                    continue;
                }
                let parts: Vec<&str> = line.split_whitespace().collect();
                if !parts.is_empty() {
                    let name = parts[0].split('.').next().unwrap_or(parts[0]).to_string();
                    packages.push(Package {
                        name,
                        version: parts.get(1).map(|s| s.to_string()),
                        description: None,
                        installed: true,
                        update_available: false,
                        source: "dnf".to_string(),
                    });
                }
            }
        }
        PackageManager::Zypper => {
            // Tabular; skip header, first column is name.
            for (idx, line) in output.lines().enumerate() {
                if idx == 0 {
                    continue;
                }
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let name = line.split_whitespace().next().unwrap_or("").trim();
                if !name.is_empty() && name != "Name" {
                    packages.push(Package {
                        name: name.to_string(),
                        version: None,
                        description: None,
                        installed: true,
                        update_available: false,
                        source: "zypper".to_string(),
                    });
                }
            }
        }
        PackageManager::Flatpak => {
            // Format: "Name         Description    Application   Version  Branch  Installation"
            for (idx, line) in output.lines().enumerate() {
                if idx < 2 {
                    continue; // skip header + separator
                }
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let parts: Vec<&str> = line.split_whitespace().collect();
                if !parts.is_empty() {
                    packages.push(Package {
                        name: parts[0].to_string(),
                        version: None,
                        description: None,
                        installed: true,
                        update_available: false,
                        source: "flatpak".to_string(),
                    });
                }
            }
        }
    }

    packages
}

/// Parse updates output.
fn parse_updates_output(manager: &PackageManager, output: &str) -> Vec<Package> {
    let mut packages = Vec::new();

    match manager {
        PackageManager::Apt => {
            // Format: "name/arch version repo [upgradable from: old_version]"
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with("Listing...") {
                    continue;
                }
                if let Some((name_ver, _rest)) = line.split_once('/') {
                    let name = name_ver.trim().to_string();
                    packages.push(Package {
                        name,
                        version: None,
                        description: None,
                        installed: false,
                        update_available: true,
                        source: "apt".to_string(),
                    });
                }
            }
        }
        PackageManager::Pacman => {
            // Format: "name version"
            for line in output.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    packages.push(Package {
                        name: parts[0].to_string(),
                        version: Some(parts[1].to_string()),
                        description: None,
                        installed: false,
                        update_available: true,
                        source: "pacman".to_string(),
                    });
                }
            }
        }
        PackageManager::Dnf => {
            // Format: "name.arch version repo"
            for line in output.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with("...") {
                    continue;
                }
                let parts: Vec<&str> = line.split_whitespace().collect();
                if !parts.is_empty() {
                    let name = parts[0].split('.').next().unwrap_or(parts[0]).to_string();
                    packages.push(Package {
                        name,
                        version: parts.get(1).map(|s| s.to_string()),
                        description: None,
                        installed: false,
                        update_available: true,
                        source: "dnf".to_string(),
                    });
                }
            }
        }
        PackageManager::Zypper | PackageManager::Flatpak => {
            // Tabular output; skip header lines.
            for (idx, line) in output.lines().enumerate() {
                if idx < 2 {
                    continue;
                }
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let name = line.split_whitespace().next().unwrap_or("").trim();
                if !name.is_empty() && name != "Name" {
                    packages.push(Package {
                        name: name.to_string(),
                        version: None,
                        description: None,
                        installed: false,
                        update_available: true,
                        source: manager.label().to_lowercase(),
                    });
                }
            }
        }
    }

    packages
}
