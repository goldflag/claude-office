#!/bin/sh
# Builds "Claude Office.app", the menu bar app, and installs it in ~/Applications.
# The server (which doubles as the hook installer) and the 3D models go into the app,
# so it runs without this repo; rebuild it to pick up changes to the code.
# Also writes mac/build/Claude Office.zip for giving the app to someone else.
set -eu

cd "$(dirname "$0")/.."
REPO="$(pwd)"
if ! command -v bun >/dev/null; then
  echo "bun is not on your PATH" >&2
  exit 1
fi

BUILD="$REPO/mac/build"
OUT="$BUILD/Claude Office.app"
rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"

swiftc -O -o "$OUT/Contents/MacOS/ClaudeOffice" mac/Sources/*.swift 2>&1 \
  || { echo "Swift build failed. Xcode command line tools are needed: xcode-select --install" >&2; exit 1; }

# --production makes Bun bundle the page into the binary instead of serving it for HMR.
# The NODE_ENV variable alone is not enough: the page then keeps the dev JSX calls and
# crashes at startup ("d is not a function") against production React.
bun build --compile --production mac/entry.ts --outfile "$OUT/Contents/Resources/office-server" >/dev/null
mkdir -p "$OUT/Contents/Resources/public"
cp -R public/models "$OUT/Contents/Resources/public/models"

ICONSET="$(mktemp -d)/AppIcon.iconset"
"$OUT/Contents/MacOS/ClaudeOffice" --iconset "$ICONSET"
iconutil -c icns -o "$OUT/Contents/Resources/AppIcon.icns" "$ICONSET"
rm -rf "$(dirname "$ICONSET")"

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

cat > "$OUT/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Claude Office</string>
  <key>CFBundleDisplayName</key><string>Claude Office</string>
  <key>CFBundleIdentifier</key><string>local.claude-office.menubar</string>
  <key>CFBundleExecutable</key><string>ClaudeOffice</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.1</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>OfficePath</key><string>$(xml "$PATH")</string>
</dict>
</plist>
EOF

codesign --force --deep --sign - "$OUT" >/dev/null 2>&1 || true
rm -f "$BUILD/Claude Office.zip"
ditto -c -k --keepParent "$OUT" "$BUILD/Claude Office.zip"

DEST="$HOME/Applications/Claude Office.app"
mkdir -p "$HOME/Applications"
# Quit a running copy so the new build replaces it cleanly.
osascript -e 'tell application id "local.claude-office.menubar" to quit' >/dev/null 2>&1 || true
sleep 1
rm -rf "$DEST"
cp -R "$OUT" "$DEST"
echo "Installed $DEST"
echo "Shareable copy: $BUILD/Claude Office.zip"

if [ "${1:-}" != "--no-open" ]; then
  open "$DEST"
fi
