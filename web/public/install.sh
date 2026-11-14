#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  Job Hunter Team — Installer (Docker-by-default)                         ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  Usage:                                                                  ║
# ║    curl -fsSL https://jobhunterteam.ai/install.sh | bash                 ║
# ║                                                                          ║
# ║    # "Expert mode" install without a container:                          ║
# ║    curl -fsSL https://jobhunterteam.ai/install.sh \                      ║
# ║      | bash -s -- --no-docker                                            ║
# ║                                                                          ║
# ║  Default (Docker mode): installs nothing on the host except Docker.      ║
# ║  Downloads:                                                              ║
# ║    - host runtime outside $HOME/.jht (compose + preflight)               ║
# ║    - $HOME/.local/bin/jht         (the bash wrapper)                     ║
# ║  The Node CLI, Python, tmux and the agents ALL run inside the long-      ║
# ║  running container managed by compose. No Node/Python/tmux on the host.  ║
# ║  No Docker socket inside the container.                                  ║
# ║                                                                          ║
# ║  Only two host folders are exposed to the container: ~/.jht and          ║
# ║  ~/Documents/Job Hunter Team. The rest of the filesystem is invisible.   ║
# ║                                                                          ║
# ║  Options (env vars / flags):                                             ║
# ║    --no-docker             Skip the container, install natively (expert) ║
# ║    --runtime podman        The only engine (also the default): on macOS  ║
# ║                            a Podman machine (Podman from Homebrew), on   ║
# ║                            Linux rootless Podman for your user; what is  ║
# ║                            missing is installed with sudo -n (no         ║
# ║                            password prompt). No Docker, no Colima.       ║
# ║    --dry-run               Only show the actions that would be executed  ║
# ║    --publish-runtime-bundle  Migrate one verified candidate installer,   ║
# ║                              wrapper, compose and host-setup transaction;║
# ║                              no engine, GUI, account or container I/O.   ║
# ║    --expected-installer-sha256 <hex> Required with the mode above.       ║
# ║    --expected-wrapper-sha256 <hex>   Required with the mode above.       ║
# ║    --expected-compose-sha256 <hex>   Required with the mode above.       ║
# ║    --expected-host-setup-sha256 <hex> Required with the mode above.      ║
# ║    --expected-runtime-version <ver>  Required with the mode above.       ║
# ║    --source-sha <40 hex>   Test channel: compose, wrapper and host-setup ║
# ║                            of exactly this commit (no API lookup)        ║
# ║    --image <ref>           Test channel: ghcr.io/leopu00/jht@sha256:<64> ║
# ║                            or ghcr.io/leopu00/jht:<tag>                  ║
# ║    --expected-image-digest sha256:<64>  Test channel: the image is pulled║
# ║                            and published only if its RepoDigests carry   ║
# ║                            this digest; `jht up` then runs exactly it.   ║
# ║                            The three go together, or none of them.       ║
# ║    --extras-image-digest sha256:<64>  Test channel, optional: the image  ║
# ║                            of the tools that come on request (screen,    ║
# ║                            media, playwright). Pinned like the image     ║
# ║                            above; it is NOT downloaded here: `jht screen ║
# ║                            on` pulls it, by this digest, when asked.     ║
# ║    --branch <name>         Source branch for wrapper+compose             ║
# ║                            (same as JHT_BRANCH=<name>, default           ║
# ║                            production). Example to test dev-1:           ║
# ║      curl ...install.sh | bash -s -- --branch dev-1                      ║
# ║    JHT_BRANCH=dev-1        Source branch (env var, alternative to        ║
# ║                            --branch). default: production                ║
# ║    JHT_INSTALL_DIR         Where to clone the repo (default:             ║
# ║                            $HOME/.jht/src, only used by --no-docker)     ║
# ║    JHT_RUNTIME_DIR         Where to download docker-compose.yml          ║
# ║                            (default: XDG/App Support host-runtime)       ║
# ║    JHT_BIN_DIR             Where to put the jht wrapper (default:        ║
# ║                            $HOME/.local/bin)                             ║
# ║    JHT_IMAGE               Image for THIS install only; a later          ║
# ║                            `jht up` uses the release digest              ║
# ║    JHT_RAW_BASE            Base URL override for downloads               ║
# ║                            (default: https://raw.githubusercontent.com/  ║
# ║                                      leopu00/job-hunter-team/<BRANCH>)   ║
# ║    JHT_SKIP_ONBOARD=1      Do not launch the wizard at the end           ║
# ║                                                                          ║
# ║  Supports: macOS (Podman), Linux (Debian/Ubuntu/Fedora/Arch, rootless    ║
# ║  Podman). Windows: install.ps1.                                          ║
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
# The folder is written between double quotes into a shell startup file (and into /etc/profile.d as root): a quote,
# a dollar sign, a backtick, a backslash or a line break in it would run something there, so it is refused here.
case "$BIN_DIR" in
  *'"'*|*'$'*|*'`'*|*'\'*|*$'\n'*|*$'\r'*)
    printf 'The folder for the jht command (JHT_BIN_DIR) has a character that cannot be written safely into a shell startup file: nothing was installed.\n' >&2
    exit 2
    ;;
esac

if [ -n "${JHT_RUNTIME_DIR:-}" ]; then
  RUNTIME_DIR="$JHT_RUNTIME_DIR"
elif [ "$(uname -s)" = "Darwin" ]; then
  RUNTIME_DIR="$HOME/Library/Application Support/Job Hunter Team/host-runtime"
else
  RUNTIME_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/job-hunter-team/host-runtime"
fi
IMAGE="${JHT_IMAGE:-ghcr.io/leopu00/jht@sha256:8db1633af3c6e7d606b058225023988f86687d86c8eab3cbe2c47c57ff8190e7}"
# The core image (tools come later): empty while the release has none; with one, the install uses it unless JHT_IMAGE names another.
CORE_IMAGE_DIGEST="${JHT_CORE_IMAGE_DIGEST:-sha256:b962a32665e6ed8c81b378a453d596417cf03333cded7087f2ea50587126b24b}"
# It becomes an image name, a file and a hash: only the exact shape of a digest goes through, whatever the environment says.
[ -z "$CORE_IMAGE_DIGEST" ] || [[ "$CORE_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || { printf 'JHT_CORE_IMAGE_DIGEST is not a sha256 digest\n' >&2; exit 2; }
RUNTIME_TIER="" TIER_STAGED="" TIER_STAGED_SHA=""
if [ -n "$CORE_IMAGE_DIGEST" ] && [ -z "${JHT_IMAGE:-}" ]; then RUNTIME_TIER="core"; IMAGE="ghcr.io/leopu00/jht@$CORE_IMAGE_DIGEST"; fi
# Il compose scaricato può evolvere sul canale production; l'installer di
# questa release deve comunque avviare l'immagine dichiarata qui.
export JHT_IMAGE="$IMAGE"
MIN_NODE_MAJOR=22

# ── Arguments ─────────────────────────────────────────────────────────────
USE_DOCKER=1
DRY_RUN=0
PAIRING_TOKEN=""
PUBLISH_RUNTIME_BUNDLE=0
EXPECTED_INSTALLER_SHA256=""
EXPECTED_WRAPPER_SHA256=""
EXPECTED_COMPOSE_SHA256=""
EXPECTED_HOST_SETUP_SHA256=""
EXPECTED_RUNTIME_VERSION=""
# Test channel (desktop test builds): one commit's files and one image digest.
SOURCE_SHA=""
TEST_IMAGE=""
EXPECTED_IMAGE_DIGEST=""
EXTRAS_IMAGE_DIGEST_OPT=""
TEST_CHANNEL=0
RUNTIME_PUBLISH_FAILPOINT="${JHT_RUNTIME_PUBLISH_FAILPOINT:-}"
RUNTIME_PUBLISH_FAILURE="${JHT_RUNTIME_PUBLISH_FAILURE:-error}"
# The container engine: Podman, the only one since 0.4 (a machine on macOS, rootless on Linux). `--runtime podman` is still
# accepted; Colima, Docker Desktop and Docker Engine are not (a computer that ran JHT on them is told what to do: keep_chosen_runtime).
RUNTIME_CHOICE=""
RUNTIME_GIVEN=0
PODMAN_MACHINE_NAME="${JHT_PODMAN_MACHINE:-jht-podman}"
PODMAN_MACHINE_CPUS=2
PODMAN_MACHINE_MEMORY_MIB=4096
PODMAN_MACHINE_DISK_GIB=30
# 1 only when THIS run created the machine (machine init succeeded): what `jht uninstall` may remove besides the standard one.
PODMAN_MACHINE_CREATED=0
# When it was created (podman machine inspect «Created»): the marker says WHICH machine, not only the name, so a machine the person
# creates later with the same name is not taken for this one.
PODMAN_MACHINE_CREATED_ID=""
DOCKER_CLI="docker"
# Position-based parser: handles both standalone flags (--no-docker) and
# key/value pairs (--branch dev-1). We do not use `for arg in "$@"` because
# it loses the link between --branch and the following value.
while [ $# -gt 0 ]; do
  case "$1" in
    --no-docker) USE_DOCKER=0; shift ;;
    --with-docker) USE_DOCKER=1; shift ;;  # backwards-compat alias
    --runtime)
      [ -n "${2:-}" ] || { printf "%s requires an argument (podman)\n" "$1" >&2; exit 2; }
      RUNTIME_CHOICE="$2"
      shift 2
      ;;
    --runtime=*) RUNTIME_CHOICE="${1#*=}"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --publish-runtime-bundle) PUBLISH_RUNTIME_BUNDLE=1; shift ;;
    --expected-installer-sha256)
      [ -n "${2:-}" ] || { printf "%s requires an argument\n" "$1" >&2; exit 2; }
      EXPECTED_INSTALLER_SHA256="$2"
      shift 2
      ;;
    --expected-installer-sha256=*) EXPECTED_INSTALLER_SHA256="${1#*=}"; shift ;;
    --expected-wrapper-sha256)
      [ -n "${2:-}" ] || { printf "%s requires an argument\n" "$1" >&2; exit 2; }
      EXPECTED_WRAPPER_SHA256="$2"
      shift 2
      ;;
    --expected-wrapper-sha256=*) EXPECTED_WRAPPER_SHA256="${1#*=}"; shift ;;
    --expected-compose-sha256)
      [ -n "${2:-}" ] || { printf "%s requires an argument\n" "$1" >&2; exit 2; }
      EXPECTED_COMPOSE_SHA256="$2"
      shift 2
      ;;
    --expected-compose-sha256=*) EXPECTED_COMPOSE_SHA256="${1#*=}"; shift ;;
    --expected-host-setup-sha256)
      [ -n "${2:-}" ] || { printf "%s requires an argument\n" "$1" >&2; exit 2; }
      EXPECTED_HOST_SETUP_SHA256="$2"
      shift 2
      ;;
    --expected-host-setup-sha256=*) EXPECTED_HOST_SETUP_SHA256="${1#*=}"; shift ;;
    --expected-runtime-version)
      [ -n "${2:-}" ] || { printf "%s requires an argument\n" "$1" >&2; exit 2; }
      EXPECTED_RUNTIME_VERSION="$2"
      shift 2
      ;;
    --expected-runtime-version=*) EXPECTED_RUNTIME_VERSION="${1#*=}"; shift ;;
    --source-sha|--image|--expected-image-digest)
      [ -n "${2:-}" ] || { printf "%s requires an argument\n" "$1" >&2; exit 2; }
      case "$1" in
        --source-sha) SOURCE_SHA="$2" ;;
        --image) TEST_IMAGE="$2" ;;
        --expected-image-digest) EXPECTED_IMAGE_DIGEST="$2" ;;
      esac
      shift 2
      ;;
    --extras-image-digest)
      [ -n "${2:-}" ] || { printf "%s requires an argument\n" "$1" >&2; exit 2; }
      EXTRAS_IMAGE_DIGEST_OPT="$2"
      shift 2
      ;;
    --extras-image-digest=*) EXTRAS_IMAGE_DIGEST_OPT="${1#*=}"; shift ;;
    --source-sha=*) SOURCE_SHA="${1#*=}"; shift ;;
    --image=*) TEST_IMAGE="${1#*=}"; shift ;;
    --expected-image-digest=*) EXPECTED_IMAGE_DIGEST="${1#*=}"; shift ;;
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
    --pairing-token-env)
      # Same token, taken from $JHT_PAIRING_TOKEN instead of the command line:
      # the arguments of a process are readable by every user of the server
      # (ps, /proc/<pid>/cmdline), its environment only by its owner. The
      # variable is dropped at once, so nothing the installer starts inherits it.
      [ -n "${JHT_PAIRING_TOKEN:-}" ] || { printf "%s needs JHT_PAIRING_TOKEN in the environment\n" "$1" >&2; exit 2; }
      PAIRING_TOKEN="$JHT_PAIRING_TOKEN"
      unset JHT_PAIRING_TOKEN
      shift
      ;;
    -h|--help)
      sed -n '2,/^# ╚/p' "$0" | sed 's/^# \{0,1\}//'  # the whole header box, whatever its length
      exit 0
      ;;
    *)
      printf "Unrecognized argument: %s\n" "$1" >&2
      exit 2
      ;;
  esac
done

# Normalize/validate the runtime choice: Podman is the only engine ('auto' and empty mean it too).
[ -z "$RUNTIME_CHOICE" ] || RUNTIME_GIVEN=1
case "$RUNTIME_CHOICE" in
  ""|auto|podman) RUNTIME_CHOICE="podman" ;;
  colima|docker|docker-desktop|orbstack)
    printf "runtime_not_supported: --runtime %s: since 0.4 JHT runs only on Podman (a machine on macOS, rootless on Linux). Run the installer without --runtime.\n" "$RUNTIME_CHOICE" >&2
    exit 2
    ;;
  *) printf "Invalid --runtime value: %s (use podman)\n" "$RUNTIME_CHOICE" >&2; exit 2 ;;
esac

# The test channel is all three coordinates or none: a half-given channel
# would install one commit's files with another image, or the reverse.
if [ -n "$EXTRAS_IMAGE_DIGEST_OPT" ]; then
  [ -n "$SOURCE_SHA$TEST_IMAGE$EXPECTED_IMAGE_DIGEST" ] \
    || { printf '%s\n' "--extras-image-digest belongs to the test channel (with --source-sha, --image and --expected-image-digest)" >&2; exit 2; }
  [[ "$EXTRAS_IMAGE_DIGEST_OPT" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || { printf '%s\n' "--extras-image-digest needs sha256:<64 lowercase hex>" >&2; exit 2; }  # whole string: grep checks line by line
fi
if [ -n "$SOURCE_SHA$TEST_IMAGE$EXPECTED_IMAGE_DIGEST" ]; then
  printf '%s' "$SOURCE_SHA" | grep -Eq '^[0-9a-f]{40}$' \
    || { printf '%s\n' "--source-sha needs 40 lowercase hex (with --image and --expected-image-digest)" >&2; exit 2; }
  printf '%s' "$EXPECTED_IMAGE_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$' \
    || { printf '%s\n' "--expected-image-digest needs sha256:<64 lowercase hex>" >&2; exit 2; }
  case "$TEST_IMAGE" in
    ghcr.io/leopu00/jht@sha256:*)
      [ "${TEST_IMAGE#ghcr.io/leopu00/jht@}" = "$EXPECTED_IMAGE_DIGEST" ] \
        || { printf '%s\n' "--image is pinned to another digest than --expected-image-digest" >&2; exit 2; }
      ;;
    ghcr.io/leopu00/jht:*)
      printf '%s' "${TEST_IMAGE#ghcr.io/leopu00/jht:}" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$' \
        || { printf '%s\n' "--image has an invalid tag" >&2; exit 2; }
      ;;
    *) printf '%s\n' "--image must be ghcr.io/leopu00/jht@sha256:<64> or ghcr.io/leopu00/jht:<tag>" >&2; exit 2 ;;
  esac
  [ "$USE_DOCKER" -eq 1 ] && [ "$PUBLISH_RUNTIME_BUNDLE" -eq 0 ] \
    || { printf '%s\n' "the test channel installs the container runtime only" >&2; exit 2; }
  TEST_CHANNEL=1
  RUNTIME_TIER=""
  BRANCH="$SOURCE_SHA"
  IMAGE="$TEST_IMAGE"
  export JHT_IMAGE="$IMAGE"
fi

if [ "$PUBLISH_RUNTIME_BUNDLE" -eq 1 ]; then
  for expected_digest_name in EXPECTED_INSTALLER_SHA256 EXPECTED_WRAPPER_SHA256 \
      EXPECTED_COMPOSE_SHA256 EXPECTED_HOST_SETUP_SHA256; do
    expected_digest="${!expected_digest_name}"
    expected_digest="$(printf '%s' "$expected_digest" | tr '[:upper:]' '[:lower:]')"
    printf -v "$expected_digest_name" '%s' "$expected_digest"
    printf '%s' "$expected_digest" | grep -Eq '^[0-9a-f]{64}$' \
      || { printf '%s\n' "--publish-runtime-bundle requires all expected SHA-256 digests" >&2; exit 2; }
  done
  case "$EXPECTED_RUNTIME_VERSION" in
    ''|*[!0-9A-Za-z._-]*)
      printf '%s\n' "--publish-runtime-bundle requires a bounded --expected-runtime-version" >&2
      exit 2
      ;;
  esac
  [ "${#EXPECTED_RUNTIME_VERSION}" -le 64 ] \
    || { printf '%s\n' "--expected-runtime-version is too long" >&2; exit 2; }
  [ "$USE_DOCKER" -eq 1 ] && [ "$DRY_RUN" -eq 0 ] \
    && [ "$RUNTIME_GIVEN" = 0 ] && [ -z "$PAIRING_TOKEN" ] \
    || { printf '%s\n' "--publish-runtime-bundle cannot combine with dry-run, runtime selection, pairing, or native mode" >&2; exit 2; }
  if [ -n "$RUNTIME_PUBLISH_FAILPOINT" ]; then
    [ "${JHT_RUNTIME_PUBLISH_TEST_MODE:-0}" = 1 ] \
      || { printf '%s\n' "runtime publication failpoints require explicit test mode" >&2; exit 2; }
    case "$RUNTIME_PUBLISH_FAILPOINT" in
      before-manifest-replace|after-manifest-replace|after-compose-replace|before-wrapper-replace|after-wrapper-replace) ;;
      *) printf '%s\n' "unknown runtime publication failpoint" >&2; exit 2 ;;
    esac
    case "$RUNTIME_PUBLISH_FAILURE" in
      error|term) ;;
      *) printf '%s\n' "unknown runtime publication failure mode" >&2; exit 2 ;;
    esac
  fi
fi

# An explicit raw base is a host-authorized private mirror/test seam. Normal
# installs resolve the selected ref to an immutable commit just before the
# download, so migration never promotes bytes from the legacy writable tree.
RAW_BASE_OVERRIDE="${JHT_RAW_BASE:-}"

attested_raw_base() {
  # Test channel: the commit is given, already immutable; no API lookup, and
  # no JHT_RAW_BASE from the environment can move it to other files.
  if [ "$TEST_CHANNEL" -eq 1 ]; then
    printf 'https://raw.githubusercontent.com/leopu00/job-hunter-team/%s\n' "$SOURCE_SHA"
    return 0
  fi
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
# tx "english" "italiano": the sentence in the person's language (installer_person_lang). Only English and Italian are written;
# every other language reads English, as in the wrapper.
tx()    { if [ "$(installer_person_lang)" = it ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }

jht_machine_output() {
  case "${JHT_MACHINE_OUTPUT:-}" in
    1) return 0 ;;
    0) return 1 ;;
  esac
  [ ! -t 1 ]
}

# `JHT_ERROR <code>` on stderr, before the exit of its own: a marker for the desktop app (which reads the installer through a pipe
# and asks for it with JHT_MACHINE_OUTPUT=1), like JHT_PHASE. A person at a terminal reads only the sentence under it.
jht_error_marker() {
  if jht_machine_output; then printf 'JHT_ERROR %s\n' "$1" >&2; fi
}

# The code in front of a refusal's sentence («team_running: …») is for the app too, which keeps the line as the cause: a person at
# a terminal reads the sentence alone.
# Asked inside $( ): stdout there is the substitution's pipe, so whether a person reads is the answer stdout gave when the installer
# started (JHT_STDOUT_AT_START, set below the functions); JHT_MACHINE_OUTPUT still decides first.
jht_code_prefix() {
  case "${JHT_MACHINE_OUTPUT:-}" in
    1) printf '%s: ' "$1"; return 0 ;;
    0) return 0 ;;
  esac
  [ "${JHT_STDOUT_AT_START:-pipe}" = terminal ] || printf '%s: ' "$1"
}
if [ -t 1 ]; then JHT_STDOUT_AT_START=terminal; else JHT_STDOUT_AT_START=pipe; fi

jht_phase() {
  case "$1" in
    homebrew_check|podman_install|compose_install|machine_create|image_pull|machine_start) ;;
    *) fail "Unknown installer phase: $1" ;;
  esac
  # The marker is for the desktop app, which reads the installer through a pipe. A person at a terminal gets the
  # human lines (✓ ▸) only. JHT_MACHINE_OUTPUT=1 forces the marker, =0 forbids it, unset: only when stdout is not a terminal.
  if jht_machine_output; then printf 'JHT_PHASE %s\n' "$1"; [ "${JHT_PHASE_TIMES:-}" != 1 ] || printf 'JHT_TIME %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"; fi
}

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
    if [ "${OS:-}" = "linux" ]; then
      printf "  ${DIM}%s${RESET}${BOLD}Container (Podman rootless)${RESET}\n" "$(tx "mode:    " "modo:     ")"
    else
      printf "  ${DIM}%s${RESET}${BOLD}Container (Podman)${RESET}\n" "$(tx "mode:    " "modo:     ")"
    fi
    printf "  ${DIM}%s%s${RESET}\n" "$(tx "image:   " "immagine: ")" "$IMAGE"
    printf "  ${DIM}%s%s${RESET}\n" "$(tx "branch:  " "ramo:     ")" "$BRANCH"
    printf "  ${DIM}%s%s${RESET}\n" "$(tx "runtime: " "runtime:  ")" "$RUNTIME_DIR"
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
# Host scripts of the runtime, besides the wrapper and host-setup.sh (same list as RUNTIME_HELPERS in jht-wrapper.sh).
RUNTIME_HELPERS="jht-integration.sh jht-tools.sh"
TOTAL_STEPS_NATIVE=6

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

# ── The runtime already chosen ────────────────────────────────────────────
# The marker container-runtime says which engine holds this computer's container and volumes. Since 0.4 the engine is Podman: a
# computer that ran JHT on Docker (Colima, Docker Desktop or Docker Engine: marker «docker», or a completed install with
# no marker) is stopped before anything changes, and told what stays and what must be given again. What stays is in folders of
# the computer: ~/.jht (configuration, database, profile) and ~/Documents/Job Hunter Team (CVs, outputs). What does not is in the
# old engine's volumes: the API key kept by the setup and the provider tools (jht-deps), the mail password and the broker state,
# the Telegram tokens. Moving volumes between engines is not available: the way is `jht uninstall --confirm` (it keeps the two
# folders) and this installer again, then `jht setup` with the key. A line `JHT_ERROR runtime_change_requires_migration` on stderr,
# then exit 85 (the Linux Podman codes are 88-97).
RUNTIME_CHANGE_REQUIRES_MIGRATION_EXIT=85
# The person's language for the lines of the installer, by the rule of the CLI: the choice saved by an earlier setup or the picker
# (~/.jht/i18n-prefs.json), then JHT_LANG as set in this terminal, then the one in ~/.jht/host.env, then the system's (the first of
# LC_ALL, LC_MESSAGES, LANG that is set decides). Files are read as data, only a known value. Italian or English; any other is English.
installer_person_lang() {
  local prefs="$HOME/.jht/i18n-prefs.json" env_file="$HOME/.jht/host.env" value="" locale name
  if [ -f "$prefs" ] && [ ! -L "$prefs" ] && [ "$(wc -c < "$prefs" 2>/dev/null || echo 9999)" -le 4096 ]; then
    value="$(tr -d '\r\n' < "$prefs" 2>/dev/null | sed -n 's/.*"locale"[[:space:]]*:[[:space:]]*"\([a-z][a-z]\)".*/\1/p' | head -n 1)"
  fi
  if [ -z "$value" ]; then
    case "${JHT_LANG:-}" in en|it|hu|es|de|fr|pt) value="$JHT_LANG" ;; esac
  fi
  if [ -z "$value" ] && [ -f "$env_file" ] && [ ! -L "$env_file" ]; then
    value="$(grep -E '^JHT_LANG=[a-z]{2}$' "$env_file" 2>/dev/null | tail -n 1 | cut -d= -f2)"
  fi
  if [ -z "$value" ]; then
    for name in LC_ALL LC_MESSAGES LANG; do
      locale="${!name:-}"
      [ -n "$locale" ] || continue
      value="${locale%%[_.@-]*}"
      break
    done
  fi
  case "$value" in it) printf 'it\n' ;; *) printf 'en\n' ;; esac
}

# The Colima profile the JHT installer started, from its marker in the runtime (a real file: 1st line «colima», 2nd the profile).
jht_started_colima_profile() {
  local marker="$RUNTIME_DIR/colima-started" profile
  [ -f "$marker" ] && [ ! -L "$marker" ] || return 1
  [ "$(head -c 64 "$marker" 2>/dev/null | sed -n '1p' | tr -d '\r')" = colima ] || return 1
  profile="$(head -c 64 "$marker" 2>/dev/null | sed -n '2p' | tr -d '\r')"
  case "$profile" in ''|-*|*[!A-Za-z0-9_.-]*) return 1 ;; esac
  printf '%s\n' "$profile"
}

# The jht this install put on the computer has no `uninstall` (installs older than 09/10): its file is there and does not have it.
installed_jht_lacks_uninstall() {
  local jht="$BIN_DIR/jht"
  [ -f "$jht" ] && [ ! -L "$jht" ] || return 1
  ! grep -Fq 'jht_uninstall()' "$jht" 2>/dev/null
}

keep_chosen_runtime() {
  [ -n "${OS:-}" ] || detect_os
  [ "$OS" = "macos" ] || [ "$OS" = "linux" ] || return 0
  local marker="$RUNTIME_DIR/container-runtime" current
  if [ -e "$marker" ] || [ -L "$marker" ]; then
    [ -f "$marker" ] && [ ! -L "$marker" ] \
      || fail "Unsafe JHT runtime selection marker: $marker"
    current="$(tr -d '\r\n' < "$marker")"
    case "$current" in docker|podman) ;; *) fail "Invalid JHT runtime selection marker" ;; esac
  elif [ -e "$RUNTIME_DIR/.runtime-integrity" ] || [ -L "$RUNTIME_DIR/.runtime-integrity" ]; then
    # A completed install without the marker: the Docker path of Linux never wrote it, nor did a Mac before the marker.
    current="docker"
  else
    return 0
  fi
  [ "$current" = "podman" ] && return 0
  local lang profile colima_line="" uninstall_it uninstall_en wrapper_url
  lang="$(installer_person_lang)"
  # The jht of an install older than 09/10 (0.3.9 and before) has no `uninstall`: on it the command reaches the CLI inside the
  # container, which does not know it, and nothing is removed. Then the first step is the uninstall of this release's wrapper, from
  # the place the installer downloads it from (the commit of the test channel, or the release branch), saved in a new private file
  # (mktemp: never a fixed name in the shared /tmp, which another user could create first), run once and deleted. No network here:
  # the refusal stays before any I/O.
  uninstall_it="«jht uninstall --confirm» (tiene quelle due cartelle)"
  uninstall_en="run «jht uninstall --confirm» (it keeps those two folders)"
  if installed_jht_lacks_uninstall; then
    local ref="$BRANCH"
    [ "$TEST_CHANNEL" -eq 1 ] && ref="$SOURCE_SHA"
    # Pasted by the person into a shell: only the characters of a branch or a commit, else the release branch.
    case "$ref" in ''|-*|*[!A-Za-z0-9._/-]*|*..*) ref="production" ;; esac
    wrapper_url="https://raw.githubusercontent.com/leopu00/job-hunter-team/$ref/scripts/jht-wrapper.sh"
    uninstall_it="il tuo comando jht e' di una versione che non sa disinstallarsi, quindi usa quello di questa versione: «f=\"\$(mktemp)\" && curl -fsSL '$wrapper_url' -o \"\$f\" && bash \"\$f\" uninstall --confirm; rm -f \"\$f\"» (toglie il JHT su Docker e il vecchio comando jht, tiene quelle due cartelle)"
    uninstall_en="your jht command is from a version that cannot uninstall itself, so use the one of this version: «f=\"\$(mktemp)\" && curl -fsSL '$wrapper_url' -o \"\$f\" && bash \"\$f\" uninstall --confirm; rm -f \"\$f\"» (it removes the JHT on Docker and the old jht command, and keeps those two folders)"
  fi
  # The Colima virtual machine stays on the disk, stopped, after the move (up to 100 GiB). Name only the profile JHT made: the one of
  # the marker of the installer that started it (1st line «colima», 2nd the profile); an install older than the marker started the
  # «default» profile, which is named only if it is there, and only for a person who installed Colima for JHT alone.
  if profile="$(jht_started_colima_profile)"; then
    if [ "$lang" = it ]; then
      colima_line=" Dopo la disinstallazione la macchina virtuale Colima che aveva creato JHT (profilo $profile) resta spenta sul disco: se non la usi per altro, toglila con «colima delete -p $profile» per liberare lo spazio."
    else
      colima_line=" After the uninstall the Colima virtual machine JHT created (profile $profile) stays on the disk, stopped: if you use it for nothing else, remove it with «colima delete -p $profile» to free the space."
    fi
  elif [ "$OS" = macos ] && [ -d "$HOME/.colima/default" ] && [ ! -L "$HOME/.colima/default" ]; then
    if [ "$lang" = it ]; then
      colima_line=" Se Colima l'avevi installata solo per JHT, dopo la disinstallazione la sua macchina virtuale (profilo default, quello che accendeva l'installer di JHT) resta spenta sul disco: toglila con «colima delete -p default» per liberare lo spazio. Se usi Colima per altro, lasciala."
    else
      colima_line=" If you installed Colima only for JHT, after the uninstall its virtual machine (profile default, the one the JHT installer started) stays on the disk, stopped: remove it with «colima delete -p default» to free the space. If you use Colima for other things, leave it."
    fi
  fi
  jht_error_marker runtime_change_requires_migration
  if [ "$lang" = it ]; then
    printf "  ${RED}✗${RESET} %s%s\n" "$(jht_code_prefix runtime_change_requires_migration)" "questo computer fa girare JHT su Docker (Colima, Docker Desktop o Docker Engine). Dalla 0.4 JHT gira solo su Podman, e non e' stato cambiato niente. I tuoi dati restano: ~/.jht (configurazione, database, profilo) e ~/Documents/Job Hunter Team (CV, risultati) sono cartelle di questo computer. Resta invece nei volumi di Docker, e va ridato: la chiave API salvata dal setup, la password della posta, i token di Telegram. Per passare a Podman: $uninstall_it, rilancia questo installer, poi «jht setup» con la tua chiave API.$colima_line" >&2
  else
    printf "  ${RED}✗${RESET} %s%s\n" "$(jht_code_prefix runtime_change_requires_migration)" "this computer runs JHT on Docker (Colima, Docker Desktop or Docker Engine). Since 0.4 JHT runs only on Podman, and nothing was changed. Your data stays: ~/.jht (configuration, database, profile) and ~/Documents/Job Hunter Team (CVs, outputs) are folders of this computer. What stays behind in Docker's volumes and has to be given again: the API key kept by the setup, the mail password, the Telegram tokens. To move to Podman: $uninstall_en, run this installer again, then «jht setup» with your API key.$colima_line" >&2
  fi
  exit "$RUNTIME_CHANGE_REQUIRES_MIGRATION_EXIT"
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
  step 1 "$total" "$(tx "System detection" "Rilevamento del sistema")"
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

# ── Podman rootless on Linux (--runtime podman) ───────────────────────────
# The Mac's Podman runs in a machine; on Linux Podman is native and rootless,
# for a user that is not root. On a server as bought (an ordinary user with
# sudo and no password) it sets Podman up itself, never Docker: the packages,
# the subordinate uid/gid range, linger. Only that user's sudo is used, with
# -n so that it never waits for a password. What it cannot do leaves with a
# code of its own, so the app can tell the administrator what to do: a line
# `JHT_ERROR <code>` on stderr (for the app only, see jht_error_marker), then the exit code of the table below.
#   88 podman_install_failed      89 podman_sudo_required
#   90 podman_missing             91 podman_rootful_refused
#   92 podman_compose_missing     93 podman_version_unsupported
#   94 podman_linger_missing      95 podman_runtime_dir_missing
#   96 podman_subuid_missing      97 podman_rootless_unavailable
# The lowest versions the Linux wrapper is known to need. Only the Mac and
# Windows runtimes keep the one exact pair.
PODMAN_MIN_VERSION="5.0.0"
PODMAN_COMPOSE_MIN_VERSION="1.1.0"

podman_machine_mode() { [ "${OS:-}" = "macos" ] && [ "$RUNTIME_CHOICE" = "podman" ]; }
podman_native_mode()  { [ "${OS:-}" = "linux" ] && [ "$RUNTIME_CHOICE" = "podman" ]; }

podman_refuse() {
  jht_error_marker "$1"
  printf "  ${RED}✗${RESET} %s%s\n" "$(jht_code_prefix "$1")" "$3" >&2
  exit "$2"
}

# On the Mac the JHT machine runs Podman of the 6.1 series from 6.1.3 (Homebrew moves the patch: 6.1.4 on 13/11), never 6.2 or later,
# with podman-compose 1.6.0 exactly: the pair the labels and the attestation were measured with. The wrapper has the same rule.
PODMAN_MAC_SERIES="6.1"
PODMAN_MAC_MIN_PATCH=3
PODMAN_COMPOSE_MAC_VERSION="1.6.0"
podman_mac_version_supported() {
  local version="$1" major minor patch rest
  case "$version" in ''|*[!0-9.]*) return 1 ;; esac
  IFS=. read -r major minor patch rest <<EOF
$version
EOF
  [ -z "$rest" ] && [ -n "$patch" ] || return 1
  [ "$major.$minor" = "$PODMAN_MAC_SERIES" ] && [ "$((10#$patch))" -ge "$PODMAN_MAC_MIN_PATCH" ]
}

# version_at_least HAVE WANT: both are dotted numbers.
version_at_least() {
  local -a have want
  local i a b
  IFS=. read -ra have <<< "$1"
  IFS=. read -ra want <<< "$2"
  for i in 0 1 2; do
    a="${have[$i]:-0}"; b="${want[$i]:-0}"
    [ "$a" -gt "$b" ] && return 0
    [ "$a" -lt "$b" ] && return 1
  done
  return 0
}

# Does the subuid (or subgid) file give this user a range.
podman_subid_range() {
  [ -r "$1" ] || return 1
  awk -F: -v u="$2" -v n="$3" '($1 == u || $1 == n) && $3 + 0 > 0 { found = 1 } END { exit !found }' "$1"
}

# The packages that give Podman rootless, by package manager.
podman_packages_missing() {
  local missing=""
  command -v podman >/dev/null 2>&1 || missing="$missing podman"
  command -v podman-compose >/dev/null 2>&1 || missing="$missing podman-compose"
  { command -v newuidmap >/dev/null 2>&1 && command -v newgidmap >/dev/null 2>&1; } || \
    case "$PKG" in
      dnf) missing="$missing shadow-utils" ;;
      pacman) missing="$missing shadow" ;;
      *) missing="$missing uidmap" ;;
    esac
  printf '%s' "$missing"
}

# First start of a free range: after every range already given to anyone.
podman_free_subid_start() {
  local -a files=()
  local f
  for f in "$1/subuid" "$1/subgid"; do
    [ -r "$f" ] && files+=("$f")
  done
  [ "${#files[@]}" -gt 0 ] || { echo 100000; return 0; }
  awk -F: 'BEGIN { top = 100000 } { end = $2 + $3; if (end > top) top = end } END { print top }' "${files[@]}"
}

# The version the package manager WOULD install (empty when it cannot tell): read before anything is installed, so that a distribution
# whose Podman is too old is said before sudo changes the computer. Only the dotted number: an epoch («5:») and a Debian suffix
# («+ds1-1ubuntu0.2») go.
podman_candidate_version() { # package
  local raw=""
  case "$PKG" in
    apt) raw="$(LC_ALL=C apt-cache policy "$1" 2>/dev/null | awk '$1 == "Candidate:" { print $2; exit }')" ;;
    dnf) raw="$(LC_ALL=C dnf -q list --available "$1" 2>/dev/null | awk -v p="$1" 'index($1, p ".") == 1 { v = $2 } END { print v }')" ;;
    pacman) raw="$(LC_ALL=C pacman -Si "$1" 2>/dev/null | awk -F': ' '$1 ~ /^Version/ { print $2; exit }')" ;;
  esac
  [ "$raw" != "(none)" ] || raw=""
  raw="${raw#*:}"
  printf '%s' "$raw" | sed -n 's/^\([0-9][0-9]*\(\.[0-9][0-9]*\)*\).*/\1/p'
}

# Podman 5 or later is what JHT runs on; the distributions that give it (13/11/2026). Said in Italian too when the person reads Italian.
PODMAN_DISTRIBUTIONS_OK="Ubuntu 26.04 LTS, Debian 13, Fedora 43 or later"
podman_refuse_old_candidate() { # package found wanted
  local locale="${JHT_LANG:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}}"
  case "$locale" in it|it_*|it.*) ;; *) locale="" ;; esac
  [ -n "$locale" ] && printf "  %s\n" "Questa distribuzione installerebbe $1 $2, ma Job Hunter Team 0.4.0 vuole $1 $3 o successivo: non ho installato niente. Distribuzioni che lo danno: Ubuntu 26.04 LTS, Debian 13, Fedora 43 o successive." >&2
  podman_refuse podman_version_unsupported 93 "this distribution would install $1 $2, and Job Hunter Team 0.4.0 needs $1 $3 or later: nothing was installed. Distributions that give it: $PODMAN_DISTRIBUTIONS_OK."
}

# Each of podman and podman-compose that is about to be installed: its candidate is the minimum or more, or nothing is installed.
# A candidate that cannot be read changes nothing: the check after the install still holds.
podman_check_candidates() { # missing packages
  local candidate
  case " $1 " in *" podman "*)
    candidate="$(podman_candidate_version podman)"
    [ -z "$candidate" ] || version_at_least "$candidate" "$PODMAN_MIN_VERSION" \
      || podman_refuse_old_candidate podman "$candidate" "$PODMAN_MIN_VERSION" ;;
  esac
  case " $1 " in *" podman-compose "*)
    candidate="$(podman_candidate_version podman-compose)"
    [ -z "$candidate" ] || version_at_least "$candidate" "$PODMAN_COMPOSE_MIN_VERSION" \
      || podman_refuse_old_candidate podman-compose "$candidate" "$PODMAN_COMPOSE_MIN_VERSION" ;;
  esac
}

# Sets up what is missing for Podman rootless with the user's own sudo: the
# packages, the subuid/subgid range (then `podman system migrate`) and linger.
# Anything already there is left alone, and sudo is not even asked for then.
provision_podman_linux() {
  local uid="$1" user="$2" etc="$3" run_user="$4" missing="" need_subuid=0 need_subgid=0 need_linger=0
  local start end i apt_err
  missing="$(podman_packages_missing)"
  podman_subid_range "$etc/subuid" "$user" "$uid" || need_subuid=1
  podman_subid_range "$etc/subgid" "$user" "$uid" || need_subgid=1
  if command -v loginctl >/dev/null 2>&1 \
      && ! loginctl show-user "$user" -p Linger 2>/dev/null | grep -qx 'Linger=yes'; then
    need_linger=1
  fi
  if [ -z "$missing" ] && [ "$need_subuid$need_subgid$need_linger" = "000" ]; then
    return 0
  fi
  command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1 \
    || podman_refuse podman_sudo_required 89 "Podman needs a setup that only an administrator can do (missing:${missing:- the subuid range or linger}), and sudo for $user is not available without a password. Ask the administrator of this server to allow $user sudo without a password, or to run, as root: apt install podman podman-compose uidmap; loginctl enable-linger $user"
  if [ -n "$missing" ]; then
    info "$(tx "Installing$missing with sudo (Podman rootless; Docker is not installed)..." "Installo$missing con sudo (Podman rootless; Docker non viene installato)...")"
    case "$PKG" in
      apt)
        # A server just bought runs unattended-upgrades, which holds the dpkg
        # lock for minutes: wait for it (apt-get gives up at once otherwise).
        sudo -n apt-get -o DPkg::Lock::Timeout=180 update -qq >/dev/null 2>&1 || warn "$(tx "apt-get update failed: trying the install anyway." "apt-get update non e' riuscito: provo comunque a installare.")"
        podman_check_candidates "$missing"
        # --no-remove: Podman never takes the place of anything. On a computer with Docker from Docker's own repository,
        # containerd.io conflicts with runc, and `install -y` alone would have removed it to make room (Docker broken).
        # apt then stops before changing anything, and the person is told what it wanted and what to run.
        if ! apt_err="$(sudo -n env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=180 install -y --no-remove $missing 2>&1 >/dev/null)"; then
          case "$apt_err" in
            *"remove is disabled"*|*"Packages need to be removed"*)
              podman_refuse podman_install_failed 88 "installing$missing would REMOVE other packages of this computer (often containerd.io, Docker's): nothing was changed. To see which, run: sudo apt-get -s install$missing. Install Podman yourself in a way that keeps them (or decide to remove them), then run this installer again." ;;
            *) podman_refuse podman_install_failed 88 "apt-get install$missing failed. To see why, run: sudo apt-get install$missing" ;;
          esac
        fi
        ;;
      dnf)
        podman_check_candidates "$missing"
        # dnf never removes a package to install one unless --allowerasing is given: it stops on the conflict.
        sudo -n dnf install -y $missing >/dev/null \
          || podman_refuse podman_install_failed 88 "dnf install$missing failed (dnf removes nothing: a conflict with an installed package stops it). To see why, run: sudo dnf install$missing"
        ;;
      pacman)
        podman_check_candidates "$missing"
        # --noconfirm answers the default, which is «no» to removing a conflicting package: pacman stops.
        sudo -n pacman -S --noconfirm --needed $missing >/dev/null \
          || podman_refuse podman_install_failed 88 "pacman -S$missing failed (nothing was removed). To see why, run: sudo pacman -S$missing"
        ;;
      *) podman_refuse podman_install_failed 88 "no known package manager (apt, dnf, pacman) to install:$missing" ;;
    esac
    hash -r 2>/dev/null || true
    ok "$(tx "Installed:$missing" "Installato:$missing")"
  fi
  if [ "$need_subuid$need_subgid" != "00" ]; then
    start="$(podman_free_subid_start "$etc")"
    end=$((start + 65535))
    info "$(tx "Giving $user the subordinate uid/gid range $start-$end..." "Assegno a $user l'intervallo di uid/gid subordinati $start-$end...")"
    {
      if [ "$need_subuid" = 1 ] && [ "$need_subgid" = 1 ]; then
        sudo -n usermod --add-subuids "$start-$end" --add-subgids "$start-$end" "$user"
      elif [ "$need_subuid" = 1 ]; then
        sudo -n usermod --add-subuids "$start-$end" "$user"
      else
        sudo -n usermod --add-subgids "$start-$end" "$user"
      fi
    } || podman_refuse podman_subuid_missing 96 "usermod could not add the subordinate range ($start-$end) for $user."
    if command -v podman >/dev/null 2>&1; then podman system migrate >/dev/null 2>&1 || true; fi
    ok "$(tx "subuid/subgid range $start-$end for $user" "intervallo subuid/subgid $start-$end per $user")"
  fi
  if [ "$need_linger" = 1 ]; then
    info "$(tx "Enabling linger for $user..." "Attivo il linger per $user...")"
    sudo -n loginctl enable-linger "$user" \
      || podman_refuse podman_linger_missing 94 "loginctl enable-linger $user failed."
    # The user manager starts a moment later: the runtime directory follows it.
    for i in 1 2 3 4 5 6 7 8 9 10; do
      [ -d "$run_user" ] && break
      sleep 1
    done
    ok "$(tx "linger enabled for $user" "linger attivo per $user")"
  fi
}

check_podman_linux() {
  step 2 "$TOTAL_STEPS_DOCKER" "$(tx "Container runtime (Podman rootless)" "Motore dei container (Podman rootless)")"
  [ "$OS" = "linux" ] \
    || podman_refuse podman_unsupported_host 1 "--runtime podman is for Linux and macOS; this system is $OS."
  # Podman on Linux answers for this user unless something turns its remote
  # mode on: CONTAINER_HOST or CONTAINER_CONNECTION do, a default system
  # connection alone does not. The wrapper unsets both too, so every check
  # below asks the Podman the team will run on.
  unset CONTAINER_HOST CONTAINER_CONNECTION
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would install with sudo -n what is missing of: podman podman-compose uidmap (never Docker)\n"
    printf "  ${DIM}[dry-run]${RESET} would give the user a subuid/subgid range and enable linger if missing\n"
    printf "  ${DIM}[dry-run]${RESET} would require: not root, podman info Rootless=true, podman >= %s, podman-compose >= %s\n" "$PODMAN_MIN_VERSION" "$PODMAN_COMPOSE_MIN_VERSION"
    return 0
  fi
  local uid user etc xdg run_user rootless have_podman have_compose
  uid="$(id -u)"; user="$(id -un)"; etc="${JHT_ETC_DIR:-/etc}"
  run_user="${JHT_RUN_USER_DIR:-/run/user}/$uid"
  [ "$uid" -ne 0 ] \
    || podman_refuse podman_rootful_refused 91 "JHT runs on Podman rootless, as a user that is not root. Sign in as that user and run the install again."
  provision_podman_linux "$uid" "$user" "$etc" "$run_user"
  command -v podman >/dev/null 2>&1 \
    || podman_refuse podman_missing 90 "podman is still not there after the install. Ask the administrator of this server to run, as root: apt install podman"
  command -v podman-compose >/dev/null 2>&1 \
    || podman_refuse podman_compose_missing 92 "podman-compose is not available from this system's packages. Ask the administrator of this server to install it, as root: apt install podman-compose"
  # A session without a user manager has no XDG_RUNTIME_DIR: the directory
  # linger has just started is the one Podman wants.
  xdg="${XDG_RUNTIME_DIR:-}"
  if [ -z "$xdg" ] || [ ! -d "$xdg" ]; then
    xdg="$run_user"
    if [ -d "$xdg" ]; then
      export XDG_RUNTIME_DIR="$xdg"
      [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] || [ ! -S "$xdg/bus" ] || export DBUS_SESSION_BUS_ADDRESS="unix:path=$xdg/bus"
    fi
  fi
  { [ -d "$xdg" ] && [ -w "$xdg" ]; } \
    || podman_refuse podman_runtime_dir_missing 95 "there is no runtime directory for this user ($xdg): the session has no user manager. Sign in again, or ask the administrator to run, as root: loginctl enable-linger $user"
  if command -v loginctl >/dev/null 2>&1; then
    loginctl show-user "$user" -p Linger 2>/dev/null | grep -qx 'Linger=yes' \
      || podman_refuse podman_linger_missing 94 "the containers of $user would stop when the session ends. Ask the administrator of this server to run, as root: loginctl enable-linger $user"
  else
    warn "$(tx "loginctl not found: linger was not checked." "loginctl non trovato: il linger non e' stato controllato.")"
  fi
  { podman_subid_range "$etc/subuid" "$user" "$uid" && podman_subid_range "$etc/subgid" "$user" "$uid"; } \
    || podman_refuse podman_subuid_missing 96 "$user has no subordinate uid/gid range in $etc/subuid and $etc/subgid. Ask the administrator of this server to run, as root: usermod --add-subuids 100000-165535 --add-subgids 100000-165535 $user"
  rootless="$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null)" \
    || podman_refuse podman_rootless_unavailable 97 "'podman info' fails for $user, so the rootless storage or runtime is not ready. Run it by hand to see why."
  [ "$rootless" = "true" ] \
    || podman_refuse podman_rootful_refused 91 "podman answers as rootful for $user (Rootless=$rootless): JHT needs Podman rootless."
  have_podman="$(podman --version 2>/dev/null | awk '{ print $NF }' | sed 's/[^0-9.].*$//')"
  # awk reads every line: exiting at the first would close the pipe while podman-compose still
  # writes its "podman version" line, and under pipefail that SIGPIPE (141) stops the install.
  have_compose="$(podman-compose --version 2>/dev/null | awk '/^podman-compose version/ && v == "" { v = $3 } END { print v }' | sed 's/[^0-9.].*$//')"
  { [ -n "$have_podman" ] && version_at_least "$have_podman" "$PODMAN_MIN_VERSION"; } \
    || podman_refuse podman_version_unsupported 93 "podman ${have_podman:-of unknown version} is older than $PODMAN_MIN_VERSION. Ask the administrator of this server for a newer podman."
  { [ -n "$have_compose" ] && version_at_least "$have_compose" "$PODMAN_COMPOSE_MIN_VERSION"; } \
    || podman_refuse podman_version_unsupported 93 "podman-compose ${have_compose:-of unknown version} is older than $PODMAN_COMPOSE_MIN_VERSION. Ask the administrator of this server for a newer podman-compose."
  ok "$(tx "Podman rootless $have_podman + podman-compose $have_compose for $user" "Podman rootless $have_podman + podman-compose $have_compose per $user")"
}

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
  # Podman and its Compose provider (podman-compose) come from Homebrew: the official Podman package has no podman-compose. Stop
  # here, before anything is written, and say what to do.
  if [ "$(installer_person_lang)" = it ]; then
    printf '%s\n' "homebrew_missing: JHT installa Podman con Homebrew, che su questo Mac non c'e'. Non e' stato cambiato niente. Installa Homebrew da https://brew.sh (un comando nel Terminale; chiede la password del Mac), apri una nuova finestra del Terminale e rilancia questo installer." >&2
  else
    printf '%s\n' 'homebrew_missing: JHT installs Podman with Homebrew, which is not on this Mac. Nothing was changed. Install Homebrew from https://brew.sh (one command in Terminal; it asks for your Mac password), open a new Terminal window and run this installer again.' >&2
  fi
  exit 80
}



running_podman_machine() {
  local podman_bin="$1" name running
  "$podman_bin" machine list --format '{{.Name}} {{.Running}}' 2>/dev/null |
    while IFS=' ' read -r name running _; do
      case "$name" in
        ''|*[!A-Za-z0-9_.-]*) continue ;;
      esac
      if [ "$running" = true ] && [ "$name" != "$PODMAN_MACHINE_NAME" ]; then
        printf '%s\n' "$name"
        break
      fi
    done
}

report_podman_machine_conflict() {
  local podman_bin="$1" command_error="$2" running
  printf '%s\n' "$command_error" | grep -Fqi 'only one VM can be active at a time' || return 1
  running="$(running_podman_machine "$podman_bin")"
  # the marker is for the desktop app (machine output); a person at a terminal reads only the line below
  if [ -n "$running" ] && jht_machine_output; then printf 'JHT_OTHER_MACHINE %s\n' "$running"; fi
  # The line in the person's language (the installer has no err(): it once stopped here with «err: command not found»). It only
  # says the command: the installer never stops a machine of the person.
  local which_it="un'altra macchina Podman e' accesa (trovala con 'podman machine list')" which_en="another Podman machine is running (find it with 'podman machine list')"
  [ -n "$running" ] && which_it="un'altra macchina Podman, $running, e' accesa" which_en="another Podman machine, $running, is running"
  if [ "$(installer_person_lang)" = it ]; then
    printf "  ${RED}✗${RESET} %s%s\n" "$(jht_code_prefix podman_other_machine_running)" "$which_it, e sul Mac ne puo' girare una sola alla volta. Spegnila con 'podman machine stop ${running:-<nome>}' (o dall'app con cui la usi) e rilancia l'installer: Job Hunter Team non la spegne mai al posto tuo, e dopo potrai riaccenderla." >&2
  else
    printf "  ${RED}✗${RESET} %s%s\n" "$(jht_code_prefix podman_other_machine_running)" "$which_en, and a Mac runs only one at a time. Stop it with 'podman machine stop ${running:-<name>}' (or from the app you use it with) and run the installer again: Job Hunter Team never stops it for you, and you can start it again afterwards." >&2
  fi
  return 0
}

enable_podman_trim_timer() {
  local podman_bin="$1"
  "$podman_bin" machine ssh "$PODMAN_MACHINE_NAME" \
    sudo systemctl enable --now fstrim.timer >/dev/null 2>&1
}

install_podman_macos() {
  # Percorso non distruttivo: non ferma e non rimuove un Colima che c'e' gia'. La macchina e la
  # connessione hanno un nome JHT dedicato; lo shim pubblicato piu' avanti usa
  # sempre quella connessione senza cambiare il default Podman dell'utente.
  unset CONTAINER_CONNECTION
  jht_phase homebrew_check
  install_brew_if_missing
  if ! command -v podman &>/dev/null; then
    jht_phase podman_install
    info "$(tx "Installing Podman CLI..." "Installo la CLI di Podman...")"
    run brew install podman || fail "Podman installation failed"
  else
    ok "$(tx "podman already installed" "podman gia' installato")"
  fi
  if ! command -v podman-compose &>/dev/null; then
    jht_phase compose_install
    info "$(tx "Installing the Podman Compose provider..." "Installo il provider di Podman Compose...")"
    run brew install podman-compose || fail "podman-compose installation failed"
  else
    ok "$(tx "podman-compose already installed" "podman-compose gia' installato")"
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    jht_phase machine_create
    jht_phase machine_start
    printf "  ${DIM}[dry-run]${RESET} would initialize/start Podman machine: %s (%s CPU, %s MiB RAM, %s GiB disk)\n" \
      "$PODMAN_MACHINE_NAME" "$PODMAN_MACHINE_CPUS" "$PODMAN_MACHINE_MEMORY_MIB" "$PODMAN_MACHINE_DISK_GIB"
    jht_phase image_pull
    printf "  ${DIM}[dry-run]${RESET} would pull image: %s\n" "$IMAGE"
    printf "  ${DIM}[dry-run]${RESET} would leave Colima installed and untouched\n"
    return 0
  fi
  case "$PODMAN_MACHINE_NAME" in
    ''|*[!A-Za-z0-9_.-]*) fail "Invalid JHT Podman machine name: $PODMAN_MACHINE_NAME" ;;
  esac
  local podman_bin compose_bin compose_version podman_version
  podman_bin="$(command -v podman)" \
    || fail "Podman CLI disappeared after installation."
  compose_bin="$(command -v podman-compose)" \
    || fail "Podman Compose provider disappeared after installation."
  podman_version="$("$podman_bin" --version 2>/dev/null)" || podman_version=""
  podman_version="${podman_version#podman version }"
  podman_mac_version_supported "$podman_version" \
    || fail "podman_version_unsupported: JHT on a Mac needs Podman $PODMAN_MAC_SERIES.$PODMAN_MAC_MIN_PATCH or a later $PODMAN_MAC_SERIES.x (not 6.2 or later); this Mac has ${podman_version:-a podman that does not say its version}. If Homebrew moved Podman past the $PODMAN_MAC_SERIES series, get the JHT installer of today again (it says which series it supports); nothing of JHT was installed."
  compose_version="$(CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME" \
    "$compose_bin" --version 2>/dev/null)" \
    || fail "Podman Compose provider version probe failed."
  printf '%s\n' "$compose_version" | grep -Fqx "podman-compose version $PODMAN_COMPOSE_MAC_VERSION" \
    || fail "podman_compose_version_unsupported: JHT on a Mac needs podman-compose $PODMAN_COMPOSE_MAC_VERSION; this Mac has $(printf '%s\n' "$compose_version" | sed -n 's/^podman-compose version //p' | head -n 1). Run «brew upgrade podman-compose» (or «brew install podman-compose»), then this installer again."
  # The only Mac folders the JHT machine may see are the two the compose
  # file binds. Without --volume, `podman machine init` on macOS mounts
  # /Users (every user's home), /private, /var/folders and
  # ~/.config/containers (measured on 08/10/2026). A declared folder that
  # does not exist stops the machine from booting, so both are created
  # before init and before every start.
  local jht_home_dir="$HOME/.jht" jht_docs_dir="$HOME/Documents/Job Hunter Team"
  if [ ! -d "$jht_home_dir" ]; then
    mkdir -p "$jht_home_dir" && chmod 700 "$jht_home_dir" \
      || fail "Cannot create $jht_home_dir for the Podman machine."
  fi
  mkdir -p "$jht_docs_dir" || fail "Cannot create $jht_docs_dir for the Podman machine."
  if podman machine inspect "$PODMAN_MACHINE_NAME" &>/dev/null; then
    local machine_resources
    machine_resources="$("$podman_bin" machine inspect \
      --format '{{.Resources.CPUs}} {{.Resources.Memory}} {{.Resources.DiskSize}}' \
      "$PODMAN_MACHINE_NAME" 2>/dev/null || true)"
    if [ "$machine_resources" != "$PODMAN_MACHINE_CPUS $PODMAN_MACHINE_MEMORY_MIB $PODMAN_MACHINE_DISK_GIB" ]; then
      warn "$(tx "Existing Podman machine '$PODMAN_MACHINE_NAME' has resources '${machine_resources:-unknown}'; JHT recommends $PODMAN_MACHINE_CPUS CPU, $PODMAN_MACHINE_MEMORY_MIB MiB RAM and $PODMAN_MACHINE_DISK_GIB GiB disk. The existing machine was not changed." "La macchina Podman '$PODMAN_MACHINE_NAME' che c'e' gia' ha le risorse '${machine_resources:-unknown}'; JHT consiglia $PODMAN_MACHINE_CPUS CPU, $PODMAN_MACHINE_MEMORY_MIB MiB di RAM e $PODMAN_MACHINE_DISK_GIB GiB di disco. La macchina non e' stata cambiata.")"
    fi
    if ! podman --connection "$PODMAN_MACHINE_NAME" info &>/dev/null; then
      jht_phase machine_start
      info "$(tx "Starting Podman machine '$PODMAN_MACHINE_NAME'..." "Avvio la macchina Podman '$PODMAN_MACHINE_NAME'...")"
      local start_error start_status
      start_error="$("$podman_bin" machine start --update-connection=false "$PODMAN_MACHINE_NAME" 2>&1 >/dev/null)" \
        && start_status=0 || start_status=$?
      if [ "$start_status" -ne 0 ]; then
        report_podman_machine_conflict "$podman_bin" "$start_error" && exit 79
        fail "Podman machine start failed; Colima was not changed."
      fi
    else
      ok "$(tx "Podman machine '$PODMAN_MACHINE_NAME' already running" "Macchina Podman '$PODMAN_MACHINE_NAME' gia' accesa")"
    fi
  else
    jht_phase machine_create
    jht_phase machine_start
    info "$(tx "Creating rootless Podman machine '$PODMAN_MACHINE_NAME'..." "Creo la macchina Podman rootless '$PODMAN_MACHINE_NAME'...")"
    local init_error init_status
    init_error="$("$podman_bin" machine init --now --update-connection=false \
      --cpus "$PODMAN_MACHINE_CPUS" \
      --memory "$PODMAN_MACHINE_MEMORY_MIB" \
      --disk-size "$PODMAN_MACHINE_DISK_GIB" \
      --volume "$jht_home_dir:$jht_home_dir" \
      --volume "$jht_docs_dir:$jht_docs_dir" \
      "$PODMAN_MACHINE_NAME" 2>&1 >/dev/null)" && init_status=0 || init_status=$?
    if [ "$init_status" -ne 0 ]; then
      report_podman_machine_conflict "$podman_bin" "$init_error" && exit 79
      fail "Podman machine initialization failed; Colima was not changed."
    fi
    PODMAN_MACHINE_CREATED=1
    PODMAN_MACHINE_CREATED_ID="$("$podman_bin" machine inspect --format '{{.Created}}' "$PODMAN_MACHINE_NAME" 2>/dev/null | head -n 1 || true)"
  fi
  "$podman_bin" --connection "$PODMAN_MACHINE_NAME" info &>/dev/null \
    || fail "Podman machine '$PODMAN_MACHINE_NAME' is not reachable."
  # A team that is running refuses the reinstall: say so before the download of the image (minutes), not after it.
  refuse_running_team
  jht_phase image_pull
  "$podman_bin" --connection "$PODMAN_MACHINE_NAME" pull "$IMAGE" >/dev/null \
    || fail "JHT image download failed: $IMAGE"
  # Fedora CoreOS ships this weekly timer. Enabling the stock unit is
  # idempotent and lets applehv reclaim unused blocks from its sparse .raw;
  # do not start or stop a machine solely for trimming.
  enable_podman_trim_timer "$podman_bin" \
    || warn "$(tx "Podman is ready, but its weekly disk trim timer could not be enabled." "Podman e' pronto, ma il suo timer settimanale che libera il disco non si e' potuto attivare.")"
  ok "$(tx "Podman ready (Colima retained)" "Podman pronto (Colima lasciato com'era)")"
}



install_container_runtime() {
  step 2 "$TOTAL_STEPS_DOCKER" "$(tx "Container runtime" "Motore dei container")"
  case "$OS" in
    macos) install_podman_macos ;;
    linux) check_podman_linux ;;
    # Windows runs JHT with install.ps1 (Podman in WSL, set up from Windows); inside a WSL distribution there is nothing to set up.
    wsl) fail "wsl_not_supported: on Windows, install JHT from PowerShell with install.ps1 (see docs/guides/QUICKSTART.md), not from inside WSL. Nothing was changed." ;;
  esac
}



verify_docker_works() {
  step 3 "$TOTAL_STEPS_DOCKER" "$(tx "Container runtime check" "Verifica del motore dei container")"
  if podman_native_mode; then
    # The check of the step before already ran podman info, rootless.
    [ "$DRY_RUN" -eq 1 ] || ok "$(tx "podman rootless reachable" "podman rootless raggiungibile")"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: podman --connection %s info\n" "$PODMAN_MACHINE_NAME"
    printf "  ${DIM}[dry-run]${RESET} would verify: Podman %s.x (from %s.%s) + podman-compose %s\n" "$PODMAN_MAC_SERIES" "$PODMAN_MAC_SERIES" "$PODMAN_MAC_MIN_PATCH" "$PODMAN_COMPOSE_MAC_VERSION"
    return 0
  fi
  podman --connection "$PODMAN_MACHINE_NAME" info &>/dev/null \
    || fail "The JHT Podman machine is not responding."
  ok "$(tx "Podman machine reachable" "Macchina Podman raggiungibile")"
}

install_podman_adapter() {
  podman_machine_mode || podman_native_mode || return 0
  local podman_bin adapter_bin shim_dest shim_tmp selection_file machine_file
  podman_bin="$(command -v podman)" || fail "podman disappeared from PATH"
  case "$podman_bin" in *"'"*|*$'\n'*) fail "Unsafe Podman executable path: $podman_bin" ;; esac
  if podman_machine_mode; then
    case "$PODMAN_MACHINE_NAME" in
      ''|*[!A-Za-z0-9_.-]*) fail "Invalid JHT Podman machine name: $PODMAN_MACHINE_NAME" ;;
    esac
  fi
  adapter_bin="$RUNTIME_DIR/bin"
  [ ! -L "$adapter_bin" ] || fail "Podman adapter bin path is a symlink: $adapter_bin"
  [ ! -e "$adapter_bin" ] || [ -d "$adapter_bin" ] \
    || fail "Podman adapter bin path is not a directory: $adapter_bin"
  mkdir -p "$adapter_bin"
  chmod 700 "$adapter_bin"
  [ "$(cd -P "$adapter_bin" && pwd -P)" = "$adapter_bin" ] \
    || fail "Podman adapter bin has a non-canonical ancestor: $adapter_bin"
  shim_dest="$adapter_bin/docker"
  if [ -e "$shim_dest" ] || [ -L "$shim_dest" ]; then
    [ -f "$shim_dest" ] && [ ! -L "$shim_dest" ] \
      && grep -Fqx '# JHT_PODMAN_DOCKER_SHIM=1' "$shim_dest" 2>/dev/null \
      || fail "Refusing to overwrite an unsafe or non-JHT executable: $shim_dest"
  fi
  shim_tmp="$(mktemp "$adapter_bin/.docker-podman.XXXXXX")"
  {
    printf '%s\n' '#!/bin/sh' '# JHT_PODMAN_DOCKER_SHIM=1'
    if podman_machine_mode; then
      printf "exec '%s' --connection '%s' \"\$@\"\n" "$podman_bin" "$PODMAN_MACHINE_NAME"
    else
      printf "exec '%s' \"\$@\"\n" "$podman_bin"
    fi
  } > "$shim_tmp"
  chmod 700 "$shim_tmp"
  mv -f "$shim_tmp" "$shim_dest"
  selection_file="$RUNTIME_DIR/container-runtime"
  machine_file="$RUNTIME_DIR/podman-machine"
  printf 'podman\n' > "$selection_file"
  chmod 600 "$selection_file"
  if podman_machine_mode; then
    printf '%s\n' "$PODMAN_MACHINE_NAME" > "$machine_file"
    chmod 600 "$machine_file"
    # The machine this run created is JHT's own and `jht uninstall` removes it whatever its name; one that was already there (adopted)
    # is not marked, and stays. A machine of an earlier run keeps its marker: it is written only on creation.
    if [ "$PODMAN_MACHINE_CREATED" = 1 ]; then
      printf '%s\n' "$PODMAN_MACHINE_NAME" > "$RUNTIME_DIR/podman-machine-created"
      # Second line: when this machine was created. Without it the uninstall cannot tell it from another of the same name: it leaves it.
      [ -z "$PODMAN_MACHINE_CREATED_ID" ] || printf '%s\n' "$PODMAN_MACHINE_CREATED_ID" >> "$RUNTIME_DIR/podman-machine-created"
      chmod 600 "$RUNTIME_DIR/podman-machine-created"
    fi
    ok "$(tx "Private JHT docker shim: $shim_dest (not added to global PATH; Colima untouched)" "Shim docker privato di JHT: $shim_dest (non aggiunto al PATH globale; Colima non toccato)")"
  else
    # Native Linux has no machine: the wrapper refuses a machine file here.
    rm -f "$machine_file"
    ok "$(tx "Private JHT docker shim: $shim_dest (not added to global PATH; rootless Podman, no machine)" "Shim docker privato di JHT: $shim_dest (non aggiunto al PATH globale; Podman rootless, senza macchina)")"
  fi
}

# runtime-tier: a host runtime file attested in an integrity file of its own (.runtime-tier-integrity), NOT in .runtime-integrity: the app
# compares the exact set of keys of that one. Staged for its hash; the file first and its integrity second, so a crash between them
# leaves a tier the wrapper refuses, never a tier it believes.
stage_runtime_tier() {
  local tier_file="$RUNTIME_DIR/runtime-tier"
  TIER_STAGED="" TIER_STAGED_SHA=""
  if [ "$RUNTIME_TIER" != "core" ]; then rm -f "$tier_file" "$RUNTIME_DIR/.runtime-tier-integrity"; return 0; fi
  TIER_STAGED="$(mktemp "$RUNTIME_DIR/.runtime-tier.XXXXXX")"
  printf 'core\n' > "$TIER_STAGED" && chmod 600 "$TIER_STAGED"
  TIER_STAGED_SHA="$({ sha256sum "$TIER_STAGED" 2>/dev/null || shasum -a 256 "$TIER_STAGED"; } | awk '{print $1}')"
}

publish_runtime_tier() {
  [ -n "$TIER_STAGED" ] || return 0
  mv -f "$TIER_STAGED" "$RUNTIME_DIR/runtime-tier" || return 1
  printf 'runtime-tier=%s\n' "$TIER_STAGED_SHA" > "$RUNTIME_DIR/.runtime-tier-integrity.tmp" && chmod 600 "$RUNTIME_DIR/.runtime-tier-integrity.tmp" \
    && mv -f "$RUNTIME_DIR/.runtime-tier-integrity.tmp" "$RUNTIME_DIR/.runtime-tier-integrity" \
    && ok "$(tx "runtime tier: core (the tools come after the welcome)" "livello del runtime: core (gli strumenti arrivano dopo il benvenuto)")"
}

# runtime-extras-image: the image of the tools that come on request, pinned by the test channel (`--extras-image-digest`), in a host runtime
# file attested in an integrity file of its own (.runtime-extras-integrity), NOT in .runtime-integrity (the app compares the exact keys of
# that one). The installer does not pull it: `jht screen on` does, by this digest. File first and integrity second: a crash between them
# leaves a pin the wrapper refuses, never one it believes. Without the option (or outside the test channel) an earlier pin is dropped.
stage_runtime_extras_pin() {
  EXTRAS_STAGED="" EXTRAS_STAGED_SHA=""
  if [ "$TEST_CHANNEL" -ne 1 ] || [ -z "$EXTRAS_IMAGE_DIGEST_OPT" ]; then
    rm -f "$RUNTIME_DIR/runtime-extras-image" "$RUNTIME_DIR/.runtime-extras-integrity"
    return 0
  fi
  EXTRAS_STAGED="$(mktemp "$RUNTIME_DIR/.runtime-extras.XXXXXX")"
  printf 'ghcr.io/leopu00/jht@%s\n' "$EXTRAS_IMAGE_DIGEST_OPT" > "$EXTRAS_STAGED" && chmod 600 "$EXTRAS_STAGED"
  EXTRAS_STAGED_SHA="$({ sha256sum "$EXTRAS_STAGED" 2>/dev/null || shasum -a 256 "$EXTRAS_STAGED"; } | awk '{print $1}')"
}

publish_runtime_extras_pin() {
  [ -n "$EXTRAS_STAGED" ] || return 0
  mv -f "$EXTRAS_STAGED" "$RUNTIME_DIR/runtime-extras-image" || return 1
  printf 'runtime-extras-image=%s\n' "$EXTRAS_STAGED_SHA" > "$RUNTIME_DIR/.runtime-extras-integrity.tmp" && chmod 600 "$RUNTIME_DIR/.runtime-extras-integrity.tmp" \
    && mv -f "$RUNTIME_DIR/.runtime-extras-integrity.tmp" "$RUNTIME_DIR/.runtime-extras-integrity" \
    && ok "$(tx "extras image pinned: ghcr.io/leopu00/jht@$EXTRAS_IMAGE_DIGEST_OPT (pulled when a tool is asked for)" "immagine extras fissata: ghcr.io/leopu00/jht@$EXTRAS_IMAGE_DIGEST_OPT (si scarica quando serve uno strumento)")"
}

download_runtime_files() {
  step 4 "$TOTAL_STEPS_DOCKER" "$(tx "Download wrapper + docker-compose.yml" "Scarico il wrapper e docker-compose.yml")"

  local release_base
  if [ "$DRY_RUN" -eq 1 ] && [ "$TEST_CHANNEL" -eq 0 ]; then
    release_base="${RAW_BASE_OVERRIDE:-https://raw.githubusercontent.com/leopu00/job-hunter-team/$BRANCH}"
  else
    release_base="$(attested_raw_base)" \
      || fail "Cannot resolve branch '$BRANCH' to an immutable release commit."
  fi
  local helper
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
    for helper in $RUNTIME_HELPERS; do
      printf "  ${DIM}[dry-run]${RESET} would download: %s -> %s\n" "$release_base/scripts/$helper" "$RUNTIME_DIR/$helper"
    done
    printf "  ${DIM}[dry-run]${RESET} would execute: chmod +x %s %s\n" "$wrapper_dest" "$hostsetup_dest"
    printf "  ${DIM}[dry-run]${RESET} would publish an attested JHT-only docker→podman shim\n"
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

  info "$(tx "Downloading docker-compose.yml..." "Scarico docker-compose.yml...")"
  if ! curl -fsSL "$compose_url" -o "$compose_tmp"; then
    fail "Download failed: $compose_url. Check your connection and branch ($BRANCH)."
  fi
  grep -Eq '^[[:space:]]*-[[:space:]]*jht-runtime-mask:/jht_home/runtime([[:space:]]|$)' "$compose_tmp" \
    || fail "Downloaded compose does not enforce the protected runtime boundary."
  chmod 600 "$compose_tmp"
  mv -f "$compose_tmp" "$compose_dest"
  ok "compose: $compose_dest"

  info "$(tx "Downloading jht wrapper..." "Scarico il wrapper jht...")"
  if ! curl -fsSL "$wrapper_url" -o "$wrapper_tmp"; then
    fail "Download failed: $wrapper_url. Check your connection and branch ($BRANCH)."
  fi
  bash -n "$wrapper_tmp" \
    && grep -Fqx 'JHT_HOST_RUNTIME_PROTOCOL=1' "$wrapper_tmp" \
    || fail "Downloaded wrapper does not implement the protected runtime protocol."
  chmod 700 "$wrapper_tmp"
  mv -f "$wrapper_tmp" "$wrapper_dest"
  ok "wrapper: $wrapper_dest"

  info "$(tx "Downloading host-setup.sh (VPS/swap preflight)..." "Scarico host-setup.sh (controlli preliminari VPS/swap)...")"
  if ! curl -fsSL "$hostsetup_url" -o "$hostsetup_tmp" \
      || ! bash -n "$hostsetup_tmp" \
      || ! grep -Fqx 'JHT_HOST_SETUP_PROTOCOL=1' "$hostsetup_tmp"; then
    fail "host-setup.sh download or validation failed: $hostsetup_url"
  fi
  chmod 700 "$hostsetup_tmp"
  mv -f "$hostsetup_tmp" "$hostsetup_dest"
  # The host scripts of the runtime that came after host-setup.sh (the wrapper lists the same names in RUNTIME_HELPERS): attested like it.
  local helper_tmp helper_lines=""
  for helper in $RUNTIME_HELPERS; do
    helper_tmp="$(mktemp "$RUNTIME_DIR/.helper.XXXXXX")"
    if ! curl -fsSL "$release_base/scripts/$helper" -o "$helper_tmp" || ! bash -n "$helper_tmp" \
        || ! grep -Fqx '# JHT_RUNTIME_HELPER=1' "$helper_tmp"; then
      rm -f "$helper_tmp"
      fail "$helper download or validation failed: $release_base/scripts/$helper"
    fi
    chmod 700 "$helper_tmp"
    mv -f "$helper_tmp" "$RUNTIME_DIR/$helper"
    helper_lines="$helper_lines$helper=$( { sha256sum "$RUNTIME_DIR/$helper" 2>/dev/null || shasum -a 256 "$RUNTIME_DIR/$helper"; } | awk '{print $1}')"$'\n'
  done
  # Their digests are in a manifest of their own: the desktop app checks the main one key by key.
  printf '%s' "$helper_lines" > "$RUNTIME_DIR/.runtime-helpers.tmp" && chmod 600 "$RUNTIME_DIR/.runtime-helpers.tmp" \
    && mv -f "$RUNTIME_DIR/.runtime-helpers.tmp" "$RUNTIME_DIR/.runtime-helpers" || fail "the digests of the host scripts were not written"
  local selection_source="$RUNTIME_DIR/container-runtime"
  install_podman_adapter
  # The test channel's image, canonical (by digest), for every later `jht up`:
  # host runtime only, outside the container-writable mounts. A production
  # install drops a pin left by an earlier test install.
  local image_pin="$RUNTIME_DIR/runtime-image" image_pin_publish="" image_pin_sha=""
  if [ "$TEST_CHANNEL" -eq 1 ]; then
    image_pin_publish="$(mktemp "$RUNTIME_DIR/.runtime-image.XXXXXX")"
    printf 'ghcr.io/leopu00/jht@%s\n' "$EXPECTED_IMAGE_DIGEST" > "$image_pin_publish"
    chmod 600 "$image_pin_publish"
  elif [ -e "$image_pin" ] || [ -L "$image_pin" ]; then
    rm -f "$image_pin"
  fi
  stage_runtime_extras_pin
  stage_runtime_tier
  local compose_sha hostsetup_sha wrapper_sha selection_sha="" machine_sha="" shim_sha=""
  if command -v sha256sum >/dev/null 2>&1; then
    compose_sha="$(sha256sum "$compose_dest" | awk '{print $1}')"
    hostsetup_sha="$(sha256sum "$hostsetup_dest" | awk '{print $1}')"
    wrapper_sha="$(sha256sum "$wrapper_dest" | awk '{print $1}')"
    if [ -f "$selection_source" ]; then
      selection_sha="$(sha256sum "$selection_source" | awk '{print $1}')"
    fi
    podman_machine_mode && machine_sha="$(sha256sum "$RUNTIME_DIR/podman-machine" | awk '{print $1}')"
    shim_sha="$(sha256sum "$RUNTIME_DIR/bin/docker" | awk '{print $1}')"
    if [ -n "$image_pin_publish" ]; then
      image_pin_sha="$(sha256sum "$image_pin_publish" | awk '{print $1}')"
    fi
  else
    compose_sha="$(shasum -a 256 "$compose_dest" | awk '{print $1}')"
    hostsetup_sha="$(shasum -a 256 "$hostsetup_dest" | awk '{print $1}')"
    wrapper_sha="$(shasum -a 256 "$wrapper_dest" | awk '{print $1}')"
    if [ -f "$selection_source" ]; then
      selection_sha="$(shasum -a 256 "$selection_source" | awk '{print $1}')"
    fi
    podman_machine_mode && machine_sha="$(shasum -a 256 "$RUNTIME_DIR/podman-machine" | awk '{print $1}')"
    shim_sha="$(shasum -a 256 "$RUNTIME_DIR/bin/docker" | awk '{print $1}')"
    if [ -n "$image_pin_publish" ]; then
      image_pin_sha="$(shasum -a 256 "$image_pin_publish" | awk '{print $1}')"
    fi
  fi
  {
    printf 'version=1\n'
    printf 'docker-compose.yml=%s\n' "$compose_sha"
    printf 'host-setup.sh=%s\n' "$hostsetup_sha"
    printf 'jht-wrapper.sh=%s\n' "$wrapper_sha"
    if [ -n "$selection_sha" ]; then
      printf 'container-runtime=%s\n' "$selection_sha"
    fi
    podman_machine_mode && printf 'podman-machine=%s\n' "$machine_sha"
    printf 'docker-shim=%s\n' "$shim_sha"
    if [ -n "$image_pin_sha" ]; then
      printf 'runtime-image=%s\n' "$image_pin_sha"
    fi
  } > "$manifest_tmp"
  chmod 600 "$manifest_tmp"
  # Publish manifest first: a crash between the two renames fails closed
  # (hash mismatch) instead of routing Docker commands to the wrong engine.
  mv -f "$manifest_tmp" "$manifest_dest"
  if [ -n "$image_pin_publish" ]; then
    mv -f "$image_pin_publish" "$image_pin"
    ok "$(tx "runtime image pinned: $(cat "$image_pin")" "immagine del runtime fissata: $(cat "$image_pin")")"
  fi
  publish_runtime_extras_pin
  publish_runtime_tier
  ok "host-setup: $hostsetup_dest"

  case ":$PATH:" in
    *":$BIN_DIR:"*)
      ok "$(tx "$BIN_DIR already in PATH" "$BIN_DIR e' gia' nel PATH")"
      PATH_READY=1
      ;;
    *)
      # Auto-add to a persistent location so the next login shells see `jht` (BUG-INSTALL-PATH-NOT-EXPORTED).
      # Ubuntu's ~/.profile guards `[ -d "$HOME/.local/bin" ]` only at the login after the dir exists: installing in
      # an open session, the dir did not exist at login → PATH not populated → `jht` not found. The `curl | bash`
      # subshell cannot modify the parent PATH, so we write to a file sourced by the next shell.
      local persistent_added=0
      if [ "${EUID:-$(id -u)}" -eq 0 ] && [ -d /etc/profile.d ] && [ -w /etc/profile.d ]; then
        # System-wide (preferred on root VPS): /etc/profile.d/<file>.sh is
        # sourced by /etc/profile at every interactive login shell.
        printf 'export PATH="$PATH:%s"\n' "$BIN_DIR" > /etc/profile.d/jht.sh
        chmod 644 /etc/profile.d/jht.sh
        ok "$(tx "PATH added to /etc/profile.d/jht.sh (system-wide)" "PATH aggiunto a /etc/profile.d/jht.sh (per tutto il sistema)")"
        persistent_added=1
      else
        # User-level fallback: append to ~/.bashrc + ~/.zshrc if they exist
        # and not already present. Idempotent: skip if already added.
        for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
          if [ -f "$rc" ] && ! grep -Fq -- "$BIN_DIR" "$rc" 2>/dev/null; then
            printf '\n# Added by JHT install.sh\nexport PATH="$PATH:%s"\n' "$BIN_DIR" >> "$rc"
            ok "$(tx "PATH added to $rc" "PATH aggiunto a $rc")"
            persistent_added=1
          fi
        done
      fi
      if [ "$persistent_added" -eq 0 ]; then
        # A fresh account may have none of the rc files, and a PATH that nobody wrote leaves `jht` "not found" in the
        # next terminal. If none of them already has the line, they are created: ~/.profile (login shells) and the
        # rc of the shell in use (bash or zsh).
        local already=0 rc
        local -a created_rc
        for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
          if [ -f "$rc" ] && grep -Fq -- "$BIN_DIR" "$rc" 2>/dev/null; then already=1; persistent_added=1; fi
        done
        if [ "$already" -eq 0 ]; then
          # one word per file, quoted: a HOME with a space in it stays one path
          created_rc=("$HOME/.profile")
          case "${SHELL##*/}" in
            zsh) created_rc+=("$HOME/.zshrc") ;;
            bash) created_rc+=("$HOME/.bashrc") ;;
          esac
          for rc in "${created_rc[@]}"; do
            printf '\n# Added by JHT install.sh\nexport PATH="$PATH:%s"\n' "$BIN_DIR" >> "$rc" \
              && { ok "$(tx "PATH added to $rc" "PATH aggiunto a $rc")"; persistent_added=1; }
          done
        fi
      fi
      if [ "$persistent_added" -eq 0 ]; then
        warn "$(tx "No shell rc file was written. Add manually:" "Nessun file rc della shell e' stato scritto. Aggiungi a mano:")"
        printf "\n      ${BOLD}export PATH=\"\$PATH:%s\"${RESET}\n\n" "$BIN_DIR"
      else
        PATH_NEW_SHELL=1
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

clone_repo() {
  step 4 "$TOTAL_STEPS_NATIVE" "Download JHT (git clone)"

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
  step 5 "$TOTAL_STEPS_NATIVE" "Build CLI and shared modules"

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
  step 6 "$TOTAL_STEPS_NATIVE" "Install jht command (native)"

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

runtime_publish_stat() {
  if [ "$(uname -s)" = Darwin ]; then
    stat -f '%u %Lp' "$1" 2>/dev/null
  else
    stat -c '%u %a' "$1" 2>/dev/null
  fi
}

runtime_publish_node_safe() {
  local path="$1" kind="$2" metadata owner mode mode_num
  [ ! -L "$path" ] || return 1
  case "$kind" in
    dir) [ -d "$path" ] ;;
    file) [ -f "$path" ] ;;
    *) return 1 ;;
  esac || return 1
  metadata="$(runtime_publish_stat "$path")" || return 1
  owner="${metadata%% *}"
  mode="${metadata#* }"
  [ "$owner" = "$(id -u)" ] || return 1
  mode_num=$((8#$mode))
  [ $((mode_num & 0022)) -eq 0 ]
}

runtime_publish_bundle_valid() {
  local manifest="$1" wrapper="$2" allow_missing_wrapper="$3"
  local key value extra path actual wrapper_digest="" selection=""
  local version_count=0 compose_count=0 setup_count=0 wrapper_count=0
  local selection_count=0 machine_count=0 shim_count=0

  runtime_publish_node_safe "$RUNTIME_DIR" dir || return 1
  runtime_publish_node_safe "$BIN_DIR" dir || return 1
  runtime_publish_node_safe "$manifest" file || return 1
  [ "$(wc -c < "$manifest" | tr -d ' ')" -le 65536 ] || return 1

  while IFS='=' read -r key value extra; do
    [ -z "$extra" ] || return 1
    case "$key" in
      version)
        version_count=$((version_count + 1))
        [ "$value" = 1 ] || return 1
        continue
        ;;
      docker-compose.yml)
        compose_count=$((compose_count + 1))
        path="$RUNTIME_DIR/docker-compose.yml"
        ;;
      host-setup.sh)
        setup_count=$((setup_count + 1))
        path="$RUNTIME_DIR/host-setup.sh"
        ;;
      jht-wrapper.sh)
        wrapper_count=$((wrapper_count + 1))
        wrapper_digest="$value"
        continue
        ;;
      container-runtime)
        selection_count=$((selection_count + 1))
        path="$RUNTIME_DIR/container-runtime"
        ;;
      podman-machine)
        machine_count=$((machine_count + 1))
        path="$RUNTIME_DIR/podman-machine"
        ;;
      docker-shim)
        shim_count=$((shim_count + 1))
        path="$RUNTIME_DIR/bin/docker"
        ;;
      *) return 1 ;;
    esac
    [ "$value" != "" ] && printf '%s' "$value" | grep -Eq '^[0-9a-f]{64}$' \
      || return 1
    runtime_publish_node_safe "$path" file || return 1
    actual="$(runtime_publish_sha256 "$path")" || return 1
    [ "$actual" = "$value" ] || return 1
    if [ "$key" = container-runtime ]; then
      selection="$(tr -d '\r\n' < "$path" 2>/dev/null || true)"
      case "$selection" in docker|podman) ;; *) return 1 ;; esac
    fi
  done < "$manifest"

  [ "$version_count" -eq 1 ] && [ "$compose_count" -eq 1 ] \
    && [ "$setup_count" -eq 1 ] && [ "$wrapper_count" -eq 1 ] \
    && [ "$selection_count" -le 1 ] && [ "$machine_count" -le 1 ] \
    && [ "$shim_count" -le 1 ] || return 1
  printf '%s' "$wrapper_digest" | grep -Eq '^[0-9a-f]{64}$' || return 1
  if [ -e "$wrapper" ] || [ -L "$wrapper" ]; then
    runtime_publish_node_safe "$wrapper" file || return 1
    [ "$(runtime_publish_sha256 "$wrapper")" = "$wrapper_digest" ] || return 1
  else
    [ "$allow_missing_wrapper" -eq 1 ] || return 1
  fi
  if [ "$selection" = podman ]; then
    [ "$machine_count" -eq 1 ] && [ "$shim_count" -eq 1 ] || return 1
    grep -Fqx '# JHT_PODMAN_DOCKER_SHIM=1' "$RUNTIME_DIR/bin/docker" || return 1
    runtime_publish_podman_shim_valid || return 1
  else
    [ "$machine_count" -eq 0 ] && [ "$shim_count" -eq 0 ] || return 1
  fi
  grep -Fqx 'JHT_HOST_SETUP_PROTOCOL=1' "$RUNTIME_DIR/host-setup.sh" || return 1
  grep -Eq '^[[:space:]]*-[[:space:]]*jht-runtime-mask:/jht_home/runtime([[:space:]]|$)' \
    "$RUNTIME_DIR/docker-compose.yml" || return 1
}

runtime_publish_podman_shim_valid() {
  local podman_bin machine expected actual
  podman_bin="$(command -v podman 2>/dev/null)" || return 1
  case "$podman_bin" in *"'"*|*$'\n'*) return 1 ;; esac
  machine="$(tr -d '\r\n' < "$RUNTIME_DIR/podman-machine" 2>/dev/null)" || return 1
  case "$machine" in ''|*[!A-Za-z0-9_.-]*) return 1 ;; esac
  expected="$(printf '%s\n%s\n' '#!/bin/sh' '# JHT_PODMAN_DOCKER_SHIM=1'; \
    printf "exec '%s' --connection '%s' \"\$@\"\n" "$podman_bin" "$machine")"
  actual="$(cat "$RUNTIME_DIR/bin/docker" 2>/dev/null)" || return 1
  [ "$actual" = "$expected" ]
}

# MIGRATION: pubblica installer, wrapper, compose e host-setup dalla stessa
# fonte candidata in un bundle host gia' attestato. Non e' un fresh install.
# Non rileva/avvia motori, non
# esegue host-setup o jht e non legge/scrive account, configurazioni o
# credenziali. Il manifest nuovo viene esposto per primo: ogni intervallo tra
# rename fallisce chiuso. Errori e segnali ripristinano tutti i byte precedenti.
publish_runtime_candidate_bundle() {
  local manifest="$RUNTIME_DIR/.runtime-integrity"
  local wrapper_dest="$BIN_DIR/jht"
  local compose_dest="$RUNTIME_DIR/docker-compose.yml"
  local setup_dest="$RUNTIME_DIR/host-setup.sh"
  local release_base installer_candidate="" wrapper_candidate=""
  local compose_candidate="" setup_candidate="" manifest_tmp=""
  local manifest_backup="" wrapper_backup="" compose_backup="" setup_backup=""
  local lock_dir="$RUNTIME_DIR/.publish-runtime.lock"
  local candidate_sha installed_sha manifest_sha size value
  local had_wrapper=0
  local publication_phase="preparing" lock_acquired=0

  [ -d "$RUNTIME_DIR" ] && [ ! -L "$RUNTIME_DIR" ] \
    || fail "Attested host runtime is missing or unsafe. Run the full installer first."
  local runtime_real home_real bind_real docs_real
  runtime_real="$(cd -P "$RUNTIME_DIR" 2>/dev/null && pwd -P)" \
    || fail "Cannot resolve the attested host runtime."
  [ "$runtime_real" = "${RUNTIME_DIR%/}" ] \
    || fail "Host runtime has a symlinked or non-canonical ancestor."
  home_real="$(cd -P "$HOME" 2>/dev/null && pwd -P)" \
    || fail "Cannot resolve the user home directory."
  bind_real="$(cd -P "$HOME/.jht" 2>/dev/null && pwd -P)" \
    || bind_real="$home_real/.jht"
  docs_real="$(cd -P "$HOME/Documents/Job Hunter Team" 2>/dev/null && pwd -P)" \
    || docs_real="$home_real/Documents/Job Hunter Team"
  case "$runtime_real/" in
    "$bind_real/"*|"$docs_real/"*)
      fail "Host runtime must stay outside container-writable bind mounts."
      ;;
  esac
  [ -d "$BIN_DIR" ] && [ ! -L "$BIN_DIR" ] \
    || fail "Attested host wrapper directory is missing or unsafe. Run the full installer first."
  local bin_real
  bin_real="$(cd -P "$BIN_DIR" 2>/dev/null && pwd -P)" \
    || fail "Cannot resolve the host wrapper directory."
  [ "$bin_real" = "${BIN_DIR%/}" ] \
    || fail "Host wrapper directory has a symlinked or non-canonical ancestor."
  case "$bin_real/" in
    "$bind_real/"*|"$docs_real/"*)
      fail "Host wrapper must stay outside container-writable bind mounts."
      ;;
  esac
  runtime_publish_node_safe "$RUNTIME_DIR" dir \
    || fail "Attested host runtime ownership or permissions are unsafe."

  mkdir "$lock_dir" 2>/dev/null \
    || fail "Another runtime publication is already in progress."
  lock_acquired=1
  cleanup_runtime_publication() {
    local temporary
    for temporary in "$installer_candidate" "$wrapper_candidate" "$compose_candidate" \
        "$setup_candidate" "$manifest_tmp" "$manifest_backup" "$wrapper_backup" \
        "$compose_backup" "$setup_backup"; do
      [ -z "$temporary" ] || rm -f -- "$temporary"
    done
    if [ "$lock_acquired" -eq 1 ]; then
      rmdir "$lock_dir" 2>/dev/null || true
      lock_acquired=0
    fi
  }
  rollback_runtime_publication() {
    trap '' HUP INT TERM
    if [ "$publication_phase" = replacing ]; then
      if [ "$had_wrapper" -eq 1 ]; then
        [ -n "$wrapper_backup" ] && [ -f "$wrapper_backup" ] \
          && mv -f "$wrapper_backup" "$wrapper_dest" 2>/dev/null || true
      else
        rm -f -- "$wrapper_dest"
      fi
      [ -n "$setup_backup" ] && [ -f "$setup_backup" ] \
        && mv -f "$setup_backup" "$setup_dest" 2>/dev/null || true
      [ -n "$compose_backup" ] && [ -f "$compose_backup" ] \
        && mv -f "$compose_backup" "$compose_dest" 2>/dev/null || true
    fi
    case "$publication_phase" in
      replacing)
        [ -n "$manifest_backup" ] && [ -f "$manifest_backup" ] \
          && mv -f "$manifest_backup" "$manifest" 2>/dev/null || true
        ;;
    esac
    publication_phase="rolled_back"
  }
  finish_runtime_publication() {
    local status=$?
    trap - EXIT HUP INT TERM
    [ "$publication_phase" = committed ] || rollback_runtime_publication
    cleanup_runtime_publication
    exit "$status"
  }
  inject_runtime_publication_failure() {
    [ "$RUNTIME_PUBLISH_FAILPOINT" = "$1" ] || return 0
    if [ "$RUNTIME_PUBLISH_FAILURE" = term ]; then
      kill -TERM "$$"
      fail "Injected termination was not delivered."
    fi
    fail "Injected runtime publication failure."
  }
  trap finish_runtime_publication EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  runtime_publish_bundle_valid "$manifest" "$wrapper_dest" 1 \
    || fail "Existing runtime bundle integrity, ownership, or permissions are invalid."
  if [ -e "$wrapper_dest" ] || [ -L "$wrapper_dest" ]; then
    had_wrapper=1
  fi
  installer_candidate="$(mktemp "$RUNTIME_DIR/.installer-candidate.XXXXXX")"
  wrapper_candidate="$(mktemp "$BIN_DIR/.jht-candidate.XXXXXX")"
  compose_candidate="$(mktemp "$RUNTIME_DIR/.compose-candidate.XXXXXX")"
  setup_candidate="$(mktemp "$RUNTIME_DIR/.host-setup-candidate.XXXXXX")"
  manifest_tmp="$(mktemp "$RUNTIME_DIR/.integrity-candidate.XXXXXX")"
  manifest_backup="$(mktemp "$RUNTIME_DIR/.integrity-rollback.XXXXXX")"
  compose_backup="$(mktemp "$RUNTIME_DIR/.compose-rollback.XXXXXX")"
  setup_backup="$(mktemp "$RUNTIME_DIR/.host-setup-rollback.XXXXXX")"
  if [ "$had_wrapper" -eq 1 ]; then
    wrapper_backup="$(mktemp "$BIN_DIR/.jht-rollback.XXXXXX")"
  fi

  release_base="$(attested_raw_base)" \
    || fail "Cannot resolve the selected candidate source."
  curl -fsSL "$release_base/scripts/install.sh" -o "$installer_candidate" \
    || fail "Candidate installer download failed."
  curl -fsSL "$release_base/scripts/jht-wrapper.sh" -o "$wrapper_candidate" \
    || fail "Candidate wrapper download failed."
  curl -fsSL "$release_base/docker-compose.yml" -o "$compose_candidate" \
    || fail "Candidate compose download failed."
  curl -fsSL "$release_base/scripts/host-setup.sh" -o "$setup_candidate" \
    || fail "Candidate host setup download failed."

  runtime_publish_node_safe "$0" file \
    || fail "Running installer source is not an owner-controlled regular file."
  [ "$(runtime_publish_sha256 "$0")" = "$EXPECTED_INSTALLER_SHA256" ] \
    || fail "Running installer digest does not match the expected candidate."
  [ "$(runtime_publish_sha256 "$installer_candidate")" = "$EXPECTED_INSTALLER_SHA256" ] \
    && cmp -s "$0" "$installer_candidate" \
    || fail "Candidate source does not contain this exact installer."
  bash -n "$installer_candidate" \
    || fail "Candidate installer has invalid shell syntax."

  size="$(wc -c < "$wrapper_candidate" | tr -d ' ')"
  [ "$size" -gt 0 ] && [ "$size" -le $((2 * 1024 * 1024)) ] \
    || fail "Candidate wrapper payload is empty or too large."
  bash -n "$wrapper_candidate" \
    || fail "Candidate wrapper has invalid shell syntax."
  for capability in \
      JHT_UPGRADE_PROTOCOL=1 \
      JHT_HOST_RUNTIME_PROTOCOL=1 \
      JHT_DESKTOP_CHAT_PROTOCOL=1 \
      JHT_ONBOARDING_SNAPSHOT_PROTOCOL=1; do
    grep -Fqx "$capability" "$wrapper_candidate" \
      || fail "Candidate wrapper is missing a required protocol capability."
  done
  grep -Fqx "DEFAULT_RUNTIME_VERSION=\"$EXPECTED_RUNTIME_VERSION\"" "$wrapper_candidate" \
    || fail "Candidate wrapper runtime version does not match the expected version."
  candidate_sha="$(runtime_publish_sha256 "$wrapper_candidate")" \
    || fail "Cannot hash the candidate wrapper."
  [ "$candidate_sha" = "$EXPECTED_WRAPPER_SHA256" ] \
    || fail "Candidate wrapper digest mismatch."
  [ "$(runtime_publish_sha256 "$compose_candidate")" = "$EXPECTED_COMPOSE_SHA256" ] \
    || fail "Candidate compose digest mismatch."
  grep -Eq '^[[:space:]]*-[[:space:]]*jht-runtime-mask:/jht_home/runtime([[:space:]]|$)' \
    "$compose_candidate" || fail "Candidate compose does not enforce the runtime boundary."
  [ "$(runtime_publish_sha256 "$setup_candidate")" = "$EXPECTED_HOST_SETUP_SHA256" ] \
    || fail "Candidate host setup digest mismatch."
  bash -n "$setup_candidate" \
    && grep -Fqx 'JHT_HOST_SETUP_PROTOCOL=1' "$setup_candidate" \
    || fail "Candidate host setup is invalid or missing its protocol capability."
  chmod 700 "$wrapper_candidate" "$setup_candidate"
  chmod 600 "$compose_candidate"

  while IFS= read -r value || [ -n "$value" ]; do
    case "$value" in
      docker-compose.yml=*) printf 'docker-compose.yml=%s\n' "$EXPECTED_COMPOSE_SHA256" ;;
      host-setup.sh=*) printf 'host-setup.sh=%s\n' "$EXPECTED_HOST_SETUP_SHA256" ;;
      jht-wrapper.sh=*) printf 'jht-wrapper.sh=%s\n' "$candidate_sha" ;;
      *) printf '%s\n' "$value" ;;
    esac
  done < "$manifest" > "$manifest_tmp"
  chmod 600 "$manifest_tmp"
  cp -p "$manifest" "$manifest_backup" \
    || fail "Cannot stage the runtime manifest rollback."
  cp -p "$compose_dest" "$compose_backup" \
    || fail "Cannot stage the compose rollback."
  cp -p "$setup_dest" "$setup_backup" \
    || fail "Cannot stage the host setup rollback."
  if [ "$had_wrapper" -eq 1 ]; then
    cp -p "$wrapper_dest" "$wrapper_backup" \
      || fail "Cannot stage the host wrapper rollback."
  fi

  inject_runtime_publication_failure before-manifest-replace
  publication_phase="replacing"
  mv -f "$manifest_tmp" "$manifest" \
    || fail "Cannot publish the candidate runtime manifest."
  inject_runtime_publication_failure after-manifest-replace
  mv -f "$compose_candidate" "$compose_dest" \
    || fail "Cannot publish the candidate compose."
  inject_runtime_publication_failure after-compose-replace
  mv -f "$setup_candidate" "$setup_dest" \
    || fail "Cannot publish the candidate host setup."
  inject_runtime_publication_failure before-wrapper-replace
  mv -f "$wrapper_candidate" "$wrapper_dest" \
    || fail "Cannot publish the candidate wrapper."
  inject_runtime_publication_failure after-wrapper-replace

  installed_sha="$(runtime_publish_sha256 "$wrapper_dest" 2>/dev/null || true)"
  manifest_sha="$(sed -n 's/^jht-wrapper.sh=//p' "$manifest" | head -n 1)"
  if [ "$installed_sha" != "$candidate_sha" ] \
      || [ "$manifest_sha" != "$candidate_sha" ] \
      || [ "$(runtime_publish_sha256 "$compose_dest" 2>/dev/null || true)" != "$EXPECTED_COMPOSE_SHA256" ] \
      || [ "$(runtime_publish_sha256 "$setup_dest" 2>/dev/null || true)" != "$EXPECTED_HOST_SETUP_SHA256" ] \
      || ! grep -Fqx 'JHT_ONBOARDING_SNAPSHOT_PROTOCOL=1' "$wrapper_dest" \
      || ! runtime_publish_bundle_valid "$manifest" "$wrapper_dest" 0; then
    fail "Candidate publication verification failed."
  fi

  publication_phase="committed"
  cleanup_runtime_publication
  trap - EXIT HUP INT TERM
  ok "Candidate runtime MIGRATION published and complete bundle verified"
}

runtime_publish_sha256() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    return 1
  fi
}

# ── Final ─────────────────────────────────────────────────────────────────

# True if /dev/tty can really be opened. The node exists and is readable on every
# machine, but opening it fails (ENXIO, "No such device or address") when the process
# has no controlling terminal: ssh without -t, cron, CI. So the only honest test is
# to open it, in a subshell so that a failure cannot end the installer.
tty_can_be_opened() {
  ( : </dev/tty ) 2>/dev/null
}

# True if maybe_onboard() can launch the wizard right away (TTY available
# directly or re-openable from /dev/tty). Used by final_message to decide
# whether to print "Next steps: jht setup" (it would be noise if the
# wizard is about to start on its own a few lines below).
will_auto_onboard() {
  [ "$DRY_RUN" -eq 1 ] && return 1
  [ "${JHT_SKIP_ONBOARD:-0}" = "1" ] && return 1
  [ -t 0 ] && return 0
  tty_can_be_opened && return 0
  return 1
}

final_message() {
  printf "\n"
  printf "${GREEN}${BOLD}══════════════════════════════════════════${RESET}\n"
  printf "${GREEN}${BOLD}  %s${RESET}\n" "$(tx "Installation complete!" "Installazione completata!")"
  printf "${GREEN}${BOLD}══════════════════════════════════════════${RESET}\n"
  printf "\n"
  if [ "$USE_DOCKER" -eq 1 ]; then
    printf "  ${BOLD}%s${RESET}\n" "$(tx "Container mode active (Podman)." "Modalita' container attiva (Podman).")"
    printf "  ${DIM}%s${RESET}\n" "$(tx "The agents can only see:" "Gli agenti vedono solo:")"
    printf "  ${DIM}  ~/.jht/                       → /jht_home %s${RESET}\n" "$(tx "(config, db, agents)" "(configurazione, db, agenti)")"
    printf "  ${DIM}  ~/Documents/Job Hunter Team/  → /jht_user %s${RESET}\n" "$(tx "(CVs, attachments, output)" "(CV, allegati, risultati)")"
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
    printf "  ${BOLD}%s${RESET}\n" "$(tx "Next steps:" "Prossimi passi:")"
    printf "\n"
    if [ "${PATH_NEW_SHELL:-0}" -eq 1 ]; then
      printf "      ${DIM}%s${RESET}\n\n" "$(tx "Open a new terminal window first (or run: . ~/.profile), so that it finds jht." "Prima apri una nuova finestra del terminale (o lancia: . ~/.profile), cosi' trova jht.")"
    fi
    if [ "${PATH_READY:-0}" -eq 1 ]; then
      if [ "$USE_DOCKER" -eq 1 ]; then
        printf "      ${BOLD}jht setup${RESET}        ${DIM}# %s${RESET}\n" "$(tx "configuration wizard (also starts the container)" "configurazione guidata (accende anche il container)")"
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

  printf "  ${DIM}%s${RESET}\n" "$(tx "To uninstall (keeps your data in ~/.jht and ~/Documents/Job Hunter Team):" "Per disinstallare (i tuoi dati in ~/.jht e ~/Documents/Job Hunter Team restano):")"
  if [ "$USE_DOCKER" -eq 1 ]; then
    # `jht uninstall` removes the containers, the networks and the VOLUMES of the project (broker, secrets, deps…: the
    # ten host-runtime_jht-* that `jht down && rm -rf` left behind, TEST 19i A2), then the runtime, the PATH lines and itself.
    # It is the only command printed for the engine: no `docker rmi`, no `rm -rf` and no `sudo` for the person to type.
    printf "  ${DIM}  jht uninstall --confirm${RESET}\n"
    printf "  ${DIM}  %s${RESET}\n" "$(tx "(it also deletes the API key, the mail password and the Telegram tokens saved for the team)" "(cancella anche la chiave API, la password della posta e i token di Telegram salvati per la squadra)")"
  else
    printf "  ${DIM}  rm -rf %s %s/jht${RESET}\n" "$INSTALL_DIR" "$BIN_DIR"
  fi
  printf "  ${DIM}%s${RESET}\n" "$(tx "To also delete your data (config, db, CVs, output):" "Per cancellare anche i tuoi dati (configurazione, db, CV, risultati):")"
  if [ "$USE_DOCKER" -eq 1 ]; then
    # With a container engine on Linux ~/.jht belongs to the container (uid 1001, often mode 700; with rootless Podman, to a
    # sub-uid): `rm -rf` from this account fails with "Permission denied" (TEST, Linux gate). `jht uninstall --confirm --purge`
    # empties the folders the right way for the engine (a one-shot container for Docker, `podman unshare` for Podman), without
    # sudo and without changing a permission, so it is the command printed for every engine.
    printf "  ${DIM}  jht uninstall --confirm --purge${RESET}\n"
    printf "  ${DIM}  %s${RESET}\n" "$(tx "(same as above, and it empties ~/.jht and ~/Documents/Job Hunter Team too)" "(come sopra, e svuota anche ~/.jht e ~/Documents/Job Hunter Team)")"
  else
    # Native mode: nothing ran in a container, the folders are the person's own and `jht` has no uninstall.
    # (`%b`, not `%s`: DIM and RESET hold the characters backslash-0-3-3, and only `%b` or the format string turns them into the escape.)
    # The text the person pastes keeps the variable: the shell expands it in the right place, and a path with a space stays one
    # word. (A tilde inside the quotes would not expand: TEST 19b.)
    printf '  %b  rm -rf "$HOME/.jht" "$HOME/Documents/Job Hunter Team"%b\n' "${DIM}" "${RESET}"
  fi
  printf "\n"
}

# Writes stdin to a file in ~/.jht, which the container mounts read-write: an agent may have put a LINK there in place of the
# file (dangling in the container, pointing into the person's home on the host), and `>`, `chmod` and `chown` by path would
# follow it. The file is made in a temporary created in the home, which is not mounted, with its mode and owner set there; the
# entry is removed (a link as a link) and the file takes its place with `ln -n`, which fails if something came back meanwhile
# instead of putting the file inside the folder a link names. Same function as host-setup.sh's, which has to stay a single file.
write_file_in_home() {
  local target="$1" mode="$2" owner="${3:-}" dir tmp
  dir="$(dirname "$(dirname "$target")")"
  if [ -d "$target" ] && [ ! -L "$target" ]; then
    warn "$target is a directory: not writing it"
    return 1
  fi
  tmp="$(mktemp "$dir/.jht-host-file.XXXXXX")" || { warn "cannot create a temporary file in $dir: not writing $target"; return 1; }
  if ! cat > "$tmp" || ! chmod "$mode" "$tmp"; then rm -f "$tmp"; return 1; fi
  if [ -n "$owner" ]; then chown "$owner" "$tmp" 2>/dev/null || true; fi
  if [ -e "$target" ] || [ -L "$target" ]; then
    rm -f "$target" || { rm -f "$tmp"; return 1; }
  fi
  if ln -n "$tmp" "$target" 2>/dev/null; then
    rm -f "$tmp"
  elif [ ! -e "$target" ] && [ ! -L "$target" ] && mv -f "$tmp" "$target"; then
    : # a folder without hard links (rare): the rename, with the entry still empty
  else
    rm -f "$tmp"
    warn "$target changed while it was being written: not writing it"
    return 1
  fi
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
  # (The mode and owner below are set on the temporary, before it takes the place of the file.)
  local token_owner=""
  podman_native_mode || [ "${OS:-}" = "macos" ] || token_owner="1001:1001"
  printf '%s' "$PAIRING_TOKEN" | write_file_in_home "$token_file" 600 "$token_owner" || return 1
  # 0600 — a bearer credential (exchanged for a Supabase access_token): no other host user may read it. It used to be
  # 0644 "because the container runs as uid 1001": the fix for that is ownership, not world-readability —
  # run_host_setup() (right after this) does `chown -R 1001:1001 ~/.jht`, and we align this file here so the order of
  # the two steps stops mattering. `jht cloud pair` deletes it after consumption (cli/src/commands/cloud.js
  # handlePair). (Nor on the Mac: see align_bind_ownership.)
  ok "Pairing token saved to $token_file (mode 0600)"
}

# The container runs as uid 1001 (`jht`), and ~/.jht plus the documents
# folder are aligned to it. On the HOST that uid must belong to nobody, or to
# the person installing or starting JHT: another account with that uid would
# own all of ~/.jht (data and portal credentials) and could run a file the
# container made setuid there (P2 of the security review, 08/10). Prints the
# account name and succeeds when there is such a conflict.
bind_uid_conflict() {
  local uid="$1" self="$(id -u)" name=""; if [ "$self" = 0 ]; then self="${SUDO_UID:-$self}"; fi
  if command -v getent >/dev/null 2>&1; then
    name="$(getent passwd "$uid" 2>/dev/null | cut -d: -f1)"
  else
    name="$(id -un "$uid" 2>/dev/null || true)"
  fi
  [ -n "$name" ] || return 1
  [ "$self" = "$uid" ] && return 1
  printf '%s\n' "$name"
}

refuse_foreign_bind_uid() {
  local name
  # Native rootless Podman maps this user onto the container's uid 1001
  # (keep-id): ~/.jht and the documents stay this user's, nothing is chowned to
  # 1001, and a host account with uid 1001 owns none of it. The wrapper skips
  # the same check there (ensure_bind_owner). Docker and the Mac's machine keep it.
  podman_native_mode && return 0
  name="$(bind_uid_conflict 1001)" || return 0
  fail "uid 1001 on this computer is the account '$name'. The Job Hunter Team container runs as uid 1001, so that account would own ~/.jht (your data and the portal credentials). Nothing was changed. Run JHT from the account '$name', or give '$name' another uid, then try again."
}

# Align the ownership of ~/.jht and ~/Documents/Job Hunter Team with the
# `jht` container UID (1001, see Dockerfile `useradd jht`). Without this,
# the container starts as UID 1001 and fails at two distinct points:
#   - pid1 → cloud pair → EACCES on /jht_home/cloud.json
#   - jht team start → mkdir /jht_user/output → Permission denied
# Both dirs are bind-mounted, so the host must be aligned.
align_bind_ownership() {
  local jht_home="$HOME/.jht"
  local jht_user_dir="$HOME/Documents/Job Hunter Team"
  if podman_native_mode; then
    # Rootless Podman maps the host user onto the container's uid (keep-id):
    # the user stays the owner, and a chown to 1001 would take it away.
    mkdir -p "$jht_user_dir" 2>/dev/null
    ok "$(tx "Ownership of $jht_home and $jht_user_dir stays with this user (rootless Podman)" "$jht_home e $jht_user_dir restano di questo utente (Podman rootless)")"
  elif [ "${OS:-}" = "macos" ]; then
    # The Mac shares the two folders with the container's VM, which shows
    # them as this user's and lets the container write: nothing needs
    # aligning. A chown to 1001 cannot work for a normal user (EPERM, on every
    # Mac) and, under sudo, would hand ~/.jht to a uid that is nobody here.
    mkdir -p "$jht_user_dir" 2>/dev/null
    ok "$(tx "Ownership of $jht_home and $jht_user_dir stays with this user (macOS)" "$jht_home e $jht_user_dir restano di questo utente (macOS)")"
  elif command -v chown >/dev/null 2>&1; then
    mkdir -p "$jht_user_dir" 2>/dev/null
    if chown -R 1001:1001 "$jht_home" "$jht_user_dir" 2>/dev/null; then
      ok "$(tx "Ownership $jht_home and $jht_user_dir → 1001:1001 (container UID)" "Proprietario di $jht_home e $jht_user_dir → 1001:1001 (UID del container)")"
    elif repair_bind_ownership_in_container "$jht_home" "$jht_user_dir"; then
      ok "$(tx "Ownership $jht_home and $jht_user_dir → 1001:1001 (container UID, set by a one-shot container: no sudo needed)" "Proprietario di $jht_home e $jht_user_dir → 1001:1001 (UID del container, messo da un container usa e getta: niente sudo)")"
    elif [ "$USE_DOCKER" -ne 1 ]; then
      warn "chown to 1001 failed — nothing runs in a container here (--no-docker), so nothing needs it"
    else
      # A normal user cannot chown to 1001 (EPERM) and without the repair above the container would start and die
      # on «mount_not_writable» in a restart loop (Gate CLI, 29/10): stop here, saying what to do.
      fail "mount_repair_failed: $jht_home and $jht_user_dir cannot be made writable for the Job Hunter Team container (it runs as uid 1001) and nothing was started. Either let Docker run for this account (add it to the 'docker' group, then log in again), or run once: sudo chown -R 1001:1001 \"$jht_home\" \"$jht_user_dir\" — then run this installer again."
    fi
  fi
}

# The fix for a normal user (uid != 1001, no sudo) on Linux with Docker: the same one-shot container the Windows
# wrapper uses (.launcher/repair-mounts.sh, one receipt per folder). Root inside it, but with CAP_CHOWN and
# CAP_DAC_READ_SEARCH only (the second one so it can walk a folder this user keeps private, mode 700), no network,
# no new privileges, and only the two folders mounted. Succeeds only when both folders are confirmed.
MOUNT_REPAIR_DISPATCH='if [ -x /app/.launcher/repair-mounts.sh ]; then exec /app/.launcher/repair-mounts.sh; else echo mount_repair_unsupported; fi'
repair_bind_ownership_in_container() {
  local jht_home="$1" jht_user_dir="$2" receipts
  command -v docker >/dev/null 2>&1 || return 1
  receipts="$(docker run --rm --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_READ_SEARCH --network none \
      --security-opt no-new-privileges \
      -v "$jht_home:/jht_home" -v "$jht_user_dir:/jht_user" \
      --entrypoint /bin/sh "$IMAGE" -c "$MOUNT_REPAIR_DISPATCH" 2>/dev/null)" || return 1
  printf '%s\n' "$receipts" | grep -Eqx 'mount_(ok|repaired) /jht_home' || return 1
  printf '%s\n' "$receipts" | grep -Eqx 'mount_(ok|repaired) /jht_user' || return 1
  ! printf '%s\n' "$receipts" | grep -Eqv 'mount_(ok|repaired) /jht_(home|user)'
}

run_host_setup() {
  # host-setup.sh writes ~/.jht/host.env (JHT_HOST_TYPE, JHT_LANG, swap). WITHOUT it the container boots in mode=local and
  # pid1 SKIPS the entire cloud block (push daemon, pair-on-boot, "Sync now"): cloud sync silently dead. Must run on BOTH paths:
  #   • app-provisioned (--pairing-token): force --host-type=vps (nobody at the terminal to confirm the auto-detection);
  #   • manual `curl install.sh | bash`: NO flag → auto-detects (detect_vps) and, with no TTY, writes it without a prompt
  #     (regression fixed 2026-07-09: this path used to `return 0` early → host.env never written).
  local hostsetup="$RUNTIME_DIR/host-setup.sh"
  if [ ! -x "$hostsetup" ]; then
    warn "host-setup.sh not available at $hostsetup — skipping preflight"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    info "dry-run: would run $hostsetup${PAIRING_TOKEN:+ --host-type=vps}"
    return 0
  fi
  info "$(tx "Running host-setup.sh (writes ~/.jht/host.env + swap preflight)..." "Eseguo host-setup.sh (scrive ~/.jht/host.env e controlla lo swap)...")"
  if [ -n "$PAIRING_TOKEN" ]; then
    if "$hostsetup" --host-type=vps </dev/null; then
      ok "$(tx "host-setup completed (forced vps)" "host-setup completato (vps imposto)")"
    else
      warn "$(tx "host-setup exited with an error — continuing (a manual pair may be needed)" "host-setup e' uscito con un errore: continuo (puo' servire un abbinamento a mano)")"
    fi
  else
    if "$hostsetup" </dev/null; then
      ok "$(tx "host-setup completed (auto-detected host type)" "host-setup completato (tipo di host rilevato da solo)")"
    else
      warn "$(tx "host-setup exited with an error — continuing" "host-setup e' uscito con un errore: continuo")"
    fi
  fi
  align_bind_ownership
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
    # login (Codex, or the API key of GLM/Kimi) from the app.
    info "$(tx "Pairing token present: skipping the interactive wizard." "Token di abbinamento presente: salto il wizard interattivo.")"
    info "$(tx "The container will complete the pairing on first boot." "Il container completera' l'abbinamento al primo avvio.")"
    return 0
  fi

  # `curl | bash` connects stdin to the pipe, so `-t 0` is false and `read` cannot talk to the user. The wizard reads
  # from the controlling terminal (/dev/tty), and ONLY the wizard: `jht setup </dev/tty` below redirects that one
  # command. Never `exec </dev/tty` here: with the script itself arriving on stdin, bash would go on reading the REST OF
  # THE SCRIPT from the terminal, the installer would not give the prompt back until Ctrl-D, and what the person types
  # would be run by the installer's own shell.
  local wizard_from_tty=0
  if [ ! -t 0 ]; then
    if tty_can_be_opened; then
      wizard_from_tty=1
    else
      info "$(tx "No interactive terminal (no /dev/tty): skipping the wizard." "Nessun terminale interattivo (niente /dev/tty): salto il wizard.")"
      info "$(tx "Run manually: jht setup" "Lancia a mano: jht setup")"
      return 0
    fi
  fi

  # No "Do you want to start the setup?" prompt: on first run it is always
  # the correct next action. Whoever wants to skip uses JHT_SKIP_ONBOARD=1.
  export PATH="$BIN_DIR:$PATH"
  printf "\n"
  # A wizard that stops (cancelled, interrupted, failed) is not a finished install: the installer ends with the wizard's own
  # non-zero code, and says what to do next. It used to swallow the code with `|| warn` and end with 0, so a script or a
  # person reading the exit code saw «done» for a team that was installed but never set up.
  local wizard_status=0
  if [ "$wizard_from_tty" -eq 1 ]; then
    jht setup </dev/tty || wizard_status=$?
  else
    jht setup || wizard_status=$?
  fi
  if [ "$wizard_status" -ne 0 ]; then
    local setup_command="jht setup"
    [ "${PATH_READY:-0}" -eq 1 ] || setup_command="$BIN_DIR/jht setup"
    printf "\n"
    warn "$(tx "The setup did not finish (exit code $wizard_status): Job Hunter Team is installed, but it is not set up yet." "Il setup non e' finito (codice di uscita $wizard_status): Job Hunter Team e' installato, ma non ancora configurato.")"
    info "$(tx "Next step: run  $setup_command  to finish the setup." "Prossimo passo: lancia  $setup_command  per finire il setup.")"
    return "$wizard_status"
  fi
}

# ── Free disk space (Linux) ───────────────────────────────────────────────
# The image is pulled by `jht up`, after this installer has finished, so a disk
# that cannot hold it used to surface as a failed start with no reason. Refuse
# here instead, before Docker is installed or anything is written. JHT_MIN_FREE_GIB
# overrides the minimum; macOS keeps its disk inside the container VM.
MIN_FREE_GIB="${JHT_MIN_FREE_GIB:-5}"

free_kib() {
  df -Pk "$1" 2>/dev/null | awk 'NR==2 {print $4}'
}

check_free_disk() {
  case "$OS" in linux|wsl) ;; *) return 0 ;; esac
  case "$MIN_FREE_GIB" in ''|*[!0-9]*) fail "Invalid JHT_MIN_FREE_GIB: $MIN_FREE_GIB" ;; esac
  # Where the image lands (Docker's data root, else its parent) and where the
  # team's data lands. A separate Docker volume is judged on its own.
  local path free_kib_value docker_root=/var/lib
  [ -d /var/lib/docker ] && docker_root=/var/lib/docker
  for path in "$docker_root" "$HOME"; do
    [ -d "$path" ] || continue
    free_kib_value="$(free_kib "$path")"
    case "$free_kib_value" in ''|*[!0-9]*) continue ;; esac
    if [ "$free_kib_value" -lt $((MIN_FREE_GIB * 1024 * 1024)) ]; then
      if [ "$DRY_RUN" -eq 1 ]; then
        warn "Only $((free_kib_value / 1024 / 1024)) GiB free on $path; a real install needs at least $MIN_FREE_GIB GiB."
        return 0
      fi
      fail "not enough free disk space: $((free_kib_value / 1024 / 1024)) GiB free on $path, the Job Hunter Team image and its data need at least $MIN_FREE_GIB GiB. Free some space (on a server that already runs Docker, 'docker image prune -af' removes unused images) and run the installer again. Nothing was changed."
    fi
  done
}

# ── Main ──────────────────────────────────────────────────────────────────
# Test channel: pull the image and refuse it unless its RepoDigests carry the
# expected digest, before anything of the runtime is published. A tag can
# move; the digest cannot.
# The engine the runtime will run on, in RUNTIME_ENGINE. On the Mac's Podman
# path DOCKER_CLI stays "docker" (no Docker client is resolved there): the JHT
# machine is reached through its own connection, never through another Docker
# that happens to be installed.
set_runtime_engine() {
  RUNTIME_ENGINE=("$DOCKER_CLI")
  if podman_machine_mode; then
    RUNTIME_ENGINE=(podman --connection "$PODMAN_MACHINE_NAME")
  elif podman_native_mode; then
    RUNTIME_ENGINE=(podman)
  fi
}

# ── A team already running (re-install) ──────────────────────────────────
# A re-install publishes a new compose (and, on the test channel, a new image
# pin). The wrapper attests the running team against them: a team started
# with the previous ones no longer matches, and `jht up`, `restart` and
# `recreate` refuse it. So the installer stops before changing anything while
# the team's containers run, and says how to go on. It never stops the agents
# by itself. Its own exit, like 85, so the app can say what it means: a line
# `JHT_ERROR team_running` on stderr (for the app only), then exit 84.
TEAM_RUNNING_EXIT=84
TEAM_CONTAINERS="jht jht-broker jht-telegram"
refuse_running_team() {
  set_runtime_engine
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would refuse if %s run (%s ps)\n" "$TEAM_CONTAINERS" "${RUNTIME_ENGINE[*]}"
    return 0
  fi
  local names name running=""
  if ! names="$("${RUNTIME_ENGINE[@]}" ps --format '{{.Names}}' 2>/dev/null)"; then
    # Nothing of JHT published here before: no team of ours can be running.
    [ -e "$RUNTIME_DIR/.runtime-integrity" ] || [ -L "$RUNTIME_DIR/.runtime-integrity" ] || return 0
    fail "Cannot list the running containers with ${RUNTIME_ENGINE[*]}: nothing was installed."
  fi
  for name in $TEAM_CONTAINERS; do
    printf '%s\n' "$names" | grep -Fqx "$name" && running="${running:+$running, }$name"
  done
  [ -z "$running" ] && return 0
  jht_error_marker team_running
  if [ "$(installer_person_lang)" = it ]; then
    printf "  ${RED}✗${RESET} %s%s\n" "$(jht_code_prefix team_running)" "Job Hunter Team e' acceso su questo computer ($running). Se il setup si era interrotto, riprendilo con «jht setup» in questo terminale; non serve spegnere niente. Per reinstallare invece: spegnilo con «jht down», rilancia l'installer, poi riaccendilo con «jht up». Non e' stato cambiato niente: il tuo profilo e i tuoi documenti in ~/.jht e ~/Documents/Job Hunter Team restano dove sono." >&2
    exit "$TEAM_RUNNING_EXIT"
  fi
  printf "  ${RED}✗${RESET} %s%s\n" "$(jht_code_prefix team_running)" "Job Hunter Team is running on this computer ($running). If setup was interrupted, resume it with «jht setup» in this terminal; no down is needed. To reinstall instead, stop it with «jht down», run the installer again, then start it with «jht up». Nothing was changed: your profile and documents in ~/.jht and ~/Documents/Job Hunter Team stay where they are." >&2
  exit "$TEAM_RUNNING_EXIT"
}

verify_test_image() {
  [ "$TEST_CHANNEL" -eq 1 ] || return 0
  local wanted="ghcr.io/leopu00/jht@$EXPECTED_IMAGE_DIGEST" digests
  set_runtime_engine
  local engine=("${RUNTIME_ENGINE[@]}")
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would pull %s with %s and require %s\n" "$IMAGE" "${engine[*]}" "$wanted"
    return 0
  fi
  info "$(tx "Pulling the test image $IMAGE..." "Scarico l'immagine di prova $IMAGE...")"
  "${engine[@]}" pull "$IMAGE" >/dev/null || fail "Cannot pull the test image $IMAGE."
  digests="$("${engine[@]}" image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$IMAGE" 2>/dev/null)" \
    || fail "Cannot inspect the test image $IMAGE."
  printf '%s\n' "$digests" | grep -Fqx "$wanted" \
    || fail "The test image $IMAGE is not $EXPECTED_IMAGE_DIGEST: nothing was installed."
  ok "$(tx "test image: $wanted" "immagine di prova: $wanted")"
}

main_docker() {
  detect_system "$TOTAL_STEPS_DOCKER"
  check_free_disk
  install_container_runtime
  verify_docker_works
  refuse_running_team
  verify_test_image
  download_runtime_files
}

main_native() {
  detect_system "$TOTAL_STEPS_NATIVE"
  install_system_deps
  install_node
  clone_repo
  build_jht
  link_bin_native
}

main() {
  if [ "$PUBLISH_RUNTIME_BUNDLE" -eq 1 ]; then
    publish_runtime_candidate_bundle
    return 0
  fi
  [ "$USE_DOCKER" -eq 1 ] && keep_chosen_runtime
  header
  if [ "$USE_DOCKER" -eq 1 ]; then
    main_docker
  else
    main_native
  fi
  refuse_foreign_bind_uid
  save_pairing_token
  run_host_setup
  final_message
  maybe_onboard; local wizard_result=$?; printf '\n  %s export PATH=%q:"$PATH"\n' "$(tx "In this terminal, run:" "In questo terminale, lancia:")" "$BIN_DIR"; return "$wizard_result"
}

if [ "${JHT_INSTALLER_SOURCE_ONLY:-0}" != "1" ]; then
  main
fi
