# package-hub — GTK4 + Libadwaita frontend

Native Linux frontend (no WebView). Reuses the exact Rust backend from
`src-tauri/src/package_manager.rs` via `#[path]` include — one parser /
backend source, three frontends (Tauri, Slint, GTK).

Apple-style UX via Libadwaita: system dark/light, rounded cards,
sidebar navigation, `AdwClamp` content width, toasts, About window.

## Build deps per distro

Floor: **GTK >= 4.8, Libadwaita >= 1.3, Rust >= 1.85** (Debian 12,
Ubuntu 23.10+/24.04, Fedora 39+, Arch, openSUSE Tumbleweed/Leap 15.6+).

| Distro | Command |
|---|---|
| Debian/Ubuntu/Mint/Pop/Kali | `sudo apt install libgtk-4-dev libadwaita-1-dev pkg-config build-essential cargo` |
| Fedora/RHEL/Alma/Rocky | `sudo dnf install gtk4-devel libadwaita-devel pkgconf cargo` |
| Arch/Manjaro/EndeavourOS | `sudo pacman -S gtk4 libadwaita rust pkgconf base-devel` |
| openSUSE | `sudo zypper install gtk4-devel libadwaita-devel cargo pkg-config` |
| NixOS | `nix-shell -p gtk4 libadwaita pkg-config cargo` |

## Build & run

```bash
cargo run --manifest-path gtk/Cargo.toml          # debug
cargo build --release --manifest-path gtk/Cargo.toml
./gtk/target/release/package-hub-gtk
```

## Architectures

Source has no arch-specific code; `gtk4-rs`/`libadwaita` build wherever
GTK4 ships: `x86_64`, `aarch64` (Pi/ARM laptops), `armv7`, `riscv64`,
`ppc64le`, `s390x`. Cross-build example:

```bash
rustup target add aarch64-unknown-linux-gnu
cargo build --release --manifest-path gtk/Cargo.toml --target aarch64-unknown-linux-gnu
# plus aarch64 GTK sysroot (distro multiarch / sysroot with pkg-config)
```

Distro packaging (`.deb`/`.rpm`/Arch) builds per-arch natively — preferred.

## Older distros (GTK < 4.8 / Adwaita < 1.3)

E.g. Ubuntu 22.04 (GTK 4.6, Adwaita 1.1). Options, in order:

1. Flatpak with `org.gnome.Platform//47` runtime — ships current
   GTK/Adwaita on any host, any arch Flatpak supports.
2. Tauri or Slint frontend in repo root (no GTK4 floor).

## Notes

- Privileged ops still via `pkexec`, serialized per backend; live log
  window streams `apt/dnf/pacman/zypper/flatpak` output.
- Verified here: `cargo check`, `cargo test` (5 backend parser tests),
  Xvfb launch smoke. Screenshot/interaction check on real desktop: pending.
