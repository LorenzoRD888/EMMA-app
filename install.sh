#!/bin/bash
# EMMA one-line installer for macOS. Paste in Terminal:
#   curl -fsSL https://raw.githubusercontent.com/LorenzoRD888/EMMA-app/main/install.sh | bash
#
# What it does, with nothing else to install first:
#   1. downloads EMMA into ~/EMMA (your home folder: macOS does not protect it);
#   2. downloads a private copy of Node.js into ~/EMMA/app/.runtime
#      (no admin password, does not touch anything else on the Mac);
#   3. installs the libraries, creates EMMA.app (Applications + Desktop) and opens it.
# Running it again updates EMMA and keeps your data (~/EMMA/data).
set -euo pipefail

REPO="LorenzoRD888/EMMA-app"
NODE_VERSION="24.11.0"
DEST="${EMMA_HOME:-$HOME/EMMA}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$*"; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer is for macOS. On Windows download the zip and double-click \"Start EMMA - Windows.bat\"."
case "$(uname -m)" in arm64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) fail "Unsupported processor: $(uname -m)." ;; esac

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

say "1/4 · Downloading EMMA…"
curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.zip" -o "$TMP/emma.zip" \
  || fail "Download failed. Check the internet connection (and that you can open the repository)."
unzip -q "$TMP/emma.zip" -d "$TMP"
SRC="$(find "$TMP" -maxdepth 1 -type d -iname "emma-app-*" | head -1)"
[ -n "$SRC" ] && [ -f "$SRC/app/package.json" ] || fail "The download does not look like EMMA."
mkdir -p "$DEST/app"
# Replace the program; never touch your data, the libraries or the downloaded runtime.
find "$DEST" -mindepth 1 -maxdepth 1 ! -name data ! -name app -exec rm -rf {} +
find "$DEST/app" -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .runtime -exec rm -rf {} +
cp -R "$SRC/." "$DEST/"
chmod +x "$DEST/Start EMMA - Mac.command" "$DEST/app/assets/"*.sh 2>/dev/null || true

say "2/4 · Preparing Node.js $NODE_VERSION (private copy for EMMA)…"
RUNTIME="$DEST/app/.runtime"
if [ ! -x "$RUNTIME/bin/node" ] || [ "$("$RUNTIME/bin/node" -v 2>/dev/null)" != "v$NODE_VERSION" ]; then
  rm -rf "$RUNTIME"; mkdir -p "$RUNTIME"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$ARCH.tar.gz" -o "$TMP/node.tgz" \
    || fail "Could not download Node.js from nodejs.org. Check the internet connection."
  tar -xzf "$TMP/node.tgz" -C "$RUNTIME" --strip-components 1
fi
export PATH="$RUNTIME/bin:$PATH"
node -v >/dev/null || fail "Node.js does not start on this Mac."

say "3/4 · Installing the libraries (about a minute)…"
( cd "$DEST/app" && npm install --omit=dev --no-audit --no-fund --loglevel=error ) \
  || fail "Library installation failed. Run this command again; if it keeps failing, send the messages above to the author."
( cd "$DEST/app" && node -e "import('./src/db.js').then(m=>{const d=m.default(':memory:');d.exec('create table t(a)');process.exit(0)})" ) \
  || fail "The database engine does not start on this Mac. Send the messages above to the author."
mkdir -p "$DEST/data"
[ -f "$DEST/data/.env" ] || { cp "$DEST/app/.env.example" "$DEST/data/.env"; chmod 600 "$DEST/data/.env"; }

say "4/4 · Creating the EMMA app…"
for pid in $(/usr/sbin/lsof -ti tcp:4317 -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
bash "$DEST/app/assets/install-app.sh"

printf '\n\033[32m✓ EMMA is installed in %s\033[0m\n' "$DEST"
echo "  Next time just double-click the EMMA icon (Applications or Desktop)."
echo "  To update EMMA later, paste the same command again: your data is kept."
