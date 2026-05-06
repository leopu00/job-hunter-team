#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  Job Hunter Team — Installer (Docker-by-default)                         ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  Uso:                                                                    ║
# ║    curl -fsSL https://jobhunterteam.ai/install.sh | bash                 ║
# ║                                                                          ║
# ║    # Installazione "expert mode" senza container:                        ║
# ║    curl -fsSL https://jobhunterteam.ai/install.sh | bash -s -- --no-docker ║
# ║                                                                          ║
# ║  Default (Docker-mode): non installa nulla sull'host se non Docker.      ║
# ║  Scarica:                                                                ║
# ║    - $HOME/.jht/runtime/docker-compose.yml                               ║
# ║    - $HOME/.local/bin/jht         (wrapper bash, ~165 righe)             ║
# ║  Il CLI Node, Python, tmux, agents girano TUTTI nel container long-      ║
# ║  running gestito dal compose. Niente Node/Python/tmux sull'host.         ║
# ║  Niente socket Docker dentro al container.                               ║
# ║                                                                          ║
# ║  Solo due cartelle host vengono esposte al container: ~/.jht e           ║
# ║  ~/Documents/Job Hunter Team. Il resto del filesystem e' invisibile.     ║
# ║                                                                          ║
# ║  Opzioni (env var / flag):                                               ║
# ║    --no-docker             Salta il container, installa nativo (expert)  ║
# ║    --dry-run               Mostra solo le azioni che verrebbero eseguite ║
# ║    JHT_BRANCH=dev-1        Branch sorgente per wrapper+compose           ║
# ║                            (default: master)                             ║
# ║    JHT_INSTALL_DIR         Dove clonare la repo (default: $HOME/.jht/src,║
# ║                            usato solo da --no-docker)                    ║
# ║    JHT_RUNTIME_DIR         Dove scaricare docker-compose.yml             ║
# ║                            (default: $HOME/.jht/runtime)                 ║
# ║    JHT_BIN_DIR             Dove mettere il wrapper jht (default:         ║
# ║                            $HOME/.local/bin)                             ║
# ║    JHT_IMAGE               Override immagine container (default:         ║
# ║                            ghcr.io/leopu00/jht:latest)                   ║
# ║    JHT_RAW_BASE            Override base URL per i download              ║
# ║                            (default: https://raw.githubusercontent.com/  ║
# ║                                      leopu00/job-hunter-team/<BRANCH>)   ║
# ║    JHT_SKIP_ONBOARD=1      Non lanciare il wizard alla fine              ║
# ║                                                                          ║
# ║  Riferimento design:                                                     ║
# ║    docs/internal/2026-05-06-host-container-split.md                      ║
# ║                                                                          ║
# ║  Supporta: macOS (via Colima), Linux (Debian/Ubuntu/Fedora/Arch), WSL2.  ║
# ╚══════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────
REPO_URL="${JHT_REPO_URL:-https://github.com/leopu00/job-hunter-team.git}"
BRANCH="${JHT_BRANCH:-master}"
INSTALL_DIR="${JHT_INSTALL_DIR:-$HOME/.jht/src}"
BIN_DIR="${JHT_BIN_DIR:-$HOME/.local/bin}"
RUNTIME_DIR="${JHT_RUNTIME_DIR:-$HOME/.jht/runtime}"
IMAGE="${JHT_IMAGE:-ghcr.io/leopu00/jht:latest}"
RAW_BASE="${JHT_RAW_BASE:-https://raw.githubusercontent.com/leopu00/job-hunter-team/$BRANCH}"
MIN_NODE_MAJOR=22

# ── Argomenti ─────────────────────────────────────────────────────────────
USE_DOCKER=1
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --no-docker) USE_DOCKER=0 ;;
    --with-docker) USE_DOCKER=1 ;;  # alias retro-compat
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf "Argomento non riconosciuto: %s\n" "$arg" >&2
      exit 2
      ;;
  esac
done

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

# Wrap comandi con side-effect sul sistema. In dry-run stampa invece di eseguire.
run() {
  if [ "${DRY_RUN:-0}" = "1" ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: %s\n" "$*"
    return 0
  fi
  "$@"
}

header() {
  printf "\n"
  printf "${BOLD}╔══════════════════════════════════════════╗${RESET}\n"
  printf "${BOLD}║     Job Hunter Team — Installer          ║${RESET}\n"
  printf "${BOLD}╚══════════════════════════════════════════╝${RESET}\n"
  printf "\n"
  if [ "$USE_DOCKER" -eq 1 ]; then
    printf "  ${DIM}mode:   ${RESET}${BOLD}Docker (isolato)${RESET}\n"
    printf "  ${DIM}image:  %s${RESET}\n" "$IMAGE"
    printf "  ${DIM}branch: %s${RESET}\n" "$BRANCH"
    printf "  ${DIM}runtime:%s${RESET}\n" "$RUNTIME_DIR"
  else
    printf "  ${DIM}mode:   ${RESET}${YELLOW}nativo (expert mode, --no-docker)${RESET}\n"
    printf "  ${DIM}repo:   %s${RESET}\n" "$REPO_URL"
    printf "  ${DIM}branch: %s${RESET}\n" "$BRANCH"
    printf "  ${DIM}target: %s${RESET}\n" "$INSTALL_DIR"
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}dry-run:${RESET} ${YELLOW}ON${RESET} (nessuna modifica al sistema)\n"
  fi
  printf "\n"
}

# Step counts diversi a seconda del path
TOTAL_STEPS_DOCKER=4
TOTAL_STEPS_NATIVE=7

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

detect_system() {
  local total="$1"
  step 1 "$total" "Rilevamento sistema"
  detect_os
  case "$OS" in
    macos) ok "macOS" ;;
    linux) detect_pkg_mgr; ok "Linux ($PKG)" ;;
    wsl)   detect_pkg_mgr; ok "WSL ($PKG)" ;;
  esac
}

# ╔══════════════════════════════════════════════════════════════════════════╗
# ║                          DOCKER PATH                                     ║
# ╚══════════════════════════════════════════════════════════════════════════╝

# ── Docker runtime install ────────────────────────────────────────────────
install_brew_if_missing() {
  if command -v brew &>/dev/null; then return 0; fi
  info "Homebrew non trovato. Installazione in corso..."
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash\n"
    return 0
  fi
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
    || fail "Installazione Homebrew fallita"
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

install_colima_macos() {
  install_brew_if_missing
  if ! command -v colima &>/dev/null; then
    info "Installo Colima (runtime container Apache 2.0, no Docker Desktop)..."
    run brew install colima || fail "Installazione Colima fallita"
  else
    ok "colima gia' installato"
  fi
  if ! command -v docker &>/dev/null; then
    info "Installo docker CLI..."
    run brew install docker || fail "Installazione docker CLI fallita"
  else
    ok "docker CLI gia' installato"
  fi
  # Avvia Colima se non gia' attivo
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: colima start (se non gia' attivo)\n"
    return 0
  fi
  if colima status &>/dev/null; then
    ok "colima gia' in esecuzione"
  else
    info "Avvio Colima (puo' richiedere 30-60s la prima volta)..."
    colima start || fail "colima start fallito. Riprova manualmente con 'colima start'."
    ok "colima avviato"
  fi
}

install_docker_linux() {
  case "$PKG" in
    apt)
      run sudo_maybe apt-get update -qq
      if ! command -v docker &>/dev/null; then
        info "Installo docker.io..."
        run sudo_maybe apt-get install -y docker.io || fail "Installazione docker.io fallita"
      fi
      ;;
    dnf)
      if ! command -v docker &>/dev/null; then
        info "Installo docker..."
        run sudo_maybe dnf install -y docker || fail "Installazione docker fallita"
      fi
      ;;
    pacman)
      if ! command -v docker &>/dev/null; then
        info "Installo docker..."
        run sudo_maybe pacman -Sy --noconfirm docker || fail "Installazione docker fallita"
      fi
      ;;
    *)
      command -v docker &>/dev/null || fail "Package manager sconosciuto. Installa docker manualmente o riprova con --no-docker."
      ;;
  esac
  # Su Linux/WSL2 il daemon di solito non parte da solo
  if command -v systemctl &>/dev/null; then
    run sudo_maybe systemctl enable --now docker 2>/dev/null || true
  fi
  # WSL2: il daemon e' avviato dal service docker
  if [ "$OS" = "wsl" ]; then
    run sudo_maybe service docker start 2>/dev/null || true
  fi
  # Aggiungi utente al gruppo docker per evitare sudo (richiede logout)
  if ! groups 2>/dev/null | grep -q '\bdocker\b'; then
    run sudo_maybe usermod -aG docker "$USER" 2>/dev/null || true
    warn "Sei stato aggiunto al gruppo 'docker'. Esci e rientra (o 'newgrp docker') per usarlo senza sudo."
  fi
  ok "docker installato"
}

install_container_runtime() {
  step 2 "$TOTAL_STEPS_DOCKER" "Container runtime"
  case "$OS" in
    macos) install_colima_macos ;;
    linux|wsl) install_docker_linux ;;
  esac
}

verify_docker_works() {
  step 3 "$TOTAL_STEPS_DOCKER" "Verifica docker"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: docker info\n"
    return 0
  fi
  if ! docker info &>/dev/null; then
    if [ "$OS" = "linux" ] || [ "$OS" = "wsl" ]; then
      warn "docker info fallisce: probabilmente serve sudo o un re-login per il gruppo docker."
      info "Provo con sudo per la verifica..."
      sudo docker info &>/dev/null \
        || fail "Il daemon Docker non risponde. Verifica con 'sudo systemctl status docker' (Linux) o 'colima status' (Mac)."
    else
      fail "Il daemon Docker non risponde. Verifica con 'colima status' (Mac) o 'systemctl status docker' (Linux)."
    fi
  fi
  ok "docker daemon raggiungibile"
}

download_runtime_files() {
  step 4 "$TOTAL_STEPS_DOCKER" "Download wrapper + docker-compose.yml"

  local compose_url="$RAW_BASE/docker-compose.yml"
  local wrapper_url="$RAW_BASE/scripts/jht-wrapper.sh"
  local compose_dest="$RUNTIME_DIR/docker-compose.yml"
  local wrapper_dest="$BIN_DIR/jht"

  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: mkdir -p %s %s\n" "$RUNTIME_DIR" "$BIN_DIR"
    printf "  ${DIM}[dry-run]${RESET} would download: %s -> %s\n" "$compose_url" "$compose_dest"
    printf "  ${DIM}[dry-run]${RESET} would download: %s -> %s\n" "$wrapper_url" "$wrapper_dest"
    printf "  ${DIM}[dry-run]${RESET} would execute: chmod +x %s\n" "$wrapper_dest"
    case ":$PATH:" in
      *":$BIN_DIR:"*) PATH_READY=1 ;;
      *)              PATH_READY=0 ;;
    esac
    return 0
  fi

  mkdir -p "$RUNTIME_DIR" "$BIN_DIR"

  info "Scarico docker-compose.yml..."
  if ! curl -fsSL "$compose_url" -o "$compose_dest"; then
    fail "Download fallito: $compose_url. Controlla connessione e branch ($BRANCH)."
  fi
  ok "compose: $compose_dest"

  info "Scarico wrapper jht..."
  if ! curl -fsSL "$wrapper_url" -o "$wrapper_dest"; then
    fail "Download fallito: $wrapper_url. Controlla connessione e branch ($BRANCH)."
  fi
  chmod +x "$wrapper_dest"
  ok "wrapper: $wrapper_dest"

  case ":$PATH:" in
    *":$BIN_DIR:"*)
      ok "$BIN_DIR gia' nel PATH"
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

# ╔══════════════════════════════════════════════════════════════════════════╗
# ║                          NATIVE PATH (--no-docker)                       ║
# ╚══════════════════════════════════════════════════════════════════════════╝

install_dep() {
  local name="$1"
  shift
  if command -v "$name" &>/dev/null; then
    ok "$name gia' installato"
    return 0
  fi
  info "Installo $name..."
  run "$@" || fail "Installazione $name fallita"
  ok "$name installato"
}

install_system_deps() {
  step 2 "$TOTAL_STEPS_NATIVE" "Dipendenze di sistema (git, curl, tmux)"

  case "$OS" in
    macos)
      install_brew_if_missing
      install_dep git brew install git
      install_dep tmux brew install tmux
      ;;
    linux|wsl)
      case "$PKG" in
        apt)
          run sudo_maybe apt-get update -qq
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
          run sudo_maybe pacman -Sy --noconfirm
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

check_node_version() {
  if ! command -v node &>/dev/null; then
    return 1
  fi
  local major
  major=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo "0")
  [ "$major" -ge "$MIN_NODE_MAJOR" ]
}

install_node() {
  step 3 "$TOTAL_STEPS_NATIVE" "Node.js ${MIN_NODE_MAJOR}+"

  if check_node_version; then
    ok "node $(node -v) gia' installato"
    return 0
  fi

  info "Installo Node.js ${MIN_NODE_MAJOR}..."
  case "$OS" in
    macos)
      run brew install "node@${MIN_NODE_MAJOR}"
      run brew link --overwrite --force "node@${MIN_NODE_MAJOR}" || true
      ;;
    linux|wsl)
      case "$PKG" in
        apt)
          if [ "$DRY_RUN" -eq 1 ]; then
            printf "  ${DIM}[dry-run]${RESET} would execute: curl -fsSL https://deb.nodesource.com/setup_%s.x | sudo -E bash -\n" "$MIN_NODE_MAJOR"
            printf "  ${DIM}[dry-run]${RESET} would execute: sudo apt-get install -y nodejs\n"
          else
            curl -fsSL "https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x" | sudo_maybe -E bash -
            sudo_maybe apt-get install -y nodejs
          fi
          ;;
        dnf)
          if [ "$DRY_RUN" -eq 1 ]; then
            printf "  ${DIM}[dry-run]${RESET} would execute: curl -fsSL https://rpm.nodesource.com/setup_%s.x | sudo bash -\n" "$MIN_NODE_MAJOR"
            printf "  ${DIM}[dry-run]${RESET} would execute: sudo dnf install -y nodejs\n"
          else
            curl -fsSL "https://rpm.nodesource.com/setup_${MIN_NODE_MAJOR}.x" | sudo_maybe bash -
            sudo_maybe dnf install -y nodejs
          fi
          ;;
        pacman)
          run sudo_maybe pacman -S --noconfirm nodejs npm
          ;;
        *)
          fail "Installazione Node.js automatica non supportata su questo sistema."
          ;;
      esac
      ;;
  esac

  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi
  check_node_version || fail "Node.js ${MIN_NODE_MAJOR}+ non e' disponibile dopo l'installazione"
  ok "node $(node -v) installato"
}

install_claude_cli() {
  step 4 "$TOTAL_STEPS_NATIVE" "Claude CLI"

  if command -v claude &>/dev/null; then
    ok "claude CLI gia' installato"
    return 0
  fi

  info "Installo Claude CLI via npm (globale)..."
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: npm install -g @anthropic-ai/claude-cli\n"
    return 0
  fi
  if ! npm install -g @anthropic-ai/claude-cli 2>/dev/null; then
    warn "Installazione automatica fallita. Installa manualmente da https://docs.anthropic.com/claude/docs/claude-code"
    return 0
  fi
  ok "claude CLI installato"
}

clone_repo() {
  step 5 "$TOTAL_STEPS_NATIVE" "Download JHT (git clone)"

  if [ "$DRY_RUN" -eq 1 ]; then
    if [ -d "$INSTALL_DIR/.git" ]; then
      printf "  ${DIM}[dry-run]${RESET} would execute: git -C %s fetch && git reset --hard origin/%s\n" "$INSTALL_DIR" "$BRANCH"
    else
      printf "  ${DIM}[dry-run]${RESET} would execute: mkdir -p %s\n" "$(dirname "$INSTALL_DIR")"
      printf "  ${DIM}[dry-run]${RESET} would execute: git clone --depth 1 --branch %s %s %s\n" "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    fi
    return 0
  fi

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

build_jht() {
  step 6 "$TOTAL_STEPS_NATIVE" "Build TUI, CLI e moduli shared"

  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: (cd %s/tui && npm install && npx tsc)\n" "$INSTALL_DIR"
    printf "  ${DIM}[dry-run]${RESET} would execute: (cd %s/cli && npm install)\n" "$INSTALL_DIR"
    printf "  ${DIM}[dry-run]${RESET} would execute: npm install in ogni %s/shared/*/package.json con deps\n" "$INSTALL_DIR"
    return 0
  fi

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

  info "Installo dipendenze moduli shared..."
  local shared_installed=0
  for pkg in "$INSTALL_DIR"/shared/*/package.json; do
    [ -f "$pkg" ] || continue
    local dir
    dir=$(dirname "$pkg")
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

link_bin_native() {
  step 7 "$TOTAL_STEPS_NATIVE" "Installazione comando jht (nativo)"

  local target="$INSTALL_DIR/cli/bin/jht.js"
  local link="$BIN_DIR/jht"

  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: mkdir -p %s\n" "$BIN_DIR"
    printf "  ${DIM}[dry-run]${RESET} would execute: chmod +x %s\n" "$target"
    printf "  ${DIM}[dry-run]${RESET} would execute: ln -s %s %s\n" "$target" "$link"
    case ":$PATH:" in
      *":$BIN_DIR:"*) PATH_READY=1 ;;
      *)              PATH_READY=0 ;;
    esac
    return 0
  fi

  mkdir -p "$BIN_DIR"

  if [ ! -f "$target" ]; then
    fail "Entry point non trovato: $target"
  fi

  chmod +x "$target"

  if [ -L "$link" ] || [ -e "$link" ]; then
    rm -f "$link"
  fi
  ln -s "$target" "$link"
  ok "Simlink creato: $link -> $target"

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
  if [ "$USE_DOCKER" -eq 1 ]; then
    printf "  ${BOLD}Modalita' container attiva.${RESET}\n"
    printf "  ${DIM}Gli agenti vedono solo:${RESET}\n"
    printf "  ${DIM}  ~/.jht/                       → /jht_home (config, db, agenti)${RESET}\n"
    printf "  ${DIM}  ~/Documents/Job Hunter Team/  → /jht_user (CV, allegati, output)${RESET}\n"
    printf "\n"
  else
    printf "  ${YELLOW}${BOLD}⚠  Modalita' nativa (--no-docker).${RESET}\n"
    printf "  ${DIM}Gli agenti AI hanno accesso al tuo filesystem. Usa solo se sai${RESET}\n"
    printf "  ${DIM}cosa stai facendo o se hai dedicato un PC/VM solo a JHT.${RESET}\n"
    printf "\n"
    printf "  ${DIM}Layout file:${RESET}\n"
    printf "  ${DIM}  ~/.jht/                       → config, db, agenti (non toccare)${RESET}\n"
    printf "  ${DIM}  ~/Documents/Job Hunter Team/  → CV, allegati, output${RESET}\n"
    printf "\n"
  fi
  printf "  ${BOLD}Prossimi passi:${RESET}\n"
  printf "\n"
  if [ "${PATH_READY:-0}" -eq 1 ]; then
    if [ "$USE_DOCKER" -eq 1 ]; then
      printf "      ${BOLD}jht up${RESET}           ${DIM}# avvia il container (pull immagine al primo run)${RESET}\n"
      printf "      ${BOLD}jht setup${RESET}        ${DIM}# wizard di configurazione${RESET}\n"
    else
      printf "      ${BOLD}jht setup${RESET}        ${DIM}# configurazione iniziale${RESET}\n"
      printf "      ${BOLD}jht dashboard${RESET}    ${DIM}# avvia la dashboard web${RESET}\n"
    fi
  else
    if [ "$USE_DOCKER" -eq 1 ]; then
      printf "      ${BOLD}%s/jht up${RESET}\n" "$BIN_DIR"
      printf "      ${BOLD}%s/jht setup${RESET}\n" "$BIN_DIR"
    else
      printf "      ${BOLD}%s/jht setup${RESET}\n" "$BIN_DIR"
      printf "      ${BOLD}%s/jht dashboard${RESET}\n" "$BIN_DIR"
    fi
  fi
  printf "\n"
  printf "  ${DIM}Per disinstallare:${RESET}\n"
  if [ "$USE_DOCKER" -eq 1 ]; then
    printf "  ${DIM}  jht down && rm -rf %s %s/jht && docker rmi %s${RESET}\n" "$RUNTIME_DIR" "$BIN_DIR" "$IMAGE"
  else
    printf "  ${DIM}  rm -rf %s %s/jht${RESET}\n" "$INSTALL_DIR" "$BIN_DIR"
  fi
  printf "\n"
}

maybe_onboard() {
  if [ "$DRY_RUN" -eq 1 ]; then
    info "dry-run: salto il wizard di onboarding."
    return 0
  fi
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
    n|N|no|NO) info "Wizard saltato. Esegui 'jht setup' quando sei pronto." ;;
    *)
      export PATH="$BIN_DIR:$PATH"
      jht setup || warn "Il wizard e' uscito con errore. Rilancialo con 'jht setup'."
      ;;
  esac
}

# ── Main ──────────────────────────────────────────────────────────────────
main_docker() {
  detect_system "$TOTAL_STEPS_DOCKER"
  install_container_runtime
  verify_docker_works
  download_runtime_files
}

main_native() {
  detect_system "$TOTAL_STEPS_NATIVE"
  install_system_deps
  install_node
  install_claude_cli
  clone_repo
  build_jht
  link_bin_native
}

main() {
  header
  if [ "$USE_DOCKER" -eq 1 ]; then
    main_docker
  else
    main_native
  fi
  final_message
  maybe_onboard
}

main
