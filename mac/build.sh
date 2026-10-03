#!/bin/sh
# Builds "Claude Office.app", the menu bar app with its optional window, and installs it in ~/Applications.
# The repo location, bun and your PATH are baked in, so rebuild after moving the repo.
set -eu

cd "$(dirname "$0")/.."
REPO="$(pwd)"
BUN="$(command -v bun || true)"
if [ -z "$BUN" ]; then
  echo "bun is not on your PATH" >&2
  exit 1
fi

OUT="$REPO/mac/build/Claude Office.app"
rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS"

swiftc -O -o "$OUT/Contents/MacOS/ClaudeOffice" mac/ClaudeOffice.swift 2>&1 \
  || { echo "Swift build failed. Xcode command line tools are needed: xcode-select --install" >&2; exit 1; }

mkdir -p "$OUT/Contents/Resources"
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
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>OfficeRepo</key><string>$(xml "$REPO")</string>
  <key>OfficeBun</key><string>$(xml "$BUN")</string>
  <key>OfficePath</key><string>$(xml "$PATH")</string>
</dict>
</plist>
EOF

codesign --force --sign - "$OUT" >/dev/null 2>&1 || true

DEST="$HOME/Applications/Claude Office.app"
mkdir -p "$HOME/Applications"
# Quit a running copy so the new build replaces it cleanly.
osascript -e 'tell application id "local.claude-office.menubar" to quit' >/dev/null 2>&1 || true
rm -rf "$DEST"
cp -R "$OUT" "$DEST"
echo "Installed $DEST"

if [ "${1:-}" != "--no-open" ]; then
  open "$DEST"
fi
