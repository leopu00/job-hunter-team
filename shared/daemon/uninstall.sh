#!/usr/bin/env bash
# Remove a JHT service installed with install.sh.
#
# Usage:
#   ./shared/daemon/uninstall.sh --name jht-gateway
#   ./shared/daemon/uninstall.sh --name jht-cron
#
# Options:
#   --name NAME    Name of the service to remove (required)
#   --purge-logs   Also delete the log files
#   -h, --help     Show this message

set -euo pipefail

JHT_HOME="${JHT_HOME:-$HOME/.jht}"
JHT_LOG_DIR="${JHT_LOG_DIR:-$JHT_HOME/logs}"

SERVICE_NAME=""
PURGE_LOGS=false

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
err() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2; }
die() { err "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Argomenti
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)       SERVICE_NAME="$2"; shift 2 ;;
    --purge-logs) PURGE_LOGS=true;   shift   ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

[[ -n "$SERVICE_NAME" ]] || die "--name is required"

# ---------------------------------------------------------------------------
# macOS — rimuove LaunchAgent
# ---------------------------------------------------------------------------
uninstall_macos() {
  local label="com.jht.${SERVICE_NAME}"
  local plist_path="$HOME/Library/LaunchAgents/${label}.plist"
  local domain="gui/$(id -u)"

  log "Removing LaunchAgent: $label"

  launchctl bootout "${domain}/${label}" 2>/dev/null || true
  launchctl unload "$plist_path"         2>/dev/null || true

  if [[ -f "$plist_path" ]]; then
    local trash="$HOME/.Trash"
    mkdir -p "$trash"
    local dest="$trash/${label}.plist"
    mv "$plist_path" "$dest" && log "Moved to Trash: $dest" \
      || { rm -f "$plist_path"; log "Deleted: $plist_path"; }
  else
    log "Plist not found: $plist_path — already removed?"
  fi
}

# ---------------------------------------------------------------------------
# Linux — rimuove unità systemd utente
# ---------------------------------------------------------------------------
uninstall_linux() {
  local unit_name="jht-${SERVICE_NAME}.service"
  local unit_path="$HOME/.config/systemd/user/${unit_name}"

  log "Removing systemd service: $unit_name"

  systemctl --user stop    "${unit_name}" 2>/dev/null || true
  systemctl --user disable "${unit_name}" 2>/dev/null || true

  if [[ -f "$unit_path" ]]; then
    rm -f "$unit_path"
    log "Unit deleted: $unit_path"
  else
    log "Unit not found: $unit_path — already removed?"
  fi

  systemctl --user daemon-reload
}

# ---------------------------------------------------------------------------
# Dispatch per OS
# ---------------------------------------------------------------------------
case "$(uname -s)" in
  Darwin) uninstall_macos ;;
  Linux)  uninstall_linux ;;
  *)      die "Unsupported operating system: $(uname -s)" ;;
esac

# ---------------------------------------------------------------------------
# Pulizia log (opzionale)
# ---------------------------------------------------------------------------
if $PURGE_LOGS; then
  for f in "$JHT_LOG_DIR/${SERVICE_NAME}.log" "$JHT_LOG_DIR/${SERVICE_NAME}.err.log"; do
    if [[ -f "$f" ]]; then
      rm -f "$f"
      log "Log deleted: $f"
    fi
  done
fi

log "Service '${SERVICE_NAME}' removed."
