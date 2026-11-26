#!/usr/bin/env bash
# package-hub install script
# Installs the package-hub GUI binary so it can be run as either
# `package-hub` or `packagehub`, plus a desktop entry and icon.
set -euo pipefail

BINARY_NAME="package-hub"
# GTK4 + Libadwaita frontend is the current binary; Slint/Tauri are fallbacks.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY_PATH="$SCRIPT_DIR/gtk/target/release/package-hub-gtk"
if [[ ! -x "$BINARY_PATH" ]]; then
  BINARY_PATH="$SCRIPT_DIR/slint/target/release/package-hub-slint"
fi
if [[ ! -x "$BINARY_PATH" ]]; then
  BINARY_PATH="$SCRIPT_DIR/src-tauri/target/release/$BINARY_NAME"
fi

if [[ ! -x "$BINARY_PATH" ]]; then
  echo "Error: release binary not found (looked in gtk/, slint/, src-tauri/ release dirs)" >&2
  echo "Build it first: cargo build --release --manifest-path gtk/Cargo.toml" >&2
  exit 1
fi

# Pick an install directory: prefer /usr/local/bin (system-wide), fall back
# to ~/.local/bin (user, no sudo needed).
if [[ -w /usr/local/bin ]]; then
  INSTALL_DIR="/usr/local/bin"
  USE_SUDO=""
elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  INSTALL_DIR="/usr/local/bin"
  USE_SUDO="sudo"
else
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
  USE_SUDO=""
fi

echo "Installing $BINARY_NAME to $INSTALL_DIR..."

# Remove any existing binary first: cp onto a running executable fails with
# "Text file busy", but a fresh mv into place never does.
TMP_BIN="$INSTALL_DIR/.package-hub.new.$$"
if [[ -n "$USE_SUDO" ]]; then
  sudo cp "$BINARY_PATH" "$TMP_BIN"
  sudo chmod 755 "$TMP_BIN"
  sudo rm -f "$INSTALL_DIR/$BINARY_NAME"
  sudo mv "$TMP_BIN" "$INSTALL_DIR/$BINARY_NAME"
else
  cp "$BINARY_PATH" "$TMP_BIN"
  chmod 755 "$TMP_BIN"
  rm -f "$INSTALL_DIR/$BINARY_NAME"
  mv "$TMP_BIN" "$INSTALL_DIR/$BINARY_NAME"
fi

# Create/refresh the alias command name: packagehub -> package-hub.
# -f replaces a stale alias of any kind (old symlink or regular file).
ALIAS_PATH="$INSTALL_DIR/packagehub"
if [[ -n "$USE_SUDO" ]]; then
  sudo ln -sfn "$INSTALL_DIR/$BINARY_NAME" "$ALIAS_PATH"
else
  ln -sfn "$INSTALL_DIR/$BINARY_NAME" "$ALIAS_PATH"
fi
echo "Alias: packagehub -> $BINARY_NAME"

# Install icon for the application menu.
ICON_SRC="$SCRIPT_DIR/src-tauri/icons/128x128@2x.png"   # 256x256
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
if [[ -f "$ICON_SRC" ]]; then
  mkdir -p "$ICON_DIR"
  cp "$ICON_SRC" "$ICON_DIR/package-hub.png"
  chmod 644 "$ICON_DIR/package-hub.png"
  echo "Installed icon to $ICON_DIR/"
fi

# Install .desktop entry with an ABSOLUTE Exec path — menu launches must not
# depend on PATH containing ~/.local/bin.
DESKTOP_DIR="$HOME/.local/share/applications"
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_DIR/package-hub.desktop" <<EOF
[Desktop Entry]
Name=package-hub
GenericName=App Store
Comment=Install, remove, and update software without the terminal
Exec=$INSTALL_DIR/package-hub
Icon=package-hub
Terminal=false
Type=Application
Categories=System;PackageManager;GTK;
StartupNotify=true
Keywords=apt;dnf;pacman;zypper;flatpak;install;software;store;
EOF
chmod 644 "$DESKTOP_DIR/package-hub.desktop"
echo "Installed desktop entry to $DESKTOP_DIR/"

# Refresh icon cache if the tool exists (non-fatal if it doesn't).
command -v gtk-update-icon-cache >/dev/null 2>&1 && \
  gtk-update-icon-cache -q -t -f "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo ""
echo "Installation complete."
echo "Run the app with:  package-hub   or   packagehub"
echo "Binary location:   $INSTALL_DIR/$BINARY_NAME"
echo "Menu entry:        package-hub (application menu)"
