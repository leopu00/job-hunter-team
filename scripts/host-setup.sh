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

# ── Flag parser ──────────────────────────────────────────────────────────
# --host-type=vps|local salta sia la lingua picker sia la detection prompt.
# Usato da install.sh quando viene invocato con --pairing-token: il flusso
# il setup VPS sa già che si tratta di una VPS, non c'è utente al terminale.
FORCED_HOST_TYPE=""
NON_INTERACTIVE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --host-type=*) FORCED_HOST_TYPE="${1#*=}" ;;
    --host-type)   FORCED_HOST_TYPE="$2"; shift ;;
    --non-interactive) NON_INTERACTIVE=1 ;;
    *) warn "Ignoring argument: $1" ;;
  esac
  shift
done
case "$FORCED_HOST_TYPE" in
  ""|vps|local) : ;;
  *) warn "Invalid --host-type ($FORCED_HOST_TYPE) — ignoring it"; FORCED_HOST_TYPE="" ;;
esac
[ -n "$FORCED_HOST_TYPE" ] && NON_INTERACTIVE=1

# ── Language picker (first prompt) ───────────────────────────────────────
# Default English (allineato con la regola lang_picker_default_english
# dell'app nativa): la grande maggioranza degli utenti non e' italiana, ed
# e' la lingua naturale di un setup terminale.
# Persistiamo in ~/.jht/host.env come JHT_LANG=en|it cosi' il wizard Node
# e i prossimi run di host-setup hanno il valore pronto. Il pre-fill
# evita di richiedere la scelta a ogni invocazione.
JHT_HOME_HOST="${JHT_HOME_HOST:-$HOME/.jht}"
HOST_ENV_PATH="$JHT_HOME_HOST/host.env"
JHT_LANG_DEFAULT=en
# Priorità lookup: env JHT_LANG > host.env > default 'en'. L'env vince
# perché il setup in-game la passa esplicitamente quando rilancia
# host-setup non-interactive (la scelta lingua viene fatta nel desktop).
if [ -n "${JHT_LANG:-}" ]; then
  JHT_LANG_DEFAULT="$JHT_LANG"
elif [ -f "$HOST_ENV_PATH" ]; then
  # shellcheck disable=SC1090
  EXISTING_LANG=$(. "$HOST_ENV_PATH" 2>/dev/null; printf %s "${JHT_LANG:-}")
  if [ -n "$EXISTING_LANG" ]; then
    JHT_LANG_DEFAULT="$EXISTING_LANG"
  fi
fi
JHT_LANG="$JHT_LANG_DEFAULT"
if [ -t 0 ] && [ "$NON_INTERACTIVE" -eq 0 ]; then
  # Picker multilingue: il prompt resta in più lingue perché ovviamente
  # prima della scelta non sappiamo cosa renderizzare.
  case "$JHT_LANG_DEFAULT" in
    it) DEFAULT_LABEL="[2]" ;;
    hu) DEFAULT_LABEL="[3]" ;;
    es) DEFAULT_LABEL="[4]" ;;
    de) DEFAULT_LABEL="[5]" ;;
    fr) DEFAULT_LABEL="[6]" ;;
    pt) DEFAULT_LABEL="[7]" ;;
    *)  DEFAULT_LABEL="[1]" ;;
  esac
  printf "\n${CYAN}━━━ Setup host (preflight) ━━━${RESET}\n\n"
  printf "Choose your language / Scegli la lingua / Válassz nyelvet / Elige tu idioma / Wähle deine Sprache / Choisis ta langue / Escolha seu idioma:\n\n"
  printf "  1) ${BOLD}English${RESET}\n"
  printf "  2) ${BOLD}Italiano${RESET}\n"
  printf "  3) ${BOLD}Magyar${RESET}\n"
  printf "  4) ${BOLD}Español${RESET}\n"
  printf "  5) ${BOLD}Deutsch${RESET}\n"
  printf "  6) ${BOLD}Français${RESET}\n"
  printf "  7) ${BOLD}Português${RESET}\n\n"
  printf "Choice / Scelta / Választás / Elección / Auswahl / Choix / Escolha %s: " "$DEFAULT_LABEL"
  read -r LANG_CHOICE
  case "$LANG_CHOICE" in
    1) JHT_LANG=en ;;
    2) JHT_LANG=it ;;
    3) JHT_LANG=hu ;;
    4) JHT_LANG=es ;;
    5) JHT_LANG=de ;;
    6) JHT_LANG=fr ;;
    7) JHT_LANG=pt ;;
    "") : ;;  # accept default already in JHT_LANG
    *) warn "Invalid / non valido / érvénytelen / no válido / ungültig / non valide / inválido — using default ($JHT_LANG)" ;;
  esac
fi
ok "Language / Lingua / Nyelv / Idioma / Sprache / Langue / Idioma: $JHT_LANG"

# Persist subito cosi' se host-setup viene interrotto/relaunchato la
# scelta resta valida. Il blocco "host type + swap" piu' giu' aggiunge
# JHT_HOST_TYPE allo stesso file.
mkdir -p "$JHT_HOME_HOST" 2>/dev/null || true
printf 'JHT_LANG=%s\n' "$JHT_LANG" > "$HOST_ENV_PATH"

# ── i18n: source catalogo locales dopo scelta lingua ────────────────────
# Da qui in poi tutti i prompt utente passano per t()/tf() che leggono
# shared/locales/<JHT_LANG>.json. Se il catalogo non c'è (es. checkout
# parziale), hardcoded English fallbacks are used inline.
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_REPO_ROOT="$(cd "$_SCRIPT_DIR/.." && pwd)"
if [ -f "$_REPO_ROOT/shared/i18n.sh" ]; then
  export JHT_LANG
  # shellcheck disable=SC1091
  source "$_REPO_ROOT/shared/i18n.sh"
fi
# Safe helper: use t() when available, otherwise return the inline English default.
ts() {
  if declare -F t >/dev/null 2>&1; then t "$1"; else printf '%s' "$2"; fi
}

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
  DETECTED_LABEL="${BOLD}$(ts host_setup.host.vps 'remote server / VPS')${RESET}"
else
  DETECTED="local"
  DETECTED_LABEL="${BOLD}$(ts host_setup.host.local 'local computer')${RESET}"
fi

printf "\n${CYAN}━━━ %s ━━━${RESET}\n\n" "$(ts host_setup.section_header 'Setup host (preflight)')"
printf "%s %b\n" "$(ts host_setup.detected 'Detected:')" "$DETECTED_LABEL"

# ── Conferma utente ──────────────────────────────────────────────────────
# Bash read; se stdin non e' TTY (es. curl|bash) usa il default detected.
# Niente finta-checkbox `[V]`/`[ ]`: era ambigua (sembrava interattiva).
# Il default va tra parentesi quadre nel prompt, premere Invio lo accetta.
HOST_TYPE="$DETECTED"
# Override esplicito via --host-type: il flusso VPS in-game lo passa per
# evitare la prompt (non c'è utente al terminale durante install.sh remoto).
if [ -n "$FORCED_HOST_TYPE" ]; then
  HOST_TYPE="$FORCED_HOST_TYPE"
fi
if [ -t 0 ] && [ "$NON_INTERACTIVE" -eq 0 ]; then
  if [ "$DETECTED" = "vps" ]; then
    DEFAULT_NUM=2
  else
    DEFAULT_NUM=1
  fi
  printf "\n%s\n\n" "$(ts host_setup.where_running 'Where are you running JHT?')"
  printf "  1) ${BOLD}%s${RESET}\n" "$(ts host_setup.option.local.title 'Local computer')"
  printf "     ${DIM}%s${RESET}\n" "$(ts host_setup.option.local.line1 'You are using JHT on your own PC, accessible only to you on the local network.')"
  printf "     ${DIM}%s${RESET}\n\n" "$(ts host_setup.option.local.line2 'The web dashboard opens automatically.')"
  printf "  2) ${BOLD}%s${RESET}\n" "$(ts host_setup.option.vps.title 'Remote server / VPS')"
  printf "     ${DIM}%s${RESET}\n" "$(ts host_setup.option.vps.line1 'JHT runs on a cloud server reachable via public IP.')"
  printf "     ${DIM}%s${RESET}\n\n" "$(ts host_setup.option.vps.line2 'Extra steps are needed to expose the dashboard securely.')"
  printf "%s [%d]: " "$(ts host_setup.choice_prompt 'Choice')" "$DEFAULT_NUM"
  read -r CHOICE
  case "$CHOICE" in
    1) HOST_TYPE="local" ;;
    2) HOST_TYPE="vps" ;;
    "") HOST_TYPE="$DETECTED" ;;
    *) warn "$(ts error.invalid_input 'Invalid choice') — using default ($DETECTED)"; HOST_TYPE="$DETECTED" ;;
  esac
fi

# ── Timezone utente (bug #15) ────────────────────────────────────────────
# Il container Linux gira sempre in UTC; l'utente sta da qualche parte
# nel mondo. Senza una timezone esplicita, il Capitano scrive "reset alle
# 23:11" e l'utente legge i suoi 23:22 locali pensando "11 min fa" quando
# in realtà il reset è fra 2h. Per evitare hardcoding (es. Europe/Rome
# default sbagliato per chi sta in CN/US), chiediamo all'utente. Detect
# euristica dal sistema host come proposta di default; l'utente conferma
# o sostituisce.
JHT_USER_TZ_DEFAULT="UTC"
# 1. system detection (buona proposta su install LOCALE; su VPS il TZ del
#    server è quasi sempre UTC e NON è il fuso dell'utente — vedi step 2).
if [ -r /etc/timezone ]; then
  _tz=$(tr -d '[:space:]' < /etc/timezone 2>/dev/null || true)
  [ -n "$_tz" ] && JHT_USER_TZ_DEFAULT="$_tz"
fi
# host /etc/localtime symlink (più affidabile su macOS host)
if [ -L /etc/localtime ]; then
  _tz=$(readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||')
  [ -n "$_tz" ] && JHT_USER_TZ_DEFAULT="$_tz"
fi
# 2. TZ esplicito dal caller/wizard (env JHT_USER_TZ = tz del BROWSER utente)
#    — VINCE sul system: su VPS il fuso reale arriva dal browser, non dal
#    server. Bug #13 (beta tester 2026-06-03): VPS=UTC ma utente Europe/Rome
#    → orari sfasati di 2h nei messaggi del Capitano.
if [ -n "${JHT_USER_TZ:-}" ] && python3 -c "from zoneinfo import ZoneInfo; ZoneInfo('${JHT_USER_TZ}')" 2>/dev/null; then
  JHT_USER_TZ_DEFAULT="$JHT_USER_TZ"
fi
# 3. Esiste già in host.env? Skip prompt, riusa (scelta confermata in un
#    install precedente — priorità massima).
if [ -f "$HOST_ENV_PATH" ]; then
  EXISTING_TZ=$(. "$HOST_ENV_PATH" 2>/dev/null; printf %s "${JHT_USER_TZ:-}")
  if [ -n "$EXISTING_TZ" ]; then
    JHT_USER_TZ_DEFAULT="$EXISTING_TZ"
  fi
fi

JHT_USER_TZ="$JHT_USER_TZ_DEFAULT"
if [ -t 0 ] && [ "$NON_INTERACTIVE" -eq 0 ]; then
  printf "\n${CYAN}━━━ %s ━━━${RESET}\n\n" "$(ts host_setup.timezone_header 'User timezone')"
  printf "%s\n" "$(ts host_setup.timezone_prompt 'Where are you (IANA timezone, e.g. Europe/Rome, America/New_York, Asia/Shanghai)?')"
  printf "%s\n\n" "$(ts host_setup.timezone_explain 'The Captain uses it to convert times in Telegram messages and charts.')"
  printf "Timezone [%s]: " "$JHT_USER_TZ_DEFAULT"
  read -r TZ_CHOICE
  if [ -n "$TZ_CHOICE" ]; then
    # Validate: python3 -c "from zoneinfo import ZoneInfo; ZoneInfo('XXX')"
    if python3 -c "from zoneinfo import ZoneInfo; ZoneInfo('$TZ_CHOICE')" 2>/dev/null; then
      JHT_USER_TZ="$TZ_CHOICE"
    else
      warn "$(ts host_setup.timezone_invalid 'Invalid timezone, falling back to UTC.') ($JHT_USER_TZ_DEFAULT)"
    fi
  fi
fi
ok "Timezone: $JHT_USER_TZ"

# #13 — su VPS / non-interattivo il prompt sopra è saltato, quindi resta
# l'UTC del SERVER (non la timezone dell'utente, che sta altrove nel mondo).
# Senza la TZ reale il Capitano mostra orari/reset sfasati e le working-hours
# valgono in UTC invece che nelle ore locali dell'utente (sul beta VPS si è
# dovuto passare --tz Europe/Rome a mano). Avvisa esplicitamente come correggere.
if { [ ! -t 0 ] || [ "$NON_INTERACTIVE" -eq 1 ]; } && [ "$JHT_USER_TZ" = "UTC" ]; then
  warn "$(ts host_setup.timezone_vps_utc 'Timezone was not detected: the team will use UTC. Set yours with jht wh --tz Europe/Rome (or in the dashboard), otherwise Telegram times and working hours will be in UTC.')"
fi

# Persisti la scelta in ~/.jht/host.env cosi' il wrapper bash + il wizard
# Node sanno se siamo su VPS (per attivare step obbligatori cloud + telegram).
# Riscriviamo l'intero file mantenendo JHT_LANG + JHT_USER_TZ. Se in
# futuro si aggiungono altre chiavi, usare un piccolo helper di merge
# invece di sovrascrivere.
mkdir -p "$JHT_HOME_HOST" 2>/dev/null || true
{
  printf 'JHT_LANG=%s\n' "$JHT_LANG"
  printf 'JHT_HOST_TYPE=%s\n' "$HOST_TYPE"
  printf 'JHT_USER_TZ=%s\n' "$JHT_USER_TZ"
} > "$HOST_ENV_PATH"

if [ "$HOST_TYPE" = "local" ]; then
  ok "Host: $(ts host_setup.host.local 'local computer') — $(ts host_setup.swap_not_needed 'no swap configuration needed')"
  exit 0
fi

ok "Host: $(ts host_setup.host.vps 'remote server / VPS')"

# ── Check RAM e swap esistente ───────────────────────────────────────────
RAM_KB=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
RAM_GB=$(( (RAM_KB + 524288) / 1048576 ))   # round to GB
SWAP_KB=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
SWAP_MB=$(( SWAP_KB / 1024 ))

info "RAM: ${RAM_GB} GB  |  Swap active: ${SWAP_MB} MB"

# Swap policy:
# - se gia' >= 1024 MB: ok, skip
# - se RAM >= 8 GB: skip (non serve)
# - altrimenti: chiedi
if [ "$SWAP_MB" -ge 1024 ]; then
  ok "Swap already configured (${SWAP_MB} MB) — skip"
  exit 0
fi

if [ "$RAM_GB" -ge 8 ]; then
  ok "RAM sufficient (${RAM_GB} GB) — swap not needed, skip"
  exit 0
fi

# ── Proposta swap ────────────────────────────────────────────────────────
SWAP_SIZE_GB=2
SWAP_FILE=/swapfile

# Versione sintetica: 1 riga di motivo (era 4 — l'utente accetta sempre).
printf "\n${DIM}With %d GB of RAM the team may OOM under load.${RESET}\n" "$RAM_GB"
printf "Configure %d GB of swap in %s? [Y/n]: " "$SWAP_SIZE_GB" "$SWAP_FILE"

DO_SWAP=1
if [ -t 0 ] && [ "$NON_INTERACTIVE" -eq 0 ]; then
  read -r ANSWER
  case "$ANSWER" in
    n|N|no|NO) DO_SWAP=0 ;;
    *)         DO_SWAP=1 ;;
  esac
else
  printf "${DIM}(non-interactive stdin; applying default Y)${RESET}\n"
fi

if [ "$DO_SWAP" = "0" ]; then
  warn "Swap not configured — the team may crash under load"
  exit 0
fi

# ── Configura swap (richiede root) ───────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  warn "Root privileges are required to configure swap"
  if command -v sudo >/dev/null 2>&1; then
    info "Trying sudo..."
    SUDO=sudo
  else
    warn "sudo is unavailable — skipping swap. Configure it manually later."
    exit 0
  fi
else
  SUDO=""
fi

info "Creating $SWAP_FILE with ${SWAP_SIZE_GB} GB..."
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
ok "Swap active: ${NEW_SWAP_MB} MB (persists across reboot via /etc/fstab)"

exit 0
