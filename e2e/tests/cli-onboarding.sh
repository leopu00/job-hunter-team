#!/usr/bin/env bash
# test E2E CLI: setup, team list, team status
# Esecuzione: bash e2e/tests/cli-onboarding.sh

set -euo pipefail

# SCRIPT_DIR = directory di questo script (e2e/tests/)
# Da lì: ../../.. = root della repo (job-hunter-team/)
# master/ è la worktree principale accanto alla worktree e2e/
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI_DIR="$REPO_ROOT/master/cli"
CONFIG_DIR="$REPO_ROOT/master/shared/config"

PASS=0
FAIL=0
SKIP=0

green() { echo -e "\033[32m✓ $*\033[0m"; }
red()   { echo -e "\033[31m✗ $*\033[0m"; }
yellow(){ echo -e "\033[33m⚠ $*\033[0m"; }

echo ""
echo "=== TEST CLI JHT — Onboarding Flow ==="
echo ""

# ── Prerequisiti ──────────────────────────────────────────────────────────────

# Test 1: directory CLI esiste
if [ -d "$CLI_DIR" ]; then
  green "CLI directory trovata"
  ((PASS++))
else
  red "CLI directory non trovata: $CLI_DIR"
  ((FAIL++))
  echo "ABORT: impossibile continuare senza la directory CLI."
  exit 1
fi

# Test 2: entry point esiste
if [ -f "$CLI_DIR/bin/jht.js" ]; then
  green "Entry point bin/jht.js presente"
  ((PASS++))
else
  red "Entry point bin/jht.js mancante"
  ((FAIL++))
fi

# Test 3: package.json ha bin.jht
if node -e "const p=require('$CLI_DIR/package.json'); process.exit(p.bin && p.bin.jht ? 0 : 1)" 2>/dev/null; then
  green "package.json: bin.jht configurato"
  ((PASS++))
else
  red "package.json: bin.jht non configurato"
  ((FAIL++))
fi

# Test 4: node_modules installati
if [ -d "$CLI_DIR/node_modules" ]; then
  green "node_modules presenti"
  ((PASS++))
  DEPS_OK=true
else
  red "node_modules MANCANTI — eseguire 'npm install' in cli/"
  red "  BUG BLOCCANTE: jht non avviabile senza dipendenze installate"
  ((FAIL++))
  DEPS_OK=false
fi

echo ""
echo "--- Test CLI (richiedono node_modules) ---"
echo ""

if [ "$DEPS_OK" = true ]; then

  # Test 5: jht --help risponde
  if (cd "$CLI_DIR" && node bin/jht.js --help 2>&1 | grep -q "Job Hunter Team"); then
    green "jht --help: output corretto"
    ((PASS++))
  else
    red "jht --help: output non atteso"
    ((FAIL++))
  fi

  # Test 6: jht team list risponde
  if (cd "$CLI_DIR" && node bin/jht.js team list 2>&1 | grep -qi "agenti\|ruolo\|scout\|capitano"); then
    green "jht team list: output agenti visibile"
    ((PASS++))
  else
    red "jht team list: output non atteso"
    ((FAIL++))
  fi

  # Test 7: jht team status risponde
  if (cd "$CLI_DIR" && node bin/jht.js team status 2>&1 | grep -qi "agente\|attivo\|nessun"); then
    green "jht team status: output corretto"
    ((PASS++))
  else
    red "jht team status: output non atteso"
    ((FAIL++))
  fi

  # Test 8: jht config --help risponde
  if (cd "$CLI_DIR" && node bin/jht.js config --help 2>&1 | grep -qi "config"); then
    green "jht config: help disponibile"
    ((PASS++))
  else
    yellow "jht config: help non trovato (SKIP)"
    ((SKIP++))
  fi

else
  yellow "Test 5-8 saltati: node_modules mancanti"
  SKIP=$((SKIP+4))
fi

# ── Struttura shared/config ───────────────────────────────────────────────────
echo ""
echo "--- Verifica shared/config ---"
echo ""

if [ -f "$CONFIG_DIR/index.ts" ] && [ -f "$CONFIG_DIR/schema.ts" ] && [ -f "$CONFIG_DIR/io.ts" ]; then
  green "shared/config: index.ts, schema.ts, io.ts presenti"
  ((PASS++))
else
  red "shared/config: file mancanti"
  ((FAIL++))
fi

if [ -f "$REPO_ROOT/master/shared/config/jht.config.example.json" ]; then
  green "jht.config.example.json presente"
  ((PASS++))
else
  yellow "jht.config.example.json non trovato (SKIP)"
  ((SKIP++))
fi

# ── Riepilogo ─────────────────────────────────────────────────────────────────
echo ""
echo "=== RISULTATI ==="
echo ""
echo -e "  \033[32mPASS: $PASS\033[0m"
echo -e "  \033[31mFAIL: $FAIL\033[0m"
echo -e "  \033[33mSKIP: $SKIP\033[0m"
echo ""

if [ "$DEPS_OK" = false ]; then
  echo -e "\033[33mACTION REQUIRED: installare dipendenze CLI:\033[0m"
  echo "  cd \$REPO_ROOT/master/cli && npm install"
  echo ""
fi

if [ $FAIL -gt 0 ]; then
  exit 1
fi
exit 0
