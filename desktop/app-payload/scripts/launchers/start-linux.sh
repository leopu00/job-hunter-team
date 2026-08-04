#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# Job Hunter Team — Linux Launcher
# Avvia il backend e apre il browser su http://localhost:3000
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

PORT=3000
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$APP_DIR/web"
LOG_FILE="$APP_DIR/.jht-server.log"

# ── Colori ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

banner() {
  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║${NC}  ${BOLD}Job Hunter Team${NC}                    ${GREEN}║${NC}"
  echo -e "${GREEN}║${NC}  Sistema multi-agente di ricerca     ${GREEN}║${NC}"
  echo -e "${GREEN}║${NC}  e candidatura automatizzata         ${GREEN}║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
  echo ""
}

info()  { echo -e "${CYAN}[info]${NC}  $1"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $1"; }
fail()  { echo -e "${RED}[err]${NC}   $1"; exit 1; }

banner

# ── Check Node.js ──
info "Verifica Node.js..."
if ! command -v node &>/dev/null; then
  warn "Node.js non trovato."
  echo ""
  echo -e "  Installa Node.js 18+ con uno di questi metodi:"
  echo ""
  echo -e "  ${BOLD}Ubuntu/Debian:${NC}"
  echo -e "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo -e "    sudo apt-get install -y nodejs"
  echo ""
  echo -e "  ${BOLD}Fedora/RHEL:${NC}"
  echo -e "    sudo dnf install nodejs"
  echo ""
  echo -e "  ${BOLD}nvm (qualsiasi distro):${NC}"
  echo -e "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
  echo -e "    nvm install 20"
  echo ""
  fail "Installa Node.js e riprova."
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  fail "Serve Node.js 18+. Versione attuale: $(node -v)"
fi
ok "Node.js $(node -v)"

# ── Check npm ──
if ! command -v npm &>/dev/null; then
  fail "npm non trovato. Installa Node.js da https://nodejs.org"
fi
ok "npm $(npm -v)"

# ── Check directory web ──
if [ ! -d "$WEB_DIR" ]; then
  fail "Directory web/ non trovata in $APP_DIR"
fi

# ── Installa dipendenze ──
if [ ! -d "$WEB_DIR/node_modules" ]; then
  info "Installazione dipendenze (prima esecuzione)..."
  cd "$WEB_DIR" && npm install --production=false 2>&1 | tail -1
  ok "Dipendenze installate"
else
  ok "Dipendenze presenti"
fi

# ── Build (se necessario) ──
if [ ! -d "$WEB_DIR/.next" ]; then
  info "Build dell'applicazione (prima esecuzione, potrebbe richiedere qualche minuto)..."
  cd "$WEB_DIR" && npm run build 2>&1 | tail -3
  ok "Build completata"
else
  ok "Build presente"
fi

# ── Verifica porta libera ──
if ss -tlnp 2>/dev/null | grep -q ":$PORT " || netstat -tlnp 2>/dev/null | grep -q ":$PORT "; then
  warn "Porta $PORT occupata. Provo a fermare il processo..."
  fuser -k "$PORT/tcp" 2>/dev/null || true
  sleep 1
fi

# ── Avvio server ──
info "Avvio server su http://localhost:$PORT ..."
cd "$WEB_DIR"
npm run start -- -p "$PORT" > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

# ── Attendi che il server sia pronto ──
info "Attendo che il server sia pronto..."
for i in $(seq 1 30); do
  if curl -s "http://localhost:$PORT" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -s "http://localhost:$PORT" >/dev/null 2>&1; then
  fail "Il server non risponde dopo 30 secondi. Controlla $LOG_FILE"
fi

ok "Server attivo (PID: $SERVER_PID)"

# ── Apri browser ──
info "Apertura browser..."
if command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:$PORT" 2>/dev/null &
elif command -v gnome-open &>/dev/null; then
  gnome-open "http://localhost:$PORT" 2>/dev/null &
elif command -v wslview &>/dev/null; then
  wslview "http://localhost:$PORT" 2>/dev/null &
else
  warn "Impossibile aprire il browser automaticamente."
  echo -e "  Apri manualmente: ${BOLD}http://localhost:$PORT${NC}"
fi

echo ""
echo -e "${GREEN}${BOLD}Job Hunter Team e' attivo!${NC}"
echo -e "  URL:  ${BOLD}http://localhost:$PORT${NC}"
echo -e "  Log:  $LOG_FILE"
echo -e "  Stop: ${BOLD}kill $SERVER_PID${NC} oppure ${BOLD}Ctrl+C${NC}"
echo ""

# ── Trap per cleanup ──
cleanup() {
  echo ""
  info "Arresto server..."
  kill "$SERVER_PID" 2>/dev/null || true
  ok "Server arrestato. Alla prossima!"
}
trap cleanup EXIT INT TERM

# ── Mantieni il processo in foreground ──
wait "$SERVER_PID" 2>/dev/null
