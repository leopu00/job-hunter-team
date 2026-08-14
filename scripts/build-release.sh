#!/usr/bin/env bash
# Job Hunter Team — build dell'unica applicazione desktop: il gioco Godot.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GAME_DIR="$ROOT_DIR/game"
TARGET="${1:-auto}"
GODOT_BIN="${GODOT:-godot}"

fail() { printf '[build] ERRORE: %s\n' "$*" >&2; exit 1; }
info() { printf '[build] %s\n' "$*"; }

detect_host_target() {
  case "$(uname -s)" in
    Darwin) echo "mac" ;;
    Linux) echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT) echo "windows" ;;
    *) fail "Host non supportato: $(uname -s)" ;;
  esac
}

case "$TARGET" in
  auto) TARGET="$(detect_host_target)" ;;
  win) TARGET="windows" ;;
  mac|linux|windows) ;;
  all) fail "Usa il workflow Release per compilare sui tre runner nativi." ;;
  *) fail "Target non valido: $TARGET (auto|mac|linux|windows)" ;;
esac

command -v "$GODOT_BIN" >/dev/null 2>&1 || fail "Godot 4.7 non trovato nel PATH."
[ -f "$GAME_DIR/project.godot" ] || fail "Progetto Godot non trovato: $GAME_DIR"

case "$TARGET" in
  mac)
    [ "$(uname -s)" = "Darwin" ] || fail "La build macOS richiede macOS."
    PRESET="macOS"
    OUTPUT="builds/macos/job-hunter-team.zip"
    ;;
  linux)
    [ "$(uname -s)" = "Linux" ] || fail "La build Linux richiede Linux."
    PRESET="Linux"
    OUTPUT="builds/linux/job-hunter-team.x86_64"
    ;;
  windows)
    case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*|Windows_NT) ;; *) fail "La build Windows richiede Windows." ;; esac
    PRESET="Windows Desktop"
    OUTPUT="builds/windows/job-hunter-team.exe"
    ;;
esac

info "Import e test del gioco…"
if [ "$TARGET" = "windows" ]; then
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$GAME_DIR/tools/run.ps1" test gate
else
  "$GAME_DIR/tools/run.sh" test gate
fi
info "Export $PRESET → game/$OUTPUT"
mkdir -p "$GAME_DIR/$(dirname "$OUTPUT")"
(
  cd "$GAME_DIR"
  "$GODOT_BIN" --headless --export-release "$PRESET" "$OUTPUT"
)
if [ "$TARGET" = "linux" ]; then
  chmod +x "$GAME_DIR/$OUTPUT"
  tar -C "$GAME_DIR/builds/linux" -czf "$GAME_DIR/builds/linux/job-hunter-team-linux-x64.tar.gz" \
    job-hunter-team.x86_64
fi
info "Build completata: $GAME_DIR/$OUTPUT"
