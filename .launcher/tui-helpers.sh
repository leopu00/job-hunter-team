#!/usr/bin/env bash
# .launcher/tui-helpers.sh — helper condivisi per inviare messaggi a
# sessioni tmux che ospitano TUI agent (Claude Code / Codex / Kimi).
#
# Le TUI dei 3 provider hanno grafica completamente diversa, ma
# condividono un invariante universale:
#
#    TUI pronta a ricevere input  →  pane silenzioso (nessun byte)
#    TUI in boot/rendering        →  pane che cambia
#
# Invece di cercare marker hardcoded nei banner (`"OpenAI Codex"`,
# `"Welcome to Claude"`...) — fragili a ogni update del CLI che aggiunge
# un tip o un banner — aspettiamo che il pane sia identico a sé stesso
# per N secondi. Questo funziona su qualsiasi TUI, oggi e domani.
#
# Va sorgato (source ...), non eseguito direttamente.

# ─── tui_wait_ready ─────────────────────────────────────────────────
# Uso:     tui_wait_ready <session> [max_wait=120] [min_boot=5] [window=2] [needed_stable=3]
# Ritorna: 0 se il pane e' idle per needed_stable snapshot consecutivi,
#          1 su timeout
#
# Parametri:
#   max_wait       secondi totali oltre i quali si rinuncia (fail-soft:
#                  il caller decide se inviare comunque o skippare)
#   min_boot       secondi "sicuri" prima di iniziare il polling — evita
#                  di matchare il pane vuoto prima del primo render
#   window         quanto aspettare tra due snapshot consecutivi
#   needed_stable  quanti snapshot consecutivi identici richiedere per
#                  considerare il pane davvero idle
#
# Nota sugli spinner: una TUI in boot puo' mostrare spinner che cicla in
# ~80ms (es. kimi "⠇ Loading agent..."). Due snapshot a distanza di 2s
# possono per sfortuna vedere lo spinner nello stesso frame → falso positivo
# "idle". Richiedere needed_stable=3 snapshot consecutivi uguali rende
# questa coincidenza estremamente improbabile (probabilita' ≈ (1/N_frames)^3).
# Ritorna 0 se il comando foreground nel pane e' una shell (bash/sh/zsh),
# 1 se c'e' un processo TUI attivo (claude/codex/kimi/python/qualsiasi cosa).
# Usa tmux list-panes per interrogare il pty direttamente, cross-provider.
# Target tmux: sempre `=NOME:`. Un nome nudo risolve per PREFISSO: con CRITICO
# assente e il CRITICO-S1 di uno Scrittore vivo, il kick-off del Critico
# verrebbe digitato nella review in corso dell'altro. `=` da solo non basta sui
# target pane/finestra (tmux 3.6: `list-panes -t =NOME` con NOME assente
# risponde coi pane della sorella), servono i due punti.
_tui_is_shell_pane() {
  local sess="$1"
  local cmd
  cmd=$(tmux list-panes -t "=$sess:" -F "#{pane_current_command}" 2>/dev/null | head -1)
  case "$cmd" in
    bash|sh|zsh|dash|ash|fish) return 0 ;;
    *) return 1 ;;
  esac
}

# Ritorna 0 se il pane contiene almeno un carattere box-drawing tipico di
# un'interfaccia TUI renderizzata (banner, input box, panels). Serve a
# distinguere la fase "processo TUI avviato ma ancora in line-mode loading"
# (stampa testo piatto + spinner) dalla fase "TUI interattiva pronta"
# (rendering del box di input, banner, etc). Durante la prima fase tmux
# send-keys arriva allo stdin ma viene scartato quando la TUI prende il
# controllo del pty; durante la seconda arriva al prompt di input.
#
# Universale per Claude / Codex / Kimi — tutte usano box drawing nei
# propri banner o nel contorno dell'input box.
_tui_has_box_drawing() {
  local sess="$1"
  local pane
  pane=$(tmux capture-pane -t "=$sess:" -p 2>/dev/null || true)
  case "$pane" in
    *'│'*|*'─'*|*'╭'*|*'╰'*|*'┌'*|*'└'*|*'▐'*|*'║'*|*'═'*) return 0 ;;
    *) return 1 ;;
  esac
}

tui_wait_ready() {
  local sess="$1"
  local max_wait="${2:-120}"
  local min_boot="${3:-5}"
  local window="${4:-2}"
  local needed_stable="${5:-3}"

  sleep "$min_boot"
  local elapsed="$min_boot"
  local stable_count=0
  local snap_prev
  snap_prev=$(tmux capture-pane -t "=$sess:" -p 2>/dev/null || true)

  while [ "$elapsed" -lt "$max_wait" ]; do
    sleep "$window"
    elapsed=$((elapsed + window))

    # Guard 1: pane su shell bash → TUI non ha preso il pty. Reset.
    # Guard 2: pane senza box drawing → processo TUI avviato ma ancora in
    # line-mode (boot/loading, stampa testo piatto). Send arriverebbe
    # allo stdin del loader e andrebbe perso al passaggio a alt-screen.
    if _tui_is_shell_pane "$sess" || ! _tui_has_box_drawing "$sess"; then
      stable_count=0
      snap_prev=$(tmux capture-pane -t "=$sess:" -p 2>/dev/null || true)
      continue
    fi

    local snap_now
    snap_now=$(tmux capture-pane -t "=$sess:" -p 2>/dev/null || true)
    if [ "$snap_prev" = "$snap_now" ]; then
      stable_count=$((stable_count + 1))
      if [ "$stable_count" -ge "$needed_stable" ]; then
        return 0
      fi
    else
      stable_count=0
    fi
    snap_prev="$snap_now"
  done
  return 1
}

# ─── tui_send_verified ──────────────────────────────────────────────
# Uso:     tui_send_verified <session> <message> [signature] [retries=3]
# Ritorna: 0 se il testo e' comparso nel pane E la TUI ha accettato l'invio,
#          1 se dopo retries tentativi il testo non compare (TUI irricettiva),
#          2 se il testo e' nel composer ma l'Enter non e' stato accettato
#            nemmeno dopo TUI_SUBMIT_TRIES invii (default 3)
#
# Invia il testo in modalita' letterale (-l: niente interpretazione di
# keywords tmux), poi CAPTURA il pane e verifica che la signature sia
# presente. Solo a quel punto invia Enter. In caso di fallimento
# (TUI in boot, modal aperto, focus perso) ri-typea e riprova.
#
# signature default = primi 30 char del messaggio. Substring perche' le
# TUI wrappano righe lunghe e il messaggio potrebbe apparire spezzato.
#
# Se il testo e' GIA' nel composer (bozza lasciata da un invio precedente il cui
# Enter si era perso, o kickoff ancora in volo) non lo si digita di nuovo: si
# manda solo l'Enter. Ridigitarlo raddoppia il messaggio nel composer.
#
# Dopo l'Enter si RILEGGE il pane: l'invio e' accettato se il turno e' partito
# (riga di stato "esc to interrupt" comparsa) oppure se il testo non e' piu'
# nel composer. Se e' ancora li', l'Enter e' andato perso e si ripete SOLO
# l'Enter: il testo e' gia' nel composer, ridigitarlo lo raddoppierebbe.
# Prima l'Enter non si verificava e il kickoff loggava "SENT OK" comunque:
# su Codex, con un testo di ~2000 caratteri, l'Enter arrivato mentre la TUI
# elaborava ancora l'incolla e' andato perso, e l'agente e' rimasto fermo con
# il messaggio nel composer (stessa verifica di jht-tmux-send, step 6).
tui_send_verified() {
  local sess="$1"
  local msg="$2"
  local sig="${3:-}"
  local max_retries="${4:-3}"
  local submit_tries="${TUI_SUBMIT_TRIES:-3}"

  if [ -z "$sig" ]; then
    sig=$(printf '%s' "$msg" | head -c 30)
  fi
  # Sonde per il composer, senza spazi ne' bordi (vedi _tui_norm): la coda
  # dell'ultima riga del messaggio sta accanto al cursore, la testa basta per
  # i messaggi corti.
  local probe_tail probe_head
  probe_tail=$(printf '%s\n' "$msg" | sed '/^[[:space:]]*$/d' | tail -n 1 | _tui_norm | tail -c 30)
  probe_head=$(printf '%s' "$sig" | _tui_norm)

  local try pane composer probe busy_before
  for try in $(seq 1 "$max_retries"); do
    # Bozza gia' nel composer: niente seconda digitazione, solo l'Enter.
    pane=$(tmux capture-pane -t "=$sess:" -p 2>/dev/null || true)
    probe=$(_tui_probe_in_composer "$pane" "$probe_tail" "$probe_head")
    if [ -z "$probe" ]; then
      tmux send-keys -t "=$sess:" -l "$msg"
      sleep 1.5
      pane=$(tmux capture-pane -t "=$sess:" -p 2>/dev/null || true)
      probe=$(_tui_probe_in_composer "$pane" "$probe_tail" "$probe_head")
    fi
    # Il testo e' arrivato se se ne vede la testa, o la coda nel composer: una
    # bozza lunga scorre dentro il composer e la testa esce dalla vista, e
    # senza la coda il testo intero verrebbe digitato una seconda volta.
    if [ -z "$probe" ]; then
      case "$pane" in
        *"$sig"*) ;;
        *) sleep 1.5; continue ;;
      esac
    fi
    busy_before=0
    if _tui_pane_busy "$pane"; then busy_before=1; fi
    _tui_press_enter "$sess" "$probe" "$busy_before" "$submit_tries"
    return $?
  done
  return 1
}

# Stampa la sonda (coda o testa del messaggio) se compare nel composer, altrimenti
# niente. Uso: _tui_probe_in_composer <pane> <probe_tail> <probe_head>
_tui_probe_in_composer() {
  local composer
  composer=$(_tui_composer "$1" | _tui_norm)
  if [ -n "$2" ]; then
    case "$composer" in
      *"$2"*) printf '%s' "$2"; return 0 ;;
    esac
  fi
  if [ -n "$3" ]; then
    case "$composer" in
      *"$3"*) printf '%s' "$3"; return 0 ;;
    esac
  fi
  return 0
}

# Preme Enter fino a <submit_tries> volte, riletto il pane dopo ognuno.
# Uso: _tui_press_enter <sess> <probe> <busy_before> <submit_tries>
# Ritorna 0 se la TUI ha accettato l'invio, 2 altrimenti. Mai ridigita il testo.
_tui_press_enter() {
  local sess="$1" probe="$2" busy_before="$3" submit_tries="$4"
  local s_try pane
  for s_try in $(seq 1 "$submit_tries"); do
    sleep 0.4
    tmux send-keys -t "=$sess:" Enter
    # Il render dopo un submit non e' istantaneo: leggere troppo presto
    # darebbe un falso "non accettato" e un Enter in piu' (innocuo su un
    # composer ormai vuoto, ma inutile).
    sleep 1.2
    pane=$(tmux capture-pane -t "=$sess:" -p 2>/dev/null || true)
    if _tui_submitted "$pane" "$probe" "$busy_before"; then
      return 0
    fi
  done
  return 2
}

# Toglie spazi, a capo e bordi verticali: una TUI manda a capo il testo del
# composer dove vuole e lo incornicia ("│ ... │"), quindi il confronto si fa
# sul testo compattato. LC_ALL=C: i bordi sono sequenze UTF-8 da togliere
# byte per byte, qualunque sia il locale del container.
_tui_norm() {
  LC_ALL=C sed 's/│//g; s/┃//g' | LC_ALL=C tr -d ' \t\r\n'
}

# Il COMPOSER: dall'ULTIMA riga che inizia col marker di input ("❯" Claude
# Code/Kimi, "›" Codex, ">" build vecchie, "▌" cursore a blocco), anche dietro
# il bordo del box, fino in fondo al pane. L'ultima e non la prima: dopo un
# submit il messaggio resta nel transcript sopra al composer. Il bordo si
# accetta fino a 4 byte perche' nel container il locale e' C e "│" ne pesa 3.
# Senza marker si guardano le ultime 10 righe: nel dubbio "non accettato",
# che costa un Enter in piu', mai un "SENT OK" falso.
_tui_composer() {
  local start
  start=$(printf '%s\n' "$1" \
    | LC_ALL=C grep -nE '^[[:space:]]*[^[:alnum:][:space:]]{0,4}[[:space:]]*(❯|›|>|▌)' \
    | tail -n 1 | cut -d: -f1)
  if [ -n "$start" ]; then
    printf '%s\n' "$1" | tail -n "+$start"
  else
    printf '%s\n' "$1" | tail -n 10
  fi
}

# Turno in corso: riga di STATO "esc to interrupt" nelle ultime 10 righe,
# distinta dalla prosa che la cita (stessi tre criteri di jht-tmux-send
# `_pane_busy`, tarati su righe vere della flotta): niente virgolette prima,
# e dopo la frase la riga chiude subito o continua con un altro token di stato.
_tui_pane_busy() {
  local line lower before after rest
  while IFS= read -r line; do
    lower=$(printf '%s' "$line" | tr 'A-Z' 'a-z')
    case "$lower" in
      *"esc to interrupt"*) ;;
      *) continue ;;
    esac
    before="${lower%%esc to interrupt*}"
    after="${lower#*esc to interrupt}"
    case "$before" in
      *\"|*\'|*“|*«) continue ;;
    esac
    if [ "${#after}" -gt 40 ]; then
      continue
    fi
    rest=$(printf '%s' "$after" | sed 's/[) ]*$//; s/^ *//')
    case "$rest" in
      "") ;;
      "·"*|"•"*|"|"*|","*|"-"*) ;;
      *) continue ;;
    esac
    return 0
  done <<EOF
$(printf '%s\n' "$1" | tail -n 10)
EOF
  return 1
}

# Uso: _tui_submitted <pane> <probe> <busy_before>
# Accettato se il turno e' partito con questo Enter (occupato ora, non prima)
# oppure se la sonda non e' piu' nel composer. Senza sonda resta solo il turno.
_tui_submitted() {
  local composer
  if [ "$3" = 0 ] && _tui_pane_busy "$1"; then
    return 0
  fi
  [ -n "$2" ] || return 1
  composer=$(_tui_composer "$1" | _tui_norm)
  case "$composer" in
    *"$2"*) return 1 ;;
  esac
  return 0
}

# ─── tui_wait_and_send ──────────────────────────────────────────────
# Combinazione comoda: aspetta idle, poi invia verificato.
# Uso:     tui_wait_and_send <session> <message> [signature]
# Ritorna: 0 successo, 1 timeout readiness, 2 send fallito,
#          3 testo nel composer ma invio non accettato
tui_wait_and_send() {
  local sess="$1"
  local msg="$2"
  local sig="${3:-}"

  if ! tui_wait_ready "$sess"; then
    return 1
  fi
  tui_send_verified "$sess" "$msg" "$sig"
  case $? in
    0) return 0 ;;
    2) return 3 ;;
    *) return 2 ;;
  esac
}

# ─── watchdog del welcome ───────────────────────────────────────────
# Il flag (welcomed.flag, capitano-welcomed.flag, ...) dura quanto il profilo:
# un run di settimane prima lo lascia li'. Il watchdog che si fidava di
# "esiste" usciva al primo controllo anche se l'agente di QUESTO avvio non
# aveva mai elaborato il messaggio. Ora il flag vale solo se piu' recente del
# marcatore d'avvio, che il launcher crea prima del kickoff; l'agente lo tocca
# comunque (anche se non manda nulla perche' "gia' presentato"), quindi un
# flag vecchio diventa recente appena il turno e' stato davvero elaborato.
#
# Uso: _welcome_flag_fresh <flag> <marcatore_avvio>
# Ritorna 0 se il flag esiste ed e' piu' recente del marcatore. Senza marcatore
# non si puo' dire "di questo avvio": ritorna 1 (si reinietta, in sicurezza:
# il testo gia' nel composer non viene ridigitato).
_welcome_flag_fresh() {
  [ -f "$1" ] || return 1
  [ -n "$2" ] && [ -f "$2" ] || return 1
  [ -n "$(find "$1" -newer "$2" 2>/dev/null)" ]
}

# Uso: tui_welcome_watchdog <session> <messaggio> <flag> <marcatore_avvio> [retries=3] [intervallo=90]
# Ogni giro, dopo l'intervallo:
#   - flag di questo avvio           -> fatto, esce 0;
#   - turno in corso nel pane        -> non si tocca niente (il messaggio e' partito);
#   - altrimenti                     -> tui_send_verified: se il primo testo e' ancora
#                                       nel composer premera' solo Enter, mai un secondo incolla.
# Ritorna 1 se dopo l'ultimo giro il flag di questo avvio non c'e'.
tui_welcome_watchdog() {
  local sess="$1" msg="$2" flag="$3" marker="$4"
  local retries="${5:-3}" interval="${6:-90}"
  local retry pane
  echo "[$(date +%H:%M:%S)] welcome watchdog start (flag=$flag)"
  for retry in $(seq 1 "$retries"); do
    sleep "$interval"
    if _welcome_flag_fresh "$flag" "$marker"; then
      echo "[$(date +%H:%M:%S)] flag confirmed for this boot (check $retry/$retries), exiting"
      return 0
    fi
    pane=$(tmux capture-pane -t "=$sess:" -p 2>/dev/null || true)
    if _tui_pane_busy "$pane"; then
      echo "[$(date +%H:%M:%S)] flag not confirmed yet (check $retry/$retries) but a turn is running: not reinjecting"
      continue
    fi
    if [ -f "$flag" ]; then
      echo "[$(date +%H:%M:%S)] flag is from a previous boot and no turn ran (check $retry/$retries): reinjecting"
    else
      echo "[$(date +%H:%M:%S)] flag missing (check $retry/$retries): reinjecting"
    fi
    tui_send_verified "$sess" "$msg"
    case $? in
      0) ;;
      2) echo "[$(date +%H:%M:%S)] SUBMIT NOT CONFIRMED (text left in the composer, Enter not accepted)" ;;
      *) echo "[$(date +%H:%M:%S)] tui_send_verified failed" ;;
    esac
  done
  if ! _welcome_flag_fresh "$flag" "$marker"; then
    echo "[$(date +%H:%M:%S)] watchdog giving up: welcome not confirmed"
    return 1
  fi
  return 0
}
