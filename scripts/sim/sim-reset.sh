#!/usr/bin/env bash
# sim-reset.sh — Reset COMPLETO del container `jht-sim-d2` per una nuova
# simulazione, SENZA buttare giù il container (più rapido del cycle
# sim-down + sim-up).
#
# Cancella ogni traccia delle simulazioni precedenti:
#   - tmux session (CAPITANO, ANALISTA-*, SENTINELLA-WORKER, ecc.)
#   - DB enrichment fields (riporta a status=new, NULL ovunque)
#   - tabelle ausiliarie (transitions, highlights, scores, applications,
#     companies, pending_user_messages)
#   - workspace dir degli agenti (/jht_home_sim/agents/*)
#   - Claude Code transcripts (/jht_home_sim/.claude/projects/*)
#   - Claude history.jsonl
#   - welcome flags + logs + paste/file cache
#   - /tmp del container (sentinel bridge, pacing, ecc.)
#
# Preserva (necessari per non rifare setup):
#   - jobs.db (solo le righe, non il file)
#   - seed.json, seed_import.py, candidate_profile.yml
#   - .claude.json + .claude/.credentials.json (token subscription)
#   - .npm-global/bin/claude (CLI installato)
#   - jht.config.json (provider config)
#
# Uso: bash scripts/sim/sim-reset.sh

set -euo pipefail

CONTAINER="${1:-jht-sim-d2}"

C_GREEN=$'\e[32m'; C_DIM=$'\e[2m'; C_RESET=$'\e[0m'
log() { printf "%s▶%s %s\n" "$C_GREEN" "$C_RESET" "$*"; }

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "✗ Container $CONTAINER non attivo. Avvia con sim-up.sh prima." >&2
  exit 1
fi

# ── 1. Kill tmux session ──────────────────────────────────────────────────
log "Kill tmux session (agenti)"
docker exec "$CONTAINER" sh -c '
for s in CAPITANO ANALISTA-1 ANALISTA-2 ANALISTA-3 ANALISTA-4 ANALISTA-5 \
         SCOUT-1 SCOUT-2 SCOUT-3 SCORER-1 SCRITTORE-1 SCRITTORE-2 \
         CRITICO SENTINELLA ASSISTENTE MENTOR SENTINELLA-WORKER; do
  tmux kill-session -t "$s" 2>/dev/null || true
done
tmux ls 2>&1 || echo "(no tmux sessions remaining)"
'

# ── 2. Wipe DB enrichment + status reset + ausiliarie ─────────────────────
log "Wipe DB (status='new', enrichment=NULL, tabelle ausiliarie)"
docker exec "$CONTAINER" python3 -c "
import sqlite3
c = sqlite3.connect('/jht_home_sim/jobs.db')
c.execute('''
UPDATE positions SET
  role_family=NULL, loc_city=NULL, loc_region=NULL,
  loc_country=NULL, loc_country_code=NULL, loc_continent=NULL,
  work_mode=NULL, work_country=NULL, work_country_code=NULL,
  is_multi_location=0, location_notes=NULL,
  office_lat=NULL, office_lon=NULL, office_address=NULL,
  office_geocoded=0, office_verified=0,
  last_actor=NULL, last_checked=NULL, notes=NULL,
  status='new'
''')
for t in ['position_state_transitions','position_highlights','scores',
          'applications','companies','pending_user_messages']:
    try: c.execute(f'DELETE FROM {t}')
    except: pass
c.commit()
n = c.execute('SELECT COUNT(*) FROM positions WHERE status=\"new\"').fetchone()[0]
print(f'  ✓ positions: {n} status=new, tutto enrichment a NULL')
"

# ── 3. Wipe workspace agenti + Claude transcripts + caches ────────────────
log "Wipe workspace agenti, Claude transcripts, history, welcome flags"
docker exec "$CONTAINER" sh -c '
rm -rf /jht_home_sim/agents/* 2>/dev/null || true
rm -rf /jht_home_sim/.claude/projects/* 2>/dev/null || true
rm -rf /jht_home_sim/.claude/file-history/* 2>/dev/null || true
rm -rf /jht_home_sim/.claude/sessions/* 2>/dev/null || true
rm -rf /jht_home_sim/.claude/cache/* 2>/dev/null || true
rm -rf /jht_home_sim/.claude/shell-snapshots/* 2>/dev/null || true
rm -rf /jht_home_sim/.claude/session-env/* 2>/dev/null || true
rm -rf /jht_home_sim/.claude/paste-cache/* 2>/dev/null || true
rm -rf /jht_home_sim/.claude/telemetry/* 2>/dev/null || true
rm -rf /jht_home_sim/.claude/plans/* 2>/dev/null || true
rm -rf /jht_home_sim/.claude/tasks/* 2>/dev/null || true
rm -rf /jht_home_sim/.claude/logs/* 2>/dev/null || true
rm -f  /jht_home_sim/.claude/history.jsonl 2>/dev/null || true
rm -f  /jht_home_sim/.claude/mcp-needs-auth-cache.json 2>/dev/null || true
rm -rf /jht_home_sim/profile/* 2>/dev/null || true
rm -rf /jht_home_sim/logs/* 2>/dev/null || true
rm -f  /tmp/*.log /tmp/sentinel-* /tmp/pacing-* /tmp/welcome-* 2>/dev/null || true
echo "  ✓ workspace + transcripts + caches puliti"
'

# ── 4. Verifica residui ──────────────────────────────────────────────────
log "Verifica: cosa è rimasto sotto /jht_home_sim/"
docker exec "$CONTAINER" sh -c '
echo "  agents/: $(ls /jht_home_sim/agents 2>/dev/null | wc -l) elementi"
echo "  .claude/projects/: $(ls /jht_home_sim/.claude/projects 2>/dev/null | wc -l) elementi"
echo "  profile/: $(ls /jht_home_sim/profile 2>/dev/null | wc -l) elementi"
echo "  logs/: $(ls /jht_home_sim/logs 2>/dev/null | wc -l) elementi"
echo "  preservati: $(ls /jht_home_sim/*.json /jht_home_sim/*.yml /jht_home_sim/seed* /jht_home_sim/.claude.json /jht_home_sim/.claude/.credentials.json 2>/dev/null | wc -l) file"
'
echo
echo "✓ Reset completo. Container ${CONTAINER} è pronto per una nuova simulazione."
echo "  Per spawnare il Capitano:"
echo "    docker exec -d ${CONTAINER} bash -c 'export HOME=/jht_home_sim JHT_HOME=/jht_home_sim JHT_USER_DIR=/jht_user_sim; bash /app/.launcher/start-agent.sh capitano'"
