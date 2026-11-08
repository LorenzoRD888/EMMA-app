#!/bin/bash
# EMMA.app launcher: starts the server in the background (unless the right
# version is already running) and opens EMMA in its own window.
# EMMA_DIR is the EMMA folder (it contains "app" and "data").
EMMA_DIR="__EMMA_DIR__"
APP_DIR="$EMMA_DIR/app"
URL="http://127.0.0.1:4317"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
for d in "$HOME"/.nvm/versions/node/*/bin "$HOME"/.volta/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
# Private Node.js copy downloaded by install.sh has priority.
[ -x "$APP_DIR/.runtime/bin/node" ] && PATH="$APP_DIR/.runtime/bin:$PATH"

log() { mkdir -p "$EMMA_DIR/data" 2>/dev/null; echo "$(date "+%Y-%m-%d %H:%M:%S") launcher: $*" >> "$EMMA_DIR/data/launcher.log" 2>/dev/null; }
alert() { log "ALERT: $1"; /usr/bin/osascript -e "display dialog \"$1\" with title \"EMMA\" buttons {\"OK\"} default button 1 with icon caution" >/dev/null 2>&1; }

if [ ! -f "$APP_DIR/src/server.js" ]; then alert "Cannot find the EMMA folder at $EMMA_DIR. If you moved it, run the app installer again."; exit 1; fi
if ! command -v node >/dev/null 2>&1; then alert "EMMA needs Node.js. Run the installer again (see the EMMA page on GitHub) or install Node.js 22 from nodejs.org."; exit 1; fi

log "start · folder $EMMA_DIR · node $(command -v node) $(node -v 2>/dev/null)"
mkdir -p "$EMMA_DIR/data"; cd "$APP_DIR" || { log "cannot enter the folder"; alert "macOS does not let EMMA open its folder ($EMMA_DIR). Run install-app.sh again from Terminal."; exit 1; }
WANTED=$(node -p "require('./package.json').version" 2>/dev/null)
STATUS=$(curl -fsS --max-time 2 "$URL/api/status" 2>/dev/null)
RUNNING=$(printf '%s' "$STATUS" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);if(j.app==='EMMA')console.log(j.version)}catch{}})")
FOLDER=$(printf '%s' "$STATUS" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).folder||'')}catch{}})")
HERE="$(cd "$EMMA_DIR" && pwd -P)"

log "wanted $WANTED · running ${RUNNING:-none} · running folder ${FOLDER:-unknown}"
# Another version, or another copy of EMMA in a different folder: close it and start this one.
if [ -n "$RUNNING" ] && { [ "$RUNNING" != "$WANTED" ] || [ "$FOLDER" != "$HERE" ]; }; then
  launchctl bootout "gui/$(id -u)/it.emma.server" >/dev/null 2>&1
  for pid in $(/usr/sbin/lsof -ti tcp:4317 -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null; done
  for i in $(seq 1 20); do curl -fsS --max-time 1 "$URL/api/status" >/dev/null 2>&1 || break; sleep 0.5; done
  RUNNING=""
fi
if [ -z "$RUNNING" ]; then
  # First start after downloading from GitHub: install the libraries.
  if [ ! -d node_modules/express ] || [ ! -d node_modules/kokoro-js ]; then
    /usr/bin/osascript -e 'display notification "Installing EMMA libraries (a few minutes the first time)…" with title "EMMA"' >/dev/null 2>&1
    npm install --omit=dev --no-audit --no-fund >> "$EMMA_DIR/data/emma.log" 2>&1 || { if tail -60 "$EMMA_DIR/data/emma.log" | grep -q "EPERM"; then alert "macOS does not let EMMA read its folder ($EMMA_DIR). Move the EMMA folder into your home folder and run app/assets/install-app.sh again, or allow it in System Settings → Privacy & Security → Files and Folders → EMMA."; else alert "EMMA could not install its libraries. Check the internet connection; details are in data/emma.log."; fi; exit 1; }
  fi
  # Start EMMA as a macOS background service (launchd): it keeps running after
  # this app quits. A process started directly by the app would be closed with it.
  NODE_BIN="$(command -v node)"
  LABEL="it.emma.server"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$(xml "$NODE_BIN")</string><string>src/server.js</string></array>
  <key>WorkingDirectory</key><string>$(xml "$APP_DIR")</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(xml "$PATH")</string></dict>
  <key>StandardOutPath</key><string>$(xml "$EMMA_DIR/data/emma.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$EMMA_DIR/data/emma.log")</string>
  <key>RunAtLoad</key><false/>
  <key>KeepAlive</key><false/>
</dict></plist>
PLISTEOF
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  if launchctl bootstrap "gui/$(id -u)" "$PLIST" >> "$EMMA_DIR/data/launcher.log" 2>&1 && launchctl kickstart "gui/$(id -u)/$LABEL" >> "$EMMA_DIR/data/launcher.log" 2>&1; then
    log "server started as background service ($NODE_BIN)"
  else
    # Fallback: detached process in its own session.
    log "launchd refused the service, starting detached"
    /usr/bin/perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' "$NODE_BIN" src/server.js >> "$EMMA_DIR/data/emma.log" 2>&1 < /dev/null &
  fi
  for i in $(seq 1 120); do curl -fsS --max-time 1 "$URL/api/status" >/dev/null 2>&1 && break; sleep 0.5; done
  if ! curl -fsS --max-time 2 "$URL/api/status" >/dev/null 2>&1; then log "server did not answer in 60 s"; alert "EMMA did not start. Details are in data/emma.log inside the EMMA folder."; exit 1; fi
  log "server is answering"
fi

# Dedicated window (no address bar) if a supporting browser is installed, otherwise the default browser.
for b in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium"; do
  if [ -d "/Applications/$b.app" ] || [ -d "$HOME/Applications/$b.app" ]; then
    log "opening window with $b"
    open -na "$b" --args --app="$URL" --window-size=1440,920 --no-first-run --no-default-browser-check --user-data-dir="$HOME/Library/Application Support/EMMA/window" || open "$URL" || true
    exit 0
  fi
done
log "opening default browser"
open "$URL" || true
exit 0
