#!/usr/bin/env bash
# sim-up.sh — Avvia il container di simulazione `jht-sim-d2`.
#
# Cosa fa:
#   1. Preflight: verifica che ~/.jht-sim-d2/seed.json esista (estratto a
#      parte da Supabase) e che Docker sia raggiungibile.
#   2. Crea ~/.jht-sim-d2/user/ (CV dir) se manca.
#   3. Copia gli script di simulazione (seed_import.py, candidate_profile.yml)
#      dentro ~/.jht-sim-d2/.
#   4. docker compose up --build per buildare immagine locale e startare
#      il container (sleep infinity, niente pid1/dashboard).
#   5. Esegue seed_import.py dentro al container: db_init + 206 INSERT.
#   6. Stampa istruzioni per spawnare capitano e analisti.
#
# Stop: bash scripts/sim/sim-down.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SIM_HOME="${HOME}/.jht-sim-d2"
COMPOSE_FILE="${REPO_ROOT}/scripts/sim/docker-compose.sim.yml"
SEED_JSON="${SIM_HOME}/seed.json"

C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_RED=$'\e[31m'; C_DIM=$'\e[2m'; C_BOLD=$'\e[1m'; C_RESET=$'\e[0m'
log()  { printf "%s▶%s %s\n" "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf "%s⚠%s %s\n" "$C_YELLOW" "$C_RESET" "$*"; }
err()  { printf "%s✗%s %s\n" "$C_RED" "$C_RESET" "$*" >&2; }

# ── 1. Preflight ──────────────────────────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
  err "Docker non raggiungibile. Avvia Docker Desktop / Colima e riprova."
  exit 1
fi

if [ ! -f "$SEED_JSON" ]; then
  err "Seed mancante: $SEED_JSON"
  err "Esegui prima l'estrazione (vedi BEFORE-START in commento)."
  exit 1
fi

# Verifica che dev1 non stia girando sul container `jht` con bind path
# che potrebbe causare confusione (giusto un warning).
if docker ps --format '{{.Names}}' | grep -qx jht; then
  warn "Container 'jht' attivo (dev1). jht-sim-d2 è isolato, ma assicurati"
  warn "di non confondere logs/exec: i due NON condividono jobs.db."
fi

# ── 2. Preparazione volume ────────────────────────────────────────────────
mkdir -p "$SIM_HOME"/{user,logs,agents}
chmod 700 "$SIM_HOME"

# Profilo candidato di leone.puglisi (TODO: estrai da Supabase o copia da
# ~/.jht/profile/candidate_profile.yml se presente).
if [ ! -f "$SIM_HOME/candidate_profile.yml" ]; then
  if [ -f "${HOME}/.jht/profile/candidate_profile.yml" ]; then
    cp "${HOME}/.jht/profile/candidate_profile.yml" "$SIM_HOME/candidate_profile.yml"
    log "Profilo candidato copiato da ~/.jht/profile/"
  else
    warn "candidate_profile.yml non trovato in ~/.jht/profile/."
    warn "L'analista funzionerà ma senza fit-check vs profilo. Copialo manualmente in $SIM_HOME/"
  fi
fi

# Copia seed_import.py dentro al volume (così è accessibile dal container).
cp "${REPO_ROOT}/scripts/sim/seed_import.py" "$SIM_HOME/seed_import.py"

# ── 3. Build & up ─────────────────────────────────────────────────────────
log "docker compose build (immagine jht-sim:local)..."
docker compose -f "$COMPOSE_FILE" build

log "docker compose up -d (container jht-sim-d2)..."
docker compose -f "$COMPOSE_FILE" up -d

# Attendi che il container sia up
sleep 2
if ! docker ps --format '{{.Names}}' | grep -qx jht-sim-d2; then
  err "Container non avviato. Vedi: docker compose -f $COMPOSE_FILE logs"
  exit 1
fi

# ── 4. Seed import ────────────────────────────────────────────────────────
log "Seed import (db_init + 206 INSERT)..."
docker exec jht-sim-d2 python3 /jht_home_sim/seed_import.py

# ── 5. Riepilogo ──────────────────────────────────────────────────────────
printf "\n"
printf "  %sSimulation container UP%s\n" "$C_GREEN$C_BOLD" "$C_RESET"
printf "    Container:  %sjht-sim-d2%s\n" "$C_BOLD" "$C_RESET"
printf "    Volume:     %s%s%s\n" "$C_DIM" "$SIM_HOME" "$C_RESET"
printf "    jobs.db:    %s%s/jobs.db%s\n" "$C_DIM" "$SIM_HOME" "$C_RESET"
printf "\n"
printf "  %sProssimi passi (esegui tu, in altro terminale):%s\n" "$C_BOLD" "$C_RESET"
printf "    # Apri shell dentro al container:\n"
printf "    %sdocker exec -it jht-sim-d2 bash%s\n" "$C_DIM" "$C_RESET"
printf "\n"
printf "    # Dentro al container, spawna il capitano:\n"
printf "    %sbash /app/.launcher/start-agent.sh capitano%s\n" "$C_DIM" "$C_RESET"
printf "\n"
printf "    # In altro terminale, spawna un analista:\n"
printf "    %sdocker exec -it jht-sim-d2 bash /app/.launcher/start-agent.sh analista%s\n" "$C_DIM" "$C_RESET"
printf "\n"
printf "    # Per fermare tutto:\n"
printf "    %sbash %s/scripts/sim/sim-down.sh%s\n" "$C_DIM" "$REPO_ROOT" "$C_RESET"
printf "\n"
