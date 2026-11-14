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
    en:host_setup.detected) printf '%s' 'Detected:' ;;
    en:host_setup.host.local) printf '%s' 'local computer' ;;
    en:host_setup.host.vps) printf '%s' 'remote server / VPS' ;;
    en:host_setup.option.local.line1) printf '%s' 'The full team runs on this PC; keep it awake with Docker running while the team works.' ;;
    en:host_setup.option.local.line2) printf '%s' 'Shortest guided path; no VPS or cloud account required.' ;;
    en:host_setup.option.local.title) printf '%s' 'Local PC' ;;
    en:host_setup.option.vps.line1) printf '%s' 'The team runs on a remote Linux server over SSH and can continue when this PC is off.' ;;
    en:host_setup.option.vps.line2) printf '%s' 'You provide and administer the server and its SSH access.' ;;
    en:host_setup.option.vps.title) printf '%s' 'VPS / remote server' ;;
    en:host_setup.ram_sufficient) printf '%s' 'RAM sufficient (%d GB) — swap not needed, skip' ;;
    en:host_setup.section_header) printf '%s' 'Host setup (preflight)' ;;
    en:host_setup.swap_active) printf '%s' 'Swap active: %d MB (persists across reboot via /etc/fstab)' ;;
    en:host_setup.swap_already_configured) printf '%s' 'swap already configured (%d MB) — skip' ;;
    en:host_setup.swap_configure) printf '%s' 'Configure %d GB of swap in %s?' ;;
    en:host_setup.swap_low_ram) printf '%s' 'With %d GB of RAM the team may OOM under load.' ;;
    en:host_setup.swap_not_configured_warn) printf '%s' 'swap not configured — team may crash under load' ;;
    en:host_setup.swap_not_needed) printf '%s' 'no swap configuration needed' ;;
    en:host_setup.swap_root_required) printf '%s' 'Root privileges needed to configure swap' ;;
    en:host_setup.timezone_explain) printf '%s' 'The Captain uses it to convert times in Telegram messages and charts.' ;;
    en:host_setup.timezone_header) printf '%s' 'User timezone' ;;
    en:host_setup.timezone_invalid) printf '%s' 'Invalid timezone, falling back to UTC.' ;;
    en:host_setup.timezone_prompt) printf '%s' 'Where are you (IANA timezone, e.g. Europe/Rome, America/New_York, Asia/Shanghai)?' ;;
    en:host_setup.where_running) printf '%s' 'Where are you running JHT?' ;;
    it:host_setup.detected) printf '%s' 'Rilevato:' ;;
    it:host_setup.host.local) printf '%s' 'computer locale' ;;
    it:host_setup.host.vps) printf '%s' 'server remoto / VPS' ;;
    it:host_setup.option.local.line1) printf '%s' 'Il team completo lavora su questo PC; tienilo acceso con Docker attivo mentre il team lavora.' ;;
    it:host_setup.option.local.line2) printf '%s' 'Percorso guidato più breve; non servono una VPS o un account cloud.' ;;
    it:host_setup.option.local.title) printf '%s' 'PC locale' ;;
    it:host_setup.option.vps.line1) printf '%s' 'Il team lavora su un server Linux remoto via SSH e può continuare quando questo PC è spento.' ;;
    it:host_setup.option.vps.line2) printf '%s' 'Fornisci e amministri tu il server e il relativo accesso SSH.' ;;
    it:host_setup.option.vps.title) printf '%s' 'VPS / server remoto' ;;
    it:host_setup.ram_sufficient) printf '%s' 'RAM sufficiente (%d GB) — swap non necessaria, skip' ;;
    it:host_setup.section_header) printf '%s' 'Setup host (preflight)' ;;
    it:host_setup.swap_active) printf '%s' 'Swap attiva: %d MB (persiste a reboot via /etc/fstab)' ;;
    it:host_setup.swap_already_configured) printf '%s' 'swap gia'\'' configurato (%d MB) — skip' ;;
    it:host_setup.swap_configure) printf '%s' 'Configuro %d GB di swap in %s?' ;;
    it:host_setup.swap_low_ram) printf '%s' 'Con %d GB di RAM il team puo'\'' andare in OOM sotto carico.' ;;
    it:host_setup.swap_not_configured_warn) printf '%s' 'swap non configurata — il team potrebbe crashare sotto carico' ;;
    it:host_setup.swap_not_needed) printf '%s' 'nessuna configurazione swap richiesta' ;;
    it:host_setup.swap_root_required) printf '%s' 'Servono privilegi root per configurare la swap' ;;
    it:host_setup.timezone_explain) printf '%s' 'Il Capitano la usa per convertire gli orari nei messaggi Telegram e nei grafici.' ;;
    it:host_setup.timezone_header) printf '%s' 'Timezone utente' ;;
    it:host_setup.timezone_invalid) printf '%s' 'Timezone non valida, fallback a UTC.' ;;
    it:host_setup.timezone_prompt) printf '%s' 'Dove ti trovi (timezone IANA, es. Europe/Rome, America/New_York, Asia/Shanghai)?' ;;
    it:host_setup.where_running) printf '%s' 'Dove stai eseguendo JHT?' ;;
    hu:host_setup.detected) printf '%s' 'Észlelt:' ;;
    hu:host_setup.host.local) printf '%s' 'helyi számítógép' ;;
    hu:host_setup.host.vps) printf '%s' 'távoli szerver / VPS' ;;
    hu:host_setup.option.local.line1) printf '%s' 'A teljes csapat ezen a PC-n fut; munka közben tartsd ébren, futó Dockerrel.' ;;
    hu:host_setup.option.local.line2) printf '%s' 'A legrövidebb vezetett út; nem kell VPS vagy felhőfiók.' ;;
    hu:host_setup.option.local.title) printf '%s' 'Helyi PC' ;;
    hu:host_setup.option.vps.line1) printf '%s' 'A csapat egy távoli Linux-szerveren fut SSH-n át, és a PC kikapcsolása után is folytathatja.' ;;
    hu:host_setup.option.vps.line2) printf '%s' 'A szervert és az SSH-hozzáférést te biztosítod és kezeled.' ;;
    hu:host_setup.option.vps.title) printf '%s' 'VPS / távoli szerver' ;;
    hu:host_setup.ram_sufficient) printf '%s' 'elegendő RAM (%d GB) — swap nem szükséges, kihagyás' ;;
    hu:host_setup.section_header) printf '%s' 'Host telepítés (előellenőrzés)' ;;
    hu:host_setup.swap_active) printf '%s' 'Swap aktív: %d MB (újraindítás után is megmarad a /etc/fstab miatt)' ;;
    hu:host_setup.swap_already_configured) printf '%s' 'swap már beállítva (%d MB) — kihagyás' ;;
    hu:host_setup.swap_configure) printf '%s' 'Beállítok %d GB swap-et ide: %s?' ;;
    hu:host_setup.swap_low_ram) printf '%s' '%d GB RAM mellett a csapat OOM-ba mehet terhelés alatt.' ;;
    hu:host_setup.swap_not_configured_warn) printf '%s' 'swap nincs beállítva — a csapat összeomolhat terhelés alatt' ;;
    hu:host_setup.swap_not_needed) printf '%s' 'nincs szükség swap beállításra' ;;
    hu:host_setup.swap_root_required) printf '%s' 'Root jogosultság szükséges a swap beállításához' ;;
    hu:host_setup.timezone_explain) printf '%s' 'A Kapitány ezt használja az időpontok átváltására Telegram üzenetekben és grafikonokon.' ;;
    hu:host_setup.timezone_header) printf '%s' 'Felhasználói időzóna' ;;
    hu:host_setup.timezone_invalid) printf '%s' 'Érvénytelen időzóna, visszaesés UTC-re.' ;;
    hu:host_setup.timezone_prompt) printf '%s' 'Hol vagy (IANA időzóna, pl. Europe/Budapest, America/New_York, Asia/Shanghai)?' ;;
    hu:host_setup.where_running) printf '%s' 'Hol futtatod a JHT-t?' ;;
    es:host_setup.detected) printf '%s' 'Detectado:' ;;
    es:host_setup.host.local) printf '%s' 'ordenador local' ;;
    es:host_setup.host.vps) printf '%s' 'servidor remoto / VPS' ;;
    es:host_setup.option.local.line1) printf '%s' 'El equipo completo trabaja en este PC; mantenlo activo con Docker en marcha mientras trabaja.' ;;
    es:host_setup.option.local.line2) printf '%s' 'La ruta guiada más corta; no requiere VPS ni cuenta cloud.' ;;
    es:host_setup.option.local.title) printf '%s' 'PC local' ;;
    es:host_setup.option.vps.line1) printf '%s' 'El equipo trabaja en un servidor Linux remoto por SSH y puede continuar con este PC apagado.' ;;
    es:host_setup.option.vps.line2) printf '%s' 'Tú proporcionas y administras el servidor y su acceso SSH.' ;;
    es:host_setup.option.vps.title) printf '%s' 'VPS / servidor remoto' ;;
    es:host_setup.ram_sufficient) printf '%s' 'RAM suficiente (%d GB) — swap no necesario, saltar' ;;
    es:host_setup.section_header) printf '%s' 'Configuración del host (preflight)' ;;
    es:host_setup.swap_active) printf '%s' 'Swap activo: %d MB (persiste tras reinicio vía /etc/fstab)' ;;
    es:host_setup.swap_already_configured) printf '%s' 'swap ya configurado (%d MB) — saltar' ;;
    es:host_setup.swap_configure) printf '%s' '¿Configurar %d GB de swap en %s?' ;;
    es:host_setup.swap_low_ram) printf '%s' 'Con %d GB de RAM el equipo puede quedarse sin memoria bajo carga.' ;;
    es:host_setup.swap_not_configured_warn) printf '%s' 'swap no configurado — el equipo puede caerse bajo carga' ;;
    es:host_setup.swap_not_needed) printf '%s' 'no hace falta configurar swap' ;;
    es:host_setup.swap_root_required) printf '%s' 'Se necesitan privilegios de root para configurar el swap' ;;
    es:host_setup.timezone_explain) printf '%s' 'El Capitán la usa para convertir las horas en los mensajes de Telegram y en los gráficos.' ;;
    es:host_setup.timezone_header) printf '%s' 'Zona horaria del usuario' ;;
    es:host_setup.timezone_invalid) printf '%s' 'Zona horaria no válida, se usará UTC.' ;;
    es:host_setup.timezone_prompt) printf '%s' '¿Dónde estás (zona horaria IANA, p. ej. Europe/Madrid, America/Mexico_City, Asia/Shanghai)?' ;;
    es:host_setup.where_running) printf '%s' '¿Dónde estás ejecutando JHT?' ;;
    de:host_setup.detected) printf '%s' 'Erkannt:' ;;
    de:host_setup.host.local) printf '%s' 'lokaler Computer' ;;
    de:host_setup.host.vps) printf '%s' 'Remote-Server / VPS' ;;
    de:host_setup.option.local.line1) printf '%s' 'Das vollständige Team läuft auf diesem PC; halte ihn wach und Docker aktiv, solange es arbeitet.' ;;
    de:host_setup.option.local.line2) printf '%s' 'Der kürzeste geführte Weg; weder VPS noch Cloud-Konto sind nötig.' ;;
    de:host_setup.option.local.title) printf '%s' 'Lokaler PC' ;;
    de:host_setup.option.vps.line1) printf '%s' 'Das Team läuft per SSH auf einem entfernten Linux-Server und kann bei ausgeschaltetem PC weiterarbeiten.' ;;
    de:host_setup.option.vps.line2) printf '%s' 'Du stellst den Server und den SSH-Zugang bereit und verwaltest sie.' ;;
    de:host_setup.option.vps.title) printf '%s' 'VPS / Remote-Server' ;;
    de:host_setup.ram_sufficient) printf '%s' 'RAM ausreichend (%d GB) — Swap nicht nötig, überspringen' ;;
    de:host_setup.section_header) printf '%s' 'Host-Setup (Preflight)' ;;
    de:host_setup.swap_active) printf '%s' 'Swap aktiv: %d MB (bleibt nach Neustart via /etc/fstab erhalten)' ;;
    de:host_setup.swap_already_configured) printf '%s' 'Swap bereits konfiguriert (%d MB) — überspringen' ;;
    de:host_setup.swap_configure) printf '%s' '%d GB Swap in %s konfigurieren?' ;;
    de:host_setup.swap_low_ram) printf '%s' 'Mit %d GB RAM könnte dem Team unter Last der Speicher ausgehen.' ;;
    de:host_setup.swap_not_configured_warn) printf '%s' 'Swap nicht konfiguriert — das Team könnte unter Last abstürzen' ;;
    de:host_setup.swap_not_needed) printf '%s' 'keine Swap-Konfiguration nötig' ;;
    de:host_setup.swap_root_required) printf '%s' 'Root-Rechte werden benötigt, um Swap zu konfigurieren' ;;
    de:host_setup.timezone_explain) printf '%s' 'Der Kapitän verwendet sie, um die Zeiten in Telegram-Nachrichten und Diagrammen umzurechnen.' ;;
    de:host_setup.timezone_header) printf '%s' 'Zeitzone des Nutzers' ;;
    de:host_setup.timezone_invalid) printf '%s' 'Ungültige Zeitzone, es wird UTC verwendet.' ;;
    de:host_setup.timezone_prompt) printf '%s' 'Wo bist du (IANA-Zeitzone, z. B. Europe/Berlin, America/New_York, Asia/Shanghai)?' ;;
    de:host_setup.where_running) printf '%s' 'Wo führst du JHT aus?' ;;
    fr:host_setup.detected) printf '%s' 'Détecté :' ;;
    fr:host_setup.host.local) printf '%s' 'ordinateur local' ;;
    fr:host_setup.host.vps) printf '%s' 'serveur distant / VPS' ;;
    fr:host_setup.option.local.line1) printf '%s' 'L'\''équipe complète travaille sur ce PC ; garde-le éveillé avec Docker actif pendant son travail.' ;;
    fr:host_setup.option.local.line2) printf '%s' 'Le parcours guidé le plus court ; aucune VPS ni compte cloud requis.' ;;
    fr:host_setup.option.local.title) printf '%s' 'PC local' ;;
    fr:host_setup.option.vps.line1) printf '%s' 'L'\''équipe travaille sur un serveur Linux distant via SSH et peut continuer quand ce PC est éteint.' ;;
    fr:host_setup.option.vps.line2) printf '%s' 'Tu fournis et administres le serveur et son accès SSH.' ;;
    fr:host_setup.option.vps.title) printf '%s' 'VPS / serveur distant' ;;
    fr:host_setup.ram_sufficient) printf '%s' 'RAM suffisante (%d Go) — swap non nécessaire, ignorer' ;;
    fr:host_setup.section_header) printf '%s' 'Configuration du hôte (préflight)' ;;
    fr:host_setup.swap_active) printf '%s' 'Swap actif : %d Mo (persiste après redémarrage via /etc/fstab)' ;;
    fr:host_setup.swap_already_configured) printf '%s' 'swap déjà configuré (%d Mo) — ignorer' ;;
    fr:host_setup.swap_configure) printf '%s' 'Configurer %d Go de swap dans %s ?' ;;
    fr:host_setup.swap_low_ram) printf '%s' 'Avec %d Go de RAM l'\''équipe peut tomber en OOM sous charge.' ;;
    fr:host_setup.swap_not_configured_warn) printf '%s' 'swap non configuré — l'\''équipe pourrait planter sous charge' ;;
    fr:host_setup.swap_not_needed) printf '%s' 'aucune configuration swap requise' ;;
    fr:host_setup.swap_root_required) printf '%s' 'Privilèges root nécessaires pour configurer le swap' ;;
    fr:host_setup.timezone_explain) printf '%s' 'Le Capitaine l'\''utilise pour convertir les heures dans les messages Telegram et les graphiques.' ;;
    fr:host_setup.timezone_header) printf '%s' 'Fuseau horaire utilisateur' ;;
    fr:host_setup.timezone_invalid) printf '%s' 'Fuseau invalide, repli sur UTC.' ;;
    fr:host_setup.timezone_prompt) printf '%s' 'Où es-tu (fuseau IANA, par ex. Europe/Paris, America/New_York, Asia/Shanghai) ?' ;;
    fr:host_setup.where_running) printf '%s' 'Où exécutes-tu JHT ?' ;;
    pt:host_setup.detected) printf '%s' 'Detectado:' ;;
    pt:host_setup.host.local) printf '%s' 'computador local' ;;
    pt:host_setup.host.vps) printf '%s' 'servidor remoto / VPS' ;;
    pt:host_setup.option.local.line1) printf '%s' 'A equipa completa trabalha neste PC; mantém-no ativo com o Docker em execução enquanto ela trabalha.' ;;
    pt:host_setup.option.local.line2) printf '%s' 'O percurso guiado mais curto; não requer VPS nem conta cloud.' ;;
    pt:host_setup.option.local.title) printf '%s' 'PC local' ;;
    pt:host_setup.option.vps.line1) printf '%s' 'A equipa trabalha num servidor Linux remoto por SSH e pode continuar com este PC desligado.' ;;
    pt:host_setup.option.vps.line2) printf '%s' 'Tu forneces e administras o servidor e o respetivo acesso SSH.' ;;
    pt:host_setup.option.vps.title) printf '%s' 'VPS / servidor remoto' ;;
    pt:host_setup.ram_sufficient) printf '%s' 'RAM suficiente (%d GB) — swap desnecessário, pular' ;;
    pt:host_setup.section_header) printf '%s' 'Configuração do host (preflight)' ;;
    pt:host_setup.swap_active) printf '%s' 'Swap ativo: %d MB (persiste após reboot via /etc/fstab)' ;;
    pt:host_setup.swap_already_configured) printf '%s' 'swap já configurado (%d MB) — pular' ;;
    pt:host_setup.swap_configure) printf '%s' 'Configurar %d GB de swap em %s?' ;;
    pt:host_setup.swap_low_ram) printf '%s' 'Com %d GB de RAM a equipa pode dar OOM sob carga.' ;;
    pt:host_setup.swap_not_configured_warn) printf '%s' 'swap não configurado — a equipa pode travar sob carga' ;;
    pt:host_setup.swap_not_needed) printf '%s' 'nenhuma configuração de swap necessária' ;;
    pt:host_setup.swap_root_required) printf '%s' 'Privilégios de root necessários para configurar swap' ;;
    pt:host_setup.timezone_explain) printf '%s' 'O Capitão usa para converter horários nas mensagens do Telegram e nos gráficos.' ;;
    pt:host_setup.timezone_header) printf '%s' 'Fuso horário do utilizador' ;;
    pt:host_setup.timezone_invalid) printf '%s' 'Fuso inválido, fallback para UTC.' ;;
    pt:host_setup.timezone_prompt) printf '%s' 'Onde estás (fuso IANA, ex. Europe/Lisbon, America/Sao_Paulo, Asia/Shanghai)?' ;;
    pt:host_setup.where_running) printf '%s' 'Onde estás a executar o JHT?' ;;
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
  if EXISTING_TZ="$(jht_read_host_env_value "$HOST_ENV_PATH" JHT_USER_TZ)"; then
    JHT_USER_TZ_DEFAULT="$EXISTING_TZ"
  fi
fi

JHT_USER_TZ="$JHT_USER_TZ_DEFAULT"
if [ -t 0 ] && [ "$NON_INTERACTIVE" -eq 0 ]; then
  printf "\n${CYAN}━━━ %s ━━━${RESET}\n\n" "$(ts host_setup.timezone_header 'User timezone')"
  printf "%s\n" "$(ts host_setup.timezone_prompt 'Where are you (IANA timezone, e.g. Europe/Rome, America/New_York, Asia/Shanghai)?')"
  printf "%s\n\n" "$(ts host_setup.timezone_explain 'The Captain uses it to convert times in Telegram messages and charts.')"
  printf "%s [%s]: " "$(ts host_setup.timezone_label 'Timezone')" "$JHT_USER_TZ_DEFAULT"
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
ok "$(ts host_setup.timezone_label 'Timezone'): $JHT_USER_TZ"

# #13 — su VPS / non-interattivo il prompt sopra è saltato, quindi resta
# l'UTC del SERVER (non la timezone dell'utente, che sta altrove nel mondo).
# Senza la TZ reale il Capitano mostra orari/reset sfasati e le working-hours
# valgono in UTC invece che nelle ore locali dell'utente (sul beta VPS si è
# dovuto passare --tz Europe/Rome a mano). Avvisa esplicitamente come correggere.
if { [ ! -t 0 ] || [ "$NON_INTERACTIVE" -eq 1 ]; } && [ "$JHT_USER_TZ" = "UTC" ]; then
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
  ok "Host: $(ts host_setup.host.local 'local computer') — $(ts host_setup.swap_not_needed 'no swap configuration needed')"
  exit 0
fi

ok "Host: $(ts host_setup.host.vps 'remote server / VPS')"

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
