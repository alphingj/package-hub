#!/usr/bin/env bash
# package-hub install script
# Installs the package-hub GUI binary so it can be run as either
# `package-hub` or `packagehub`.
set -euo pipefail

BINARY_NAME="package-hub"
RELEASE_DIR="src-tauri/target/release"

# Resolve the directory of this script so it works from any CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BINARY_PATH="$SCRIPT_DIR/$RELEASE_DIR/$BINARY_NAME"

if [[ ! -x "$BINARY_PATH" ]]; then
  echo "Error: release binary not found at $BINARY_PATH" >&2
  echo "Build it first: cd src-tauri && cargo build --release" >&2
  exit 1
fi

# Pick an install directory: prefer /usr/local/bin (system-wide), fall back to ~/.local/bin (user, no sudo needed).
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

# Install the primary binary.
if [[ -n "$USE_SUDO" ]]; then
  sudo cp "$BINARY_PATH" "$INSTALL_DIR/$BINARY_NAME"
  sudo chmod 755 "$INSTALL_DIR/$BINARY_NAME"
else
  cp "$BINARY_PATH" "$INSTALL_DIR/$BINARY_NAME"
  chmod 755 "$INSTALL_DIR/$BINARY_NAME"
fi

# Create the alias command name: packagehub -> package-hub
ALIAS_PATH="$INSTALL_DIR/packagehub"
if [[ -e "$ALIAS_PATH" ]] || [[ -L "$ALIAS_PATH" ]]; then
  echo "Alias packagehub already exists, skipping."
else
  if [[ -n "$USE_SUDO" ]]; then
    sudo ln -s "$INSTALL_DIR/$BINARY_NAME" "$ALIAS_PATH"
  else
    ln -s "$INSTALL_DIR/$BINARY_NAME" "$ALIAS_PATH"
  fi
  echo "Created alias: packagehub -> $BINARY_NAME"
fi

# Install .desktop file for application menu integration.
DESKTOP_FILE="$SCRIPT_DIR/package-hub.desktop"
if [[ -f "$DESKTOP_FILE" ]]; then
  DESKTOP_DIR="$HOME/.local/share/applications"
  mkdir -p "$DESKTOP_DIR"
  cp "$DESKTOP_FILE" "$DESKTOP_DIR/"
  chmod 644 "$DESKTOP_DIR/package-hub.desktop"
  echo "Installed desktop entry to $DESKTOP_DIR/"
fi

echo ""
echo "Installation complete."
echo "Run the app with:  package-hub   or   packagehub"
echo "Binary location:   $INSTALL_DIR/$BINARY_NAME"
echo "Alias location:    $ALIAS_PATH"
echo "Or find 'package-hub' in your application menu."
