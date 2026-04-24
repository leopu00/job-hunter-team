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
_tui_is_shell_pane() {
  local sess="$1"
  local cmd
  cmd=$(tmux list-panes -t "$sess" -F "#{pane_current_command}" 2>/dev/null | head -1)
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
  pane=$(tmux capture-pane -t "$sess" -p 2>/dev/null || true)
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
  snap_prev=$(tmux capture-pane -t "$sess" -p 2>/dev/null || true)

  while [ "$elapsed" -lt "$max_wait" ]; do
    sleep "$window"
    elapsed=$((elapsed + window))

    # Guard 1: pane su shell bash → TUI non ha preso il pty. Reset.
    # Guard 2: pane senza box drawing → processo TUI avviato ma ancora in
    # line-mode (boot/loading, stampa testo piatto). Send arriverebbe
    # allo stdin del loader e andrebbe perso al passaggio a alt-screen.
    if _tui_is_shell_pane "$sess" || ! _tui_has_box_drawing "$sess"; then
      stable_count=0
      snap_prev=$(tmux capture-pane -t "$sess" -p 2>/dev/null || true)
      continue
    fi

    local snap_now
    snap_now=$(tmux capture-pane -t "$sess" -p 2>/dev/null || true)
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
# Ritorna: 0 se il testo e' comparso nel pane ed Enter e' stato inviato,
#          1 se dopo retries tentativi il testo non compare (TUI irricettiva)
#
# Invia il testo in modalita' letterale (-l: niente interpretazione di
# keywords tmux), poi CAPTURA il pane e verifica che la signature sia
# presente. Solo a quel punto invia Enter. In caso di fallimento
# (TUI in boot, modal aperto, focus perso) ri-typea e riprova.
#
# signature default = primi 30 char del messaggio. Substring perche' le
# TUI wrappano righe lunghe e il messaggio potrebbe apparire spezzato.
tui_send_verified() {
  local sess="$1"
  local msg="$2"
  local sig="${3:-}"
  local max_retries="${4:-3}"

  if [ -z "$sig" ]; then
    sig=$(printf '%s' "$msg" | head -c 30)
  fi

  local try
  for try in $(seq 1 "$max_retries"); do
    tmux send-keys -t "$sess" -l "$msg"
    sleep 1.5
    local pane
    pane=$(tmux capture-pane -t "$sess" -p 2>/dev/null || true)
    case "$pane" in
      *"$sig"*)
        sleep 0.4
        tmux send-keys -t "$sess" Enter
        return 0
        ;;
    esac
    sleep 1.5
  done
  return 1
}

# ─── tui_wait_and_send ──────────────────────────────────────────────
# Combinazione comoda: aspetta idle, poi invia verificato.
# Uso:     tui_wait_and_send <session> <message> [signature]
# Ritorna: 0 successo, 1 timeout readiness, 2 send fallito
tui_wait_and_send() {
  local sess="$1"
  local msg="$2"
  local sig="${3:-}"

  if ! tui_wait_ready "$sess"; then
    return 1
  fi
  if ! tui_send_verified "$sess" "$msg" "$sig"; then
    return 2
  fi
  return 0
}
