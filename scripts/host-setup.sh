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
JHT_HOST_SETUP_PROTOCOL=1

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

# host.env vive in una directory bind-mountata read-write nel container. Va
# quindi trattato come input non fidato: leggerne coppie note e validate, mai
# eseguirlo con `source`/`.`. Questa copia locale rende host-setup.sh ancora
# distribuibile come singolo file, come fa oggi l'installer.
jht_host_env_value_valid() {
  local key="$1" value="$2"
  case "$key" in
    JHT_HOST_TYPE)
      case "$value" in local|vps) return 0 ;; esac
      ;;
    JHT_LANG)
      case "$value" in en|it|hu|es|de|fr|pt) return 0 ;; esac
      ;;
    JHT_USER_TZ)
      case "$value" in
        ''|*[!A-Za-z0-9_+./-]*) return 1 ;;
        *) return 0 ;;
      esac
      ;;
  esac
  return 1
}

jht_read_host_env_value() {
  local file="$1" requested="$2" line key value result=""
  local found=1
  # Un link non e' il file di host-setup: lo ha messo un agente, e non si legge quello che indica.
  [ ! -L "$file" ] || return 1
  [ -f "$file" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    if [[ "$line" =~ ^[[:space:]]*(JHT_HOST_TYPE|JHT_LANG|JHT_USER_TZ)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      case "$value" in
        \"*\") value="${value#\"}"; value="${value%\"}" ;;
        \'*\') value="${value#\'}"; value="${value%\'}" ;;
      esac
      if [ "$key" = "$requested" ] && jht_host_env_value_valid "$key" "$value"; then
        result="$value"
        found=0
      fi
    fi
  done < "$file"
  [ "$found" -eq 0 ] || return 1
  printf '%s' "$result"
}

# ── i18n: soltanto dati, mai helper shell dal filesystem ─────────────────
# This script runs on the host, where shared/locales is not there, and it imports no code and reads no text from a folder the
# container can write. Its texts in the 7 languages are written here, as data: the block below is made from shared/locales
# (python3 tests/host_setup_texts.py --write), and a test fails when the two differ. JHT_LANG is the language decided below
# (the saved choice, the picker, JHT_LANG, host.env, the system's); a key with no text in it says the English of the call.
# >>> texts in the 7 languages, made from shared/locales by `python3 tests/host_setup_texts.py --write`: do not edit by hand
ts_table() {
  case "$1:$2" in
    en:host_setup.choice) printf '%s' 'Choice' ;;
    en:host_setup.detected) printf '%s' 'Detected:' ;;
    en:host_setup.host.local) printf '%s' 'local computer' ;;
    en:host_setup.host.vps) printf '%s' 'remote server / VPS' ;;
    en:host_setup.host_line) printf '%s' 'Host: %s' ;;
    en:host_setup.host_line_no_swap) printf '%s' 'Host: %s — %s' ;;
    en:host_setup.host_values_not_written) printf '%s' 'host-values not written in %s — the wrapper will create it from host.env' ;;
    en:host_setup.invalid_choice) printf '%s' 'Invalid choice' ;;
    en:host_setup.option.local.line1) printf '%s' 'The full team runs on this PC; keep it awake with the container engine running while the team works.' ;;
    en:host_setup.option.local.line2) printf '%s' 'Shortest guided path; no VPS or cloud account required.' ;;
    en:host_setup.option.local.title) printf '%s' 'Local PC' ;;
    en:host_setup.option.vps.line1) printf '%s' 'The team runs on a remote Linux server over SSH and can continue when this PC is off.' ;;
    en:host_setup.option.vps.line2) printf '%s' 'You provide and administer the server and its SSH access.' ;;
    en:host_setup.option.vps.title) printf '%s' 'VPS / remote server' ;;
    en:host_setup.ram_info) printf '%s' 'RAM: %d GB  |  Swap active: %d MB' ;;
    en:host_setup.ram_sufficient) printf '%s' 'RAM sufficient (%d GB) — swap not needed, skip' ;;
    en:host_setup.section_header) printf '%s' 'Setup host (preflight)' ;;
    en:host_setup.swap_active) printf '%s' 'Swap active: %d MB (persists across reboot via /etc/fstab)' ;;
    en:host_setup.swap_already_configured) printf '%s' 'Swap already configured (%d MB) — skip' ;;
    en:host_setup.swap_configure) printf '%s' 'Configure %d GB of swap in %s?' ;;
    en:host_setup.swap_creating) printf '%s' 'Creating %s with %d GB...' ;;
    en:host_setup.swap_low_ram) printf '%s' 'With %d GB of RAM the team may OOM under load.' ;;
    en:host_setup.swap_noninteractive) printf '%s' '(non-interactive stdin; applying default Y)' ;;
    en:host_setup.swap_not_configured_warn) printf '%s' 'Swap not configured — the team may crash under load' ;;
    en:host_setup.swap_not_needed) printf '%s' 'no swap configuration needed' ;;
    en:host_setup.swap_root_required) printf '%s' 'Root privileges are required to configure swap' ;;
    en:host_setup.swap_sudo_unavailable) printf '%s' 'sudo is unavailable — skipping swap. Configure it manually later.' ;;
    en:host_setup.swap_trying_sudo) printf '%s' 'Trying sudo...' ;;
    en:host_setup.timezone_explain) printf '%s' 'The Captain uses it to convert times in Telegram messages and charts.' ;;
    en:host_setup.timezone_header) printf '%s' 'User timezone' ;;
    en:host_setup.timezone_vps_utc) printf '%s' 'Timezone was not detected: the team will use UTC. Set yours with jht wh --tz Europe/Rome (or in the dashboard), otherwise Telegram times and working hours will be in UTC.' ;;
    en:host_setup.tz.ask) printf '%s' 'Timezone:' ;;
    en:host_setup.tz.ask_default) printf '%s' 'Timezone [%s]:' ;;
    en:host_setup.tz.bad_number) printf '%s' 'Choose a number between 1 and %d.' ;;
    en:host_setup.tz.chosen) printf '%s' 'Timezone: %s' ;;
    en:host_setup.tz.how) printf '%s' 'Type a country, a city or a timezone (for example Italy, Rome, Europe/Rome).' ;;
    en:host_setup.tz.how_default) printf '%s' 'Press Enter to keep %s, or type a country, a city or a timezone to look for another one.' ;;
    en:host_setup.tz.none) printf '%s' 'No timezone found for «%s»: try a country, a city or a timezone like Europe/Rome.' ;;
    en:host_setup.tz.not_detected) printf '%s' 'Your timezone was not detected.' ;;
    en:host_setup.tz.pick) printf '%s' 'Number (1-%d), or a new search:' ;;
    en:host_setup.tz.proposed) printf '%s' 'Proposed: %s (now %s).' ;;
    en:host_setup.tz.saved_and_detected) printf '%s' 'Saved: %s (now %s) · Detected now: %s (now %s)' ;;
    en:host_setup.tz.too_many) printf '%s' '%d timezones match «%s»: type something more precise (a city, for example).' ;;
    en:host_setup.where_running) printf '%s' 'Where are you running JHT?' ;;
    en:host_setup.write_changed) printf '%s' '%s changed while it was being written: not writing it' ;;
    en:host_setup.write_is_directory) printf '%s' '%s is a directory: not writing it' ;;
    en:host_setup.write_kept_old) printf '%s' '%s keeps its old content: its folder belongs to the container'\''s user and this user cannot replace the file.' ;;
    en:host_setup.write_no_temp) printf '%s' 'cannot create a temporary file in %s: not writing %s' ;;
    it:host_setup.choice) printf '%s' 'Scelta' ;;
    it:host_setup.detected) printf '%s' 'Rilevato:' ;;
    it:host_setup.host.local) printf '%s' 'computer locale' ;;
    it:host_setup.host.vps) printf '%s' 'server remoto / VPS' ;;
    it:host_setup.host_line) printf '%s' 'Host: %s' ;;
    it:host_setup.host_line_no_swap) printf '%s' 'Host: %s — %s' ;;
    it:host_setup.host_values_not_written) printf '%s' 'host-values non scritto in %s — il wrapper lo creera'\'' da host.env' ;;
    it:host_setup.invalid_choice) printf '%s' 'Scelta non valida' ;;
    it:host_setup.option.local.line1) printf '%s' 'La squadra intera gira su questo PC: tienilo acceso, con il motore dei container attivo, mentre la squadra lavora.' ;;
    it:host_setup.option.local.line2) printf '%s' 'Il percorso guidato piu'\'' corto; non servono VPS ne'\'' account cloud.' ;;
    it:host_setup.option.local.title) printf '%s' 'PC locale' ;;
    it:host_setup.option.vps.line1) printf '%s' 'La squadra gira su un server Linux remoto via SSH e puo'\'' continuare a PC spento.' ;;
    it:host_setup.option.vps.line2) printf '%s' 'Il server e il suo accesso SSH li fornisci e li gestisci tu.' ;;
    it:host_setup.option.vps.title) printf '%s' 'VPS / server remoto' ;;
    it:host_setup.ram_info) printf '%s' 'RAM: %d GB  |  Swap attivo: %d MB' ;;
    it:host_setup.ram_sufficient) printf '%s' 'RAM sufficiente (%d GB): lo swap non serve, salto' ;;
    it:host_setup.section_header) printf '%s' 'Preparazione dell'\''host' ;;
    it:host_setup.swap_active) printf '%s' 'Swap attivo: %d MB (resta dopo il riavvio grazie a /etc/fstab)' ;;
    it:host_setup.swap_already_configured) printf '%s' 'Swap gia'\'' configurato (%d MB): salto' ;;
    it:host_setup.swap_configure) printf '%s' 'Configuro %d GB di swap in %s?' ;;
    it:host_setup.swap_creating) printf '%s' 'Creo %s da %d GB...' ;;
    it:host_setup.swap_low_ram) printf '%s' 'Con %d GB di RAM la squadra puo'\'' restare senza memoria sotto carico.' ;;
    it:host_setup.swap_noninteractive) printf '%s' '(nessun terminale per rispondere: uso la risposta predefinita, Y)' ;;
    it:host_setup.swap_not_configured_warn) printf '%s' 'Swap non configurato: la squadra potrebbe bloccarsi sotto carico' ;;
    it:host_setup.swap_not_needed) printf '%s' 'nessuna configurazione dello swap necessaria' ;;
    it:host_setup.swap_root_required) printf '%s' 'Per configurare lo swap servono i privilegi di root' ;;
    it:host_setup.swap_sudo_unavailable) printf '%s' 'sudo non c'\''e'\'': salto lo swap. Puoi configurarlo a mano piu'\'' tardi.' ;;
    it:host_setup.swap_trying_sudo) printf '%s' 'Provo con sudo...' ;;
    it:host_setup.timezone_explain) printf '%s' 'Il Capitano lo usa per convertire gli orari nei messaggi Telegram e nei grafici.' ;;
    it:host_setup.timezone_header) printf '%s' 'Fuso orario' ;;
    it:host_setup.timezone_vps_utc) printf '%s' 'Il fuso orario non e'\'' stato rilevato: la squadra usera'\'' UTC. Imposta il tuo con jht wh --tz Europe/Rome (o nella dashboard), altrimenti gli orari di Telegram e di lavoro saranno in UTC.' ;;
    it:host_setup.tz.ask) printf '%s' 'Fuso orario:' ;;
    it:host_setup.tz.ask_default) printf '%s' 'Fuso orario [%s]:' ;;
    it:host_setup.tz.bad_number) printf '%s' 'Scegli un numero fra 1 e %d.' ;;
    it:host_setup.tz.chosen) printf '%s' 'Fuso orario: %s' ;;
    it:host_setup.tz.how) printf '%s' 'Scrivi un paese, una città o un fuso orario (per esempio Italia, Roma, Europe/Rome).' ;;
    it:host_setup.tz.how_default) printf '%s' 'Premi Invio per tenere %s, oppure scrivi un paese, una città o un fuso orario per cercarne un altro.' ;;
    it:host_setup.tz.none) printf '%s' 'Nessun fuso orario trovato per «%s»: prova con un paese, una città o un fuso come Europe/Rome.' ;;
    it:host_setup.tz.not_detected) printf '%s' 'Il tuo fuso orario non è stato rilevato.' ;;
    it:host_setup.tz.pick) printf '%s' 'Numero (1-%d), oppure una nuova ricerca:' ;;
    it:host_setup.tz.proposed) printf '%s' 'Proposto: %s (ora %s).' ;;
    it:host_setup.tz.saved_and_detected) printf '%s' 'Salvato: %s (ora %s) · Rilevato ora: %s (ora %s)' ;;
    it:host_setup.tz.too_many) printf '%s' '%d fusi orari corrispondono a «%s»: scrivi qualcosa di più preciso (una città, per esempio).' ;;
    it:host_setup.where_running) printf '%s' 'Dove fai girare JHT?' ;;
    it:host_setup.write_changed) printf '%s' '%s e'\'' cambiato mentre lo scrivevo: non lo scrivo' ;;
    it:host_setup.write_is_directory) printf '%s' '%s e'\'' una cartella: non lo scrivo' ;;
    it:host_setup.write_kept_old) printf '%s' '%s resta com'\''era: la sua cartella e'\'' dell'\''utente del container e questo utente non puo'\'' sostituire il file.' ;;
    it:host_setup.write_no_temp) printf '%s' 'non posso creare un file temporaneo in %s: non scrivo %s' ;;
    hu:host_setup.choice) printf '%s' 'Választás' ;;
    hu:host_setup.detected) printf '%s' 'Észlelt:' ;;
    hu:host_setup.host.local) printf '%s' 'helyi számítógép' ;;
    hu:host_setup.host.vps) printf '%s' 'távoli szerver / VPS' ;;
    hu:host_setup.host_line) printf '%s' 'Gép: %s' ;;
    hu:host_setup.host_line_no_swap) printf '%s' 'Gép: %s — %s' ;;
    hu:host_setup.host_values_not_written) printf '%s' 'a host-values nem íródott ide: %s — a wrapper létrehozza a host.env-ből' ;;
    hu:host_setup.invalid_choice) printf '%s' 'Érvénytelen választás' ;;
    hu:host_setup.option.local.line1) printf '%s' 'A teljes csapat ezen a PC-n fut: tartsd bekapcsolva, futó konténermotorral, amíg a csapat dolgozik.' ;;
    hu:host_setup.option.local.line2) printf '%s' 'A legrövidebb vezetett út; nem kell VPS vagy felhőfiók.' ;;
    hu:host_setup.option.local.title) printf '%s' 'Helyi PC' ;;
    hu:host_setup.option.vps.line1) printf '%s' 'A csapat egy távoli Linux-szerveren fut SSH-n át, és a PC kikapcsolása után is folytathatja.' ;;
    hu:host_setup.option.vps.line2) printf '%s' 'A szervert és az SSH-hozzáférést te biztosítod és kezeled.' ;;
    hu:host_setup.option.vps.title) printf '%s' 'VPS / távoli szerver' ;;
    hu:host_setup.ram_info) printf '%s' 'RAM: %d GB  |  Aktív swap: %d MB' ;;
    hu:host_setup.ram_sufficient) printf '%s' 'Elég a RAM (%d GB): nincs szükség swapre, kihagyom' ;;
    hu:host_setup.section_header) printf '%s' 'A gazdagép előkészítése' ;;
    hu:host_setup.swap_active) printf '%s' 'Swap aktív: %d MB (újraindítás után is megmarad a /etc/fstab miatt)' ;;
    hu:host_setup.swap_already_configured) printf '%s' 'A swap már be van állítva (%d MB): kihagyom' ;;
    hu:host_setup.swap_configure) printf '%s' 'Beállítsak %d GB swapet itt: %s?' ;;
    hu:host_setup.swap_creating) printf '%s' '%s létrehozása, mérete %d GB...' ;;
    hu:host_setup.swap_low_ram) printf '%s' '%d GB RAM mellett a csapatnak terhelés alatt elfogyhat a memóriája.' ;;
    hu:host_setup.swap_noninteractive) printf '%s' '(nincs terminál a válaszhoz: az alapértelmezett választ használom, Y)' ;;
    hu:host_setup.swap_not_configured_warn) printf '%s' 'swap nincs beállítva — a csapat összeomolhat terhelés alatt' ;;
    hu:host_setup.swap_not_needed) printf '%s' 'nincs szükség swap beállításra' ;;
    hu:host_setup.swap_root_required) printf '%s' 'Root jogosultság szükséges a swap beállításához' ;;
    hu:host_setup.swap_sudo_unavailable) printf '%s' 'Nincs sudo: a swapet kihagyom. Később kézzel is beállíthatod.' ;;
    hu:host_setup.swap_trying_sudo) printf '%s' 'Megpróbálom sudo-val...' ;;
    hu:host_setup.timezone_explain) printf '%s' 'A Kapitány ezt használja az időpontok átváltására Telegram üzenetekben és grafikonokon.' ;;
    hu:host_setup.timezone_header) printf '%s' 'Időzóna' ;;
    hu:host_setup.timezone_vps_utc) printf '%s' 'Az időzónát nem sikerült felismerni: a csapat UTC-t fog használni. Állítsd be a sajátodat a jht wh --tz Europe/Budapest paranccsal (vagy a vezérlőpulton), különben a Telegram és a munkaidő időpontjai UTC-ben lesznek.' ;;
    hu:host_setup.tz.ask) printf '%s' 'Időzóna:' ;;
    hu:host_setup.tz.ask_default) printf '%s' 'Időzóna [%s]:' ;;
    hu:host_setup.tz.bad_number) printf '%s' 'Válassz egy számot 1 és %d között.' ;;
    hu:host_setup.tz.chosen) printf '%s' 'Időzóna: %s' ;;
    hu:host_setup.tz.how) printf '%s' 'Írj be egy országot, egy várost vagy egy időzónát (például Magyarország, Budapest, Europe/Budapest).' ;;
    hu:host_setup.tz.how_default) printf '%s' 'Nyomj Entert, ha megtartod ezt: %s, vagy írj be egy országot, egy várost vagy egy időzónát, hogy másikat keress.' ;;
    hu:host_setup.tz.none) printf '%s' 'Nem található időzóna ehhez: «%s». Próbálj meg egy országot, egy várost vagy egy időzónát, például Europe/Budapest.' ;;
    hu:host_setup.tz.not_detected) printf '%s' 'Az időzónádat nem sikerült felismerni.' ;;
    hu:host_setup.tz.pick) printf '%s' 'Szám (1-%d), vagy új keresés:' ;;
    hu:host_setup.tz.proposed) printf '%s' 'Javasolt: %s (most %s).' ;;
    hu:host_setup.tz.saved_and_detected) printf '%s' 'Mentve: %s (most %s) · Most felismerve: %s (most %s)' ;;
    hu:host_setup.tz.too_many) printf '%s' '%d időzóna illik erre: «%s». Írj be valami pontosabbat (például egy várost).' ;;
    hu:host_setup.where_running) printf '%s' 'Hol futtatod a JHT-t?' ;;
    hu:host_setup.write_changed) printf '%s' '%s megváltozott írás közben: nem írom' ;;
    hu:host_setup.write_is_directory) printf '%s' '%s egy mappa: nem írom' ;;
    hu:host_setup.write_kept_old) printf '%s' '%s a régi tartalmát tartja meg: a mappája a konténer felhasználójáé, és ez a felhasználó nem cserélheti le a fájlt.' ;;
    hu:host_setup.write_no_temp) printf '%s' 'nem tudok ideiglenes fájlt létrehozni itt: %s; nem írom: %s' ;;
    es:host_setup.choice) printf '%s' 'Elección' ;;
    es:host_setup.detected) printf '%s' 'Detectado:' ;;
    es:host_setup.host.local) printf '%s' 'ordenador local' ;;
    es:host_setup.host.vps) printf '%s' 'servidor remoto / VPS' ;;
    es:host_setup.host_line) printf '%s' 'Máquina: %s' ;;
    es:host_setup.host_line_no_swap) printf '%s' 'Máquina: %s — %s' ;;
    es:host_setup.host_values_not_written) printf '%s' 'host-values no se ha escrito en %s — el wrapper lo creará a partir de host.env' ;;
    es:host_setup.invalid_choice) printf '%s' 'Elección no válida' ;;
    es:host_setup.option.local.line1) printf '%s' 'El equipo completo trabaja en este PC: mantenlo encendido, con el motor de contenedores en marcha, mientras el equipo trabaja.' ;;
    es:host_setup.option.local.line2) printf '%s' 'La ruta guiada más corta; no requiere VPS ni cuenta cloud.' ;;
    es:host_setup.option.local.title) printf '%s' 'PC local' ;;
    es:host_setup.option.vps.line1) printf '%s' 'El equipo trabaja en un servidor Linux remoto por SSH y puede continuar con este PC apagado.' ;;
    es:host_setup.option.vps.line2) printf '%s' 'Tú proporcionas y administras el servidor y su acceso SSH.' ;;
    es:host_setup.option.vps.title) printf '%s' 'VPS / servidor remoto' ;;
    es:host_setup.ram_info) printf '%s' 'RAM: %d GB  |  Swap activo: %d MB' ;;
    es:host_setup.ram_sufficient) printf '%s' 'RAM suficiente (%d GB): no hace falta swap, lo salto' ;;
    es:host_setup.section_header) printf '%s' 'Preparación del host' ;;
    es:host_setup.swap_active) printf '%s' 'Swap activo: %d MB (persiste tras reinicio vía /etc/fstab)' ;;
    es:host_setup.swap_already_configured) printf '%s' 'Swap ya configurado (%d MB): lo salto' ;;
    es:host_setup.swap_configure) printf '%s' '¿Configurar %d GB de swap en %s?' ;;
    es:host_setup.swap_creating) printf '%s' 'Creo %s de %d GB...' ;;
    es:host_setup.swap_low_ram) printf '%s' 'Con %d GB de RAM el equipo puede quedarse sin memoria bajo carga.' ;;
    es:host_setup.swap_noninteractive) printf '%s' '(no hay terminal para responder: uso la respuesta predeterminada, Y)' ;;
    es:host_setup.swap_not_configured_warn) printf '%s' 'swap no configurado — el equipo puede caerse bajo carga' ;;
    es:host_setup.swap_not_needed) printf '%s' 'no hace falta configurar swap' ;;
    es:host_setup.swap_root_required) printf '%s' 'Se necesitan privilegios de root para configurar el swap' ;;
    es:host_setup.swap_sudo_unavailable) printf '%s' 'sudo no está disponible: me salto el swap. Puedes configurarlo a mano más tarde.' ;;
    es:host_setup.swap_trying_sudo) printf '%s' 'Pruebo con sudo...' ;;
    es:host_setup.timezone_explain) printf '%s' 'El Capitán la usa para convertir las horas en los mensajes de Telegram y en los gráficos.' ;;
    es:host_setup.timezone_header) printf '%s' 'Zona horaria' ;;
    es:host_setup.timezone_vps_utc) printf '%s' 'No se ha detectado la zona horaria: el equipo usará UTC. Configura la tuya con jht wh --tz Europe/Madrid (o en el panel); si no, las horas de Telegram y del horario de trabajo estarán en UTC.' ;;
    es:host_setup.tz.ask) printf '%s' 'Zona horaria:' ;;
    es:host_setup.tz.ask_default) printf '%s' 'Zona horaria [%s]:' ;;
    es:host_setup.tz.bad_number) printf '%s' 'Elige un número entre 1 y %d.' ;;
    es:host_setup.tz.chosen) printf '%s' 'Zona horaria: %s' ;;
    es:host_setup.tz.how) printf '%s' 'Escribe un país, una ciudad o una zona horaria (por ejemplo España, Madrid, Europe/Madrid).' ;;
    es:host_setup.tz.how_default) printf '%s' 'Pulsa Intro para mantener %s, o escribe un país, una ciudad o una zona horaria para buscar otra.' ;;
    es:host_setup.tz.none) printf '%s' 'No se ha encontrado ninguna zona horaria para «%s»: prueba con un país, una ciudad o una zona como Europe/Madrid.' ;;
    es:host_setup.tz.not_detected) printf '%s' 'No se ha detectado tu zona horaria.' ;;
    es:host_setup.tz.pick) printf '%s' 'Número (1-%d), o una nueva búsqueda:' ;;
    es:host_setup.tz.proposed) printf '%s' 'Propuesta: %s (ahora %s).' ;;
    es:host_setup.tz.saved_and_detected) printf '%s' 'Guardada: %s (ahora %s) · Detectada ahora: %s (ahora %s)' ;;
    es:host_setup.tz.too_many) printf '%s' '%d zonas horarias coinciden con «%s»: escribe algo más preciso (una ciudad, por ejemplo).' ;;
    es:host_setup.where_running) printf '%s' '¿Dónde estás ejecutando JHT?' ;;
    es:host_setup.write_changed) printf '%s' '%s ha cambiado mientras se escribía: no lo escribo' ;;
    es:host_setup.write_is_directory) printf '%s' '%s es una carpeta: no lo escribo' ;;
    es:host_setup.write_kept_old) printf '%s' '%s conserva su contenido anterior: su carpeta es del usuario del contenedor y este usuario no puede sustituir el archivo.' ;;
    es:host_setup.write_no_temp) printf '%s' 'no puedo crear un archivo temporal en %s: no escribo %s' ;;
    de:host_setup.choice) printf '%s' 'Auswahl' ;;
    de:host_setup.detected) printf '%s' 'Erkannt:' ;;
    de:host_setup.host.local) printf '%s' 'lokaler Computer' ;;
    de:host_setup.host.vps) printf '%s' 'Remote-Server / VPS' ;;
    de:host_setup.host_line) printf '%s' 'Rechner: %s' ;;
    de:host_setup.host_line_no_swap) printf '%s' 'Rechner: %s — %s' ;;
    de:host_setup.host_values_not_written) printf '%s' 'host-values nicht in %s geschrieben — der Wrapper erstellt es aus host.env' ;;
    de:host_setup.invalid_choice) printf '%s' 'Ungültige Auswahl' ;;
    de:host_setup.option.local.line1) printf '%s' 'Das ganze Team läuft auf diesem PC: Lass ihn eingeschaltet und die Container-Engine laufen, solange das Team arbeitet.' ;;
    de:host_setup.option.local.line2) printf '%s' 'Der kürzeste geführte Weg; weder VPS noch Cloud-Konto sind nötig.' ;;
    de:host_setup.option.local.title) printf '%s' 'Lokaler PC' ;;
    de:host_setup.option.vps.line1) printf '%s' 'Das Team läuft per SSH auf einem entfernten Linux-Server und kann bei ausgeschaltetem PC weiterarbeiten.' ;;
    de:host_setup.option.vps.line2) printf '%s' 'Du stellst den Server und den SSH-Zugang bereit und verwaltest sie.' ;;
    de:host_setup.option.vps.title) printf '%s' 'VPS / Remote-Server' ;;
    de:host_setup.ram_info) printf '%s' 'RAM: %d GB  |  Aktiver Swap: %d MB' ;;
    de:host_setup.ram_sufficient) printf '%s' 'Genug RAM (%d GB): Swap ist nicht nötig, übersprungen' ;;
    de:host_setup.section_header) printf '%s' 'Vorbereitung des Hosts' ;;
    de:host_setup.swap_active) printf '%s' 'Swap aktiv: %d MB (bleibt nach Neustart via /etc/fstab erhalten)' ;;
    de:host_setup.swap_already_configured) printf '%s' 'Swap bereits eingerichtet (%d MB): übersprungen' ;;
    de:host_setup.swap_configure) printf '%s' '%d GB Swap in %s einrichten?' ;;
    de:host_setup.swap_creating) printf '%s' 'Erstelle %s mit %d GB...' ;;
    de:host_setup.swap_low_ram) printf '%s' 'Mit %d GB RAM könnte dem Team unter Last der Speicher ausgehen.' ;;
    de:host_setup.swap_noninteractive) printf '%s' '(kein Terminal zum Antworten: ich nehme die Vorgabe, Y)' ;;
    de:host_setup.swap_not_configured_warn) printf '%s' 'Swap nicht konfiguriert — das Team könnte unter Last abstürzen' ;;
    de:host_setup.swap_not_needed) printf '%s' 'keine Swap-Konfiguration nötig' ;;
    de:host_setup.swap_root_required) printf '%s' 'Root-Rechte werden benötigt, um Swap zu konfigurieren' ;;
    de:host_setup.swap_sudo_unavailable) printf '%s' 'sudo ist nicht verfügbar: Swap wird übersprungen. Du kannst ihn später von Hand einrichten.' ;;
    de:host_setup.swap_trying_sudo) printf '%s' 'Versuche es mit sudo...' ;;
    de:host_setup.timezone_explain) printf '%s' 'Der Kapitän verwendet sie, um die Zeiten in Telegram-Nachrichten und Diagrammen umzurechnen.' ;;
    de:host_setup.timezone_header) printf '%s' 'Zeitzone' ;;
    de:host_setup.timezone_vps_utc) printf '%s' 'Die Zeitzone wurde nicht erkannt: Das Team verwendet UTC. Stelle deine mit jht wh --tz Europe/Berlin ein (oder im Dashboard), sonst stehen die Telegram-Zeiten und die Arbeitszeiten in UTC.' ;;
    de:host_setup.tz.ask) printf '%s' 'Zeitzone:' ;;
    de:host_setup.tz.ask_default) printf '%s' 'Zeitzone [%s]:' ;;
    de:host_setup.tz.bad_number) printf '%s' 'Wähle eine Zahl zwischen 1 und %d.' ;;
    de:host_setup.tz.chosen) printf '%s' 'Zeitzone: %s' ;;
    de:host_setup.tz.how) printf '%s' 'Gib ein Land, eine Stadt oder eine Zeitzone ein (zum Beispiel Deutschland, Berlin, Europe/Berlin).' ;;
    de:host_setup.tz.how_default) printf '%s' 'Drücke Enter, um %s zu behalten, oder gib ein Land, eine Stadt oder eine Zeitzone ein, um eine andere zu suchen.' ;;
    de:host_setup.tz.none) printf '%s' 'Keine Zeitzone für «%s» gefunden: Versuche es mit einem Land, einer Stadt oder einer Zeitzone wie Europe/Berlin.' ;;
    de:host_setup.tz.not_detected) printf '%s' 'Deine Zeitzone wurde nicht erkannt.' ;;
    de:host_setup.tz.pick) printf '%s' 'Nummer (1-%d) oder eine neue Suche:' ;;
    de:host_setup.tz.proposed) printf '%s' 'Vorgeschlagen: %s (jetzt %s).' ;;
    de:host_setup.tz.saved_and_detected) printf '%s' 'Gespeichert: %s (jetzt %s) · Jetzt erkannt: %s (jetzt %s)' ;;
    de:host_setup.tz.too_many) printf '%s' '%d Zeitzonen passen zu «%s»: Gib etwas Genaueres ein (zum Beispiel eine Stadt).' ;;
    de:host_setup.where_running) printf '%s' 'Wo führst du JHT aus?' ;;
    de:host_setup.write_changed) printf '%s' '%s hat sich beim Schreiben geändert: wird nicht geschrieben' ;;
    de:host_setup.write_is_directory) printf '%s' '%s ist ein Ordner: wird nicht geschrieben' ;;
    de:host_setup.write_kept_old) printf '%s' '%s behält den alten Inhalt: Sein Ordner gehört dem Benutzer des Containers, und dieser Benutzer kann die Datei nicht ersetzen.' ;;
    de:host_setup.write_no_temp) printf '%s' 'kann in %s keine temporäre Datei anlegen: %s wird nicht geschrieben' ;;
    fr:host_setup.choice) printf '%s' 'Choix' ;;
    fr:host_setup.detected) printf '%s' 'Détecté :' ;;
    fr:host_setup.host.local) printf '%s' 'ordinateur local' ;;
    fr:host_setup.host.vps) printf '%s' 'serveur distant / VPS' ;;
    fr:host_setup.host_line) printf '%s' 'Machine : %s' ;;
    fr:host_setup.host_line_no_swap) printf '%s' 'Machine : %s — %s' ;;
    fr:host_setup.host_values_not_written) printf '%s' 'host-values non écrit dans %s — le wrapper le créera à partir de host.env' ;;
    fr:host_setup.invalid_choice) printf '%s' 'Choix non valide' ;;
    fr:host_setup.option.local.line1) printf '%s' 'Toute l'\''équipe tourne sur ce PC : garde-le allumé, avec le moteur de conteneurs actif, pendant que l'\''équipe travaille.' ;;
    fr:host_setup.option.local.line2) printf '%s' 'Le parcours guidé le plus court ; aucune VPS ni compte cloud requis.' ;;
    fr:host_setup.option.local.title) printf '%s' 'PC local' ;;
    fr:host_setup.option.vps.line1) printf '%s' 'L'\''équipe travaille sur un serveur Linux distant via SSH et peut continuer quand ce PC est éteint.' ;;
    fr:host_setup.option.vps.line2) printf '%s' 'Tu fournis et administres le serveur et son accès SSH.' ;;
    fr:host_setup.option.vps.title) printf '%s' 'VPS / serveur distant' ;;
    fr:host_setup.ram_info) printf '%s' 'RAM : %d Go  |  Swap actif : %d Mo' ;;
    fr:host_setup.ram_sufficient) printf '%s' 'RAM suffisante (%d Go) : le swap n’est pas nécessaire, je passe' ;;
    fr:host_setup.section_header) printf '%s' 'Préparation de l'\''hôte' ;;
    fr:host_setup.swap_active) printf '%s' 'Swap actif : %d Mo (persiste après redémarrage via /etc/fstab)' ;;
    fr:host_setup.swap_already_configured) printf '%s' 'Swap déjà configuré (%d Mo) : je passe' ;;
    fr:host_setup.swap_configure) printf '%s' 'Configurer %d Go de swap dans %s ?' ;;
    fr:host_setup.swap_creating) printf '%s' 'Je crée %s de %d Go...' ;;
    fr:host_setup.swap_low_ram) printf '%s' 'Avec %d Go de RAM, l’équipe peut manquer de mémoire sous charge.' ;;
    fr:host_setup.swap_noninteractive) printf '%s' '(pas de terminal pour répondre : je prends la réponse par défaut, Y)' ;;
    fr:host_setup.swap_not_configured_warn) printf '%s' 'swap non configuré — l'\''équipe pourrait planter sous charge' ;;
    fr:host_setup.swap_not_needed) printf '%s' 'aucune configuration swap requise' ;;
    fr:host_setup.swap_root_required) printf '%s' 'Privilèges root nécessaires pour configurer le swap' ;;
    fr:host_setup.swap_sudo_unavailable) printf '%s' 'sudo n'\''est pas disponible : je passe le swap. Tu pourras le configurer à la main plus tard.' ;;
    fr:host_setup.swap_trying_sudo) printf '%s' 'J'\''essaie avec sudo...' ;;
    fr:host_setup.timezone_explain) printf '%s' 'Le Capitaine l'\''utilise pour convertir les heures dans les messages Telegram et les graphiques.' ;;
    fr:host_setup.timezone_header) printf '%s' 'Fuseau horaire' ;;
    fr:host_setup.timezone_vps_utc) printf '%s' 'Le fuseau horaire n'\''a pas été détecté : l'\''équipe utilisera UTC. Règle le tien avec jht wh --tz Europe/Paris (ou dans le tableau de bord), sinon les heures de Telegram et les horaires de travail seront en UTC.' ;;
    fr:host_setup.tz.ask) printf '%s' 'Fuseau horaire :' ;;
    fr:host_setup.tz.ask_default) printf '%s' 'Fuseau horaire [%s] :' ;;
    fr:host_setup.tz.bad_number) printf '%s' 'Choisis un nombre entre 1 et %d.' ;;
    fr:host_setup.tz.chosen) printf '%s' 'Fuseau horaire : %s' ;;
    fr:host_setup.tz.how) printf '%s' 'Tape un pays, une ville ou un fuseau horaire (par exemple France, Paris, Europe/Paris).' ;;
    fr:host_setup.tz.how_default) printf '%s' 'Appuie sur Entrée pour garder %s, ou tape un pays, une ville ou un fuseau horaire pour en chercher un autre.' ;;
    fr:host_setup.tz.none) printf '%s' 'Aucun fuseau horaire trouvé pour « %s » : essaie un pays, une ville ou un fuseau comme Europe/Paris.' ;;
    fr:host_setup.tz.not_detected) printf '%s' 'Ton fuseau horaire n'\''a pas été détecté.' ;;
    fr:host_setup.tz.pick) printf '%s' 'Numéro (1-%d), ou une nouvelle recherche :' ;;
    fr:host_setup.tz.proposed) printf '%s' 'Proposé : %s (il est %s).' ;;
    fr:host_setup.tz.saved_and_detected) printf '%s' 'Enregistré : %s (il est %s) · Détecté maintenant : %s (il est %s)' ;;
    fr:host_setup.tz.too_many) printf '%s' '%d fuseaux horaires correspondent à « %s » : tape quelque chose de plus précis (une ville, par exemple).' ;;
    fr:host_setup.where_running) printf '%s' 'Où exécutes-tu JHT ?' ;;
    fr:host_setup.write_changed) printf '%s' '%s a changé pendant l'\''écriture : je ne l'\''écris pas' ;;
    fr:host_setup.write_is_directory) printf '%s' '%s est un dossier : je ne l'\''écris pas' ;;
    fr:host_setup.write_kept_old) printf '%s' '%s garde son ancien contenu : son dossier appartient à l'\''utilisateur du conteneur et cet utilisateur ne peut pas remplacer le fichier.' ;;
    fr:host_setup.write_no_temp) printf '%s' 'impossible de créer un fichier temporaire dans %s : je n'\''écris pas %s' ;;
    pt:host_setup.choice) printf '%s' 'Escolha' ;;
    pt:host_setup.detected) printf '%s' 'Detectado:' ;;
    pt:host_setup.host.local) printf '%s' 'computador local' ;;
    pt:host_setup.host.vps) printf '%s' 'servidor remoto / VPS' ;;
    pt:host_setup.host_line) printf '%s' 'Máquina: %s' ;;
    pt:host_setup.host_line_no_swap) printf '%s' 'Máquina: %s — %s' ;;
    pt:host_setup.host_values_not_written) printf '%s' 'host-values não escrito em %s — o wrapper vai criá-lo a partir de host.env' ;;
    pt:host_setup.invalid_choice) printf '%s' 'Escolha inválida' ;;
    pt:host_setup.option.local.line1) printf '%s' 'A equipa inteira trabalha neste PC: mantém-no ligado, com o motor de contentores ativo, enquanto a equipa trabalha.' ;;
    pt:host_setup.option.local.line2) printf '%s' 'O percurso guiado mais curto; não requer VPS nem conta cloud.' ;;
    pt:host_setup.option.local.title) printf '%s' 'PC local' ;;
    pt:host_setup.option.vps.line1) printf '%s' 'A equipa trabalha num servidor Linux remoto por SSH e pode continuar com este PC desligado.' ;;
    pt:host_setup.option.vps.line2) printf '%s' 'Tu forneces e administras o servidor e o respetivo acesso SSH.' ;;
    pt:host_setup.option.vps.title) printf '%s' 'VPS / servidor remoto' ;;
    pt:host_setup.ram_info) printf '%s' 'RAM: %d GB  |  Swap ativo: %d MB' ;;
    pt:host_setup.ram_sufficient) printf '%s' 'RAM suficiente (%d GB): o swap não é necessário, salto' ;;
    pt:host_setup.section_header) printf '%s' 'Preparação do host' ;;
    pt:host_setup.swap_active) printf '%s' 'Swap ativo: %d MB (persiste após reboot via /etc/fstab)' ;;
    pt:host_setup.swap_already_configured) printf '%s' 'Swap já configurado (%d MB): salto' ;;
    pt:host_setup.swap_configure) printf '%s' 'Configurar %d GB de swap em %s?' ;;
    pt:host_setup.swap_creating) printf '%s' 'Crio %s com %d GB...' ;;
    pt:host_setup.swap_low_ram) printf '%s' 'Com %d GB de RAM a equipa pode ficar sem memória sob carga.' ;;
    pt:host_setup.swap_noninteractive) printf '%s' '(sem terminal para responder: uso a resposta predefinida, Y)' ;;
    pt:host_setup.swap_not_configured_warn) printf '%s' 'swap não configurado — a equipa pode travar sob carga' ;;
    pt:host_setup.swap_not_needed) printf '%s' 'nenhuma configuração de swap necessária' ;;
    pt:host_setup.swap_root_required) printf '%s' 'Privilégios de root necessários para configurar swap' ;;
    pt:host_setup.swap_sudo_unavailable) printf '%s' 'O sudo não está disponível: salto o swap. Podes configurá-lo à mão mais tarde.' ;;
    pt:host_setup.swap_trying_sudo) printf '%s' 'Tento com sudo...' ;;
    pt:host_setup.timezone_explain) printf '%s' 'O Capitão usa para converter horários nas mensagens do Telegram e nos gráficos.' ;;
    pt:host_setup.timezone_header) printf '%s' 'Fuso horário' ;;
    pt:host_setup.timezone_vps_utc) printf '%s' 'O fuso horário não foi detetado: a equipa vai usar UTC. Define o teu com jht wh --tz Europe/Lisbon (ou no painel); caso contrário, as horas do Telegram e o horário de trabalho ficam em UTC.' ;;
    pt:host_setup.tz.ask) printf '%s' 'Fuso horário:' ;;
    pt:host_setup.tz.ask_default) printf '%s' 'Fuso horário [%s]:' ;;
    pt:host_setup.tz.bad_number) printf '%s' 'Escolhe um número entre 1 e %d.' ;;
    pt:host_setup.tz.chosen) printf '%s' 'Fuso horário: %s' ;;
    pt:host_setup.tz.how) printf '%s' 'Escreve um país, uma cidade ou um fuso horário (por exemplo Portugal, Lisboa, Europe/Lisbon).' ;;
    pt:host_setup.tz.how_default) printf '%s' 'Prime Enter para manter %s, ou escreve um país, uma cidade ou um fuso horário para procurar outro.' ;;
    pt:host_setup.tz.none) printf '%s' 'Nenhum fuso horário encontrado para «%s»: experimenta um país, uma cidade ou um fuso como Europe/Lisbon.' ;;
    pt:host_setup.tz.not_detected) printf '%s' 'O teu fuso horário não foi detetado.' ;;
    pt:host_setup.tz.pick) printf '%s' 'Número (1-%d), ou uma nova pesquisa:' ;;
    pt:host_setup.tz.proposed) printf '%s' 'Proposto: %s (agora %s).' ;;
    pt:host_setup.tz.saved_and_detected) printf '%s' 'Guardado: %s (agora %s) · Detetado agora: %s (agora %s)' ;;
    pt:host_setup.tz.too_many) printf '%s' '%d fusos horários correspondem a «%s»: escreve algo mais preciso (uma cidade, por exemplo).' ;;
    pt:host_setup.where_running) printf '%s' 'Onde estás a executar o JHT?' ;;
    pt:host_setup.write_changed) printf '%s' '%s mudou enquanto era escrito: não o escrevo' ;;
    pt:host_setup.write_is_directory) printf '%s' '%s é uma pasta: não o escrevo' ;;
    pt:host_setup.write_kept_old) printf '%s' '%s mantém o conteúdo antigo: a pasta pertence ao utilizador do contentor e este utilizador não pode substituir o ficheiro.' ;;
    pt:host_setup.write_no_temp) printf '%s' 'não consigo criar um ficheiro temporário em %s: não escrevo %s' ;;
    *) return 1 ;;
  esac
}
# <<< texts in the 7 languages
ts() {
  ts_table "${JHT_LANG:-en}" "$1" || printf '%s' "$2"
}
# tsf <key> '<English with %s/%d>' args...: the same, with the values put in (in the same order in every language).
tsf() {
  local format
  format="$(ts "$1" "$2")"
  shift 2
  # shellcheck disable=SC2059
  printf -- "$format" "$@"
}

# Tutto quello che host-setup.sh scrive in ~/.jht (host.env, i18n-prefs.json) passa da qui. Si scrive in un file temporaneo FUORI dalla cartella montata nel container (la home non lo e'), poi si mette al
# suo posto. Dentro ~/.jht un agente potrebbe cambiare il temporaneo con un link appena compare, e `cat >` o `chmod` per percorso
# lo seguirebbero (un file della home troncato, una chiave resa leggibile). Un link messo al posto di host.env (che dentro il
# container e' pendente e sull'host punta a un file dell'utente) si toglie come link, mai seguito, e il file entra con `ln`,
# che con -n (non seguire un link) fallisce se nel frattempo c'e' di nuovo qualcosa, invece di metterlo dentro la cartella
# indicata da un link, come farebbero `mv` e `ln` senza -n.
# Il contenuto arriva su stdin.
jht_write_host_file() {
  local target="$1" dir tmp
  dir="$(dirname "$JHT_HOME_HOST")"
  if [ -d "$target" ] && [ ! -L "$target" ]; then
    warn "$(tsf host_setup.write_is_directory '%s is a directory: not writing it' "$target")"
    return 1
  fi
  tmp="$(mktemp "$dir/.jht-host-file.XXXXXX")" || { warn "$(tsf host_setup.write_no_temp 'cannot create a temporary file in %s: not writing %s' "$dir" "$target")"; return 1; }
  # Il container lo legge con un altro utente: i permessi di sempre (umask), non quelli riservati di mktemp.
  if ! cat > "$tmp" || ! chmod 644 "$tmp"; then rm -f "$tmp"; return 1; fi
  # Already as it should be: nothing to write. A second run finds ~/.jht in the hands of the container's user (the first run
  # handed it over), where this user cannot replace a file, and a file that is already right needs no replacing.
  if [ -f "$target" ] && [ ! -L "$target" ] && cmp -s "$tmp" "$target"; then rm -f "$tmp"; return 0; fi
  if [ ! -w "$(dirname "$target")" ]; then
    rm -f "$tmp"
    warn "$(tsf host_setup.write_kept_old '%s keeps its old content: its folder belongs to the container'\''s user and this user cannot replace the file.' "$target")"
    return 0  # a warning, not a stop: the rest of the preflight (the swap of a VPS) must still run
  fi
  if [ -e "$target" ] || [ -L "$target" ]; then
    rm -f "$target" || { rm -f "$tmp"; return 1; }
  fi
  if ln -n "$tmp" "$target" 2>/dev/null; then
    rm -f "$tmp"
  elif [ ! -e "$target" ] && [ ! -L "$target" ] && mv -f "$tmp" "$target"; then
    : # una cartella senza hard link (raro): la rinomina, con l'entrata ancora vuota
  else
    rm -f "$tmp"
    warn "$(tsf host_setup.write_changed '%s changed while it was being written: not writing it' "$target")"
    return 1
  fi
}

# host.env, the only file with the host type in it.
jht_write_host_env() { jht_write_host_file "$HOST_ENV_PATH"; }

I18N_PREFS_PATH="$JHT_HOME_HOST/i18n-prefs.json"
jht_read_i18n_locale() {
  local file="$1" value=""
  [ ! -L "$file" ] || return 1
  [ -f "$file" ] || return 1
  value="$(sed -n 's/.*"locale"[[:space:]]*:[[:space:]]*"\([a-z][a-z]\)".*/\1/p' "$file" | head -n 1)"
  case "$value" in en|it|hu|es|de|fr|pt) printf '%s' "$value" ;; *) return 1 ;; esac
}

# La lingua del sistema (LC_ALL, LC_MESSAGES, LANG: il primo che c'e' decide, come in
# cli/src/lib/texts.js): una lingua che non abbiamo, «C» e «POSIX» valgono en, non «guarda il
# successivo». Serve solo a chi non ha fatto NESSUNA scelta (vedi sotto).
jht_system_language() {
  local name value code
  for name in LC_ALL LC_MESSAGES LANG; do
    value="${!name:-}"
    [ -n "$value" ] || continue
    code="$(printf '%s' "${value%%[-_.@]*}" | tr '[:upper:]' '[:lower:]')"
    if jht_host_env_value_valid JHT_LANG "$code"; then printf '%s' "$code"; else printf 'en'; fi
    return 0
  done
  printf 'en'
}

JHT_LANG_DEFAULT=en
JHT_LANG_CHOSEN=0
# La preferenza canonica vince. Env e host.env inizializzano soltanto una
# macchina che non ha ancora i18n-prefs.json (contratto lingua v1).
if EXISTING_PREFS_LANG="$(jht_read_i18n_locale "$I18N_PREFS_PATH")"; then
  JHT_LANG_DEFAULT="$EXISTING_PREFS_LANG"
  JHT_LANG_CHOSEN=1
elif jht_host_env_value_valid JHT_LANG "${JHT_LANG:-}"; then
  JHT_LANG_DEFAULT="$JHT_LANG"
  JHT_LANG_CHOSEN=1
elif [ -f "$HOST_ENV_PATH" ]; then
  if EXISTING_LANG="$(jht_read_host_env_value "$HOST_ENV_PATH" JHT_LANG)"; then
    JHT_LANG_DEFAULT="$EXISTING_LANG"
    JHT_LANG_CHOSEN=1
  fi
fi
# In coda alla cascata del contratto v1 (prefs -> JHT_LANG -> host.env -> en): se NESSUNA scelta
# esiste, il default e' la lingua del sistema invece di en. Una scelta esplicita vince sempre
# e RULE-T14 non cambia (la lingua del messaggio non decide mai quella della squadra).
if [ "$JHT_LANG_CHOSEN" -eq 0 ]; then
  JHT_LANG_DEFAULT="$(jht_system_language)"
fi
JHT_LANG="$JHT_LANG_DEFAULT"
JHT_LANG_ASKED_AT=""
if [ -t 0 ] && [ "$NON_INTERACTIVE" -eq 0 ]; then
  # the person answers here: the wizard in the container reads `asked_at` and does not ask a second time
  JHT_LANG_ASKED_AT="$(date +%s)"
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
# Questa prima scrittura riscrive il file: il fuso gia' scelto in un'installazione precedente (priorita' massima piu' sotto,
# punto 3 del fuso) si legge PRIMA e si tiene, se no resta quello della macchina.
PRESERVED_TZ=""
PRESERVED_TZ="$(jht_read_host_env_value "$HOST_ENV_PATH" JHT_USER_TZ)" || PRESERVED_TZ=""
# Con la stessa lingua gia' salvata non c'e' niente da conservare in anticipo (e il file, completo, si riscrive in fondo).
if [ "$(jht_read_host_env_value "$HOST_ENV_PATH" JHT_LANG)" != "$JHT_LANG" ]; then
  {
    printf 'JHT_LANG=%s\n' "$JHT_LANG"
    if [ -n "$PRESERVED_TZ" ]; then printf 'JHT_USER_TZ=%s\n' "$PRESERVED_TZ"; fi
  } | jht_write_host_env
fi
if [ -n "$JHT_LANG_ASKED_AT" ]; then
  printf '{\n  "locale": "%s",\n  "asked_at": %s\n}\n' "$JHT_LANG" "$JHT_LANG_ASKED_AT" | jht_write_host_file "$I18N_PREFS_PATH"
else
  printf '{\n  "locale": "%s"\n}\n' "$JHT_LANG" | jht_write_host_file "$I18N_PREFS_PATH"
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
  printf "  1) ${BOLD}%s${RESET}\n" "$(ts host_setup.option.local.title 'Local PC')"
  printf "     ${DIM}%s${RESET}\n" "$(ts host_setup.option.local.line1 'The full team runs on this PC; keep it awake with the container engine running while the team works.')"
  printf "     ${DIM}%s${RESET}\n\n" "$(ts host_setup.option.local.line2 'Shortest guided path; no VPS or cloud account required.')"
  printf "  2) ${BOLD}%s${RESET}\n" "$(ts host_setup.option.vps.title 'VPS / remote server')"
  printf "     ${DIM}%s${RESET}\n" "$(ts host_setup.option.vps.line1 'The team runs on a remote Linux server over SSH and can continue when this PC is off.')"
  printf "     ${DIM}%s${RESET}\n\n" "$(ts host_setup.option.vps.line2 'You provide and administer the server and its SSH access.')"
  printf "%s [%d]: " "$(ts host_setup.choice 'Choice')" "$DEFAULT_NUM"
  read -r CHOICE
  case "$CHOICE" in
    1) HOST_TYPE="local" ;;
    2) HOST_TYPE="vps" ;;
    "") HOST_TYPE="$DETECTED" ;;
    *) warn "$(ts host_setup.invalid_choice 'Invalid choice') — using default ($DETECTED)"; HOST_TYPE="$DETECTED" ;;
  esac
fi

# ── Timezone utente (bug #15) ────────────────────────────────────────────
# Il container Linux gira sempre in UTC; l'utente sta da qualche parte nel mondo. Senza il suo fuso il Capitano scrive orari
# sfasati. Si propone il fuso già scelto (host.env) o quello rilevato dalla macchina, confermabile con Invio; altrimenti la
# persona scrive un paese, una città o un fuso e sceglie da un elenco numerato. Un valore che non è un fuso si richiede: mai
# UTC in silenzio. Il file dei fusi si legge come DATO dalla cartella zoneinfo del sistema (niente python3, che può mancare).

# The zoneinfo folder of the system (JHT_ZONEINFO_DIR only for the tests, with a small fake one).
jht_zoneinfo_dir() {
  local dir
  for dir in "${JHT_ZONEINFO_DIR:-}" /usr/share/zoneinfo /var/db/timezone/zoneinfo /usr/lib/zoneinfo; do
    [ -n "$dir" ] && [ -d "$dir" ] && [ -f "$dir/zone.tab" ] && { printf '%s' "$dir"; return 0; }
  done
  return 1
}

# A name of the IANA form whose zoneinfo file is a real one (TZif); UTC always is.
jht_tz_valid() {
  local name="$1" dir magic
  case "$name" in UTC|Etc/UTC) return 0 ;; esac
  [[ "$name" =~ ^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$ ]] || return 1
  case "$name" in *..*) return 1 ;; esac
  if dir="$(jht_zoneinfo_dir)"; then
    [ -f "$dir/$name" ] || return 1
    magic="$(head -c 4 "$dir/$name" 2>/dev/null)" || return 1
    [ "$magic" = TZif ]
    return
  fi
  command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; from zoneinfo import ZoneInfo; ZoneInfo(sys.argv[1])' "$name" 2>/dev/null
}

# The zone the machine is set to, if it says one.
jht_tz_detect() {
  local tz=""
  if [ -z "${JHT_ZONEINFO_DIR:-}" ]; then
    if command -v timedatectl >/dev/null 2>&1; then
      tz="$(timedatectl show -p Timezone --value 2>/dev/null | head -n 1)"
      jht_tz_valid "$tz" && { printf '%s' "$tz"; return 0; }
    fi
    if [ -r /etc/timezone ]; then
      tz="$(tr -d '[:space:]' < /etc/timezone 2>/dev/null)"
      jht_tz_valid "$tz" && { printf '%s' "$tz"; return 0; }
    fi
  fi
  if [ -L "${JHT_LOCALTIME:-/etc/localtime}" ]; then
    tz="$(readlink "${JHT_LOCALTIME:-/etc/localtime}" 2>/dev/null | sed 's|.*/zoneinfo/||')"
    jht_tz_valid "$tz" && { printf '%s' "$tz"; return 0; }
  fi
  return 1
}

# The time it is now in a zone, as HH:MM.
jht_tz_now() {
  TZ="$1" date +%H:%M 2>/dev/null
}

# Lower case, no accents, single spaces: what the person types and the names searched are compared like this. One line in, one
# line out, for every line of the input (a whole file is folded in one go).
jht_tz_fold_lines() {
  sed -E \
    -e 's/(À|Á|Â|Ã|Ä|Å|à|á|â|ã|ä|å|ă|ą)/a/g' -e 's/(Ç|ç|ć|č|Ć|Č)/c/g' -e 's/(È|É|Ê|Ë|è|é|ê|ë|ę|ě)/e/g' \
    -e 's/(Ì|Í|Î|Ï|ì|í|î|ï)/i/g' -e 's/(Ñ|ñ|ń)/n/g' -e 's/(Ò|Ó|Ô|Õ|Ö|Ø|ò|ó|ô|õ|ö|ø|ő|Ő)/o/g' \
    -e 's/(Ù|Ú|Û|Ü|ù|ú|û|ü|ű|Ű|ů)/u/g' -e 's/(Ý|ý|ÿ)/y/g' -e 's/ß/ss/g' -e 's/(Ł|ł)/l/g' -e 's/(Ś|ś|Š|š)/s/g' \
    -e 's/(Ž|ž|Ź|ź|Ż|ż)/z/g' -e 's/(Ř|ř)/r/g' -e "s/['’.,-]/ /g" \
    | tr 'A-Z_' 'a-z ' | tr -s ' ' | sed -e 's/^ //' -e 's/ $//'
}
jht_tz_fold() {
  printf '%s\n' "$1" | jht_tz_fold_lines
}

# Names of countries and cities in the 7 languages (and a few common ones) that zone.tab does not have: folded name | country
# code (2 letters) or zone.
JHT_TZ_ALIASES='italia|IT
italy|IT
italie|IT
italien|IT
olaszorszag|IT
roma|Europe/Rome
rome|Europe/Rome
rom|Europe/Rome
milano|Europe/Rome
milan|Europe/Rome
mailand|Europe/Rome
napoli|Europe/Rome
naples|Europe/Rome
torino|Europe/Rome
turin|Europe/Rome
firenze|Europe/Rome
florence|Europe/Rome
venezia|Europe/Rome
venice|Europe/Rome
bologna|Europe/Rome
palermo|Europe/Rome
genova|Europe/Rome
bari|Europe/Rome
germania|DE
germany|DE
deutschland|DE
allemagne|DE
alemania|DE
alemanha|DE
nemetorszag|DE
monaco di baviera|Europe/Berlin
munchen|Europe/Berlin
munich|Europe/Berlin
francoforte|Europe/Berlin
frankfurt|Europe/Berlin
amburgo|Europe/Berlin
hamburg|Europe/Berlin
colonia|Europe/Berlin
koln|Europe/Berlin
cologne|Europe/Berlin
spagna|ES
spain|ES
espana|ES
espagne|ES
spanien|ES
espanha|ES
spanyolorszag|ES
barcellona|Europe/Madrid
barcelona|Europe/Madrid
siviglia|Europe/Madrid
sevilla|Europe/Madrid
valencia|Europe/Madrid
francia|FR
france|FR
frankreich|FR
franca|FR
franciaorszag|FR
parigi|Europe/Paris
paris|Europe/Paris
lione|Europe/Paris
lyon|Europe/Paris
marsiglia|Europe/Paris
marseille|Europe/Paris
portogallo|PT
portugal|PT
portugalia|PT
lisbona|Europe/Lisbon
lisboa|Europe/Lisbon
lisbonne|Europe/Lisbon
lissabon|Europe/Lisbon
porto|Europe/Lisbon
ungheria|HU
hungary|HU
magyarorszag|HU
hongrie|HU
hungria|HU
ungarn|HU
debrecen|Europe/Budapest
szeged|Europe/Budapest
brasile|BR
brazil|BR
brasil|BR
bresil|BR
brasilien|BR
brazilia|BR
san paolo|America/Sao_Paulo
sao paulo|America/Sao_Paulo
rio de janeiro|America/Sao_Paulo
rio|America/Sao_Paulo
svizzera|CH
switzerland|CH
schweiz|CH
suisse|CH
suiza|CH
suica|CH
svajc|CH
ginevra|Europe/Zurich
geneve|Europe/Zurich
geneva|Europe/Zurich
genf|Europe/Zurich
zurigo|Europe/Zurich
basilea|Europe/Zurich
basel|Europe/Zurich
berna|Europe/Zurich
bern|Europe/Zurich
lugano|Europe/Zurich
austria|AT
osterreich|AT
autriche|AT
ausztria|AT
vienna|Europe/Vienna
wien|Europe/Vienna
vienne|Europe/Vienna
viena|Europe/Vienna
becs|Europe/Vienna
regno unito|GB
united kingdom|GB
uk|GB
inghilterra|GB
england|GB
gran bretagna|GB
great britain|GB
royaume uni|GB
reino unido|GB
vereinigtes konigreich|GB
egyesult kiralysag|GB
londra|Europe/London
londres|Europe/London
irlanda|IE
ireland|IE
irland|IE
irlande|IE
stati uniti|US
united states|US
usa|US
etats unis|US
estados unidos|US
vereinigte staaten|US
egyesult allamok|US
nuova york|America/New_York
nueva york|America/New_York
new york|America/New_York
washington|America/New_York
boston|America/New_York
miami|America/New_York
san francisco|America/Los_Angeles
seattle|America/Los_Angeles
messico|MX
mexico|MX
mexique|MX
mexiko|MX
citta del messico|America/Mexico_City
ciudad de mexico|America/Mexico_City
mexico city|America/Mexico_City
canada|CA
kanada|CA
montreal|America/Toronto
paesi bassi|NL
olanda|NL
netherlands|NL
holland|NL
niederlande|NL
pays bas|NL
paises bajos|NL
holanda|NL
hollandia|NL
belgio|BE
belgium|BE
belgien|BE
belgique|BE
belgica|BE
belgium|BE
bruxelles|Europe/Brussels
brussel|Europe/Brussels
bruselas|Europe/Brussels
bruxelas|Europe/Brussels
svezia|SE
sweden|SE
schweden|SE
suede|SE
suecia|SE
svedorszag|SE
norvegia|NO
norway|NO
norwegen|NO
norvege|NO
noruega|NO
danimarca|DK
denmark|DK
danemark|DK
dinamarca|DK
finlandia|FI
finland|FI
finnland|FI
finlande|FI
polonia|PL
poland|PL
polen|PL
pologne|PL
lengyelorszag|PL
varsavia|Europe/Warsaw
warschau|Europe/Warsaw
varsovie|Europe/Warsaw
varsovia|Europe/Warsaw
repubblica ceca|CZ
cechia|CZ
czechia|CZ
tschechien|CZ
praga|Europe/Prague
prag|Europe/Prague
romania|RO
rumanien|RO
roumanie|RO
grecia|GR
greece|GR
griechenland|GR
grece|GR
atene|Europe/Athens
athen|Europe/Athens
athenes|Europe/Athens
atenas|Europe/Athens
croazia|HR
croatia|HR
kroatien|HR
croatie|HR
croacia|HR
slovenia|SI
turchia|TR
turkey|TR
turkei|TR
turquie|TR
turquia|TR
istanbul|Europe/Istanbul
russia|RU
russland|RU
russie|RU
rusia|RU
mosca|Europe/Moscow
moskau|Europe/Moscow
moscou|Europe/Moscow
moscu|Europe/Moscow
ucraina|UA
ukraine|UA
ucrania|UA
giappone|JP
japan|JP
japon|JP
japao|JP
tokio|Asia/Tokyo
toquio|Asia/Tokyo
cina|CN
china|CN
chine|CN
pechino|Asia/Shanghai
peking|Asia/Shanghai
pekin|Asia/Shanghai
beijing|Asia/Shanghai
pequim|Asia/Shanghai
india|IN
indien|IN
inde|IN
nuova delhi|Asia/Kolkata
new delhi|Asia/Kolkata
delhi|Asia/Kolkata
mumbai|Asia/Kolkata
bangalore|Asia/Kolkata
emirati arabi|AE
dubai|Asia/Dubai
australia|AU
australien|AU
australie|AU
argentina|AR
argentinien|AR
argentine|AR
cile|CL
chile|CL
colombia|CO
kolumbien|CO
peru|PE
marocco|MA
morocco|MA
marokko|MA
maroc|MA
marruecos|MA
egitto|EG
egypt|EG
agypten|EG
egypte|EG
egipto|EG
il cairo|Africa/Cairo
cairo|Africa/Cairo
angola|AO
mozambico|MZ
mocambique|MZ
capo verde|CV
cabo verde|CV
acoren|Atlantic/Azores
acores|Atlantic/Azores
azori szigetek|Atlantic/Azores
azzorre|Atlantic/Azores
barcelone|Europe/Madrid
berlim|Europe/Berlin
berlino|Europe/Berlin
bilbao|Europe/Madrid
bordeaux|Europe/Paris
braga|Europe/Lisbon
brasilia|America/Sao_Paulo
brusszel|Europe/Brussels
bucareste|Europe/Bucharest
bucarest|Europe/Bucharest
budapesta|Europe/Budapest
budapeste|Europe/Budapest
bukarest|Europe/Bucharest
burdeos|Europe/Paris
canarias|Atlantic/Canary
canaries|Atlantic/Canary
canarie|Atlantic/Canary
chequia|CZ
chili|CL
coimbra|Europe/Lisbon
colombie|CO
copenaghen|Europe/Copenhagen
copenhaga|Europe/Copenhagen
copenhague|Europe/Copenhagen
csehorszag|CZ
czech republic|CZ
dania|DK
dresda|Europe/Berlin
dresden|Europe/Berlin
dusseldorf|Europe/Berlin
emirati arabi uniti|AE
eslovaquia|SK
eslovenia|SI
estambul|Europe/Istanbul
estocolmo|Europe/Stockholm
estrasburgo|Europe/Paris
faro|Europe/Lisbon
finnorszag|FI
francfort del meno|Europe/Berlin
francfort sur le main|Europe/Berlin
francforte|Europe/Berlin
francfort|Europe/Berlin
funchal|Atlantic/Madeira
gorogorszag|GR
gran canaria|Atlantic/Canary
gyor|Europe/Budapest
hambourg|Europe/Berlin
hamburgo|Europe/Berlin
horvatorszag|HR
islas canarias|Atlantic/Canary
istambul|Europe/Istanbul
isztambul|Europe/Istanbul
kanaren|Atlantic/Canary
kiew|Europe/Kyiv
kijev|Europe/Kyiv
kopenhagen|Europe/Copenhagen
koppenhaga|Europe/Copenhagen
las palmas|Atlantic/Canary
leipzig|Europe/Berlin
lille|Europe/Paris
lipsia|Europe/Berlin
lisszabon|Europe/Lisbon
lussemburgo|LU
luxemburgo|LU
luxemburg|LU
madri|Europe/Madrid
malaga|Europe/Madrid
marselha|Europe/Paris
marsella|Europe/Paris
miskolc|Europe/Budapest
monaco de baviera|Europe/Berlin
munique|Europe/Berlin
nantes|Europe/Paris
nice|Europe/Paris
niza|Europe/Paris
nizza|Europe/Paris
oporto|Europe/Lisbon
paises baixos|NL
parizs|Europe/Paris
pecs|Europe/Budapest
perou|PE
republica checa|CZ
romenia|RO
rumania|RO
saragozza|Europe/Madrid
serbia|RS
serbien|RS
serbie|RS
servia|RS
sevilha|Europe/Madrid
seville|Europe/Madrid
slovacchia|SK
slovaquie|SK
slovenie|SI
slowakei|SK
slowenien|SI
stoccarda|Europe/Berlin
stoccolma|Europe/Stockholm
strasbourg|Europe/Paris
strasburgo|Europe/Paris
stuttgart|Europe/Berlin
szerbia|RS
szlovakia|SK
szlovenia|SI
tchequie|CZ
tenerife|Atlantic/Canary
torokorszag|TR
toulouse|Europe/Paris
ukrajna|UA
united arab emirates|AE
valence|Europe/Madrid
varso|Europe/Warsaw
zaragoza|Europe/Madrid
kiev|Europe/Kyiv'

# The zones that match what the person typed, one per line, without repeats, each with «=» in front when the match is exact and
# «~» when it is a part of a name. Exact: a zone written as it is (with its «/»), a name of the table above, a country code, the
# whole English name of a country (iso3166.tab), the whole name of a city (the last part of a zone). Exact matches, when there are
# any, are the answer alone. Otherwise the countries and the zones whose name (the whole one, «America/New_York» too) contains it.
jht_tz_search() {
  local query dir code tab zones exact
  query="$(jht_tz_fold "$1")"
  [ -n "$query" ] || return 0
  dir="$(jht_zoneinfo_dir)" || return 0
  tab="$dir/zone.tab"
  case "$1" in */*) if jht_tz_valid "$1"; then printf '=%s\n' "$1"; return 0; fi ;; esac
  code="$(printf '%s\n' "$JHT_TZ_ALIASES" | awk -F '|' -v q="$query" '$1 == q { print $2; exit }')"
  if [ -z "$code" ] && [ "${#query}" -eq 2 ]; then code="$(printf '%s' "$query" | tr 'a-z' 'A-Z')"; fi
  case "$code" in
    '') ;;
    ??) zones="$(awk -F '\t' -v cc="$code" '$1 !~ /^#/ && $1 == cc { print $3 }' "$tab")"
        [ -z "$zones" ] || { printf '%s\n' "$zones" | jht_tz_only_valid | sed 's/^/=/'; return 0; } ;;
    *) jht_tz_valid "$code" && { printf '=%s\n' "$code"; return 0; } ;;
  esac
  zones="$(awk -F '\t' '$1 !~ /^#/ && NF >= 3 { print $3 }' "$tab")"
  # every line: the code or the zone, its folded name, its folded last part (empty for a country). Kept in a variable: no file
  # (a name in a shared /tmp could be made first by another user, as a link to a file of the person).
  local names
  names="$({
    if [ -f "$dir/iso3166.tab" ]; then
      grep -v '^#' "$dir/iso3166.tab" | cut -f 1 | paste - <(grep -v '^#' "$dir/iso3166.tab" | cut -f 2 | jht_tz_fold_lines) \
        | awk -F '\t' '{ print "C\t" $1 "\t" $2 "\t" }'
    fi
    printf '%s\n' "$zones" | paste - <(printf '%s\n' "$zones" | tr '/' ' ' | jht_tz_fold_lines) <(printf '%s\n' "$zones" | sed 's|.*/||' | jht_tz_fold_lines) \
      | awk -F '\t' '{ print "Z\t" $1 "\t" $2 "\t" $3 }'
  })"
  exact="$(printf '%s\n' "$names" | awk -F '\t' -v q="$query" '($1 == "C" && $3 == q) || ($1 == "Z" && $4 == q) { print $1 "\t" $2 }')"
  if [ -n "$exact" ]; then
    printf '%s\n' "$exact" | jht_tz_expand "$tab" | jht_tz_only_valid | sed 's/^/=/'
  else
    printf '%s\n' "$names" | awk -F '\t' -v q="$query" 'index($3, q) { print $1 "\t" $2 }' \
      | jht_tz_expand "$tab" | jht_tz_only_valid | sed 's/^/~/'
  fi
}
# «C<tab>code» becomes the zones of that country, «Z<tab>zone» the zone.
jht_tz_expand() {
  local kind name
  while IFS="$(printf '\t')" read -r kind name; do
    case "$kind" in
      C) awk -F '\t' -v cc="$name" '$1 !~ /^#/ && $1 == cc { print $3 }' "$1" ;;
      Z) printf '%s\n' "$name" ;;
    esac
  done
}
jht_tz_only_valid() {
  local zone
  # a result is a zone with its «/» (never a link of the old names like «Portugal» or «GB»)
  awk 'NF && !seen[$0]++' | while read -r zone; do
    case "$zone" in */*) jht_tz_valid "$zone" && printf '%s\n' "$zone" ;; esac
  done
}

JHT_USER_TZ_SAVED=""
if [ -f "$HOST_ENV_PATH" ]; then
  JHT_USER_TZ_SAVED="$(jht_read_host_env_value "$HOST_ENV_PATH" JHT_USER_TZ)" || JHT_USER_TZ_SAVED=""
  jht_tz_valid "$JHT_USER_TZ_SAVED" || JHT_USER_TZ_SAVED=""
fi
JHT_USER_TZ_DETECTED="$(jht_tz_detect)" || JHT_USER_TZ_DETECTED=""
# JHT_USER_TZ from the caller (the browser's zone, given by the wizard): it wins over the machine's, which on a VPS is the server's.
JHT_USER_TZ_CALLER=""
if [ -n "${JHT_USER_TZ:-}" ] && jht_tz_valid "$JHT_USER_TZ"; then JHT_USER_TZ_CALLER="$JHT_USER_TZ"; fi
# The proposal: the zone chosen before, then the caller's, then the machine's. On a server a machine in UTC says nothing of the person.
JHT_USER_TZ_DEFAULT="${JHT_USER_TZ_SAVED:-${JHT_USER_TZ_CALLER:-$JHT_USER_TZ_DETECTED}}"
if [ "$HOST_TYPE" = vps ] && [ -z "$JHT_USER_TZ_SAVED$JHT_USER_TZ_CALLER" ]; then
  case "$JHT_USER_TZ_DETECTED" in UTC|Etc/UTC|Etc/GMT|GMT|Etc/Universal|Universal|Zulu) JHT_USER_TZ_DEFAULT="" ;; esac
fi

JHT_USER_TZ="${JHT_USER_TZ_DEFAULT:-UTC}"
if [ -t 0 ] && [ "$NON_INTERACTIVE" -eq 0 ]; then
  printf "\n${CYAN}━━━ %s ━━━${RESET}\n\n" "$(ts host_setup.timezone_header 'User timezone')"
  printf "%s\n\n" "$(ts host_setup.timezone_explain 'The Captain uses it to convert times in Telegram messages and charts.')"
  if [ -n "$JHT_USER_TZ_SAVED" ] && [ -n "$JHT_USER_TZ_DETECTED" ] && [ "$JHT_USER_TZ_SAVED" != "$JHT_USER_TZ_DETECTED" ]; then
    printf "%s\n" "$(tsf host_setup.tz.saved_and_detected 'Saved: %s (now %s) · Detected now: %s (now %s)' "$JHT_USER_TZ_SAVED" "$(jht_tz_now "$JHT_USER_TZ_SAVED")" "$JHT_USER_TZ_DETECTED" "$(jht_tz_now "$JHT_USER_TZ_DETECTED")")"
  elif [ -n "$JHT_USER_TZ_DEFAULT" ]; then
    printf "%s\n" "$(tsf host_setup.tz.proposed 'Proposed: %s (now %s).' "$JHT_USER_TZ_DEFAULT" "$(jht_tz_now "$JHT_USER_TZ_DEFAULT")")"
  else
    printf "%s\n" "$(ts host_setup.tz.not_detected 'Your timezone was not detected.')"
  fi
  TZ_PICKED=""
  TZ_PENDING=""
  while [ -z "$TZ_PICKED" ]; do
    if [ -n "$TZ_PENDING" ]; then
      # a search typed at the prompt of the number: it starts again with that
      TZ_CHOICE="$TZ_PENDING"; TZ_PENDING=""
    else
      if [ -n "$JHT_USER_TZ_DEFAULT" ]; then
        printf "%s\n" "$(tsf host_setup.tz.how_default 'Press Enter to keep %s, or type a country, a city or a timezone to look for another one.' "$JHT_USER_TZ_DEFAULT")"
        printf "%s " "$(tsf host_setup.tz.ask_default 'Timezone [%s]:' "$JHT_USER_TZ_DEFAULT")"
      else
        printf "%s\n" "$(ts host_setup.tz.how 'Type a country, a city or a timezone (for example Italy, Rome, Europe/Rome).')"
        printf "%s " "$(ts host_setup.tz.ask 'Timezone:')"
      fi
      if ! read -r TZ_CHOICE; then
        # no more input: what was proposed, or UTC said out loud below
        TZ_PICKED="${JHT_USER_TZ_DEFAULT:-UTC}"
        printf '\n'
        break
      fi
    fi
    if [ -z "$TZ_CHOICE" ]; then
      [ -z "$JHT_USER_TZ_DEFAULT" ] || TZ_PICKED="$JHT_USER_TZ_DEFAULT"
      continue
    fi
    case "$TZ_CHOICE" in UTC|utc|Etc/UTC) TZ_PICKED=UTC; break ;; esac
    TZ_RESULTS="$(jht_tz_search "$TZ_CHOICE")"
    TZ_FOUND="$(printf '%s\n' "$TZ_RESULTS" | sed -n 's/^[=~]//p')"
    TZ_COUNT="$(printf '%s' "$TZ_FOUND" | grep -c . || true)"
    TZ_EXACT="$(printf '%s\n' "$TZ_RESULTS" | grep -c '^=' || true)"
    if [ "$TZ_COUNT" -eq 0 ]; then
      warn "$(tsf host_setup.tz.none 'No timezone found for «%s»: try a country, a city or a timezone like Europe/Rome.' "$TZ_CHOICE")"
      continue
    fi
    if [ "$TZ_COUNT" -eq 1 ] && [ "$TZ_EXACT" -eq 1 ]; then
      # one zone that is exactly what was typed: it becomes the proposal, and Enter takes it
      JHT_USER_TZ_DEFAULT="$TZ_FOUND"
      printf "%s\n" "$(tsf host_setup.tz.proposed 'Proposed: %s (now %s).' "$TZ_FOUND" "$(jht_tz_now "$TZ_FOUND")")"
      continue
    fi
    if [ "$TZ_COUNT" -gt 9 ]; then
      warn "$(tsf host_setup.tz.too_many '%d timezones match «%s»: type something more precise (a city, for example).' "$TZ_COUNT" "$TZ_CHOICE")"
      continue
    fi
    # a list, also of one zone found by a part of its name: the person picks it by its number
    printf "\n"
    TZ_N=0
    while read -r TZ_ZONE; do
      TZ_N=$((TZ_N + 1))
      printf "  %d) %s  (%s)\n" "$TZ_N" "$TZ_ZONE" "$(jht_tz_now "$TZ_ZONE")"
    done <<EOF_TZ_FOUND
$TZ_FOUND
EOF_TZ_FOUND
    printf "\n%s " "$(tsf host_setup.tz.pick 'Number (1-%d), or a new search:' "$TZ_COUNT")"
    read -r TZ_NUMBER || TZ_NUMBER=""
    case "$TZ_NUMBER" in
      [1-9])
        if [ "$TZ_NUMBER" -le "$TZ_COUNT" ]; then
          TZ_PICKED="$(printf '%s\n' "$TZ_FOUND" | sed -n "${TZ_NUMBER}p")"
          continue
        fi
        warn "$(tsf host_setup.tz.bad_number 'Choose a number between 1 and %d.' "$TZ_COUNT")"
        ;;
      '') : ;;
      *) TZ_PENDING="$TZ_NUMBER" ;;
    esac
  done
  JHT_USER_TZ="$TZ_PICKED"
fi
ok "$(tsf host_setup.tz.chosen 'Timezone: %s' "$JHT_USER_TZ")"

# #13 — senza una persona al terminale (o su un server che dice UTC) resta UTC: si dice come mettere il proprio fuso.
if [ "$JHT_USER_TZ" = "UTC" ] && { [ ! -t 0 ] || [ "$NON_INTERACTIVE" -eq 1 ] || [ "$HOST_TYPE" = vps ]; }; then
  warn "$(ts host_setup.timezone_vps_utc 'Timezone was not detected: the team will use UTC. Set yours with jht wh --tz Europe/Rome (or in the dashboard), otherwise Telegram times and working hours will be in UTC.')"
fi

# Persisti la scelta in ~/.jht/host.env cosi' il wrapper bash + il wizard
# Node sanno se siamo su VPS (per proporre cloud + Telegram, entrambi opzionali).
# Riscriviamo l'intero file mantenendo JHT_LANG + JHT_USER_TZ. Se in
# futuro si aggiungono altre chiavi, usare un piccolo helper di merge
# invece di sovrascrivere.
mkdir -p "$JHT_HOME_HOST" 2>/dev/null || true
{
  printf 'JHT_LANG=%s\n' "$JHT_LANG"
  printf 'JHT_HOST_TYPE=%s\n' "$HOST_TYPE"
  printf 'JHT_USER_TZ=%s\n' "$JHT_USER_TZ"
} | jht_write_host_env

# Gli stessi tre valori, per il wrapper, nella cartella del runtime: NON e' montata nel container (host.env si', e un agente puo'
# riscriverlo). Sono questi a decidere come il container viene creato e attestato. Temporaneo + rename, 0600; la cartella del
# runtime e' quella di questo script, o JHT_RUNTIME_DIR, o il percorso che il wrapper usa di default.
if [ -n "${JHT_RUNTIME_DIR:-}" ]; then
  HOST_VALUES_DIR="$JHT_RUNTIME_DIR"
elif [ "$(uname -s)" = "Darwin" ]; then
  HOST_VALUES_DIR="$HOME/Library/Application Support/Job Hunter Team/host-runtime"
else
  HOST_VALUES_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/job-hunter-team/host-runtime"
fi
if [ -d "$HOST_VALUES_DIR" ] && [ ! -L "$HOST_VALUES_DIR" ] && [ -O "$HOST_VALUES_DIR" ]; then
  HOST_VALUES_TMP="$HOST_VALUES_DIR/host-values.tmp.$$"
  (
    umask 077
    {
      printf 'JHT_LANG=%s\n' "$JHT_LANG"
      printf 'JHT_HOST_TYPE=%s\n' "$HOST_TYPE"
      printf 'JHT_USER_TZ=%s\n' "$JHT_USER_TZ"
    } > "$HOST_VALUES_TMP"
  ) 2>/dev/null && chmod 600 "$HOST_VALUES_TMP" 2>/dev/null && mv -f -- "$HOST_VALUES_TMP" "$HOST_VALUES_DIR/host-values" 2>/dev/null \
    || { rm -f -- "$HOST_VALUES_TMP" 2>/dev/null; warn "$(tsf host_setup.host_values_not_written 'host-values not written in %s — the wrapper will create it from host.env' "$HOST_VALUES_DIR")"; }
fi

if [ "$HOST_TYPE" = "local" ]; then
  ok "$(tsf host_setup.host_line_no_swap 'Host: %s — %s' "$(ts host_setup.host.local 'local computer')" "$(ts host_setup.swap_not_needed 'no swap configuration needed')")"
  exit 0
fi

ok "$(tsf host_setup.host_line 'Host: %s' "$(ts host_setup.host.vps 'remote server / VPS')")"

# ── Check RAM e swap esistente ───────────────────────────────────────────
RAM_KB=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
RAM_GB=$(( (RAM_KB + 524288) / 1048576 ))   # round to GB
SWAP_KB=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
SWAP_MB=$(( SWAP_KB / 1024 ))

info "$(tsf host_setup.ram_info 'RAM: %d GB  |  Swap active: %d MB' "$RAM_GB" "$SWAP_MB")"

# Swap policy:
# - se gia' >= 1024 MB: ok, skip
# - se RAM >= 8 GB: skip (non serve)
# - altrimenti: chiedi
if [ "$SWAP_MB" -ge 1024 ]; then
  ok "$(tsf host_setup.swap_already_configured 'Swap already configured (%d MB) — skip' "$SWAP_MB")"
  exit 0
fi

if [ "$RAM_GB" -ge 8 ]; then
  ok "$(tsf host_setup.ram_sufficient 'RAM sufficient (%d GB) — swap not needed, skip' "$RAM_GB")"
  exit 0
fi

# ── Proposta swap ────────────────────────────────────────────────────────
SWAP_SIZE_GB=2
SWAP_FILE=/swapfile

# Versione sintetica: 1 riga di motivo (era 4 — l'utente accetta sempre).
printf "\n${DIM}%s${RESET}\n" "$(tsf host_setup.swap_low_ram 'With %d GB of RAM the team may OOM under load.' "$RAM_GB")"
printf "%s [Y/n]: " "$(tsf host_setup.swap_configure 'Configure %d GB of swap in %s?' "$SWAP_SIZE_GB" "$SWAP_FILE")"

DO_SWAP=1
if [ -t 0 ] && [ "$NON_INTERACTIVE" -eq 0 ]; then
  read -r ANSWER
  case "$ANSWER" in
    n|N|no|NO) DO_SWAP=0 ;;
    *)         DO_SWAP=1 ;;
  esac
else
  printf "${DIM}%s${RESET}\n" "$(ts host_setup.swap_noninteractive '(non-interactive stdin; applying default Y)')"
fi

if [ "$DO_SWAP" = "0" ]; then
  warn "$(ts host_setup.swap_not_configured_warn 'Swap not configured — the team may crash under load')"
  exit 0
fi

# ── Configura swap (richiede root) ───────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  warn "$(ts host_setup.swap_root_required 'Root privileges are required to configure swap')"
  if command -v sudo >/dev/null 2>&1; then
    info "$(ts host_setup.swap_trying_sudo 'Trying sudo...')"
    SUDO=sudo
  else
    warn "$(ts host_setup.swap_sudo_unavailable 'sudo is unavailable — skipping swap. Configure it manually later.')"
    exit 0
  fi
else
  SUDO=""
fi

info "$(tsf host_setup.swap_creating 'Creating %s with %d GB...' "$SWAP_FILE" "$SWAP_SIZE_GB")"
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
ok "$(tsf host_setup.swap_active 'Swap active: %d MB (persists across reboot via /etc/fstab)' "$NEW_SWAP_MB")"

exit 0
