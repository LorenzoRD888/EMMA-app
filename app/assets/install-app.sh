#!/bin/bash
# Creates EMMA.app (icon in Applications and on the Desktop) and opens it.
# Usage, in Terminal:   bash <EMMA folder>/app/assets/install-app.sh
#
# macOS protects Desktop, Documents and Downloads: an app kept there cannot
# read its own files without a permission that macOS often never asks for.
# So, if the EMMA folder is in one of them, this script moves it (program AND
# data) into your home folder first — ~/EMMA — and builds the app from there.
set -e
DIR="$(cd "$(dirname "$0")/../.." && pwd)"   # the EMMA folder (contains app and data)

case "$DIR" in
  "$HOME/Desktop"|"$HOME/Desktop/"*|"$HOME/Documents"|"$HOME/Documents/"*|"$HOME/Downloads"|"$HOME/Downloads/"*)
    TARGET="$HOME/EMMA"; n=2
    while [ -e "$TARGET" ]; do TARGET="$HOME/EMMA-$n"; n=$((n+1)); done
    echo "The EMMA folder is in a folder protected by macOS:"
    echo "  $DIR"
    echo "Moving it (program and data) to your home folder:"
    echo "  $TARGET"
    # Stop EMMA if it is running from the old place, then move.
    for pid in $(/usr/sbin/lsof -ti tcp:4317 -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
    sleep 1
    mv "$DIR" "$TARGET" || { echo "✗ Could not move the folder. Close EMMA and any window using it, then run this again."; exit 1; }
    DIR="$TARGET"
    echo "✓ Moved. In Finder you find it with Go → Home → $(basename "$TARGET")."
    echo ""
    ;;
esac

if [ -w /Applications ]; then DEST=/Applications; else DEST="$HOME/Applications"; mkdir -p "$DEST"; fi
APP="$DEST/EMMA.app"
TMP="$(mktemp -d)"
cat > "$TMP/EMMA.applescript" <<'APPLESCRIPT'
do shell script "/bin/bash " & quoted form of (POSIX path of (path to resource "launch.sh"))
APPLESCRIPT
rm -rf "$APP"
/usr/bin/osacompile -o "$APP" "$TMP/EMMA.applescript"
ESC_DIR="$(printf '%s' "$DIR" | sed 's/[&|\\]/\\&/g')"
sed "s|__EMMA_DIR__|$ESC_DIR|" "$DIR/app/assets/launch.sh" > "$APP/Contents/Resources/launch.sh"
cp "$DIR/app/assets/EMMA.icns" "$APP/Contents/Resources/applet.icns"
/usr/libexec/PlistBuddy -c "Set :CFBundleName EMMA" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string it.emma.marketintelligence" "$APP/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier it.emma.marketintelligence" "$APP/Contents/Info.plist" 2>/dev/null || true
touch "$APP"
ln -sfn "$APP" "$HOME/Desktop/EMMA.app"
rm -rf "$TMP"
echo "✓ EMMA.app created in $DEST and linked on the Desktop."
echo "  Double-click the EMMA icon. To keep it in the Dock, drag it there."
echo "  To start it at login: System Settings → General → Login Items → + → EMMA."
echo "  Opening EMMA… (the first start may install its libraries: about a minute)"
open "$APP"
