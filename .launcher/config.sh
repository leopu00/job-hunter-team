#!/usr/bin/env bash
# .launcher/config.sh — Configurazione path per il team Job Hunter
# Rilevamento automatico della root del repo + workspace.

# Root del repo (dove risiede questo script)
DEV_TEAM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DEV_TEAM_DIR/.." && pwd)"

# Workspace dove lavorano gli agenti (configurabile via env o .env)
if [ -z "${JHT_WORKSPACE:-}" ] && [ -f "$REPO_ROOT/.env" ]; then
  JHT_WORKSPACE=$(sed -n 's/^JHT_WORKSPACE=//p' "$REPO_ROOT/.env" 2>/dev/null || echo "")
fi
# Espandi ~ se presente
JHT_WORKSPACE="${JHT_WORKSPACE/#\~/$HOME}"

# Converti path Windows (C:/... o C:\...) in WSL path (/mnt/c/...) se in WSL
if grep -qi microsoft /proc/version 2>/dev/null && [[ "${JHT_WORKSPACE:-}" =~ ^[A-Za-z]:[/\\] ]]; then
  JHT_WORKSPACE=$(wslpath "$JHT_WORKSPACE")
fi
