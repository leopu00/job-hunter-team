#!/usr/bin/env bash
# pager-unstick-watchdog.sh — dismisses Codex TUI's built-in fullscreen
# pager (opened automatically for long tool output) when it is left open
# in a headless tmux session with nobody to press `q`.
#
# Observed repeatedly in production: a single `sed -n`/`cat` of a long
# skill file or JD dump makes the Codex TUI switch to its internal
# paginated viewer ("↑/↓ to scroll ... q to quit"). In an unattended
# tmux session (no human terminal attached) that viewer sits forever —
# the agent makes zero further progress until something sends `q`.
# There is no Codex CLI flag/config to disable this (checked `codex
# features list` and `~/.codex/config.toml` schema — nothing).
#
# This watchdog polls every agent's tmux pane, recognises the pager's
# fixed footer text, sends `q`, and — since dismissing a pager sometimes
# also interrupts the agent's in-flight turn (Codex shows "Conversation
# interrupted") — sends a generic resume nudge so the agent doesn't just
# sit on a dead prompt afterwards.
#
# Loop interval: 20s (configurable via JHT_PAGER_WATCHDOG_INTERVAL).
# Same daemon pattern as agent-watchdog.sh / doctor-watchdog.sh: spawned
# by pid1 at container boot, log-and-continue on any single-session
# failure rather than fail-fast.
set -u

export PATH="/app/agents/_tools:${PATH}"

JHT_HOME="${JHT_HOME:-/jht_home}"
LOG="$JHT_HOME/logs/pager-unstick-watchdog.log"
INTERVAL_SEC="${JHT_PAGER_WATCHDOG_INTERVAL:-20}"

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; }

log "pager-unstick-watchdog up — interval=${INTERVAL_SEC}s"

while true; do
  sessions=$(tmux list-sessions -F '#{session_name}' 2>/dev/null || true)
  for s in $sessions; do
    tail3=$(tmux capture-pane -t "$s" -p -S -3 2>/dev/null || true)
    # Both footer fragments together are the pager's fixed signature —
    # specific enough to avoid matching normal agent chatter.
    if printf '%s' "$tail3" | grep -q 'pgup/pgdn to page' \
      && printf '%s' "$tail3" | grep -q 'q to quit'; then
      log "session $s: stuck in pager, dismissing"
      tmux send-keys -t "$s" q
      sleep 1
      after=$(tmux capture-pane -t "$s" -p -S -3 2>/dev/null || true)
      if printf '%s' "$after" | grep -q 'Conversation interrupted'; then
        jht-tmux-send "$s" "Continue where you left off." >>"$LOG" 2>&1 || true
        log "session $s: dismissal interrupted the turn, sent resume nudge"
      else
        log "session $s: dismissed cleanly, no resume needed"
      fi
    fi
  done
  sleep "$INTERVAL_SEC"
done
