# package-hub — Install & Run

## One-command install

```bash
git clone https://github.com/alphingj/package-hub.git
cd package-hub
./install.sh
```

Then run:

```bash
package-hub
# or
packagehub
```

## What `install.sh` does

- Builds/uses the release binary from `src-tauri/target/release/package-hub`
- Installs it to `/usr/local/bin/package-hub` (system-wide), or falls back to
  `~/.local/bin/package-hub` if you don't have sudo
- Creates a `packagehub` symlink pointing to `package-hub`
- Installs an application menu entry (`package-hub.desktop`)

## Manual install (no script)

If you already have the built binary:

```bash
# System-wide (needs sudo):
sudo cp src-tauri/target/release/package-hub /usr/local/bin/package-hub
sudo chmod 755 /usr/local/bin/package-hub
sudo ln -s /usr/local/bin/package-hub /usr/local/bin/packagehub

# Or user-only (no sudo):
mkdir -p ~/.local/bin
cp src-tauri/target/release/package-hub ~/.local/bin/package-hub
chmod 755 ~/.local/bin/package-hub
ln -s ~/.local/bin/package-hub ~/.local/bin/packagehub
```

## Building from source

Requires Rust and the Tauri system dependencies (webkit2gtk-4.0, libsoup-3.0, gtk-3).

```bash
npm install
npm run build
cd src-tauri && cargo build --release
```

Then run `./install.sh`.

## Running without installing

```bash
cargo run --release
```

## Uninstall

```bash
# System-wide:
sudo rm /usr/local/bin/package-hub /usr/local/bin/packagehub

# Or user-only:
rm ~/.local/bin/package-hub ~/.local/bin/packagehub

# Desktop entry:
rm ~/.local/share/applications/package-hub.desktop
```
