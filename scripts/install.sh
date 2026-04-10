#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  Job Hunter Team — Installer                                             ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  Uso:                                                                    ║
# ║    curl -fsSL https://raw.githubusercontent.com/leopu00/job-hunter-team/ ║
# ║              main/scripts/install.sh | bash                              ║
# ║                                                                          ║
# ║  Opzioni (env var):                                                      ║
# ║    JHT_BRANCH=dev-4    Branch da clonare (default: main)                 ║
# ║    JHT_INSTALL_DIR     Dove clonare la repo (default: $HOME/.jht/src)    ║
# ║    JHT_BIN_DIR         Dove mettere il simlink jht (default:             ║
# ║                        $HOME/.local/bin)                                 ║
# ║    JHT_SKIP_ONBOARD=1  Non lanciare il wizard alla fine                  ║
# ║                                                                          ║
# ║  Supporta: macOS, Linux (Debian/Ubuntu/Fedora/Arch), WSL.                ║
# ╚══════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────
REPO_URL="${JHT_REPO_URL:-https://github.com/leopu00/job-hunter-team.git}"
BRANCH="${JHT_BRANCH:-main}"
INSTALL_DIR="${JHT_INSTALL_DIR:-$HOME/.jht/src}"
BIN_DIR="${JHT_BIN_DIR:-$HOME/.local/bin}"
MIN_NODE_MAJOR=20

# ── Colori ────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  BOLD='\033[1m'
  DIM='\033[2m'
  RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' BOLD='' DIM='' RESET=''
fi

ok()    { printf "  ${GREEN}✓${RESET} %s\n" "$*"; }
warn()  { printf "  ${YELLOW}⚠${RESET}  %s\n" "$*"; }
info()  { printf "  ${BLUE}▸${RESET} %s\n" "$*"; }
fail()  { printf "  ${RED}✗${RESET} %s\n" "$*" >&2; exit 1; }
step()  { printf "\n${BOLD}[%s/%s] %s${RESET}\n" "$1" "$2" "$3"; }

header() {
  printf "\n"
  printf "${BOLD}╔══════════════════════════════════════════╗${RESET}\n"
  printf "${BOLD}║     Job Hunter Team — Installer          ║${RESET}\n"
  printf "${BOLD}╚══════════════════════════════════════════╝${RESET}\n"
  printf "\n"
  printf "  ${DIM}repo:   %s${RESET}\n" "$REPO_URL"
  printf "  ${DIM}branch: %s${RESET}\n" "$BRANCH"
  printf "  ${DIM}target: %s${RESET}\n" "$INSTALL_DIR"
  printf "\n"
}

TOTAL_STEPS=7

# ── OS Detection ──────────────────────────────────────────────────────────
detect_os() {
  local uname_s
  uname_s=$(uname -s)
  case "$uname_s" in
    Darwin)  OS="macos" ;;
    Linux)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        OS="wsl"
      else
        OS="linux"
      fi
      ;;
    *) fail "Sistema operativo non supportato: $uname_s" ;;
  esac
}

# ── Package manager detection (Linux) ─────────────────────────────────────
detect_pkg_mgr() {
  if command -v apt-get &>/dev/null; then PKG="apt"
  elif command -v dnf &>/dev/null; then PKG="dnf"
  elif command -v pacman &>/dev/null; then PKG="pacman"
  else PKG=""
  fi
}

sudo_maybe() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

# ── 1. Detect OS ──────────────────────────────────────────────────────────
detect_system() {
  step 1 "$TOTAL_STEPS" "Rilevamento sistema"
  detect_os
  case "$OS" in
    macos) ok "macOS" ;;
    linux) detect_pkg_mgr; ok "Linux ($PKG)" ;;
    wsl)   detect_pkg_mgr; ok "WSL ($PKG)" ;;
  esac
}

# ── 2. Dipendenze di sistema ──────────────────────────────────────────────
install_dep() {
  local name="$1"
  shift
  if command -v "$name" &>/dev/null; then
    ok "$name gia' installato"
    return 0
  fi
  info "Installo $name..."
  "$@" || fail "Installazione $name fallita"
  ok "$name installato"
}

install_system_deps() {
  step 2 "$TOTAL_STEPS" "Dipendenze di sistema (git, curl, tmux)"

  case "$OS" in
    macos)
      if ! command -v brew &>/dev/null; then
        info "Homebrew non trovato. Installazione in corso..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
          || fail "Installazione Homebrew fallita"
        # Aggiungi brew al PATH della sessione corrente
        if [ -x /opt/homebrew/bin/brew ]; then
          eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [ -x /usr/local/bin/brew ]; then
          eval "$(/usr/local/bin/brew shellenv)"
        fi
      fi
      install_dep git brew install git
      install_dep tmux brew install tmux
      ;;
    linux|wsl)
      case "$PKG" in
        apt)
          sudo_maybe apt-get update -qq
          install_dep git sudo_maybe apt-get install -y git
          install_dep tmux sudo_maybe apt-get install -y tmux
          install_dep curl sudo_maybe apt-get install -y curl
          ;;
        dnf)
          install_dep git sudo_maybe dnf install -y git
          install_dep tmux sudo_maybe dnf install -y tmux
          install_dep curl sudo_maybe dnf install -y curl
          ;;
        pacman)
          sudo_maybe pacman -Sy --noconfirm
          install_dep git sudo_maybe pacman -S --noconfirm git
          install_dep tmux sudo_maybe pacman -S --noconfirm tmux
          install_dep curl sudo_maybe pacman -S --noconfirm curl
          ;;
        *)
          command -v git &>/dev/null || fail "git non trovato e package manager sconosciuto. Installa git manualmente."
          command -v tmux &>/dev/null || fail "tmux non trovato. Installa tmux manualmente."
          ;;
      esac
      ;;
  esac
}

# ── 3. Node.js 20+ ────────────────────────────────────────────────────────
check_node_version() {
  if ! command -v node &>/dev/null; then
    return 1
  fi
  local major
  major=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "0")
  [ "$major" -ge "$MIN_NODE_MAJOR" ]
}

install_node() {
  step 3 "$TOTAL_STEPS" "Node.js ${MIN_NODE_MAJOR}+"

  if check_node_version; then
    ok "node $(node -v) gia' installato"
    return 0
  fi

  info "Installo Node.js ${MIN_NODE_MAJOR}..."
  case "$OS" in
    macos)
      brew install "node@${MIN_NODE_MAJOR}"
      brew link --overwrite --force "node@${MIN_NODE_MAJOR}" || true
      ;;
    linux|wsl)
      case "$PKG" in
        apt)
          curl -fsSL "https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x" | sudo_maybe -E bash -
          sudo_maybe apt-get install -y nodejs
          ;;
        dnf)
          curl -fsSL "https://rpm.nodesource.com/setup_${MIN_NODE_MAJOR}.x" | sudo_maybe bash -
          sudo_maybe dnf install -y nodejs
          ;;
        pacman)
          sudo_maybe pacman -S --noconfirm nodejs npm
          ;;
        *)
          fail "Installazione Node.js automatica non supportata su questo sistema. Installa Node.js ${MIN_NODE_MAJOR}+ manualmente e rilancia."
          ;;
      esac
      ;;
  esac

  check_node_version || fail "Node.js ${MIN_NODE_MAJOR}+ non e' disponibile dopo l'installazione"
  ok "node $(node -v) installato"
}

# ── 4. Claude CLI (Anthropic) ─────────────────────────────────────────────
install_claude_cli() {
  step 4 "$TOTAL_STEPS" "Claude CLI"

  if command -v claude &>/dev/null; then
    ok "claude CLI gia' installato"
    return 0
  fi

  info "Installo Claude CLI via npm (globale)..."
  if ! npm install -g @anthropic-ai/claude-cli 2>/dev/null; then
    warn "Installazione automatica fallita. Installa manualmente da https://docs.anthropic.com/claude/docs/claude-code"
    warn "JHT funzionera' solo dopo aver installato claude CLI e configurato la API key."
    return 0
  fi
  ok "claude CLI installato"
}

# ── 5. Clone repo ─────────────────────────────────────────────────────────
clone_repo() {
  step 5 "$TOTAL_STEPS" "Download JHT (git clone)"

  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Repo gia' presente in $INSTALL_DIR, aggiorno..."
    (cd "$INSTALL_DIR" && git fetch --quiet --depth 1 origin "$BRANCH" && git checkout --quiet "$BRANCH" && git reset --hard --quiet "origin/$BRANCH") \
      || fail "Impossibile aggiornare la repo"
    ok "Repo aggiornata a $BRANCH"
  else
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" \
      || fail "Clone fallito. Controlla la connessione e i permessi su $INSTALL_DIR"
    ok "Repo clonata in $INSTALL_DIR"
  fi
}

# ── 6. Build TUI + CLI + shared deps ──────────────────────────────────────
build_jht() {
  step 6 "$TOTAL_STEPS" "Build TUI, CLI e moduli shared"

  info "Installo dipendenze TUI..."
  (cd "$INSTALL_DIR/tui" && npm install --silent --no-audit --no-fund) \
    || fail "npm install TUI fallito"

  info "Compilo TUI (TypeScript)..."
  (cd "$INSTALL_DIR/tui" && npx --yes tsc) \
    || fail "Build TUI fallito"
  ok "TUI compilata in $INSTALL_DIR/tui/dist"

  info "Installo dipendenze CLI..."
  (cd "$INSTALL_DIR/cli" && npm install --silent --no-audit --no-fund) \
    || fail "npm install CLI fallito"
  ok "CLI pronta"

  # I moduli shared/* con package.json che dichiarano dependencies devono
  # avere le deps installate: il CLI importa molti shared/* a top level
  # (es. shared/cron/index.js → croner) e crasherebbe all'avvio.
  info "Installo dipendenze moduli shared..."
  local shared_installed=0
  for pkg in "$INSTALL_DIR"/shared/*/package.json; do
    [ -f "$pkg" ] || continue
    local dir
    dir=$(dirname "$pkg")
    # Skip se non ci sono dependencies
    local has_deps
    has_deps=$(node -p "Object.keys(JSON.parse(require('fs').readFileSync('$pkg','utf8')).dependencies||{}).length > 0")
    if [ "$has_deps" = "true" ]; then
      (cd "$dir" && npm install --silent --no-audit --no-fund) \
        || fail "npm install $(basename "$dir") fallito"
      shared_installed=$((shared_installed + 1))
    fi
  done
  ok "$shared_installed moduli shared pronti"
}

# ── 7. Simlink e PATH ─────────────────────────────────────────────────────
link_bin() {
  step 7 "$TOTAL_STEPS" "Installazione comando jht"

  mkdir -p "$BIN_DIR"
  local target="$INSTALL_DIR/cli/bin/jht.js"

  if [ ! -f "$target" ]; then
    fail "Entry point non trovato: $target"
  fi

  chmod +x "$target"

  # Simlink
  local link="$BIN_DIR/jht"
  if [ -L "$link" ] || [ -e "$link" ]; then
    rm -f "$link"
  fi
  ln -s "$target" "$link"
  ok "Simlink creato: $link -> $target"

  # PATH check
  case ":$PATH:" in
    *":$BIN_DIR:"*)
      ok "$BIN_DIR e' gia' nel PATH"
      PATH_READY=1
      ;;
    *)
      warn "$BIN_DIR non e' nel PATH."
      info "Aggiungi questa riga al tuo shell rc (~/.zshrc, ~/.bashrc):"
      printf "\n      ${BOLD}export PATH=\"\$PATH:%s\"${RESET}\n\n" "$BIN_DIR"
      PATH_READY=0
      ;;
  esac
}

# ── Finale ────────────────────────────────────────────────────────────────
final_message() {
  printf "\n"
  printf "${GREEN}${BOLD}══════════════════════════════════════════${RESET}\n"
  printf "${GREEN}${BOLD}  Installazione completata!${RESET}\n"
  printf "${GREEN}${BOLD}══════════════════════════════════════════${RESET}\n"
  printf "\n"
  printf "  ${BOLD}Prossimo passo:${RESET} avvia JHT con il setup wizard\n"
  printf "\n"
  if [ "${PATH_READY:-0}" -eq 1 ]; then
    printf "      ${BOLD}jht${RESET}\n"
  else
    printf "      ${BOLD}%s/jht${RESET}\n" "$BIN_DIR"
  fi
  printf "\n"
  printf "  ${DIM}Struttura creata dopo il primo avvio:${RESET}\n"
  printf "  ${DIM}  ~/.jht/                       → config, db, agenti (non toccare)${RESET}\n"
  printf "  ${DIM}  ~/Documents/Job Hunter Team/  → CV, allegati, output${RESET}\n"
  printf "\n"
  printf "  ${DIM}Per disinstallare:${RESET}\n"
  printf "  ${DIM}  rm -rf %s %s/jht${RESET}\n" "$INSTALL_DIR" "$BIN_DIR"
  printf "\n"
}

# ── Onboarding automatico ─────────────────────────────────────────────────
maybe_onboard() {
  if [ "${JHT_SKIP_ONBOARD:-0}" = "1" ]; then
    return 0
  fi
  if [ ! -t 0 ] || [ ! -t 1 ]; then
    info "Stdin/stdout non e' un terminale interattivo: salto il wizard."
    info "Esegui manualmente: jht"
    return 0
  fi
  printf "\n${BOLD}Vuoi avviare il setup wizard adesso? [Y/n]${RESET} "
  read -r answer || answer=""
  case "$answer" in
    n|N|no|NO) info "Wizard saltato. Esegui 'jht' quando sei pronto." ;;
    *)
      export PATH="$BIN_DIR:$PATH"
      jht || warn "Il wizard e' uscito con errore. Rilancialo con 'jht'."
      ;;
  esac
}

# ── Main ──────────────────────────────────────────────────────────────────
main() {
  header
  detect_system
  install_system_deps
  install_node
  install_claude_cli
  clone_repo
  build_jht
  link_bin
  final_message
  maybe_onboard
}

main "$@"
