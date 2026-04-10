#!/usr/bin/env bash
set -euo pipefail

# Build the JHT Desktop launcher for macOS:
# 1. cargo build --release
# 2. assemble a .app bundle
# 3. package it as a .dmg via hdiutil

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${LAUNCHER_DIR}"

APP_NAME="JHT Desktop"
BIN_NAME="jht-launcher"
BUNDLE_ID="com.leopu00.jht-desktop"
VERSION="0.1.0"

DIST_DIR="${LAUNCHER_DIR}/dist"
BUNDLE_DIR="${DIST_DIR}/${APP_NAME}.app"
DMG_PATH="${DIST_DIR}/JHT-Desktop-${VERSION}.dmg"

echo "==> cargo build --release"
cargo build --release

echo "==> assembling .app bundle"
rm -rf "${DIST_DIR}"
mkdir -p "${BUNDLE_DIR}/Contents/MacOS" "${BUNDLE_DIR}/Contents/Resources"

cp "target/release/${BIN_NAME}" "${BUNDLE_DIR}/Contents/MacOS/${BIN_NAME}"
chmod +x "${BUNDLE_DIR}/Contents/MacOS/${BIN_NAME}"

cat > "${BUNDLE_DIR}/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleExecutable</key><string>${BIN_NAME}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
</dict>
</plist>
PLIST

echo "==> creating .dmg"
# hdiutil UDZO = zlib-compressed read-only
STAGING_DIR="${DIST_DIR}/dmg-staging"
mkdir -p "${STAGING_DIR}"
cp -R "${BUNDLE_DIR}" "${STAGING_DIR}/"
ln -s /Applications "${STAGING_DIR}/Applications"

hdiutil create \
  -volname "${APP_NAME}" \
  -srcfolder "${STAGING_DIR}" \
  -ov \
  -format UDZO \
  "${DMG_PATH}"

rm -rf "${STAGING_DIR}"

echo ""
echo "Done."
echo "  App:  ${BUNDLE_DIR}"
echo "  DMG:  ${DMG_PATH}"
