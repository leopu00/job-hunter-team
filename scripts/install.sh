#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  Job Hunter Team — Installer (Docker-by-default)                         ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  Usage:                                                                  ║
# ║    curl -fsSL https://jobhunterteam.ai/install.sh | bash                 ║
# ║                                                                          ║
# ║    # "Expert mode" install without a container:                          ║
# ║    curl -fsSL https://jobhunterteam.ai/install.sh | bash -s -- --no-docker ║
# ║                                                                          ║
# ║  Default (Docker mode): installs nothing on the host except Docker.      ║
# ║  Downloads:                                                              ║
# ║    - host runtime outside $HOME/.jht (compose + preflight)               ║
# ║    - $HOME/.local/bin/jht         (bash wrapper, ~165 lines)             ║
# ║  The Node CLI, Python, tmux and the agents ALL run inside the long-      ║
# ║  running container managed by compose. No Node/Python/tmux on the host.  ║
# ║  No Docker socket inside the container.                                  ║
# ║                                                                          ║
# ║  Only two host folders are exposed to the container: ~/.jht and          ║
# ║  ~/Documents/Job Hunter Team. The rest of the filesystem is invisible.   ║
# ║                                                                          ║
# ║  Options (env vars / flags):                                             ║
# ║    --no-docker             Skip the container, install natively (expert) ║
# ║    --runtime <r>           macOS: container runtime — colima (default,   ║
# ║                            headless) or docker-desktop (your Docker).    ║
# ║                            If a Docker is already running it is reused   ║
# ║                            (detect-first). Ignored on Linux. ADR-0006.   ║
# ║    --dry-run               Only show the actions that would be executed  ║
# ║    --branch <name>         Source branch for wrapper+compose             ║
# ║                            (same as JHT_BRANCH=<name>, default           ║
# ║                            production). Example to test dev-1:           ║
# ║      curl ...install.sh | bash -s -- --branch dev-1                      ║
# ║    JHT_BRANCH=dev-1        Source branch (env var, alternative to        ║
# ║                            --branch). default: production                ║
# ║    JHT_INSTALL_DIR         Where to clone the repo (default: $HOME/.jht/src,║
# ║                            only used by --no-docker)                     ║
# ║    JHT_RUNTIME_DIR         Where to download docker-compose.yml          ║
# ║                            (default: XDG/App Support host-runtime)        ║
# ║    JHT_BIN_DIR             Where to put the jht wrapper (default:        ║
# ║                            $HOME/.local/bin)                             ║
# ║    JHT_IMAGE               Container image override (default:            ║
# ║                            ghcr.io/leopu00/jht:0.3.5)                    ║
# ║    JHT_RAW_BASE            Base URL override for downloads               ║
# ║                            (default: https://raw.githubusercontent.com/  ║
# ║                                      leopu00/job-hunter-team/<BRANCH>)   ║
# ║    JHT_SKIP_ONBOARD=1      Do not launch the wizard at the end           ║
# ║                                                                          ║
# ║  Design reference:                                                       ║
# ║    docs/internal/ops/vps.md                      ║
# ║                                                                          ║
# ║  Supports: macOS (Colima or Docker Desktop), Linux (Debian/Ubuntu/Fedora/ ║
# ║  Arch), WSL2.                                                             ║
# ╚══════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────
REPO_URL="${JHT_REPO_URL:-https://github.com/leopu00/job-hunter-team.git}"
BRANCH="${JHT_BRANCH:-production}"
INSTALL_DIR="${JHT_INSTALL_DIR:-$HOME/.jht/src}"

# BIN_DIR automatic choice:
# - root on Linux/WSL  → /usr/local/bin (always in the default PATH, no profile.d)
# - non-root or macOS  → $HOME/.local/bin (requires /etc/profile.d or ~/.bashrc)
# An explicit override via JHT_BIN_DIR is always respected.
if [ -n "${JHT_BIN_DIR:-}" ]; then
  BIN_DIR="$JHT_BIN_DIR"
elif [ "$(id -u 2>/dev/null || echo 1000)" -eq 0 ] && [ -w /usr/local/bin ]; then
  BIN_DIR="/usr/local/bin"
else
  BIN_DIR="$HOME/.local/bin"
fi

if [ -n "${JHT_RUNTIME_DIR:-}" ]; then
  RUNTIME_DIR="$JHT_RUNTIME_DIR"
elif [ "$(uname -s)" = "Darwin" ]; then
  RUNTIME_DIR="$HOME/Library/Application Support/Job Hunter Team/host-runtime"
else
  RUNTIME_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/job-hunter-team/host-runtime"
fi
IMAGE="${JHT_IMAGE:-ghcr.io/leopu00/jht:0.3.5}"
# Il compose scaricato può evolvere sul canale production; l'installer di
# questa release deve comunque avviare l'immagine dichiarata qui.
export JHT_IMAGE="$IMAGE"
MIN_NODE_MAJOR=22

# ── Arguments ─────────────────────────────────────────────────────────────
USE_DOCKER=1
DRY_RUN=0
PAIRING_TOKEN=""
# macOS container runtime: '' (= colima default) | 'colima' | 'docker-desktop'.
# Non-interactive (curl | bash) → the choice is a flag, not a prompt; the
# detect-first still reuses an already running Docker. Ignored on Linux. (ADR-0006)
RUNTIME_CHOICE=""
# Position-based parser: handles both standalone flags (--no-docker) and
# key/value pairs (--branch dev-1). We do not use `for arg in "$@"` because
# it loses the link between --branch and the following value.
while [ $# -gt 0 ]; do
  case "$1" in
    --no-docker) USE_DOCKER=0; shift ;;
    --with-docker) USE_DOCKER=1; shift ;;  # backwards-compat alias
    --runtime)
      [ -n "${2:-}" ] || { printf "%s requires an argument (colima|docker-desktop)\n" "$1" >&2; exit 2; }
      RUNTIME_CHOICE="$2"
      shift 2
      ;;
    --runtime=*) RUNTIME_CHOICE="${1#*=}"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --branch)
      # Explicit branch override, same as JHT_BRANCH=<name>.
      # Useful to test dev-N branches without setting the env var
      # (BUG-INSTALL-BRANCH-MASTER-DEFAULT). Wins over JHT_BRANCH if both set.
      [ -n "${2:-}" ] || { printf "%s requires an argument\n" "$1" >&2; exit 2; }
      BRANCH="$2"
      shift 2
      ;;
    --branch=*) BRANCH="${1#*=}"; shift ;;
    --pairing-token)
      # Opaque token produced when pairing the native application.
      # Decision locked 2026-05-13 #4: the app passes the token here, install.sh
      # saves it to $HOME/.jht/.pairing-token (perms 0600) and skips the
      # interactive wizard (no `jht cloud login` to redo inside the VPS). The
      # container reads it on first run via `jht cloud pair` (future gap).
      [ -n "${2:-}" ] || { printf "%s requires an argument\n" "$1" >&2; exit 2; }
      PAIRING_TOKEN="$2"
      shift 2
      ;;
    --pairing-token=*) PAIRING_TOKEN="${1#*=}"; shift ;;
    -h|--help)
      sed -n '2,54p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf "Unrecognized argument: %s\n" "$1" >&2
      exit 2
      ;;
  esac
done

# Normalize/validate the runtime choice: 'auto' (and empty) = colima by default.
case "$RUNTIME_CHOICE" in
  ""|auto) RUNTIME_CHOICE="" ;;
  colima|docker-desktop) ;;
  *) printf "Invalid --runtime value: %s (use colima|docker-desktop)\n" "$RUNTIME_CHOICE" >&2; exit 2 ;;
esac

# An explicit raw base is a host-authorized private mirror/test seam. Normal
# installs resolve the selected ref to an immutable commit just before the
# download, so migration never promotes bytes from the legacy writable tree.
RAW_BASE_OVERRIDE="${JHT_RAW_BASE:-}"

attested_raw_base() {
  if [ -n "$RAW_BASE_OVERRIDE" ]; then
    printf '%s\n' "${RAW_BASE_OVERRIDE%/}"
    return 0
  fi
  local metadata sha
  metadata="$(curl -fsSL "https://api.github.com/repos/leopu00/job-hunter-team/commits/$BRANCH")" \
    || return 1
  sha="$(printf '%s\n' "$metadata" \
    | sed -n 's/^[[:space:]]*"sha": "\([0-9a-fA-F]\{40\}\)".*/\1/p' \
    | head -n 1)"
  printf '%s' "$sha" | grep -Eq '^[0-9a-fA-F]{40}$' || return 1
  printf 'https://raw.githubusercontent.com/leopu00/job-hunter-team/%s\n' "$sha"
}

# ── Colors ────────────────────────────────────────────────────────────────
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

# Wrap commands with system side effects. In dry-run, print instead of executing.
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
    printf "  ${DIM}mode:    ${RESET}${BOLD}Docker (isolated)${RESET}\n"
    printf "  ${DIM}image:   %s${RESET}\n" "$IMAGE"
    printf "  ${DIM}branch:  %s${RESET}\n" "$BRANCH"
    printf "  ${DIM}runtime: %s${RESET}\n" "$RUNTIME_DIR"
  else
    printf "  ${DIM}mode:   ${RESET}${YELLOW}native (expert mode, --no-docker)${RESET}\n"
    printf "  ${DIM}repo:   %s${RESET}\n" "$REPO_URL"
    printf "  ${DIM}branch: %s${RESET}\n" "$BRANCH"
    printf "  ${DIM}target: %s${RESET}\n" "$INSTALL_DIR"
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}dry-run:${RESET} ${YELLOW}ON${RESET} (no changes to the system)\n"
  fi
  printf "\n"
}

# Different step counts depending on the path
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
    *) fail "Unsupported operating system: $uname_s" ;;
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
  step 1 "$total" "System detection"
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
  # Finder-launched macOS apps inherit a minimal PATH. Homebrew can therefore
  # already exist in its standard prefix while `command -v brew` says it does
  # not; attempting a second install then falls into sudo/TTY prompts for no
  # reason. Load the existing installation before deciding it is absent.
  local brew_bin
  if ! command -v brew &>/dev/null; then
    for brew_bin in /opt/homebrew/bin/brew /usr/local/bin/brew; do
      if [ -x "$brew_bin" ]; then
        eval "$("$brew_bin" shellenv)"
        break
      fi
    done
  fi
  if command -v brew &>/dev/null; then return 0; fi
  info "Homebrew not found. Installing..."
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash\n"
    return 0
  fi
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
    || fail "Homebrew installation failed"
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

install_colima_macos() {
  install_brew_if_missing
  if ! command -v colima &>/dev/null; then
    info "Installing Colima (Apache 2.0 container runtime, no Docker Desktop)..."
    run brew install colima || fail "Colima installation failed"
  else
    ok "colima already installed"
  fi
  if ! command -v docker &>/dev/null; then
    info "Installing docker CLI..."
    run brew install docker || fail "docker CLI installation failed"
  else
    ok "docker CLI already installed"
  fi
  # Start Colima if not already running
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: colima start (if not already running)\n"
    return 0
  fi
  if colima status &>/dev/null; then
    ok "colima already running"
  else
    info "Starting Colima (may take 30-60s the first time)..."
    colima start || fail "colima start failed. Retry manually with 'colima start'."
    ok "colima started"
  fi
}

install_docker_linux() {
  # Install Docker Engine + the Docker Compose v2 plugin. On Ubuntu 24.04
  # `apt install docker.io` does NOT include the compose plugin: without it,
  # `docker compose ...` fails with "unknown shorthand flag 'f'" and the
  # jht wrapper does not start. Tracked as a gotcha during the first Hetzner
  # VPS smoke test of 2026-05-06 (see docs/internal/ops/vps.md).
  case "$PKG" in
    apt)
      run sudo_maybe apt-get update -qq
      if ! command -v docker &>/dev/null; then
        info "Installing docker.io..."
        run sudo_maybe apt-get install -y docker.io || fail "docker.io installation failed"
      fi
      if ! docker compose version &>/dev/null; then
        info "Installing docker-compose-v2 (plugin)..."
        run sudo_maybe apt-get install -y docker-compose-v2 || fail "docker-compose-v2 installation failed"
      fi
      ;;
    dnf)
      if ! command -v docker &>/dev/null; then
        info "Installing docker..."
        run sudo_maybe dnf install -y docker || fail "docker installation failed"
      fi
      if ! docker compose version &>/dev/null; then
        info "Installing docker-compose-plugin..."
        run sudo_maybe dnf install -y docker-compose-plugin || warn "docker-compose-plugin installation failed — check manually"
      fi
      ;;
    pacman)
      if ! command -v docker &>/dev/null; then
        info "Installing docker..."
        run sudo_maybe pacman -Sy --noconfirm docker || fail "docker installation failed"
      fi
      if ! docker compose version &>/dev/null; then
        info "Installing docker-compose..."
        run sudo_maybe pacman -S --noconfirm docker-compose || warn "docker-compose installation failed — check manually"
      fi
      ;;
    *)
      command -v docker &>/dev/null || fail "Unknown package manager. Install docker manually or retry with --no-docker."
      docker compose version &>/dev/null || warn "docker compose v2 not available — install the plugin manually"
      ;;
  esac
  # On Linux/WSL2 the daemon usually does not start on its own
  if command -v systemctl &>/dev/null; then
    run sudo_maybe systemctl enable --now docker 2>/dev/null || true
  fi
  # WSL2: the daemon is started by the docker service
  if [ "$OS" = "wsl" ]; then
    run sudo_maybe service docker start 2>/dev/null || true
  fi
  # Add the user to the docker group to avoid sudo (requires logout).
  # Skipped for root: root uses docker without re-login and the warning
  # would just be noise. Common on VPS where the install runs as root.
  if [ "$(id -u)" -ne 0 ] && ! groups 2>/dev/null | grep -q '\bdocker\b'; then
    run sudo_maybe usermod -aG docker "$USER" 2>/dev/null || true
    warn "You have been added to the 'docker' group. Log out and back in (or run 'newgrp docker') to use it without sudo."
  fi
  ok "docker installed"
}

install_docker_desktop_macos() {
  # Docker Desktop is the user's app: we do NOT install it silently (EULA +
  # admin password + GUI on first open). The detect-first already ran,
  # so at this point the daemon is down. (ADR-0006)
  if [ ! -d "/Applications/Docker.app" ]; then
    fail "Docker Desktop is not installed. Download it from https://www.docker.com/products/docker-desktop/ and re-run, or use Colima with --runtime=colima."
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: open -a Docker (+ wait for daemon)\n"
    return 0
  fi
  info "Starting Docker Desktop..."
  open -a Docker || true
  info "Waiting for the Docker daemon (up to 120s)..."
  local i=0
  while [ "$i" -lt 60 ]; do
    if docker info &>/dev/null; then ok "Docker Desktop ready"; return 0; fi
    sleep 2
    i=$((i + 1))
  done
  fail "Docker Desktop started but the daemon is not responding after 120s. Open it manually and re-run."
}

install_container_runtime() {
  step 2 "$TOTAL_STEPS_DOCKER" "Container runtime"
  # Detect-first: if a Docker daemon already responds (Docker Desktop, an
  # existing Colima, OrbStack, ...), we reuse it — no second installation/VM
  # on top (avoids the two-VM clash, ADR-0006).
  if [ "$DRY_RUN" -ne 1 ] && docker info &>/dev/null; then
    ok "Docker already running and reachable — reusing this runtime (no installation)"
    return 0
  fi
  case "$OS" in
    macos)
      case "$RUNTIME_CHOICE" in
        docker-desktop) install_docker_desktop_macos ;;
        *) install_colima_macos ;;
      esac
      ;;
    linux|wsl) install_docker_linux ;;
  esac
}

verify_docker_works() {
  step 3 "$TOTAL_STEPS_DOCKER" "Docker check"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: docker info\n"
    return 0
  fi
  if ! docker info &>/dev/null; then
    if [ "$OS" = "linux" ] || [ "$OS" = "wsl" ]; then
      warn "docker info fails: you probably need sudo or a re-login for the docker group."
      info "Trying with sudo for the check..."
      sudo docker info &>/dev/null \
        || fail "The Docker daemon is not responding. Check with 'sudo systemctl status docker' (Linux) or 'colima status' (Mac)."
    else
      fail "The Docker daemon is not responding. Check with 'colima status' (Mac) or 'systemctl status docker' (Linux)."
    fi
  fi
  ok "docker daemon reachable"
}

download_runtime_files() {
  step 4 "$TOTAL_STEPS_DOCKER" "Download wrapper + docker-compose.yml"

  local release_base
  if [ "$DRY_RUN" -eq 1 ]; then
    release_base="${RAW_BASE_OVERRIDE:-https://raw.githubusercontent.com/leopu00/job-hunter-team/$BRANCH}"
  else
    release_base="$(attested_raw_base)" \
      || fail "Cannot resolve branch '$BRANCH' to an immutable release commit."
  fi
  local compose_url="$release_base/docker-compose.yml"
  local wrapper_url="$release_base/scripts/jht-wrapper.sh"
  local hostsetup_url="$release_base/scripts/host-setup.sh"
  local compose_dest="$RUNTIME_DIR/docker-compose.yml"
  local wrapper_dest="$BIN_DIR/jht"
  local hostsetup_dest="$RUNTIME_DIR/host-setup.sh"
  local manifest_dest="$RUNTIME_DIR/.runtime-integrity"

  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: mkdir -p %s %s\n" "$RUNTIME_DIR" "$BIN_DIR"
    printf "  ${DIM}[dry-run]${RESET} would download: %s -> %s\n" "$compose_url" "$compose_dest"
    printf "  ${DIM}[dry-run]${RESET} would download: %s -> %s\n" "$wrapper_url" "$wrapper_dest"
    printf "  ${DIM}[dry-run]${RESET} would download: %s -> %s\n" "$hostsetup_url" "$hostsetup_dest"
    printf "  ${DIM}[dry-run]${RESET} would execute: chmod +x %s %s\n" "$wrapper_dest" "$hostsetup_dest"
    case ":$PATH:" in
      *":$BIN_DIR:"*) PATH_READY=1 ;;
      *)              PATH_READY=0 ;;
    esac
    return 0
  fi

  if [ -L "$RUNTIME_DIR" ]; then
    fail "Host runtime path is a symlink: $RUNTIME_DIR"
  fi
  case "$RUNTIME_DIR/" in
    "$HOME/.jht/"*|"$HOME/Documents/Job Hunter Team/"*)
      fail "Host runtime must be outside container-writable bind mounts: $RUNTIME_DIR"
      ;;
  esac
  case "$BIN_DIR/" in
    "$HOME/.jht/"*|"$HOME/Documents/Job Hunter Team/"*)
      fail "Host wrapper must be outside container-writable bind mounts: $BIN_DIR"
      ;;
  esac
  umask 077
  mkdir -p "$RUNTIME_DIR" "$BIN_DIR"
  chmod 700 "$RUNTIME_DIR"
  local runtime_real bin_real
  runtime_real="$(cd -P "$RUNTIME_DIR" && pwd -P)"
  bin_real="$(cd -P "$BIN_DIR" && pwd -P)"
  [ "$runtime_real" = "${RUNTIME_DIR%/}" ] \
    || fail "Host runtime has a symlinked or non-canonical ancestor: $RUNTIME_DIR"
  [ "$bin_real" = "${BIN_DIR%/}" ] \
    || fail "Host wrapper directory has a symlinked or non-canonical ancestor: $BIN_DIR"

  local compose_tmp wrapper_tmp hostsetup_tmp manifest_tmp
  compose_tmp="$(mktemp "$RUNTIME_DIR/.compose.XXXXXX")"
  wrapper_tmp="$(mktemp "$BIN_DIR/.jht.XXXXXX")"
  hostsetup_tmp="$(mktemp "$RUNTIME_DIR/.host-setup.XXXXXX")"
  manifest_tmp="$(mktemp "$RUNTIME_DIR/.integrity.XXXXXX")"

  info "Downloading docker-compose.yml..."
  if ! curl -fsSL "$compose_url" -o "$compose_tmp"; then
    fail "Download failed: $compose_url. Check your connection and branch ($BRANCH)."
  fi
  chmod 600 "$compose_tmp"
  mv -f "$compose_tmp" "$compose_dest"
  ok "compose: $compose_dest"

  info "Downloading jht wrapper..."
  if ! curl -fsSL "$wrapper_url" -o "$wrapper_tmp"; then
    fail "Download failed: $wrapper_url. Check your connection and branch ($BRANCH)."
  fi
  chmod 700 "$wrapper_tmp"
  mv -f "$wrapper_tmp" "$wrapper_dest"
  ok "wrapper: $wrapper_dest"

  info "Downloading host-setup.sh (VPS/swap preflight)..."
  if ! curl -fsSL "$hostsetup_url" -o "$hostsetup_tmp" \
      || ! bash -n "$hostsetup_tmp"; then
    fail "host-setup.sh download or validation failed: $hostsetup_url"
  fi
  chmod 700 "$hostsetup_tmp"
  mv -f "$hostsetup_tmp" "$hostsetup_dest"
  local compose_sha hostsetup_sha wrapper_sha
  if command -v sha256sum >/dev/null 2>&1; then
    compose_sha="$(sha256sum "$compose_dest" | awk '{print $1}')"
    hostsetup_sha="$(sha256sum "$hostsetup_dest" | awk '{print $1}')"
    wrapper_sha="$(sha256sum "$wrapper_dest" | awk '{print $1}')"
  else
    compose_sha="$(shasum -a 256 "$compose_dest" | awk '{print $1}')"
    hostsetup_sha="$(shasum -a 256 "$hostsetup_dest" | awk '{print $1}')"
    wrapper_sha="$(shasum -a 256 "$wrapper_dest" | awk '{print $1}')"
  fi
  {
    printf 'version=1\n'
    printf 'docker-compose.yml=%s\n' "$compose_sha"
    printf 'host-setup.sh=%s\n' "$hostsetup_sha"
    printf 'jht-wrapper.sh=%s\n' "$wrapper_sha"
  } > "$manifest_tmp"
  chmod 600 "$manifest_tmp"
  mv -f "$manifest_tmp" "$manifest_dest"
  ok "host-setup: $hostsetup_dest"

  case ":$PATH:" in
    *":$BIN_DIR:"*)
      ok "$BIN_DIR already in PATH"
      PATH_READY=1
      ;;
    *)
      # Auto-add to a persistent location so the next login shells see
      # `jht` without manual intervention (BUG-INSTALL-PATH-NOT-EXPORTED).
      # On Ubuntu Bash, ~/.profile already contains the guard
      # `if [ -d "$HOME/.local/bin" ]; then PATH="$HOME/.local/bin:$PATH"; fi`,
      # but that guard is evaluated ONLY at the login following the creation
      # of the dir — installing JHT in an already open session, the dir did
      # not exist at login → PATH not populated → `jht` not found.
      # The `curl | bash` subshell cannot modify the parent PATH, so we
      # must write to a file sourced by the next shell.
      local persistent_added=0
      if [ "${EUID:-$(id -u)}" -eq 0 ] && [ -d /etc/profile.d ] && [ -w /etc/profile.d ]; then
        # System-wide (preferred on root VPS): /etc/profile.d/<file>.sh is
        # sourced by /etc/profile at every interactive login shell.
        printf 'export PATH="$PATH:%s"\n' "$BIN_DIR" > /etc/profile.d/jht.sh
        chmod 644 /etc/profile.d/jht.sh
        ok "PATH added to /etc/profile.d/jht.sh (system-wide)"
        persistent_added=1
      else
        # User-level fallback: append to ~/.bashrc + ~/.zshrc if they exist
        # and not already present. Idempotent: skip if already added.
        for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
          if [ -f "$rc" ] && ! grep -q "$BIN_DIR" "$rc" 2>/dev/null; then
            printf '\n# Added by JHT install.sh\nexport PATH="$PATH:%s"\n' "$BIN_DIR" >> "$rc"
            ok "PATH added to $rc"
            persistent_added=1
          fi
        done
      fi
      if [ "$persistent_added" -eq 0 ]; then
        warn "No shell rc file was written. Add manually:"
        printf "\n      ${BOLD}export PATH=\"\$PATH:%s\"${RESET}\n\n" "$BIN_DIR"
      fi
      # Also update this subshell's PATH so the commands install.sh runs
      # afterwards (e.g. the wizard) can find `jht`. The parent shell PATH
      # will be updated at the next login (via /etc/profile.d or ~/.bashrc).
      # We show PATH_READY=1 in the "next steps" because the user usually
      # opens a new shell or re-runs exec bash -l.
      export PATH="$BIN_DIR:$PATH"
      PATH_READY=1
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
    ok "$name already installed"
    return 0
  fi
  info "Installing $name..."
  run "$@" || fail "$name installation failed"
  ok "$name installed"
}

install_system_deps() {
  step 2 "$TOTAL_STEPS_NATIVE" "System dependencies (git, curl, tmux)"

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
          command -v git &>/dev/null || fail "git not found and unknown package manager. Install git manually."
          command -v tmux &>/dev/null || fail "tmux not found. Install tmux manually."
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
    ok "node $(node -v) already installed"
    return 0
  fi

  info "Installing Node.js ${MIN_NODE_MAJOR}..."
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
          fail "Automatic Node.js installation is not supported on this system."
          ;;
      esac
      ;;
  esac

  if [ "$DRY_RUN" -eq 1 ]; then
    return 0
  fi
  check_node_version || fail "Node.js ${MIN_NODE_MAJOR}+ is not available after installation"
  ok "node $(node -v) installed"
}

install_claude_cli() {
  step 4 "$TOTAL_STEPS_NATIVE" "Claude CLI"

  if command -v claude &>/dev/null; then
    ok "claude CLI already installed"
    return 0
  fi

  info "Installing Claude CLI via npm (global)..."
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: npm install -g @anthropic-ai/claude-cli\n"
    return 0
  fi
  if ! npm install -g @anthropic-ai/claude-cli 2>/dev/null; then
    warn "Automatic installation failed. Install manually from https://docs.anthropic.com/claude/docs/claude-code"
    return 0
  fi
  ok "claude CLI installed"
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
    info "Repo already present in $INSTALL_DIR, updating..."
    (cd "$INSTALL_DIR" && git fetch --quiet --depth 1 origin "$BRANCH" && git checkout --quiet "$BRANCH" && git reset --hard --quiet "origin/$BRANCH") \
      || fail "Unable to update the repo"
    ok "Repo updated to $BRANCH"
  else
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" \
      || fail "Clone failed. Check your connection and permissions on $INSTALL_DIR"
    ok "Repo cloned into $INSTALL_DIR"
  fi
}

build_jht() {
  step 6 "$TOTAL_STEPS_NATIVE" "Build CLI and shared modules"

  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: (cd %s/cli && npm install)\n" "$INSTALL_DIR"
    printf "  ${DIM}[dry-run]${RESET} would execute: npm install in each %s/shared/*/package.json with deps\n" "$INSTALL_DIR"
    return 0
  fi

  info "Installing CLI dependencies..."
  (cd "$INSTALL_DIR/cli" && npm install --silent --no-audit --no-fund) \
    || fail "CLI npm install failed"
  ok "CLI ready"

  info "Installing shared module dependencies..."
  local shared_installed=0
  for pkg in "$INSTALL_DIR"/shared/*/package.json; do
    [ -f "$pkg" ] || continue
    local dir
    dir=$(dirname "$pkg")
    local has_deps
    has_deps=$(node -p "Object.keys(JSON.parse(require('fs').readFileSync('$pkg','utf8')).dependencies||{}).length > 0")
    if [ "$has_deps" = "true" ]; then
      (cd "$dir" && npm install --silent --no-audit --no-fund) \
        || fail "npm install $(basename "$dir") failed"
      shared_installed=$((shared_installed + 1))
    fi
  done
  ok "$shared_installed shared modules ready"
}

link_bin_native() {
  step 7 "$TOTAL_STEPS_NATIVE" "Install jht command (native)"

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
    fail "Entry point not found: $target"
  fi

  chmod +x "$target"

  if [ -L "$link" ] || [ -e "$link" ]; then
    rm -f "$link"
  fi
  ln -s "$target" "$link"
  ok "Symlink created: $link -> $target"

  case ":$PATH:" in
    *":$BIN_DIR:"*)
      ok "$BIN_DIR is already in PATH"
      PATH_READY=1
      ;;
    *)
      warn "$BIN_DIR is not in PATH."
      info "Add this line to your shell rc (~/.zshrc, ~/.bashrc):"
      printf "\n      ${BOLD}export PATH=\"\$PATH:%s\"${RESET}\n\n" "$BIN_DIR"
      PATH_READY=0
      ;;
  esac
}

# ── Final ─────────────────────────────────────────────────────────────────

# True if maybe_onboard() can launch the wizard right away (TTY available
# directly or re-openable from /dev/tty). Used by final_message to decide
# whether to print "Next steps: jht setup" (it would be noise if the
# wizard is about to start on its own a few lines below).
will_auto_onboard() {
  [ "$DRY_RUN" -eq 1 ] && return 1
  [ "${JHT_SKIP_ONBOARD:-0}" = "1" ] && return 1
  [ -t 0 ] && return 0
  [ -r /dev/tty ] && return 0
  return 1
}

final_message() {
  printf "\n"
  printf "${GREEN}${BOLD}══════════════════════════════════════════${RESET}\n"
  printf "${GREEN}${BOLD}  Installation complete!${RESET}\n"
  printf "${GREEN}${BOLD}══════════════════════════════════════════${RESET}\n"
  printf "\n"
  if [ "$USE_DOCKER" -eq 1 ]; then
    printf "  ${BOLD}Container mode active.${RESET}\n"
    printf "  ${DIM}The agents can only see:${RESET}\n"
    printf "  ${DIM}  ~/.jht/                       → /jht_home (config, db, agents)${RESET}\n"
    printf "  ${DIM}  ~/Documents/Job Hunter Team/  → /jht_user (CVs, attachments, output)${RESET}\n"
    printf "\n"
  else
    printf "  ${YELLOW}${BOLD}⚠  Native mode (--no-docker).${RESET}\n"
    printf "  ${DIM}The AI agents have access to your filesystem. Use this only if${RESET}\n"
    printf "  ${DIM}you know what you are doing or have a PC/VM dedicated to JHT.${RESET}\n"
    printf "\n"
    printf "  ${DIM}File layout:${RESET}\n"
    printf "  ${DIM}  ~/.jht/                       → config, db, agents (do not touch)${RESET}\n"
    printf "  ${DIM}  ~/Documents/Job Hunter Team/  → CVs, attachments, output${RESET}\n"
    printf "\n"
  fi

  # Show "Next steps" only when the wizard does NOT start on its own
  # (e.g. CI without a TTY, JHT_SKIP_ONBOARD=1). When it starts, the
  # wizard takes over right below and these lines would be noise.
  if ! will_auto_onboard; then
    printf "  ${BOLD}Next steps:${RESET}\n"
    printf "\n"
    if [ "${PATH_READY:-0}" -eq 1 ]; then
      if [ "$USE_DOCKER" -eq 1 ]; then
        printf "      ${BOLD}jht setup${RESET}        ${DIM}# configuration wizard (also starts the container)${RESET}\n"
      else
        printf "      ${BOLD}jht setup${RESET}        ${DIM}# initial configuration${RESET}\n"
        printf "      ${BOLD}jht dashboard${RESET}    ${DIM}# starts the web dashboard${RESET}\n"
      fi
    else
      if [ "$USE_DOCKER" -eq 1 ]; then
        printf "      ${BOLD}%s/jht setup${RESET}\n" "$BIN_DIR"
      else
        printf "      ${BOLD}%s/jht setup${RESET}\n" "$BIN_DIR"
        printf "      ${BOLD}%s/jht dashboard${RESET}\n" "$BIN_DIR"
      fi
    fi
    printf "\n"
  fi

  printf "  ${DIM}To uninstall (keeps your data in ~/.jht and ~/Documents/Job Hunter Team):${RESET}\n"
  if [ "$USE_DOCKER" -eq 1 ]; then
    printf "  ${DIM}  jht down && rm -rf %s %s/jht && docker rmi %s${RESET}\n" "$RUNTIME_DIR" "$BIN_DIR" "$IMAGE"
  else
    printf "  ${DIM}  rm -rf %s %s/jht${RESET}\n" "$INSTALL_DIR" "$BIN_DIR"
  fi
  printf "  ${DIM}To also delete your data (config, db, CVs, output):${RESET}\n"
  printf "  ${DIM}  rm -rf %s/.jht \"%s/Documents/Job Hunter Team\"${RESET}\n" "$HOME" "$HOME"
  printf "\n"
}

save_pairing_token() {
  # Save the pairing token to $HOME/.jht/.pairing-token with perms 0600.
  # The container reads it on first run and exchanges the refresh_token →
  # Supabase access_token before calling /auth/v1/user. See
  # cli/src/commands/cloud.js handlePair (future task).
  [ -z "$PAIRING_TOKEN" ] && return 0
  local jht_home="$HOME/.jht"
  local token_file="$jht_home/.pairing-token"
  run mkdir -p "$jht_home"
  if [ "$DRY_RUN" -eq 1 ]; then
    info "dry-run: would save the pairing token to $token_file"
    return 0
  fi
  printf '%s' "$PAIRING_TOKEN" > "$token_file"
  # 0600 — it is a bearer credential (it is exchanged for a Supabase
  # access_token), so no other host user may read it. It used to be 0644
  # "because the container runs as a non-root UID (jht/1001)": the right fix
  # for that is ownership, not world-readability — run_host_setup() (called
  # right after this) already does `chown -R 1001:1001 ~/.jht`, and we align
  # this file explicitly here so the order of those two steps stops mattering.
  # The file is deleted by `jht cloud pair` right after consumption
  # (cli/src/commands/cloud.js handlePair), so the window is short either way.
  chmod 600 "$token_file" 2>/dev/null || true
  chown 1001:1001 "$token_file" 2>/dev/null || true
  ok "Pairing token saved to $token_file (mode 0600)"
}

run_host_setup() {
  # host-setup.sh writes ~/.jht/host.env with JHT_HOST_TYPE (+ JHT_LANG + swap).
  # WITHOUT this file the container boots in mode=local (compose backwards-compat
  # default) and pid1 SKIPS the entire cloud block — push daemon + pair-on-boot +
  # the "Sync now" handler — so cloud sync is silently dead. Must run on BOTH
  # install paths:
  #   • app-provisioned (--pairing-token present): force --host-type=vps —
  #     no user at the terminal to confirm the auto-detection.
  #   • manual `curl install.sh | bash`: NO flag → host-setup auto-detects
  #     (detect_vps) and, with no TTY, writes the detected type without a prompt.
  #     Regression fixed 2026-07-09: this path used to `return 0` early → host.env
  #     never written → container in mode=local → cloud daemon never started.
  local hostsetup="$RUNTIME_DIR/host-setup.sh"
  if [ ! -x "$hostsetup" ]; then
    warn "host-setup.sh not available at $hostsetup — skipping preflight"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    info "dry-run: would run $hostsetup${PAIRING_TOKEN:+ --host-type=vps}"
    return 0
  fi
  info "Running host-setup.sh (writes ~/.jht/host.env + swap preflight)..."
  if [ -n "$PAIRING_TOKEN" ]; then
    if "$hostsetup" --host-type=vps </dev/null; then
      ok "host-setup completed (forced vps)"
    else
      warn "host-setup exited with an error — continuing (a manual pair may be needed)"
    fi
  else
    if "$hostsetup" </dev/null; then
      ok "host-setup completed (auto-detected host type)"
    else
      warn "host-setup exited with an error — continuing"
    fi
  fi
  # Align the ownership of ~/.jht and ~/Documents/Job Hunter Team with the
  # `jht` container UID (1001, see Dockerfile `useradd jht`). Without this,
  # the container starts as UID 1001 and fails at two distinct points:
  #   - pid1 → cloud pair → EACCES on /jht_home/cloud.json
  #   - jht team start → mkdir /jht_user/output → Permission denied
  # Both dirs are bind-mounted, so the host must be aligned.
  local jht_home="$HOME/.jht"
  local jht_user_dir="$HOME/Documents/Job Hunter Team"
  if command -v chown >/dev/null 2>&1; then
    chown -R 1001:1001 "$jht_home" 2>/dev/null && \
      ok "Ownership $jht_home → 1001:1001 (container UID)" || \
      warn "chown $jht_home failed — pairing may require a manual fix"
    mkdir -p "$jht_user_dir" 2>/dev/null
    chown -R 1001:1001 "$jht_user_dir" 2>/dev/null && \
      ok "Ownership $jht_user_dir → 1001:1001 (container UID)" || \
      warn "chown $jht_user_dir failed — team start may fail on mkdir output/"
  fi
}

maybe_onboard() {
  if [ "$DRY_RUN" -eq 1 ]; then
    info "dry-run: skipping the onboarding wizard."
    return 0
  fi
  if [ "${JHT_SKIP_ONBOARD:-0}" = "1" ]; then
    return 0
  fi
  if [ -n "$PAIRING_TOKEN" ]; then
    # Pairing token present → the user is provisioning the VPS from the
    # native application (decision locked 2026-05-13 #4). No interactive
    # wizard: the container will do the non-interactive pair on first run
    # via the .pairing-token file. The user will complete the provider
    # login (Claude/Codex/Kimi) from the console embedded in the app.
    info "Pairing token present: skipping the interactive wizard."
    info "The container will complete the pairing on first boot."
    return 0
  fi

  # `curl | bash` connects stdin to the pipe, so `-t 0` is false and
  # `read` cannot talk to the user. We reopen stdin from the
  # controlling terminal (/dev/tty) so the wizard can read input:
  # same pattern as rustup, nvm, oh-my-zsh.
  # Without this escape hatch, after `curl | bash` the installer
  # printed "Stdin is not an interactive terminal: skipping the
  # wizard" and the user had to remember to re-run `jht setup`.
  if [ ! -t 0 ]; then
    if [ -r /dev/tty ]; then
      exec </dev/tty
    else
      info "No interactive terminal (no /dev/tty): skipping the wizard."
      info "Run manually: jht setup"
      return 0
    fi
  fi

  # No "Do you want to start the setup?" prompt: on first run it is always
  # the correct next action. Whoever wants to skip uses JHT_SKIP_ONBOARD=1.
  export PATH="$BIN_DIR:$PATH"
  printf "\n"
  jht setup || warn "The wizard exited with an error. Re-run it with 'jht setup'."
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
  save_pairing_token
  run_host_setup
  final_message
  maybe_onboard
}

main
