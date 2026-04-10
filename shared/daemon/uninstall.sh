#!/usr/bin/env bash
# Rimuove un servizio JHT installato con install.sh.
#
# Uso:
#   ./shared/daemon/uninstall.sh --name jht-gateway
#   ./shared/daemon/uninstall.sh --name jht-cron
#
# Opzioni:
#   --name NAME    Nome del servizio da rimuovere (obbligatorio)
#   --purge-logs   Elimina anche i file di log
#   -h, --help     Mostra questo messaggio

set -euo pipefail

JHT_HOME="${JHT_HOME:-$HOME/.jht}"
JHT_LOG_DIR="${JHT_LOG_DIR:-$JHT_HOME/logs}"

SERVICE_NAME=""
PURGE_LOGS=false

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
err() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERRORE: $*" >&2; }
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
    *) die "Opzione sconosciuta: $1" ;;
  esac
done

[[ -n "$SERVICE_NAME" ]] || die "--name obbligatorio"

# ---------------------------------------------------------------------------
# macOS — rimuove LaunchAgent
# ---------------------------------------------------------------------------
uninstall_macos() {
  local label="com.jht.${SERVICE_NAME}"
  local plist_path="$HOME/Library/LaunchAgents/${label}.plist"
  local domain="gui/$(id -u)"

  log "Rimozione LaunchAgent: $label"

  launchctl bootout "${domain}/${label}" 2>/dev/null || true
  launchctl unload "$plist_path"         2>/dev/null || true

  if [[ -f "$plist_path" ]]; then
    local trash="$HOME/.Trash"
    mkdir -p "$trash"
    local dest="$trash/${label}.plist"
    mv "$plist_path" "$dest" && log "Spostato nel Cestino: $dest" \
      || { rm -f "$plist_path"; log "Eliminato: $plist_path"; }
  else
    log "Plist non trovato: $plist_path — già rimosso?"
  fi
}

# ---------------------------------------------------------------------------
# Linux — rimuove unità systemd utente
# ---------------------------------------------------------------------------
uninstall_linux() {
  local unit_name="jht-${SERVICE_NAME}.service"
  local unit_path="$HOME/.config/systemd/user/${unit_name}"

  log "Rimozione servizio systemd: $unit_name"

  systemctl --user stop    "${unit_name}" 2>/dev/null || true
  systemctl --user disable "${unit_name}" 2>/dev/null || true

  if [[ -f "$unit_path" ]]; then
    rm -f "$unit_path"
    log "Unit eliminata: $unit_path"
  else
    log "Unit non trovata: $unit_path — già rimossa?"
  fi

  systemctl --user daemon-reload
}

# ---------------------------------------------------------------------------
# Dispatch per OS
# ---------------------------------------------------------------------------
case "$(uname -s)" in
  Darwin) uninstall_macos ;;
  Linux)  uninstall_linux ;;
  *)      die "Sistema operativo non supportato: $(uname -s)" ;;
esac

# ---------------------------------------------------------------------------
# Pulizia log (opzionale)
# ---------------------------------------------------------------------------
if $PURGE_LOGS; then
  for f in "$JHT_LOG_DIR/${SERVICE_NAME}.log" "$JHT_LOG_DIR/${SERVICE_NAME}.err.log"; do
    if [[ -f "$f" ]]; then
      rm -f "$f"
      log "Log eliminato: $f"
    fi
  done
fi

log "Servizio '${SERVICE_NAME}' rimosso."
