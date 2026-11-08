#!/bin/zsh
# EMMA for Mac — double-click to start.
# First start: if Node.js is missing it downloads a private copy into app/.runtime
# (no admin password) and installs the libraries. Then EMMA opens in the browser.
# Keep this window open while you use EMMA: closing it stops EMMA.
# Your data stay in the "data" folder next to this file.
cd "${0:A:h}/app" || { echo "The 'app' folder is missing next to this file."; read; exit 1; }
URL="http://127.0.0.1:4317"
NODE_VERSION="24.11.0"
export PATH="$PWD/.runtime/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# EMMA uses the database built into Node.js (22.13 or newer).
if ! node -e "require('node:sqlite')" >/dev/null 2>&1; then
  echo "First start: downloading Node.js $NODE_VERSION for EMMA (about 50 MB, only once)…"
  case "$(uname -m)" in arm64) ARCH=arm64 ;; *) ARCH=x64 ;; esac
  TMP="$(mktemp -d)"
  if curl -fL# "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$ARCH.tar.gz" -o "$TMP/node.tgz"; then
    rm -rf .runtime && mkdir -p .runtime && tar -xzf "$TMP/node.tgz" -C .runtime --strip-components 1
  fi
  rm -rf "$TMP"
  if ! node -v >/dev/null 2>&1; then
    echo "\nNode.js could not be downloaded. Check the internet connection (turn off any VPN) and try again,"
    echo "or install Node.js 22 or newer from https://nodejs.org"; read; exit 1
  fi
fi

WANTED=$(node -p "require('./package.json').version")
HERE="$(cd .. && pwd -P)"
# Which EMMA answers on the port: version and folder. Another copy of EMMA
# (another folder, e.g. an older one) is closed so that this one opens with its own data.
STATUS=$(curl -fsS --max-time 2 "$URL/api/status" 2>/dev/null)
RUNNING=$(printf '%s' "$STATUS" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);if(j.app==='EMMA')console.log(j.version)}catch{}})")
FOLDER=$(printf '%s' "$STATUS" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).folder||'')}catch{}})")
if [[ -n "$RUNNING" && "$RUNNING" == "$WANTED" && "$FOLDER" == "$HERE" ]]; then open "$URL"; exit 0; fi
if [[ -n "$RUNNING" ]]; then
  if [[ "$FOLDER" != "$HERE" ]]; then echo "Another EMMA (${FOLDER:-older folder}) is running: closing it and starting this one ($HERE)…"
  else echo "EMMA $RUNNING is running: closing it and starting version $WANTED…"; fi
  launchctl bootout "gui/$(id -u)/it.emma.server" >/dev/null 2>&1
  for pid in $(/usr/sbin/lsof -ti tcp:4317 -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null; done
  for i in {1..20}; do curl -fsS --max-time 1 "$URL/api/status" >/dev/null 2>&1 || break; sleep 0.5; done
fi

# Libraries: installed the first time (or when missing).
if ! node -e "require.resolve('express');require.resolve('docx');require.resolve('kokoro-js')" >/dev/null 2>&1; then
  echo "Installing the EMMA libraries (about a minute, only the first time)…"
  rm -rf node_modules
  npm install --omit=dev --no-audit --no-fund --loglevel=error || { echo "\nThe libraries could not be installed. Check the internet connection and try again."; read; exit 1; }
fi

echo "\n  EMMA $WANTED is starting: it opens in the browser in a few seconds."
echo "  Keep this window open while you use EMMA. Close it to stop EMMA.\n"
(sleep 2; open "$URL") &
node src/server.js
echo "\nEMMA has stopped. If this was not expected, send the messages above to the author."; read
