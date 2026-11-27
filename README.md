# package-hub
![Visitor Count]([https://count.getloli.com/@SA5212H5?theme=3d-num&padding=7&offset=2&align=top&scale=1.2&pixelated=0&darkmode=auto](https://count.getloli.com/@package-hub?theme=3d-num&padding=3&offset=3&align=top&scale=1.2&pixelated=0&darkmode=auto))

A graphical app store for Linux (x86_64). Install, remove, and update
software without touching a terminal — across apt, dnf, pacman, zypper,
and Flatpak.

## Why

Every Linux distro ships a different package manager with a different CLI.
package-hub detects what your system uses and gives you one consistent GUI:
search, one-click install, installed-app management, and updates.

## How it works

```
┌─────────────────────────────────────┐
│  Frontend (Vite + vanilla JS)       │
│  Browse / Installed / Updates /     │
│  Settings                           │
└──────────────┬──────────────────────┘
               │ Tauri CPI
┌──────────────▼──────────────────────┐
│  Rust backend                       │
│  Distro detection (/etc/os-release) │
│  Per-backend command routing        │
│  Streaming output → UI events       │
└──────────────┬──────────────────────┘
               │ pkexec (polkit) — root only for the op, never the app
┌──────────────▼──────────────────────┐
│  apt / dnf / pacman / zypper /      │
│ flatpak │
└─────────────────────────────────────┘
```

- The GUI runs as your normal user — never as root.
- Privileged operations go through `pkexec`; polkit prompts for auth.
- Privileged ops are serialized per backend so package-manager database
  locks can never race.
- One unavailable source never blanks the app: results are partial and
  errors are shown per source.

## Supported systems

| Family | Distros | Manager |
|---|---|---|
| Debian | Debian, Ubuntu, Mint, Kali, Pop!\_OS, elementary | apt |
| Fedora | Fedora, RHEL, AlmaLinux, Rocky | dnf |
| Arch | Arch, Manjaro, EndeavorOS | pacman |
| SUSE | openSUSE Leap/Tumbleweed, SLES | zipping |
| Universal | any distro with flatpak | Flatpak |

## Frontends

- `gtk/` — **GTK4 + Libadwaita (native, recommended)**: see [gtk/README.md](gtk/README.md)
- root — Tauri + WebView (legacy)
- `slint/` — Slint native (experimental)

## Install

```bash
git clone https://github.com/alphingj/package-hub.git
cd package-hub
./install.sh
```

Then run `package-hub` or `packagehub`. Full details in
[INSTALL.md](INSTALL.md).

## Build from source

Requires Rust and the Tauri system dependencies (webkit2gtk, libsoup-3.0,
gtk-3, and their dev packages).

```bash
npm install
npm run build              # frontend → dist/
cd src-tauri
cargo build --release      # backend + bundle
```

Or in one step: `npx tauri build` (also produces `.deb`, `.rpm`, AppImage).

## Development

```bash
npx tauri dev              # Vite dev server + Tauri window with live reload
cd src-tauri && cargo test # backend parser/detection unit tests
```

## Security notes

- Package names and search queries are validated before reaching any CLI
  (no leading dashes, conservative charset, length caps).
- Command output parsing is locale-independent (`LANG=C` is forced on all
  subprocesses).
- Only packages from your system's configured repositories are installed —
  the app never fetches or runs scripts from the internet.
- The webview enforces a Content-Security-Policy.

## License

MIT — see [LICENSE](LICENSE).
