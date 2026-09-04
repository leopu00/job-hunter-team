#!/usr/bin/env bash
# .launcher/daemon-lib.sh — helper condivisi dagli script che avviano i daemon
# detached del team (bridge-suite, tg-bridge, token-meter, agent-vitals, …).
#
# Sourced da: start-agent.sh, bridge-control.sh.
# Non esegue nulla di per sé: definisce solo funzioni.
#
# Espone:
#   jht_kill_by_marker <marker> [grace_sec] [settle_sec]
#       Termina i processi il cui cmdline contiene <marker>. grace>0 → dopo
#       SIGTERM attende e manda SIGKILL ai sopravvissuti; settle>0 → attesa
#       finale di quiescenza. Delega a proc-kill.py (scansione /proc in Python,
#       NIENTE self-match — vedi il docstring lì e process_health.py).
#
#   jht_daemon_log <nome-file>
#       Stampa il path del log del daemon sotto $JHT_HOME/logs (bind-mount,
#       sopravvive al recreate del container — /tmp è il layer effimero e i log
#       ci sparivano a ogni `docker compose up --force-recreate`), creando la
#       directory e ruotando il file se supera la soglia.
#
#   jht_timeout <secondi> <comando...>
#       Esegue <comando> con un tetto di tempo DOVE il tetto è disponibile.
#       Propaga sempre il rc del comando (124 se il tetto è scattato).

# Directory di questo file — risolta una volta sola, funziona anche quando lo
# script sorgente viene invocato via path relativo.
JHT_LAUNCHER_DIR="${JHT_LAUNCHER_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
JHT_PROC_KILL_PY="${JHT_PROC_KILL_PY:-$JHT_LAUNCHER_DIR/proc-kill.py}"
# Stessa soglia della rotazione di pid1 (cli/src/commands/pid1.js, spawnLabeled).
JHT_DAEMON_LOG_MAX_BYTES="${JHT_DAEMON_LOG_MAX_BYTES:-5242880}"

# `timeout` è GNU coreutils: c'è sempre nel container (Dockerfile: Debian
# bookworm) e sugli host Linux, NON su macOS/BSD — lì al più si chiama
# `gtimeout`, e solo con `brew install coreutils`. Senza questa cascata un
# `timeout` assente esce 127 e ogni chiamante che tratta il non-zero come
# errore fatale trasforma un guard-rail mancante nel fallimento
# dell'operazione che doveva proteggere. `.launcher/` non si è mai concesso
# quella scelta per un binario opzionale: la cascata `stat -c`/`stat -f`/`wc`
# qui sotto e il `flock` di codex-auth-healer.sh degradano invece di morire.
# Nudo significa "senza tetto", non "non eseguito": chi vuole discriminare il
# tetto scattato guarda il 124, che solo `timeout`/`gtimeout` producono.
#
# Niente `-k`: SIGKILL non scioglie un processo bloccato in I/O
# ininterrompibile (stato D su un bind mount stallato) più di quanto faccia
# SIGTERM, e nel caso in cui il tetto serve davvero — un client tmux appeso —
# il processo non ignora SIGTERM, quindi `-k` non copre nessuno scenario in
# più. In cambio costerebbe un rischio: un `timeout` che non conosce `-k`
# risponde 125 (errore d'uso), e chi discrimina l'rc leggerebbe "wrapper
# rotto" a ogni spawn. L'assicurazione contro il figlio che sopravvive è
# altrove ed è già in casa: la chiusura del fd del lock (`9>&-`) nei figli,
# che rende irrilevante quanto a lungo essi restino vivi.
jht_timeout() {
  local secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
  else
    "$@"
  fi
}

jht_daemon_log_dir() {
  printf '%s\n' "${JHT_LOGS_DIR:-${JHT_HOME:-/jht_home}/logs}"
}

jht_daemon_log() {
  local name="$1" dir path size
  dir="$(jht_daemon_log_dir)"
  path="$dir/$name"
  mkdir -p "$dir" 2>/dev/null || true
  size=0
  if [ -f "$path" ]; then
    # stat -c = GNU (container), stat -f = BSD (host macOS), wc = fallback
    size="$(stat -c %s "$path" 2>/dev/null \
      || stat -f %z "$path" 2>/dev/null \
      || wc -c <"$path" 2>/dev/null \
      || echo 0)"
    size="${size// /}"
  fi
  if [ "${size:-0}" -gt "$JHT_DAEMON_LOG_MAX_BYTES" ] 2>/dev/null; then
    # Rotazione singola (come pid1): il precedente resta come .old, il resto
    # se ne va. Se il mv fallisce (fs read-only) tronchiamo e proseguiamo.
    mv -f "$path" "$path.old" 2>/dev/null || : >"$path" 2>/dev/null || true
  fi
  printf '%s\n' "$path"
}

# Fallback shell usato solo se python3 non è disponibile: scan di /proc con
# esclusione esplicita del proprio PID e del parent (il pattern storico non le
# faceva → si auto-matchava).
_jht_kill_scan_fallback() {
  local marker="$1" sig="$2" f pid
  for f in /proc/[0-9]*/cmdline; do
    [ -e "$f" ] || continue
    pid="${f#/proc/}"
    pid="${pid%/cmdline}"
    [ "$pid" = "$$" ] && continue
    [ "$pid" = "${PPID:-0}" ] && continue
    grep -q "$marker" "$f" 2>/dev/null || continue
    kill -"$sig" "$pid" 2>/dev/null || true
  done
}

jht_kill_by_marker() {
  local marker="$1" grace="${2:-0}" settle="${3:-0}"
  [ -n "$marker" ] || return 0
  if command -v python3 >/dev/null 2>&1 && [ -f "$JHT_PROC_KILL_PY" ]; then
    python3 "$JHT_PROC_KILL_PY" "$marker" --grace "$grace" --settle "$settle" \
      >/dev/null 2>&1 || true
    return 0
  fi
  _jht_kill_scan_fallback "$marker" TERM
  if [ "$grace" != "0" ]; then
    sleep "$grace" 2>/dev/null || true
    _jht_kill_scan_fallback "$marker" KILL
  fi
  if [ "$settle" != "0" ]; then
    sleep "$settle" 2>/dev/null || true
  fi
  return 0
}
