#!/usr/bin/env bash
# Installa JHT come servizio sempre attivo.
#
# Su macOS: LaunchAgent (launchd) in ~/Library/LaunchAgents/
# Su Linux: servizio utente systemd in ~/.config/systemd/user/
#
# Uso:
#   ./shared/daemon/install.sh --name jht-gateway --cmd "node /path/to/entry.js"
#   ./shared/daemon/install.sh --name jht-cron    --cmd "node /path/to/cron.js"
#
# Opzioni:
#   --name NAME    Nome univoco del servizio (obbligatorio)
#   --cmd  CMD     Comando da eseguire (obbligatorio)
#   --dir  DIR     Working directory (default: $HOME)
#   --env  KEY=VAL Variabile d'ambiente aggiuntiva (ripetibile)
#   -h, --help     Mostra questo messaggio

set -euo pipefail

JHT_WORKSPACE="${JHT_WORKSPACE:-$HOME/.jht}"
JHT_LOG_DIR="${JHT_LOG_DIR:-$JHT_WORKSPACE/logs}"

SERVICE_NAME=""
SERVICE_CMD=""
WORK_DIR="$HOME"
EXTRA_ENV=()

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
err()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERRORE: $*" >&2; }
die()  { err "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Argomenti
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) SERVICE_NAME="$2"; shift 2 ;;
    --cmd)  SERVICE_CMD="$2";  shift 2 ;;
    --dir)  WORK_DIR="$2";     shift 2 ;;
    --env)  EXTRA_ENV+=("$2"); shift 2 ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *) die "Opzione sconosciuta: $1" ;;
  esac
done

[[ -n "$SERVICE_NAME" ]] || die "--name obbligatorio"
[[ -n "$SERVICE_CMD"  ]] || die "--cmd obbligatorio"

mkdir -p "$JHT_LOG_DIR"
LOG_OUT="$JHT_LOG_DIR/${SERVICE_NAME}.log"
LOG_ERR="$JHT_LOG_DIR/${SERVICE_NAME}.err.log"

# ---------------------------------------------------------------------------
# macOS — launchd LaunchAgent
# ---------------------------------------------------------------------------
install_macos() {
  local label="com.jht.${SERVICE_NAME}"
  local agents_dir="$HOME/Library/LaunchAgents"
  local plist_path="$agents_dir/${label}.plist"

  mkdir -p "$agents_dir"
  chmod 755 "$agents_dir"

  # Costruisce il blocco EnvironmentVariables se servono variabili extra
  local env_block=""
  if [[ ${#EXTRA_ENV[@]} -gt 0 ]]; then
    env_block=$'\n    <key>EnvironmentVariables</key>\n    <dict>'
    for kv in "${EXTRA_ENV[@]}"; do
      local k="${kv%%=*}"
      local v="${kv#*=}"
      env_block+=$"\n      <key>${k}</key>\n      <string>${v}</string>"
    done
    env_block+=$'\n    </dict>'
  fi

  cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>1</integer>
    <key>Umask</key>
    <integer>63</integer>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>-c</string>
      <string>${SERVICE_CMD}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${WORK_DIR}</string>
    <key>StandardOutPath</key>
    <string>${LOG_OUT}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_ERR}</string>${env_block}
  </dict>
</plist>
PLIST

  chmod 644 "$plist_path"

  # Rimuove versione precedente se caricata
  local domain="gui/$(id -u)"
  launchctl bootout "${domain}/${label}" 2>/dev/null || true
  launchctl unload "$plist_path"        2>/dev/null || true

  launchctl enable "${domain}/${label}"
  launchctl bootstrap "$domain" "$plist_path"

  log "LaunchAgent installato: $plist_path"
  log "Log: $LOG_OUT"
}

# ---------------------------------------------------------------------------
# Linux — systemd servizio utente
# ---------------------------------------------------------------------------
install_linux() {
  local unit_name="jht-${SERVICE_NAME}.service"
  local unit_dir="$HOME/.config/systemd/user"
  local unit_path="$unit_dir/${unit_name}"

  mkdir -p "$unit_dir"

  # Costruisce righe Environment= aggiuntive
  local env_lines=""
  for kv in "${EXTRA_ENV[@]}"; do
    env_lines+=$"\nEnvironment=${kv}"
  done

  cat > "$unit_path" <<UNIT
[Unit]
Description=JHT ${SERVICE_NAME} — Job Hunter Team
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/bin/bash -c '${SERVICE_CMD}'
WorkingDirectory=${WORK_DIR}
Restart=always
RestartSec=5
TimeoutStopSec=30
TimeoutStartSec=30
SuccessExitStatus=0 143
KillMode=control-group
StandardOutput=append:${LOG_OUT}
StandardError=append:${LOG_ERR}${env_lines}

[Install]
WantedBy=default.target
UNIT

  systemctl --user daemon-reload
  systemctl --user enable "${unit_name}"
  systemctl --user start  "${unit_name}"

  log "Servizio systemd installato: $unit_path"
  log "Log: journalctl --user -u ${unit_name} -f"
}

# ---------------------------------------------------------------------------
# Dispatch per OS
# ---------------------------------------------------------------------------
case "$(uname -s)" in
  Darwin) install_macos ;;
  Linux)  install_linux ;;
  *)      die "Sistema operativo non supportato: $(uname -s)" ;;
esac

log "Servizio '${SERVICE_NAME}' avviato. Usa uninstall.sh per rimuoverlo."
