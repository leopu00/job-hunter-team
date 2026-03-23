#!/usr/bin/env bash
# .dev-team/config.sh — Configurazione path per il team Job Hunter
# Rilevamento automatico della root del repo.

# Root del repo (dove risiede questo script)
DEV_TEAM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DEV_TEAM_DIR/.." && pwd)"
