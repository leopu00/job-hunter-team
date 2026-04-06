#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# Job Hunter Team — Desktop Release Builder
# Costruisce i pacchetti Electron nativi per il sistema corrente
# o per un target esplicito supportato dall'host.
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"
TARGET="${1:-auto}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info() { echo -e "${CYAN}[build]${NC} $1"; }
ok()   { echo -e "${GREEN}[done]${NC}  $1"; }
warn() { echo -e "${YELLOW}[warn]${NC}  $1"; }
fail() { echo -e "${RED}[err]${NC}   $1"; exit 1; }

detect_host_target() {
  case "$(uname -s)" in
    Darwin) echo "mac" ;;
    Linux) echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT) echo "windows" ;;
    *) fail "Host non supportato: $(uname -s)" ;;
  esac
}

resolve_target() {
  case "$1" in
    auto) detect_host_target ;;
    mac|linux|windows) echo "$1" ;;
    win) echo "windows" ;;
    all)
      fail "Build cross-platform complete: usa il workflow GitHub Release, che compila macOS/Windows/Linux sui runner nativi."
      ;;
    *)
      fail "Target non valido: $1 (usa: auto, mac, linux, windows)"
      ;;
  esac
}

run_build() {
  case "$1" in
    mac) npm --prefix "$DESKTOP_DIR" run dist:mac ;;
    linux) npm --prefix "$DESKTOP_DIR" run dist:linux ;;
    windows) npm --prefix "$DESKTOP_DIR" run dist:win ;;
    *) fail "Target non gestito: $1" ;;
  esac
}

FINAL_TARGET="$(resolve_target "$TARGET")"

echo ""
echo -e "${GREEN}${BOLD}Desktop Release Build — target: ${FINAL_TARGET}${NC}"
echo ""

if ! command -v npm >/dev/null 2>&1; then
  fail "npm non trovato. Installa Node.js 20+ prima di creare i pacchetti desktop."
fi

if [ ! -f "$DESKTOP_DIR/package.json" ]; then
  fail "Directory desktop/ non trovata in $ROOT_DIR"
fi

case "$FINAL_TARGET" in
  mac)
    [ "$(uname -s)" = "Darwin" ] || fail "Il pacchetto macOS va generato da macOS."
    ;;
  linux)
    [ "$(uname -s)" = "Linux" ] || fail "Il pacchetto Linux va generato da Linux."
    ;;
  windows)
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*|Windows_NT) ;;
      *) fail "Il pacchetto Windows va generato da Windows oppure dal workflow GitHub Release." ;;
    esac
    ;;
esac

info "Eseguo il build desktop per ${FINAL_TARGET}..."
run_build "$FINAL_TARGET"

echo ""
ok "Build completata. Artefatti in $DESKTOP_DIR/dist"
echo ""
find "$DESKTOP_DIR/dist" -maxdepth 1 -type f | sort | sed 's#^#  - #'
echo ""
warn "Per pubblicare tutti i pacchetti insieme usa il workflow GitHub Release, che crea macOS, Windows e Linux in parallelo."
echo ""
