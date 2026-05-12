#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  jht — host-side setup preflight                                         ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  Eseguito dal wrapper PRIMA di entrare nel container, per le cose che    ║
# ║  il wizard Node nel container non puo' fare:                             ║
# ║                                                                          ║
# ║   1. Detect "VPS o computer locale"                                      ║
# ║   2. Su VPS con RAM bassa: configurare swap (richiede root + sysctl)     ║
# ║                                                                          ║
# ║  Idempotente: se lo swap e' gia' attivo o l'utente sceglie "no",         ║
# ║  esce 0 senza modificare nulla.                                          ║
# ║                                                                          ║
# ║  Skip via env JHT_SKIP_HOST_SETUP=1 (es. --non-interactive nel wrapper). ║
# ║                                                                          ║
# ╚══════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

# ── Colori ───────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD='\033[1m'; CYAN='\033[1;36m'; GREEN='\033[0;32m'
  YELLOW='\033[1;33m'; DIM='\033[2m'; RESET='\033[0m'
else
  BOLD=''; CYAN=''; GREEN=''; YELLOW=''; DIM=''; RESET=''
fi

info() { printf "${DIM}%s${RESET}\n" "$*"; }
ok()   { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${RESET} %s\n" "$*"; }

# ── Skip path ────────────────────────────────────────────────────────────
if [ "${JHT_SKIP_HOST_SETUP:-0}" = "1" ]; then
  exit 0
fi

# ── Detect VPS ───────────────────────────────────────────────────────────
# Heuristica: linux + (root OR no display) + (no battery OR cloud-init present)
# Niente euristica e' al 100%: chiediamo sempre conferma all'utente.
detect_vps() {
  # Solo Linux (Mac e' tipicamente locale)
  [ "$(uname -s)" = "Linux" ] || return 1
  # Nessun DISPLAY/Wayland → probabile headless (server)
  if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
    return 1
  fi
  # Battery presente? Se sì, è un laptop
  if compgen -G "/sys/class/power_supply/BAT*" >/dev/null 2>&1; then
    return 1
  fi
  # cloud-init / hetzner / vultr / digitalocean signature
  if [ -d /var/lib/cloud ] || [ -f /etc/cloud/cloud.cfg ]; then
    return 0
  fi
  # systemd-detect-virt (se disponibile) → kvm/qemu = VPS
  if command -v systemd-detect-virt >/dev/null 2>&1; then
    case "$(systemd-detect-virt 2>/dev/null || echo none)" in
      kvm|qemu|vmware|xen|microsoft|amazon) return 0 ;;
    esac
  fi
  # Default linux server senza GUI: probabile VPS
  return 0
}

if detect_vps; then
  DETECTED="vps"
  DETECTED_LABEL="${BOLD}server remoto / VPS${RESET}"
else
  DETECTED="local"
  DETECTED_LABEL="${BOLD}computer locale${RESET}"
fi

printf "\n${CYAN}━━━ Setup host (preflight) ━━━${RESET}\n\n"
printf "Rilevato: %b\n" "$DETECTED_LABEL"

# ── Conferma utente ──────────────────────────────────────────────────────
# Bash read; se stdin non e' TTY (es. curl|bash) usa il default detected.
# Niente finta-checkbox `[V]`/`[ ]`: era ambigua (sembrava interattiva).
# Il default va tra parentesi quadre nel prompt, premere Invio lo accetta.
HOST_TYPE="$DETECTED"
if [ -t 0 ]; then
  if [ "$DETECTED" = "vps" ]; then
    DEFAULT_NUM=2
  else
    DEFAULT_NUM=1
  fi
  printf "\n%s\n\n" "Dove stai eseguendo JHT?"
  printf "  1) ${BOLD}Computer locale${RESET}\n"
  printf "     ${DIM}Stai usando JHT sul tuo PC, accessibile solo da te in rete locale.${RESET}\n"
  printf "     ${DIM}La dashboard web si apre automaticamente.${RESET}\n\n"
  printf "  2) ${BOLD}Server remoto / VPS${RESET}\n"
  printf "     ${DIM}JHT gira su un server cloud raggiungibile via IP pubblico.${RESET}\n"
  printf "     ${DIM}Servono passi extra per esporre la dashboard in sicurezza.${RESET}\n\n"
  printf "Scelta [%d]: " "$DEFAULT_NUM"
  read -r CHOICE
  case "$CHOICE" in
    1) HOST_TYPE="local" ;;
    2) HOST_TYPE="vps" ;;
    "") HOST_TYPE="$DETECTED" ;;
    *) warn "Scelta non valida — uso default ($DETECTED)"; HOST_TYPE="$DETECTED" ;;
  esac
fi

# Persisti la scelta in ~/.jht/host.env cosi' il wrapper bash + il wizard
# Node sanno se siamo su VPS (per attivare step obbligatori cloud + telegram).
JHT_HOME_HOST="${JHT_HOME_HOST:-$HOME/.jht}"
mkdir -p "$JHT_HOME_HOST" 2>/dev/null || true
printf 'JHT_HOST_TYPE=%s\n' "$HOST_TYPE" > "$JHT_HOME_HOST/host.env"

if [ "$HOST_TYPE" = "local" ]; then
  ok "Host: computer locale — nessuna configurazione swap richiesta"
  exit 0
fi

ok "Host: server remoto / VPS"

# ── Check RAM e swap esistente ───────────────────────────────────────────
RAM_KB=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
RAM_GB=$(( (RAM_KB + 524288) / 1048576 ))   # round to GB
SWAP_KB=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
SWAP_MB=$(( SWAP_KB / 1024 ))

info "RAM: ${RAM_GB} GB  |  Swap attivo: ${SWAP_MB} MB"

# Swap policy:
# - se gia' >= 1024 MB: ok, skip
# - se RAM >= 8 GB: skip (non serve)
# - altrimenti: chiedi
if [ "$SWAP_MB" -ge 1024 ]; then
  ok "Swap gia' configurato (${SWAP_MB} MB) — skip"
  exit 0
fi

if [ "$RAM_GB" -ge 8 ]; then
  ok "RAM sufficiente (${RAM_GB} GB) — swap non necessaria, skip"
  exit 0
fi

# ── Proposta swap ────────────────────────────────────────────────────────
SWAP_SIZE_GB=2
SWAP_FILE=/swapfile

# Versione sintetica: 1 riga di motivo (era 4 — l'utente accetta sempre).
printf "\n${DIM}Con %d GB di RAM il team puo' andare in OOM sotto carico.${RESET}\n" "$RAM_GB"
printf "Configuro %d GB di swap in %s? [Y/n]: " "$SWAP_SIZE_GB" "$SWAP_FILE"

DO_SWAP=1
if [ -t 0 ]; then
  read -r ANSWER
  case "$ANSWER" in
    n|N|no|NO) DO_SWAP=0 ;;
    *)         DO_SWAP=1 ;;
  esac
else
  printf "${DIM}(stdin non interattivo, applico default Y)${RESET}\n"
fi

if [ "$DO_SWAP" = "0" ]; then
  warn "Swap non configurata — il team potrebbe crashare sotto carico"
  exit 0
fi

# ── Configura swap (richiede root) ───────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  warn "Servono privilegi root per configurare la swap"
  if command -v sudo >/dev/null 2>&1; then
    info "Provo con sudo..."
    SUDO=sudo
  else
    warn "sudo non disponibile — skip swap. Configura manualmente piu' tardi."
    exit 0
  fi
else
  SUDO=""
fi

info "Creo $SWAP_FILE da ${SWAP_SIZE_GB} GB..."
$SUDO fallocate -l "${SWAP_SIZE_GB}G" "$SWAP_FILE" 2>/dev/null \
  || $SUDO dd if=/dev/zero of="$SWAP_FILE" bs=1M count=$((SWAP_SIZE_GB * 1024)) status=none
$SUDO chmod 600 "$SWAP_FILE"
$SUDO mkswap "$SWAP_FILE" >/dev/null
$SUDO swapon "$SWAP_FILE"

# Persiste in /etc/fstab (idempotente)
if ! grep -q "^${SWAP_FILE} " /etc/fstab 2>/dev/null; then
  printf '%s none swap sw 0 0\n' "$SWAP_FILE" | $SUDO tee -a /etc/fstab >/dev/null
fi

NEW_SWAP_MB=$(awk '/^SwapTotal:/ {print int($2/1024)}' /proc/meminfo)
ok "Swap attiva: ${NEW_SWAP_MB} MB (persiste a reboot via /etc/fstab)"

exit 0
