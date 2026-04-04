#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# Job Hunter Team — Build Release Archives
# Genera pacchetti scaricabili per Mac, Linux e Windows
# Output: dist/job-hunter-team-{mac,linux,windows}.{tar.gz,zip}
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
BUILD_NAME="job-hunter-team"
VERSION=$(node -p "require('$ROOT_DIR/web/package.json').version" 2>/dev/null || echo "0.1.0")

GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info() { echo -e "${CYAN}[build]${NC} $1"; }
ok()   { echo -e "${GREEN}[done]${NC}  $1"; }

echo ""
echo -e "${GREEN}${BOLD}Build Release — Job Hunter Team v$VERSION${NC}"
echo ""

# ── Pulizia ──
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/staging"

STAGE="$DIST_DIR/staging/$BUILD_NAME"
mkdir -p "$STAGE"

# ── Copia file del progetto ──
info "Copia file del progetto..."

# Directories principali
for dir in web shared cli; do
  if [ -d "$ROOT_DIR/$dir" ]; then
    rsync -a --exclude='node_modules' --exclude='.next' --exclude='.turbo' \
      "$ROOT_DIR/$dir/" "$STAGE/$dir/"
  fi
done

# File root
for f in package.json package-lock.json requirements.txt; do
  [ -f "$ROOT_DIR/$f" ] && cp "$ROOT_DIR/$f" "$STAGE/"
done

ok "File copiati"

# ── Build Mac (.tar.gz) ──
info "Build pacchetto macOS..."
cp "$ROOT_DIR/scripts/launchers/start-mac.sh" "$STAGE/start.sh"
chmod +x "$STAGE/start.sh"
cd "$DIST_DIR/staging"
tar -czf "$DIST_DIR/${BUILD_NAME}-${VERSION}-mac.tar.gz" "$BUILD_NAME"
rm "$STAGE/start.sh"
ok "${BUILD_NAME}-${VERSION}-mac.tar.gz"

# ── Build Linux (.tar.gz) ──
info "Build pacchetto Linux..."
cp "$ROOT_DIR/scripts/launchers/start-linux.sh" "$STAGE/start.sh"
chmod +x "$STAGE/start.sh"
cd "$DIST_DIR/staging"
tar -czf "$DIST_DIR/${BUILD_NAME}-${VERSION}-linux.tar.gz" "$BUILD_NAME"
rm "$STAGE/start.sh"
ok "${BUILD_NAME}-${VERSION}-linux.tar.gz"

# ── Build Windows (.zip) ──
info "Build pacchetto Windows..."
cp "$ROOT_DIR/scripts/launchers/start-windows.bat" "$STAGE/start.bat"
cp "$ROOT_DIR/scripts/launchers/start-windows.ps1" "$STAGE/start.ps1"
cd "$DIST_DIR/staging"
zip -rq "$DIST_DIR/${BUILD_NAME}-${VERSION}-windows.zip" "$BUILD_NAME"
rm "$STAGE/start.bat" "$STAGE/start.ps1"
ok "${BUILD_NAME}-${VERSION}-windows.zip"

# ── Pulizia staging ──
rm -rf "$DIST_DIR/staging"

# ── Report ──
echo ""
echo -e "${GREEN}${BOLD}Build completata!${NC}"
echo ""
echo "  Pacchetti in $DIST_DIR:"
ls -lh "$DIST_DIR"/*.{tar.gz,zip} 2>/dev/null | awk '{print "    " $NF " (" $5 ")"}'
echo ""
echo "  Carica questi file su GitHub Releases per renderli scaricabili."
echo ""
