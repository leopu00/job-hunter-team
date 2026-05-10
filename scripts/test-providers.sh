#!/usr/bin/env bash
# scripts/test-providers.sh — E2E smoke test per tutti i provider LLM.
#
# Loop sui provider (claude, openai, kimi). Per ognuno:
#   1. container up
#   2. providers use <id>
#   3. team start
#   4. sample ogni 2 min per DURATION_MIN totale
#   5. team stop --all
#
# Output in /tmp/provider-tests-<unix>/ con un .log per provider + summary.
#
# Uso:
#   bash scripts/test-providers.sh                     # tutti i provider, 10 min ciascuno
#   bash scripts/test-providers.sh "claude openai" 5   # solo claude+codex, 5 min
set -u

PROVIDERS="${1:-claude openai kimi}"
DURATION_MIN="${2:-10}"
SAMPLE_EVERY_MIN="${3:-2}"
CONTAINER="${JHT_CONTAINER_NAME:-jht}"
CLI="node $(cd "$(dirname "$0")/.." && pwd)/cli/bin/jht.js"

OUT_DIR="/tmp/provider-tests-$(date +%s)"
mkdir -p "$OUT_DIR"
SUMMARY="$OUT_DIR/summary.txt"
: > "$SUMMARY"

echo "Test directory: $OUT_DIR" | tee -a "$SUMMARY"
echo "Providers:      $PROVIDERS" | tee -a "$SUMMARY"
echo "Duration:       $DURATION_MIN min each, sample every $SAMPLE_EVERY_MIN min" | tee -a "$SUMMARY"
echo "Container:      $CONTAINER" | tee -a "$SUMMARY"
echo "Started:        $(date)" | tee -a "$SUMMARY"
echo "" | tee -a "$SUMMARY"

sample() {
  # Short status snapshot — gira dentro il container, rapido.
  # MSYS_NO_PATHCONV=1: git-bash su Windows converte path POSIX /app/... in
  # C:/Program Files/Git/app/... a livello di argomenti — disattiviamo.
  local phase="$1"
  echo "-- [$phase] $(date +%H:%M:%S) --"
  echo "sessions:"
  MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" tmux list-sessions 2>/dev/null | head -8
  echo "rate_budget:"
  MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" bash -c 'python3 /app/shared/skills/rate_budget.py status 2>&1 | head -2'
  echo "bridge (last 3):"
  MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" bash -c 'tail -3 /tmp/sentinel-bridge.log 2>/dev/null'
  echo "kickoff CAPITANO:"
  MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" bash -c 'tail -3 /tmp/kickoff-CAPITANO.log 2>/dev/null'
}

for provider in $PROVIDERS; do
  LOG="$OUT_DIR/$provider.log"
  echo "==================== $provider ====================" | tee -a "$SUMMARY"
  STARTED_AT=$(date +%s)
  {
    echo "=== PROVIDER: $provider ==="
    echo "Start: $(date)"
    echo ""

    # 1. Stop any team running (might be leftover from previous cycle)
    echo "--- team stop --all (pre-cleanup) ---"
    $CLI team stop --all 2>&1 | head -5
    sleep 3

    # 2. Switch provider
    echo ""
    echo "--- providers use $provider ---"
    $CLI providers use "$provider" 2>&1 | head -5
    sleep 1

    # 3. Start team (container mode: CLI delegate a start-agent.sh)
    echo ""
    echo "--- team start ---"
    $CLI team start 2>&1 | head -10
    echo ""

    # 4. Sample loop
    total_samples=$(( DURATION_MIN / SAMPLE_EVERY_MIN + 1 ))
    for i in $(seq 0 "$((total_samples - 1))"); do
      minute=$(( i * SAMPLE_EVERY_MIN ))
      echo ""
      sample "T+${minute}min"
      [ "$i" -lt "$((total_samples - 1))" ] && sleep "$((SAMPLE_EVERY_MIN * 60))"
    done

    # 5. Stop team at end
    echo ""
    echo "--- team stop --all (post-test) ---"
    $CLI team stop --all 2>&1 | head -5
    sleep 3

    echo ""
    echo "End: $(date)"
  } >> "$LOG" 2>&1

  ELAPSED=$(( $(date +%s) - STARTED_AT ))
  # Quick summary line per provider — MSYS_NO_PATHCONV=1 evita path mangle
  # su git-bash. bash -c per path POSIX dentro il container.
  SESSIONS=$(MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" tmux list-sessions 2>/dev/null | wc -l || echo 0)
  ORDERS=$(MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" bash -c 'grep -c "\[ORDER SENT\]" /tmp/sentinel-bridge.log 2>/dev/null || echo 0')
  KICKOFF=$(MSYS_NO_PATHCONV=1 docker exec "$CONTAINER" bash -c 'grep -c "SENT OK" /tmp/kickoff-CAPITANO.log 2>/dev/null || echo 0')
  echo "  elapsed:         ${ELAPSED}s" | tee -a "$SUMMARY"
  echo "  tmux sessions:   $SESSIONS (at stop)" | tee -a "$SUMMARY"
  echo "  bridge orders:   $ORDERS sent during run" | tee -a "$SUMMARY"
  echo "  kickoff OK:      $KICKOFF" | tee -a "$SUMMARY"
  echo "  log:             $LOG" | tee -a "$SUMMARY"
  echo "" | tee -a "$SUMMARY"
done

echo "Finished: $(date)" | tee -a "$SUMMARY"
echo "" | tee -a "$SUMMARY"
echo "=== FULL SUMMARY ===" | tee -a "$SUMMARY"
cat "$SUMMARY"
