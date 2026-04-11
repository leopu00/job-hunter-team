#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  Job Hunter Team — Installer (Docker-by-default)                         ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  Uso:                                                                    ║
# ║    curl -fsSL https://raw.githubusercontent.com/leopu00/job-hunter-team/ ║
# ║              main/scripts/install.sh | bash                              ║
# ║                                                                          ║
# ║    # Installazione "expert mode" senza container:                        ║
# ║    curl -fsSL .../install.sh | bash -s -- --no-docker                    ║
# ║                                                                          ║
# ║  Default: gli agenti AI girano dentro un container Docker isolato.       ║
# ║  Solo due cartelle host vengono esposte: ~/.jht e                        ║
# ║  ~/Documents/Job Hunter Team. Il resto del filesystem e' invisibile.     ║
# ║                                                                          ║
# ║  Opzioni (env var / flag):                                               ║
# ║    --no-docker             Salta il container, installa nativo (expert)  ║
# ║    JHT_BRANCH=dev-3        Branch da clonare (default: main)             ║
# ║    JHT_INSTALL_DIR         Dove clonare la repo (default: $HOME/.jht/src)║
# ║    JHT_BIN_DIR             Dove mettere il wrapper jht (default:         ║
# ║                            $HOME/.local/bin)                             ║
# ║    JHT_IMAGE               Override immagine container (default:         ║
# ║                            ghcr.io/leopu00/jht:latest)                   ║
# ║    JHT_SKIP_ONBOARD=1      Non lanciare il wizard alla fine              ║
# ║                                                                          ║
# ║  Supporta: macOS (via Colima), Linux (Debian/Ubuntu/Fedora/Arch), WSL2.  ║
# ╚══════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────
REPO_URL="${JHT_REPO_URL:-https://github.com/leopu00/job-hunter-team.git}"
BRANCH="${JHT_BRANCH:-main}"
INSTALL_DIR="${JHT_INSTALL_DIR:-$HOME/.jht/src}"
BIN_DIR="${JHT_BIN_DIR:-$HOME/.local/bin}"
IMAGE="${JHT_IMAGE:-ghcr.io/leopu00/jht:latest}"
MIN_NODE_MAJOR=20

# ── Argomenti ─────────────────────────────────────────────────────────────
USE_DOCKER=1
for arg in "$@"; do
  case "$arg" in
    --no-docker) USE_DOCKER=0 ;;
    --with-docker) USE_DOCKER=1 ;;  # alias retro-compat
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

header() {
  printf "\n"
  printf "${BOLD}╔══════════════════════════════════════════╗${RESET}\n"
  printf "${BOLD}║     Job Hunter Team — Installer          ║${RESET}\n"
  printf "${BOLD}╚══════════════════════════════════════════╝${RESET}\n"
  printf "\n"
  if [ "$USE_DOCKER" -eq 1 ]; then
    printf "  ${DIM}mode:   ${RESET}${BOLD}Docker (isolato)${RESET}\n"
    printf "  ${DIM}image:  %s${RESET}\n" "$IMAGE"
  else
    printf "  ${DIM}mode:   ${RESET}${YELLOW}nativo (expert mode, --no-docker)${RESET}\n"
    printf "  ${DIM}repo:   %s${RESET}\n" "$REPO_URL"
    printf "  ${DIM}branch: %s${RESET}\n" "$BRANCH"
    printf "  ${DIM}target: %s${RESET}\n" "$INSTALL_DIR"
  fi
  printf "\n"
}

# Step counts diversi a seconda del path
TOTAL_STEPS_DOCKER=5
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
    brew install colima || fail "Installazione Colima fallita"
  else
    ok "colima gia' installato"
  fi
  if ! command -v docker &>/dev/null; then
    info "Installo docker CLI..."
    brew install docker || fail "Installazione docker CLI fallita"
  else
    ok "docker CLI gia' installato"
  fi
  # Avvia Colima se non gia' attivo
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
      sudo_maybe apt-get update -qq
      if ! command -v docker &>/dev/null; then
        info "Installo docker.io..."
        sudo_maybe apt-get install -y docker.io || fail "Installazione docker.io fallita"
      fi
      ;;
    dnf)
      if ! command -v docker &>/dev/null; then
        info "Installo docker..."
        sudo_maybe dnf install -y docker || fail "Installazione docker fallita"
      fi
      ;;
    pacman)
      if ! command -v docker &>/dev/null; then
        info "Installo docker..."
        sudo_maybe pacman -Sy --noconfirm docker || fail "Installazione docker fallita"
      fi
      ;;
    *)
      command -v docker &>/dev/null || fail "Package manager sconosciuto. Installa docker manualmente o riprova con --no-docker."
      ;;
  esac
  # Su Linux/WSL2 il daemon di solito non parte da solo
  if command -v systemctl &>/dev/null; then
    sudo_maybe systemctl enable --now docker 2>/dev/null || true
  fi
  # WSL2: il daemon e' avviato dal service docker
  if [ "$OS" = "wsl" ]; then
    sudo_maybe service docker start 2>/dev/null || true
  fi
  # Aggiungi utente al gruppo docker per evitare sudo (richiede logout)
  if ! groups 2>/dev/null | grep -q '\bdocker\b'; then
    sudo_maybe usermod -aG docker "$USER" 2>/dev/null || true
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

pull_image() {
  step 4 "$TOTAL_STEPS_DOCKER" "Download immagine $IMAGE"
  if docker pull "$IMAGE"; then
    ok "immagine pronta"
  else
    warn "Pull fallito. L'immagine non e' ancora pubblicata o c'e' un problema di rete."
    warn "Il wrapper viene comunque installato: ri-esegui l'installer quando l'immagine sara' disponibile."
  fi
}

write_wrapper() {
  step 5 "$TOTAL_STEPS_DOCKER" "Wrapper jht (docker run)"
  mkdir -p "$BIN_DIR"
  local wrapper="$BIN_DIR/jht"
  if [ -L "$wrapper" ] || [ -e "$wrapper" ]; then
    rm -f "$wrapper"
  fi

  cat > "$wrapper" <<WRAPPER
#!/usr/bin/env bash
# Job Hunter Team — wrapper container.
# Generato da scripts/install.sh. Modifiche manuali verranno sovrascritte.
#
# Niente array bash, niente 'set -u': macOS imbarca bash 3.2 dove
# l'espansione di array vuoti rompe set -u, e questo script e' troppo
# semplice perche' valga la pena gestire le edge case.
set -eo pipefail

IMAGE="\${JHT_IMAGE:-$IMAGE}"
JHT_HOME_HOST="\${JHT_HOME_HOST:-\$HOME/.jht}"
JHT_USER_DIR_HOST="\${JHT_USER_DIR_HOST:-\$HOME/Documents/Job Hunter Team}"

mkdir -p "\$JHT_HOME_HOST" "\$JHT_USER_DIR_HOST"

# macOS: assicura che Colima sia attivo prima di lanciare docker
if [ "\$(uname -s)" = "Darwin" ] && command -v colima >/dev/null 2>&1; then
  if ! colima status >/dev/null 2>&1; then
    echo "[jht] Avvio Colima..." >&2
    colima start >/dev/null 2>&1 || {
      echo "[jht] Impossibile avviare Colima. Esegui 'colima start' manualmente." >&2
      exit 1
    }
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[jht] docker non trovato nel PATH. Reinstalla con scripts/install.sh." >&2
  exit 1
fi

# Funzioni di supporto: emettono frammenti di flag come stringhe.
tty_flag() {
  if [ -t 0 ] && [ -t 1 ]; then
    printf -- '-it'
  fi
}

env_flags() {
  for var in ANTHROPIC_API_KEY OPENAI_API_KEY MOONSHOT_API_KEY \\
             CLAUDE_CODE_OAUTH_TOKEN GEMINI_API_KEY GOOGLE_API_KEY; do
    eval "value=\\\${\$var:-}"
    if [ -n "\$value" ]; then
      printf -- '-e %s ' "\$var"
    fi
  done
}

# I \$(...) non quotati si espandono via word splitting in argomenti
# separati: nessun array bash, nessun problema con bash 3.2.
exec docker run --rm \\
  \$(tty_flag) \\
  -v "\$JHT_HOME_HOST:/jht_home" \\
  -v "\$JHT_USER_DIR_HOST:/jht_user" \\
  -e JHT_HOME=/jht_home \\
  -e JHT_USER_DIR=/jht_user \\
  -e IS_CONTAINER=1 \\
  \$(env_flags) \\
  -p 3000:3000 \\
  "\$IMAGE" "\$@"
WRAPPER

  chmod +x "$wrapper"
  ok "wrapper creato: $wrapper"

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
  "$@" || fail "Installazione $name fallita"
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
          fail "Installazione Node.js automatica non supportata su questo sistema."
          ;;
      esac
      ;;
  esac

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
  if ! npm install -g @anthropic-ai/claude-cli 2>/dev/null; then
    warn "Installazione automatica fallita. Installa manualmente da https://docs.anthropic.com/claude/docs/claude-code"
    return 0
  fi
  ok "claude CLI installato"
}

clone_repo() {
  step 5 "$TOTAL_STEPS_NATIVE" "Download JHT (git clone)"

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

  mkdir -p "$BIN_DIR"
  local target="$INSTALL_DIR/cli/bin/jht.js"

  if [ ! -f "$target" ]; then
    fail "Entry point non trovato: $target"
  fi

  chmod +x "$target"

  local link="$BIN_DIR/jht"
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
  printf "  ${BOLD}Prossimo passo:${RESET} avvia il wizard di setup\n"
  printf "\n"
  if [ "${PATH_READY:-0}" -eq 1 ]; then
    printf "      ${BOLD}jht setup${RESET}        ${DIM}# configurazione iniziale${RESET}\n"
    printf "      ${BOLD}jht dashboard${RESET}    ${DIM}# avvia la dashboard web${RESET}\n"
  else
    printf "      ${BOLD}%s/jht setup${RESET}\n" "$BIN_DIR"
    printf "      ${BOLD}%s/jht dashboard${RESET}\n" "$BIN_DIR"
  fi
  printf "\n"
  printf "  ${DIM}Per disinstallare:${RESET}\n"
  if [ "$USE_DOCKER" -eq 1 ]; then
    printf "  ${DIM}  rm -f %s/jht && docker rmi %s${RESET}\n" "$BIN_DIR" "$IMAGE"
  else
    printf "  ${DIM}  rm -rf %s %s/jht${RESET}\n" "$INSTALL_DIR" "$BIN_DIR"
  fi
  printf "\n"
}

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
  pull_image
  write_wrapper
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
