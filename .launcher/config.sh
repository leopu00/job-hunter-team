#!/usr/bin/env bash
# .launcher/config.sh — Configurazione path per il team Job Hunter
# Path fissi JHT (specchio di tui/src/tui-paths.ts).

# Root del repo (dove risiede questo script)
DEV_TEAM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DEV_TEAM_DIR/.." && pwd)"

# Zona nascosta — dove girano gli agenti. Rispetta JHT_HOME /
# JHT_USER_DIR se già settati via env (nel container JHT il Dockerfile
# esporta JHT_HOME=/jht_home come bind-mount). Fallback: host-style.
JHT_HOME="${JHT_HOME:-$HOME/.jht}"
JHT_CONFIG="$JHT_HOME/jht.config.json"
JHT_DB="$JHT_HOME/jobs.db"
JHT_AGENTS_DIR="$JHT_HOME/agents"
JHT_LOGS_DIR="$JHT_HOME/logs"

# Zona visibile — dove l'utente droppa CV e legge output
JHT_USER_DIR="${JHT_USER_DIR:-$HOME/Documents/Job Hunter Team}"

export JHT_HOME JHT_CONFIG JHT_DB JHT_AGENTS_DIR JHT_LOGS_DIR JHT_USER_DIR
