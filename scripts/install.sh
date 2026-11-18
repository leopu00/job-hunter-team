#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  Job Hunter Team — Installer (Podman by default)                         ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  Usage:                                                                  ║
# ║    curl -fsSL https://jobhunterteam.ai/install.sh | bash                 ║
# ║                                                                          ║
# ║    # "Expert mode" install without a container:                          ║
# ║    curl -fsSL https://jobhunterteam.ai/install.sh \                      ║
# ║      | bash -s -- --no-docker                                            ║
# ║                                                                          ║
# ║  Default (container mode): installs nothing on the host except Podman.   ║
# ║  Downloads:                                                              ║
# ║    - host runtime outside $HOME/.jht (compose + preflight)               ║
# ║    - $HOME/.local/bin/jht         (the bash wrapper)                     ║
# ║  The Node CLI, Python, tmux and the agents ALL run inside the long-      ║
# ║  running container managed by compose. No Node/Python/tmux on the host.  ║
# ║  No engine socket inside the container.                                  ║
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
IMAGE="${JHT_IMAGE:-ghcr.io/leopu00/jht@sha256:dd723873b6898717f94ac20fdb6fb049f52b4bb1d5d18cd13541878d78e4575d}"
# The full image, also when the install starts from the core one: it follows by itself after the setup (the room for it counts).
FULL_IMAGE="$IMAGE"
# The core image (tools come later): empty while the release has none; with one, the install uses it unless JHT_IMAGE names another.
CORE_IMAGE_DIGEST="${JHT_CORE_IMAGE_DIGEST:-sha256:2bb7ff3ca65b6e8afc9c9929d5de6bcd0f481384edcf4f4d782fb8e91665cea1}"
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
    # Read with the arguments, before the functions that say a sentence in the person's language: English, like «Unrecognized argument».
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
# ts <key> '<English>': the sentence in the person's language (installer_person_lang), in the 7 languages of shared/locales. The
# installer runs before anything of JHT is on the computer (often `curl … | bash`), so the texts are written inside it, in the block
# below, made from the catalogs by `python3 tests/installer_texts.py --write`; a test fails when the two differ. A key a language
# lacks says the English of the call. tsf <key> '<English with %s/%d>' values...: the same, with the values put in (in the same
# order in every language).
ts()    { ts_table "$(installer_person_lang)" "$1" || printf '%s' "$2"; }
tsf() {
  local format
  format="$(ts "$1" "$2")"
  shift 2
  # shellcheck disable=SC2059
  printf -- "$format" "$@"
}

# >>> texts in the 7 languages, made from shared/locales by `python3 tests/installer_texts.py --write`: do not edit by hand
ts_table() {
  case "$1:$2" in
    en:installer.agents_can_only_see) printf '%s' 'The agents can only see:' ;;
    en:installer.already_path) printf '%s' '%s already in PATH' ;;
    en:installer.also_delete_your_data) printf '%s' 'To also delete your data (config, db, CVs, output):' ;;
    en:installer.also_deletes_api_key) printf '%s' '(it also deletes the API key, the mail password and the Telegram tokens saved for the team)' ;;
    en:installer.apt_get_update_failed) printf '%s' 'apt-get update failed: trying the install anyway.' ;;
    en:installer.branch) printf '%s' 'branch:  ' ;;
    en:installer.cannot_list_containers) printf '%s' 'Cannot list the running containers with %s: nothing was installed.' ;;
    en:installer.check.adapter_bad_ancestor) printf '%s' 'Podman adapter bin has a non-canonical ancestor: %s' ;;
    en:installer.check.adapter_is_link) printf '%s' 'Podman adapter bin path is a symlink: %s' ;;
    en:installer.check.adapter_not_dir) printf '%s' 'Podman adapter bin path is not a directory: %s' ;;
    en:installer.check.branch_unresolved) printf '%s' 'Cannot resolve branch '\''%s'\'' to an immutable release commit.' ;;
    en:installer.check.compose_boundary) printf '%s' 'Downloaded compose does not enforce the protected runtime boundary.' ;;
    en:installer.check.compose_gone) printf '%s' 'Podman Compose provider disappeared after installation.' ;;
    en:installer.check.compose_version_unreadable) printf '%s' 'Podman Compose provider version probe failed.' ;;
    en:installer.check.digests_not_written) printf '%s' 'the digests of the host scripts were not written' ;;
    en:installer.check.machine_name_invalid) printf '%s' 'Invalid JHT Podman machine name: %s' ;;
    en:installer.check.marker_invalid) printf '%s' 'Invalid JHT runtime selection marker' ;;
    en:installer.check.marker_unsafe) printf '%s' 'Unsafe JHT runtime selection marker: %s' ;;
    en:installer.check.os_unsupported) printf '%s' 'Unsupported operating system: %s' ;;
    en:installer.check.podman_gone) printf '%s' 'Podman CLI disappeared after installation.' ;;
    en:installer.check.podman_not_on_path) printf '%s' 'podman disappeared from PATH' ;;
    en:installer.check.podman_path_unsafe) printf '%s' 'Unsafe Podman executable path: %s' ;;
    en:installer.check.shim_unsafe) printf '%s' 'Refusing to overwrite an unsafe or non-JHT executable: %s' ;;
    en:installer.check.wrapper_protocol) printf '%s' 'Downloaded wrapper does not implement the protected runtime protocol.' ;;
    en:installer.chown_not_needed) printf '%s' 'chown to 1001 failed — nothing runs in a container here (--no-docker), so nothing needs it' ;;
    en:installer.config_db_agents) printf '%s' '(config, db, agents)' ;;
    en:installer.configuration_wizard_also_starts) printf '%s' 'configuration wizard (also starts the container)' ;;
    en:installer.container_mode_active_podman) printf '%s' 'Container mode active (Podman).' ;;
    en:installer.container_runtime) printf '%s' 'Container runtime' ;;
    en:installer.container_runtime_check) printf '%s' 'Container runtime check' ;;
    en:installer.container_runtime_podman_rootless) printf '%s' 'Container runtime (Podman rootless)' ;;
    en:installer.container_will_complete_pairing) printf '%s' 'The container will complete the pairing on first boot.' ;;
    en:installer.creating_rootless_podman_machine) printf '%s' 'Creating rootless Podman machine '\''%s'\''...' ;;
    en:installer.cvs_attachments_output) printf '%s' '(CVs, attachments, output)' ;;
    en:installer.disk_low_dry_run) printf '%s' 'Only %s GiB free on %s; a real install needs at least %s GiB.' ;;
    en:installer.disk_not_enough) printf '%s' 'not enough free disk space: %s GiB free on %s, the Job Hunter Team image and its data need at least %s GiB. Free some space (on a server that already runs Docker, '\''docker image prune -af'\'' removes unused images) and run the installer again. Nothing was changed.' ;;
    en:installer.disk_room_short) printf '%s' 'Job Hunter Team downloads about %s GiB, and after the download the agents would have less than the %s GiB of disk they need: %s GiB are free now. Free at least %s GiB more (empty the Trash, delete large files you do not need), then run the installer again: nothing was downloaded, and the version of Job Hunter Team you have installed was not touched.' ;;
    en:installer.done_compose) printf '%s' 'compose: %s' ;;
    en:installer.done_host_setup) printf '%s' 'host-setup: %s' ;;
    en:installer.done_wrapper) printf '%s' 'wrapper: %s' ;;
    en:installer.download_failed) printf '%s' 'Download failed: %s. Check your connection and branch (%s).' ;;
    en:installer.download_wrapper_docker_compose) printf '%s' 'Download wrapper + docker-compose.yml' ;;
    en:installer.downloading_docker_compose_yml) printf '%s' 'Downloading docker-compose.yml...' ;;
    en:installer.downloading_host_setup_sh) printf '%s' 'Downloading host-setup.sh (VPS/swap preflight)...' ;;
    en:installer.downloading_jht_wrapper) printf '%s' 'Downloading jht wrapper...' ;;
    en:installer.enabling_linger) printf '%s' 'Enabling linger for %s...' ;;
    en:installer.existing_podman_machine_has) printf '%s' 'Existing Podman machine '\''%s'\'' has resources '\''%s'\''; JHT recommends %s CPU, %s MiB RAM and %s GiB disk. The existing machine was not changed.' ;;
    en:installer.extras_image_pinned_ghcr) printf '%s' 'extras image pinned: ghcr.io/leopu00/jht@%s (pulled when a tool is asked for)' ;;
    en:installer.giving_subordinate_uid_gid) printf '%s' 'Giving %s the subordinate uid/gid range %s-%s...' ;;
    en:installer.helper_download_failed) printf '%s' '%s download or validation failed: %s/scripts/%s' ;;
    en:installer.host_file_tmp_failed) printf '%s' 'cannot create a temporary file in %s: not writing %s' ;;
    en:installer.host_setup_completed_auto) printf '%s' 'host-setup completed (auto-detected host type)' ;;
    en:installer.host_setup_completed_forced) printf '%s' 'host-setup completed (forced vps)' ;;
    en:installer.host_setup_download_failed) printf '%s' 'host-setup.sh download or validation failed: %s' ;;
    en:installer.host_setup_exited_error) printf '%s' 'host-setup exited with an error — continuing (a manual pair may be needed)' ;;
    en:installer.host_setup_exited_error_2) printf '%s' 'host-setup exited with an error — continuing' ;;
    en:installer.host_setup_missing) printf '%s' 'host-setup.sh not available at %s — skipping preflight' ;;
    en:installer.image) printf '%s' 'image:   ' ;;
    en:installer.image_download_failed) printf '%s' 'JHT image download failed: %s' ;;
    en:installer.installation_complete) printf '%s' 'Installation complete!' ;;
    en:installer.installed) printf '%s' 'Installed:%s' ;;
    en:installer.installing_podman_cli) printf '%s' 'Installing Podman CLI...' ;;
    en:installer.installing_podman_compose_provider) printf '%s' 'Installing the Podman Compose provider...' ;;
    en:installer.installing_sudo_podman_rootless) printf '%s' 'Installing%s with sudo (Podman rootless; Docker is not installed)...' ;;
    en:installer.linger_enabled) printf '%s' 'linger enabled for %s' ;;
    en:installer.loginctl_not_found_linger) printf '%s' 'loginctl not found: linger was not checked.' ;;
    en:installer.mac.cannot_create_folder) printf '%s' 'Cannot create %s for the Podman machine.' ;;
    en:installer.mac.compose_install_failed) printf '%s' 'podman-compose installation failed' ;;
    en:installer.mac.compose_version_unsupported) printf '%s' 'JHT on a Mac needs podman-compose %s; this Mac has %s. Run «brew upgrade podman-compose» (or «brew install podman-compose»), then this installer again.' ;;
    en:installer.mac.homebrew_missing) printf '%s' 'JHT installs Podman with Homebrew, which is not on this Mac. Nothing was changed. Install Homebrew from https://brew.sh (one command in Terminal; it asks for your Mac password), open a new Terminal window and run this installer again.' ;;
    en:installer.mac.machine_init_failed) printf '%s' 'Podman machine initialization failed; Colima was not changed.' ;;
    en:installer.mac.machine_name_placeholder) printf '%s' '<name>' ;;
    en:installer.mac.machine_not_responding) printf '%s' 'The JHT Podman machine is not responding.' ;;
    en:installer.mac.machine_start_failed) printf '%s' 'Podman machine start failed; Colima was not changed.' ;;
    en:installer.mac.machine_unreachable) printf '%s' 'Podman machine '\''%s'\'' is not reachable.' ;;
    en:installer.mac.other_machine_any) printf '%s' 'another Podman machine is running (find it with '\''podman machine list'\'')' ;;
    en:installer.mac.other_machine_named) printf '%s' 'another Podman machine, %s, is running' ;;
    en:installer.mac.other_machine_running) printf '%s' '%s, and a Mac runs only one at a time. Stop it with '\''podman machine stop %s'\'' (or from the app you use it with) and run the installer again: Job Hunter Team never stops it for you, and you can start it again afterwards.' ;;
    en:installer.mac.podman_install_failed) printf '%s' 'Podman installation failed' ;;
    en:installer.mac.podman_no_version) printf '%s' 'a podman that does not say its version' ;;
    en:installer.mac.podman_version_unsupported) printf '%s' 'JHT on a Mac needs Podman %s.%s or a later %s.x (not 6.2 or later); this Mac has %s. If Homebrew moved Podman past the %s series, get the JHT installer of today again (it says which series it supports); nothing of JHT was installed.' ;;
    en:installer.migration.colima_default) printf '%s' 'If you installed Colima only for JHT, after the uninstall its virtual machine (profile default, the one the JHT installer started) stays on the disk, stopped: remove it with «colima delete -p default» to free the space. If you use Colima for other things, leave it.' ;;
    en:installer.migration.colima_started) printf '%s' 'After the uninstall the Colima virtual machine JHT created (profile %s) stays on the disk, stopped: if you use it for nothing else, remove it with «colima delete -p %s» to free the space.' ;;
    en:installer.migration.refused) printf '%s' 'this computer runs JHT on Docker (Colima, Docker Desktop or Docker Engine). Since 0.4 JHT runs only on Podman, and nothing was changed. Your data stays: ~/.jht (configuration, database, profile) and ~/Documents/Job Hunter Team (CVs, outputs) are folders of this computer. What stays behind in Docker'\''s volumes and has to be given again: the API key kept by the setup, the mail password, the Telegram tokens. To move to Podman: %s, run this installer again, then «jht setup» with your API key.%s' ;;
    en:installer.migration.uninstall) printf '%s' 'run «jht uninstall --confirm» (it keeps those two folders)' ;;
    en:installer.migration.uninstall_old_jht) printf '%s' 'your jht command is from a version that cannot uninstall itself, so use the one of this version: «f="$(mktemp)" && curl -fsSL '\''%s'\'' -o "$f" && bash "$f" uninstall --confirm; rm -f "$f"» (it removes the JHT on Docker and the old jht command, and keeps those two folders)' ;;
    en:installer.min_free_invalid) printf '%s' 'Invalid JHT_MIN_FREE_GIB: %s' ;;
    en:installer.mode) printf '%s' 'mode:    ' ;;
    en:installer.mount_repair_failed) printf '%s' '%s and %s cannot be made writable for the Job Hunter Team container (it runs as uid 1001) and nothing was started. Either let Docker run for this account (add it to the '\''docker'\'' group, then log in again), or run once: sudo chown -R 1001:1001 "%s" "%s" — then run this installer again.' ;;
    en:installer.next_step_run_finish) printf '%s' 'Next step: run  %s  to finish the setup.' ;;
    en:installer.next_steps) printf '%s' 'Next steps:' ;;
    en:installer.no_interactive_terminal_no) printf '%s' 'No interactive terminal (no /dev/tty): skipping the wizard.' ;;
    en:installer.no_shell_rc_file) printf '%s' 'No shell rc file was written. Add manually:' ;;
    en:installer.open_new_terminal_window) printf '%s' 'Open a new terminal window first (or run: . ~/.profile), so that it finds jht.' ;;
    en:installer.ownership_1001_1001_container) printf '%s' 'Ownership %s and %s → 1001:1001 (container UID)' ;;
    en:installer.ownership_1001_1001_container_2) printf '%s' 'Ownership %s and %s → 1001:1001 (container UID, set by a one-shot container: no sudo needed)' ;;
    en:installer.ownership_stays_user_macos) printf '%s' 'Ownership of %s and %s stays with this user (macOS)' ;;
    en:installer.ownership_stays_user_rootless) printf '%s' 'Ownership of %s and %s stays with this user (rootless Podman)' ;;
    en:installer.pairing_token_present_skipping) printf '%s' 'Pairing token present: skipping the interactive wizard.' ;;
    en:installer.pairing_token_saved) printf '%s' 'Pairing token saved to %s (mode 0600)' ;;
    en:installer.path_added) printf '%s' 'PATH added to %s' ;;
    en:installer.path_added_etc_profile) printf '%s' 'PATH added to /etc/profile.d/jht.sh (system-wide)' ;;
    en:installer.podman.answers_rootful) printf '%s' 'podman answers as rootful for %s (Rootless=%s): JHT needs Podman rootless.' ;;
    en:installer.podman.apt_failed) printf '%s' 'apt-get install%s failed. To see why, run: sudo apt-get install%s' ;;
    en:installer.podman.apt_would_remove) printf '%s' 'installing%s would REMOVE other packages of this computer (often containerd.io, Docker'\''s): nothing was changed. To see which, run: sudo apt-get -s install%s. Install Podman yourself in a way that keeps them (or decide to remove them), then run this installer again.' ;;
    en:installer.podman.compose_missing) printf '%s' 'podman-compose is not available from this system'\''s packages. Ask the administrator of this server to install it, as root: apt install podman-compose' ;;
    en:installer.podman.compose_too_old) printf '%s' 'podman-compose %s is older than %s. Ask the administrator of this server for a newer podman-compose.' ;;
    en:installer.podman.distribution_too_old) printf '%s' 'this distribution would install %s %s, and Job Hunter Team 0.4.0 needs %s %s or later: nothing was installed. Distributions that give it: Ubuntu 26.04 LTS, Debian 13, Fedora 43 or later.' ;;
    en:installer.podman.dnf_failed) printf '%s' 'dnf install%s failed (dnf removes nothing: a conflict with an installed package stops it). To see why, run: sudo dnf install%s' ;;
    en:installer.podman.info_fails) printf '%s' ''\''podman info'\'' fails for %s, so the rootless storage or runtime is not ready. Run it by hand to see why.' ;;
    en:installer.podman.linger_failed) printf '%s' 'loginctl enable-linger %s failed.' ;;
    en:installer.podman.linger_missing) printf '%s' 'the containers of %s would stop when the session ends. Ask the administrator of this server to run, as root: loginctl enable-linger %s' ;;
    en:installer.podman.missing_default) printf '%s' 'the subuid range or linger' ;;
    en:installer.podman.no_package_manager) printf '%s' 'no known package manager (apt, dnf, pacman) to install:%s' ;;
    en:installer.podman.pacman_failed) printf '%s' 'pacman -S%s failed (nothing was removed). To see why, run: sudo pacman -S%s' ;;
    en:installer.podman.root_refused) printf '%s' 'JHT runs on Podman rootless, as a user that is not root. Sign in as that user and run the install again.' ;;
    en:installer.podman.runtime_dir_missing) printf '%s' 'there is no runtime directory for this user (%s): the session has no user manager. Sign in again, or ask the administrator to run, as root: loginctl enable-linger %s' ;;
    en:installer.podman.still_missing) printf '%s' 'podman is still not there after the install. Ask the administrator of this server to run, as root: apt install podman' ;;
    en:installer.podman.subuid_missing) printf '%s' '%s has no subordinate uid/gid range in %s/subuid and %s/subgid. Ask the administrator of this server to run, as root: usermod --add-subuids 100000-165535 --add-subgids 100000-165535 %s' ;;
    en:installer.podman.sudo_required) printf '%s' 'Podman needs a setup that only an administrator can do (missing:%s), and sudo for %s is not available without a password. Ask the administrator of this server to allow %s sudo without a password, or to run, as root: apt install podman podman-compose uidmap; loginctl enable-linger %s' ;;
    en:installer.podman.too_old) printf '%s' 'podman %s is older than %s. Ask the administrator of this server for a newer podman.' ;;
    en:installer.podman.unknown_version) printf '%s' 'of unknown version' ;;
    en:installer.podman.unsupported_host) printf '%s' '--runtime podman is for Linux and macOS; this system is %s.' ;;
    en:installer.podman.usermod_failed) printf '%s' 'usermod could not add the subordinate range (%s-%s) for %s.' ;;
    en:installer.podman_already_installed) printf '%s' 'podman already installed' ;;
    en:installer.podman_compose_already_installed) printf '%s' 'podman-compose already installed' ;;
    en:installer.podman_machine_already_running) printf '%s' 'Podman machine '\''%s'\'' already running' ;;
    en:installer.podman_machine_reachable) printf '%s' 'Podman machine reachable' ;;
    en:installer.podman_ready_but_weekly) printf '%s' 'Podman is ready, but its weekly disk trim timer could not be enabled.' ;;
    en:installer.podman_ready_colima_retained) printf '%s' 'Podman ready (Colima retained)' ;;
    en:installer.podman_rootless_podman_compose) printf '%s' 'Podman rootless %s + podman-compose %s for %s' ;;
    en:installer.podman_rootless_reachable) printf '%s' 'podman rootless reachable' ;;
    en:installer.private_jht_docker_shim) printf '%s' 'Private JHT docker shim: %s (not added to global PATH; Colima untouched)' ;;
    en:installer.private_jht_docker_shim_2) printf '%s' 'Private JHT docker shim: %s (not added to global PATH; rootless Podman, no machine)' ;;
    en:installer.run_manually_jht_setup) printf '%s' 'Run manually: jht setup' ;;
    en:installer.running_host_setup_sh) printf '%s' 'Running host-setup.sh (writes ~/.jht/host.env + swap preflight)...' ;;
    en:installer.runtime) printf '%s' 'runtime: ' ;;
    en:installer.runtime_dir_bad_ancestor) printf '%s' 'Host runtime has a symlinked or non-canonical ancestor: %s' ;;
    en:installer.runtime_dir_in_mount) printf '%s' 'Host runtime must be outside container-writable bind mounts: %s' ;;
    en:installer.runtime_dir_is_link) printf '%s' 'Host runtime path is a symlink: %s' ;;
    en:installer.runtime_image_pinned) printf '%s' 'runtime image pinned: %s' ;;
    en:installer.runtime_tier_core_tools) printf '%s' 'runtime tier: core (the tools come after the welcome)' ;;
    en:installer.same_as_above_empties) printf '%s' '(same as above, and it empties ~/.jht and ~/Documents/Job Hunter Team too)' ;;
    en:installer.setup_did_not_finish) printf '%s' 'The setup did not finish (exit code %s): Job Hunter Team is installed, but it is not set up yet.' ;;
    en:installer.setup_done_team_needs_space) printf '%s' 'The setup is done and saved, but the team did not start: the disk needs more free space. Free it as said above, then start the team with  jht team start  (no need to run the setup again).' ;;
    en:installer.starting_podman_machine) printf '%s' 'Starting Podman machine '\''%s'\''...' ;;
    en:installer.subuid_subgid_range) printf '%s' 'subuid/subgid range %s-%s for %s' ;;
    en:installer.system_detection) printf '%s' 'System detection' ;;
    en:installer.team_running) printf '%s' 'Job Hunter Team is running on this computer (%s). If setup was interrupted, resume it with «jht setup» in this terminal; no down is needed. To reinstall instead, stop it with «jht down», run the installer again, then start it with «jht up». Nothing was changed: your profile and documents in ~/.jht and ~/Documents/Job Hunter Team stay where they are.' ;;
    en:installer.team_running_update) printf '%s' 'Job Hunter Team is running on this computer (%s). To update it, stop it with «jht down», run the installer again, then start it with «jht up». Nothing was changed: your profile and documents in ~/.jht and ~/Documents/Job Hunter Team stay where they are.' ;;
    en:installer.terminal_run) printf '%s' 'In this terminal, run:' ;;
    en:installer.uid_1001_taken) printf '%s' 'uid 1001 on this computer is the account '\''%s'\''. The Job Hunter Team container runs as uid 1001, so that account would own ~/.jht (your data and the portal credentials). Nothing was changed. Run JHT from the account '\''%s'\'', or give '\''%s'\'' another uid, then try again.' ;;
    en:installer.uninstall_keeps_your_data) printf '%s' 'To uninstall (keeps your data in ~/.jht and ~/Documents/Job Hunter Team):' ;;
    en:installer.wrapper_dir_bad_ancestor) printf '%s' 'Host wrapper directory has a symlinked or non-canonical ancestor: %s' ;;
    en:installer.wrapper_dir_in_mount) printf '%s' 'Host wrapper must be outside container-writable bind mounts: %s' ;;
    en:installer.wsl_not_supported) printf '%s' 'on Windows, install JHT from PowerShell with install.ps1 (see docs/guides/QUICKSTART.md), not from inside WSL. Nothing was changed.' ;;
    it:installer.agents_can_only_see) printf '%s' 'Gli agenti vedono solo:' ;;
    it:installer.already_path) printf '%s' '%s e'\'' gia'\'' nel PATH' ;;
    it:installer.also_delete_your_data) printf '%s' 'Per cancellare anche i tuoi dati (configurazione, db, CV, risultati):' ;;
    it:installer.also_deletes_api_key) printf '%s' '(cancella anche la chiave API, la password della posta e i token di Telegram salvati per la squadra)' ;;
    it:installer.apt_get_update_failed) printf '%s' 'apt-get update non e'\'' riuscito: provo comunque a installare.' ;;
    it:installer.branch) printf '%s' 'ramo:     ' ;;
    it:installer.cannot_list_containers) printf '%s' 'Non riesco a elencare i container accesi con %s: non e'\'' stato installato niente.' ;;
    it:installer.check.adapter_bad_ancestor) printf '%s' 'La cartella dell'\''adattatore di Podman ha sopra di se'\'' un collegamento o un percorso non canonico: %s' ;;
    it:installer.check.adapter_is_link) printf '%s' 'La cartella dell'\''adattatore di Podman e'\'' un collegamento: %s' ;;
    it:installer.check.adapter_not_dir) printf '%s' 'La cartella dell'\''adattatore di Podman non e'\'' una cartella: %s' ;;
    it:installer.check.branch_unresolved) printf '%s' 'Non riesco a ricondurre il ramo '\''%s'\'' a un commit di rilascio immutabile.' ;;
    it:installer.check.compose_boundary) printf '%s' 'Il docker-compose.yml scaricato non applica il confine protetto del runtime.' ;;
    it:installer.check.compose_gone) printf '%s' 'Il provider di Podman Compose e'\'' sparito dopo l'\''installazione.' ;;
    it:installer.check.compose_version_unreadable) printf '%s' 'Non riesco a leggere la versione del provider di Podman Compose.' ;;
    it:installer.check.digests_not_written) printf '%s' 'le impronte degli script dell'\''host non sono state scritte' ;;
    it:installer.check.machine_name_invalid) printf '%s' 'Nome della macchina Podman di JHT non valido: %s' ;;
    it:installer.check.marker_invalid) printf '%s' 'Il marcatore del motore scelto per JHT non e'\'' valido' ;;
    it:installer.check.marker_unsafe) printf '%s' 'Il marcatore del motore scelto per JHT non e'\'' sicuro: %s' ;;
    it:installer.check.os_unsupported) printf '%s' 'Sistema operativo non supportato: %s' ;;
    it:installer.check.podman_gone) printf '%s' 'La CLI di Podman e'\'' sparita dopo l'\''installazione.' ;;
    it:installer.check.podman_not_on_path) printf '%s' 'podman e'\'' sparito dal PATH' ;;
    it:installer.check.podman_path_unsafe) printf '%s' 'Il percorso dell'\''eseguibile di Podman non e'\'' sicuro: %s' ;;
    it:installer.check.shim_unsafe) printf '%s' 'Non sovrascrivo un eseguibile non sicuro o non di JHT: %s' ;;
    it:installer.check.wrapper_protocol) printf '%s' 'Il wrapper scaricato non implementa il protocollo protetto del runtime.' ;;
    it:installer.chown_not_needed) printf '%s' 'chown a 1001 non riuscito: qui non gira niente in un container (--no-docker), quindi non serve' ;;
    it:installer.config_db_agents) printf '%s' '(configurazione, db, agenti)' ;;
    it:installer.configuration_wizard_also_starts) printf '%s' 'configurazione guidata (accende anche il container)' ;;
    it:installer.container_mode_active_podman) printf '%s' 'Modalita'\'' container attiva (Podman).' ;;
    it:installer.container_runtime) printf '%s' 'Motore dei container' ;;
    it:installer.container_runtime_check) printf '%s' 'Verifica del motore dei container' ;;
    it:installer.container_runtime_podman_rootless) printf '%s' 'Motore dei container (Podman rootless)' ;;
    it:installer.container_will_complete_pairing) printf '%s' 'Il container completera'\'' l'\''abbinamento al primo avvio.' ;;
    it:installer.creating_rootless_podman_machine) printf '%s' 'Creo la macchina Podman rootless '\''%s'\''...' ;;
    it:installer.cvs_attachments_output) printf '%s' '(CV, allegati, risultati)' ;;
    it:installer.disk_low_dry_run) printf '%s' 'Solo %s GiB liberi su %s; un'\''installazione vera ne vuole almeno %s GiB.' ;;
    it:installer.disk_not_enough) printf '%s' 'spazio libero su disco insufficiente: %s GiB liberi su %s, l'\''immagine di Job Hunter Team e i suoi dati vogliono almeno %s GiB. Libera un po'\'' di spazio (su un server che usa gia'\'' Docker, '\''docker image prune -af'\'' toglie le immagini non usate) e rilancia l'\''installer. Non e'\'' stato cambiato niente.' ;;
    it:installer.disk_room_short) printf '%s' 'Job Hunter Team scarica circa %s GiB, e dopo il download agli agenti resterebbero meno dei %s GiB di disco che servono: ora ne sono liberi %s. Libera almeno altri %s GiB (svuota il Cestino, elimina i file grandi che non ti servono), poi rilancia l'\''installer: non è stato scaricato niente, e la versione di Job Hunter Team che hai installata non è stata toccata.' ;;
    it:installer.done_compose) printf '%s' 'compose: %s' ;;
    it:installer.done_host_setup) printf '%s' 'host-setup: %s' ;;
    it:installer.done_wrapper) printf '%s' 'wrapper: %s' ;;
    it:installer.download_failed) printf '%s' 'Download non riuscito: %s. Controlla la connessione e il ramo (%s).' ;;
    it:installer.download_wrapper_docker_compose) printf '%s' 'Scarico il wrapper e docker-compose.yml' ;;
    it:installer.downloading_docker_compose_yml) printf '%s' 'Scarico docker-compose.yml...' ;;
    it:installer.downloading_host_setup_sh) printf '%s' 'Scarico host-setup.sh (controlli preliminari VPS/swap)...' ;;
    it:installer.downloading_jht_wrapper) printf '%s' 'Scarico il wrapper jht...' ;;
    it:installer.enabling_linger) printf '%s' 'Attivo il linger per %s...' ;;
    it:installer.existing_podman_machine_has) printf '%s' 'La macchina Podman '\''%s'\'' che c'\''e'\'' gia'\'' ha le risorse '\''%s'\''; JHT consiglia %s CPU, %s MiB di RAM e %s GiB di disco. La macchina non e'\'' stata cambiata.' ;;
    it:installer.extras_image_pinned_ghcr) printf '%s' 'immagine extras fissata: ghcr.io/leopu00/jht@%s (si scarica quando serve uno strumento)' ;;
    it:installer.giving_subordinate_uid_gid) printf '%s' 'Assegno a %s l'\''intervallo di uid/gid subordinati %s-%s...' ;;
    it:installer.helper_download_failed) printf '%s' 'download o verifica di %s non riusciti: %s/scripts/%s' ;;
    it:installer.host_file_tmp_failed) printf '%s' 'non riesco a creare un file temporaneo in %s: non scrivo %s' ;;
    it:installer.host_setup_completed_auto) printf '%s' 'host-setup completato (tipo di host rilevato da solo)' ;;
    it:installer.host_setup_completed_forced) printf '%s' 'host-setup completato (vps imposto)' ;;
    it:installer.host_setup_download_failed) printf '%s' 'download o verifica di host-setup.sh non riusciti: %s' ;;
    it:installer.host_setup_exited_error) printf '%s' 'host-setup e'\'' uscito con un errore: continuo (puo'\'' servire un abbinamento a mano)' ;;
    it:installer.host_setup_exited_error_2) printf '%s' 'host-setup e'\'' uscito con un errore: continuo' ;;
    it:installer.host_setup_missing) printf '%s' 'host-setup.sh non c'\''e'\'' in %s: salto i controlli preliminari' ;;
    it:installer.image) printf '%s' 'immagine: ' ;;
    it:installer.image_download_failed) printf '%s' 'Il download dell'\''immagine di JHT non e'\'' riuscito: %s' ;;
    it:installer.installation_complete) printf '%s' 'Installazione completata!' ;;
    it:installer.installed) printf '%s' 'Installato:%s' ;;
    it:installer.installing_podman_cli) printf '%s' 'Installo la CLI di Podman...' ;;
    it:installer.installing_podman_compose_provider) printf '%s' 'Installo il provider di Podman Compose...' ;;
    it:installer.installing_sudo_podman_rootless) printf '%s' 'Installo%s con sudo (Podman rootless; Docker non viene installato)...' ;;
    it:installer.linger_enabled) printf '%s' 'linger attivo per %s' ;;
    it:installer.loginctl_not_found_linger) printf '%s' 'loginctl non trovato: il linger non e'\'' stato controllato.' ;;
    it:installer.mac.cannot_create_folder) printf '%s' 'Non riesco a creare %s per la macchina Podman.' ;;
    it:installer.mac.compose_install_failed) printf '%s' 'l'\''installazione di podman-compose non e'\'' riuscita' ;;
    it:installer.mac.compose_version_unsupported) printf '%s' 'JHT su un Mac vuole podman-compose %s; questo Mac ha %s. Lancia «brew upgrade podman-compose» (o «brew install podman-compose»), poi di nuovo questo installer.' ;;
    it:installer.mac.homebrew_missing) printf '%s' 'JHT installa Podman con Homebrew, che su questo Mac non c'\''e'\''. Non e'\'' stato cambiato niente. Installa Homebrew da https://brew.sh (un comando nel Terminale; chiede la password del Mac), apri una nuova finestra del Terminale e rilancia questo installer.' ;;
    it:installer.mac.machine_init_failed) printf '%s' 'La creazione della macchina Podman non e'\'' riuscita; Colima non e'\'' stato cambiato.' ;;
    it:installer.mac.machine_name_placeholder) printf '%s' '<nome>' ;;
    it:installer.mac.machine_not_responding) printf '%s' 'La macchina Podman di JHT non risponde.' ;;
    it:installer.mac.machine_start_failed) printf '%s' 'L'\''avvio della macchina Podman non e'\'' riuscito; Colima non e'\'' stato cambiato.' ;;
    it:installer.mac.machine_unreachable) printf '%s' 'La macchina Podman '\''%s'\'' non e'\'' raggiungibile.' ;;
    it:installer.mac.other_machine_any) printf '%s' 'un'\''altra macchina Podman e'\'' accesa (trovala con '\''podman machine list'\'')' ;;
    it:installer.mac.other_machine_named) printf '%s' 'un'\''altra macchina Podman, %s, e'\'' accesa' ;;
    it:installer.mac.other_machine_running) printf '%s' '%s, e sul Mac ne puo'\'' girare una sola alla volta. Spegnila con '\''podman machine stop %s'\'' (o dall'\''app con cui la usi) e rilancia l'\''installer: Job Hunter Team non la spegne mai al posto tuo, e dopo potrai riaccenderla.' ;;
    it:installer.mac.podman_install_failed) printf '%s' 'L'\''installazione di Podman non e'\'' riuscita' ;;
    it:installer.mac.podman_no_version) printf '%s' 'un podman che non dice la sua versione' ;;
    it:installer.mac.podman_version_unsupported) printf '%s' 'JHT su un Mac vuole Podman %s.%s o un %s.x successivo (non 6.2 o successivi); questo Mac ha %s. Se Homebrew ha portato Podman oltre la serie %s, riscarica l'\''installer di JHT di oggi (dice quale serie supporta); non e'\'' stato installato niente di JHT.' ;;
    it:installer.migration.colima_default) printf '%s' 'Se Colima l'\''avevi installata solo per JHT, dopo la disinstallazione la sua macchina virtuale (profilo default, quello che accendeva l'\''installer di JHT) resta spenta sul disco: toglila con «colima delete -p default» per liberare lo spazio. Se usi Colima per altro, lasciala.' ;;
    it:installer.migration.colima_started) printf '%s' 'Dopo la disinstallazione la macchina virtuale Colima che aveva creato JHT (profilo %s) resta spenta sul disco: se non la usi per altro, toglila con «colima delete -p %s» per liberare lo spazio.' ;;
    it:installer.migration.refused) printf '%s' 'questo computer fa girare JHT su Docker (Colima, Docker Desktop o Docker Engine). Dalla 0.4 JHT gira solo su Podman, e non e'\'' stato cambiato niente. I tuoi dati restano: ~/.jht (configurazione, database, profilo) e ~/Documents/Job Hunter Team (CV, risultati) sono cartelle di questo computer. Resta invece nei volumi di Docker, e va ridato: la chiave API salvata dal setup, la password della posta, i token di Telegram. Per passare a Podman: %s, rilancia questo installer, poi «jht setup» con la tua chiave API.%s' ;;
    it:installer.migration.uninstall) printf '%s' '«jht uninstall --confirm» (tiene quelle due cartelle)' ;;
    it:installer.migration.uninstall_old_jht) printf '%s' 'il tuo comando jht e'\'' di una versione che non sa disinstallarsi, quindi usa quello di questa versione: «f="$(mktemp)" && curl -fsSL '\''%s'\'' -o "$f" && bash "$f" uninstall --confirm; rm -f "$f"» (toglie il JHT su Docker e il vecchio comando jht, tiene quelle due cartelle)' ;;
    it:installer.min_free_invalid) printf '%s' 'JHT_MIN_FREE_GIB non valido: %s' ;;
    it:installer.mode) printf '%s' 'modo:     ' ;;
    it:installer.mount_repair_failed) printf '%s' '%s e %s non si possono rendere scrivibili per il container di Job Hunter Team (gira come uid 1001) e non e'\'' stato avviato niente. O lascia che Docker giri per questo account (aggiungilo al gruppo '\''docker'\'', poi rientra), o lancia una volta: sudo chown -R 1001:1001 "%s" "%s", poi rilancia questo installer.' ;;
    it:installer.next_step_run_finish) printf '%s' 'Prossimo passo: lancia  %s  per finire il setup.' ;;
    it:installer.next_steps) printf '%s' 'Prossimi passi:' ;;
    it:installer.no_interactive_terminal_no) printf '%s' 'Nessun terminale interattivo (niente /dev/tty): salto il wizard.' ;;
    it:installer.no_shell_rc_file) printf '%s' 'Nessun file rc della shell e'\'' stato scritto. Aggiungi a mano:' ;;
    it:installer.open_new_terminal_window) printf '%s' 'Prima apri una nuova finestra del terminale (o lancia: . ~/.profile), cosi'\'' trova jht.' ;;
    it:installer.ownership_1001_1001_container) printf '%s' 'Proprietario di %s e %s → 1001:1001 (UID del container)' ;;
    it:installer.ownership_1001_1001_container_2) printf '%s' 'Proprietario di %s e %s → 1001:1001 (UID del container, messo da un container usa e getta: niente sudo)' ;;
    it:installer.ownership_stays_user_macos) printf '%s' '%s e %s restano di questo utente (macOS)' ;;
    it:installer.ownership_stays_user_rootless) printf '%s' '%s e %s restano di questo utente (Podman rootless)' ;;
    it:installer.pairing_token_present_skipping) printf '%s' 'Token di abbinamento presente: salto il wizard interattivo.' ;;
    it:installer.pairing_token_saved) printf '%s' 'Token di abbinamento salvato in %s (permessi 0600)' ;;
    it:installer.path_added) printf '%s' 'PATH aggiunto a %s' ;;
    it:installer.path_added_etc_profile) printf '%s' 'PATH aggiunto a /etc/profile.d/jht.sh (per tutto il sistema)' ;;
    it:installer.podman.answers_rootful) printf '%s' 'podman risponde come rootful per %s (Rootless=%s): JHT vuole Podman rootless.' ;;
    it:installer.podman.apt_failed) printf '%s' 'apt-get install%s non e'\'' riuscito. Per vedere perche'\'', lancia: sudo apt-get install%s' ;;
    it:installer.podman.apt_would_remove) printf '%s' 'installare%s TOGLIEREBBE altri pacchetti di questo computer (spesso containerd.io, di Docker): non e'\'' stato cambiato niente. Per vedere quali, lancia: sudo apt-get -s install%s. Installa tu Podman in un modo che li tenga (o decidi di toglierli), poi rilancia questo installer.' ;;
    it:installer.podman.compose_missing) printf '%s' 'podman-compose non e'\'' disponibile fra i pacchetti di questo sistema. Chiedi all'\''amministratore di questo server di installarlo, come root: apt install podman-compose' ;;
    it:installer.podman.compose_too_old) printf '%s' 'podman-compose %s e'\'' piu'\'' vecchio di %s. Chiedi all'\''amministratore di questo server un podman-compose piu'\'' recente.' ;;
    it:installer.podman.distribution_too_old) printf '%s' 'questa distribuzione installerebbe %s %s, ma Job Hunter Team 0.4.0 vuole %s %s o successivo: non ho installato niente. Distribuzioni che lo danno: Ubuntu 26.04 LTS, Debian 13, Fedora 43 o successive.' ;;
    it:installer.podman.dnf_failed) printf '%s' 'dnf install%s non e'\'' riuscito (dnf non toglie niente: lo ferma un conflitto con un pacchetto installato). Per vedere perche'\'', lancia: sudo dnf install%s' ;;
    it:installer.podman.info_fails) printf '%s' ''\''podman info'\'' non riesce per %s, quindi lo spazio o il runtime rootless non sono pronti. Lancialo a mano per vedere perche'\''.' ;;
    it:installer.podman.linger_failed) printf '%s' 'loginctl enable-linger %s non e'\'' riuscito.' ;;
    it:installer.podman.linger_missing) printf '%s' 'i container di %s si fermerebbero alla fine della sessione. Chiedi all'\''amministratore di questo server di lanciare, come root: loginctl enable-linger %s' ;;
    it:installer.podman.missing_default) printf '%s' 'l'\''intervallo subuid o il linger' ;;
    it:installer.podman.no_package_manager) printf '%s' 'nessun gestore di pacchetti conosciuto (apt, dnf, pacman) per installare:%s' ;;
    it:installer.podman.pacman_failed) printf '%s' 'pacman -S%s non e'\'' riuscito (non e'\'' stato tolto niente). Per vedere perche'\'', lancia: sudo pacman -S%s' ;;
    it:installer.podman.root_refused) printf '%s' 'JHT gira su Podman rootless, come un utente che non e'\'' root. Entra con quell'\''utente e rilancia l'\''installazione.' ;;
    it:installer.podman.runtime_dir_missing) printf '%s' 'per questo utente non c'\''e'\'' la cartella di runtime (%s): la sessione non ha un gestore dell'\''utente. Rientra, o chiedi all'\''amministratore di lanciare, come root: loginctl enable-linger %s' ;;
    it:installer.podman.still_missing) printf '%s' 'podman non c'\''e'\'' ancora dopo l'\''installazione. Chiedi all'\''amministratore di questo server di lanciare, come root: apt install podman' ;;
    it:installer.podman.subuid_missing) printf '%s' '%s non ha un intervallo di uid/gid subordinati in %s/subuid e %s/subgid. Chiedi all'\''amministratore di questo server di lanciare, come root: usermod --add-subuids 100000-165535 --add-subgids 100000-165535 %s' ;;
    it:installer.podman.sudo_required) printf '%s' 'Podman ha bisogno di una preparazione che solo un amministratore puo'\'' fare (manca:%s), e sudo per %s non e'\'' disponibile senza password. Chiedi all'\''amministratore di questo server di dare a %s sudo senza password, o di lanciare, come root: apt install podman podman-compose uidmap; loginctl enable-linger %s' ;;
    it:installer.podman.too_old) printf '%s' 'podman %s e'\'' piu'\'' vecchio di %s. Chiedi all'\''amministratore di questo server un podman piu'\'' recente.' ;;
    it:installer.podman.unknown_version) printf '%s' 'di versione sconosciuta' ;;
    it:installer.podman.unsupported_host) printf '%s' '--runtime podman e'\'' per Linux e macOS; questo sistema e'\'' %s.' ;;
    it:installer.podman.usermod_failed) printf '%s' 'usermod non ha potuto aggiungere l'\''intervallo subordinato (%s-%s) per %s.' ;;
    it:installer.podman_already_installed) printf '%s' 'podman gia'\'' installato' ;;
    it:installer.podman_compose_already_installed) printf '%s' 'podman-compose gia'\'' installato' ;;
    it:installer.podman_machine_already_running) printf '%s' 'Macchina Podman '\''%s'\'' gia'\'' accesa' ;;
    it:installer.podman_machine_reachable) printf '%s' 'Macchina Podman raggiungibile' ;;
    it:installer.podman_ready_but_weekly) printf '%s' 'Podman e'\'' pronto, ma il suo timer settimanale che libera il disco non si e'\'' potuto attivare.' ;;
    it:installer.podman_ready_colima_retained) printf '%s' 'Podman pronto (Colima lasciato com'\''era)' ;;
    it:installer.podman_rootless_podman_compose) printf '%s' 'Podman rootless %s + podman-compose %s per %s' ;;
    it:installer.podman_rootless_reachable) printf '%s' 'podman rootless raggiungibile' ;;
    it:installer.private_jht_docker_shim) printf '%s' 'Shim docker privato di JHT: %s (non aggiunto al PATH globale; Colima non toccato)' ;;
    it:installer.private_jht_docker_shim_2) printf '%s' 'Shim docker privato di JHT: %s (non aggiunto al PATH globale; Podman rootless, senza macchina)' ;;
    it:installer.run_manually_jht_setup) printf '%s' 'Lancia a mano: jht setup' ;;
    it:installer.running_host_setup_sh) printf '%s' 'Eseguo host-setup.sh (scrive ~/.jht/host.env e controlla lo swap)...' ;;
    it:installer.runtime) printf '%s' 'runtime:  ' ;;
    it:installer.runtime_dir_bad_ancestor) printf '%s' 'La cartella del runtime sull'\''host ha sopra di se'\'' un collegamento o un percorso non canonico: %s' ;;
    it:installer.runtime_dir_in_mount) printf '%s' 'La cartella del runtime sull'\''host deve stare fuori dalle cartelle che il container puo'\'' scrivere: %s' ;;
    it:installer.runtime_dir_is_link) printf '%s' 'La cartella del runtime sull'\''host e'\'' un collegamento: %s' ;;
    it:installer.runtime_image_pinned) printf '%s' 'immagine del runtime fissata: %s' ;;
    it:installer.runtime_tier_core_tools) printf '%s' 'livello del runtime: core (gli strumenti arrivano dopo il benvenuto)' ;;
    it:installer.same_as_above_empties) printf '%s' '(come sopra, e svuota anche ~/.jht e ~/Documents/Job Hunter Team)' ;;
    it:installer.setup_did_not_finish) printf '%s' 'Il setup non e'\'' finito (codice di uscita %s): Job Hunter Team e'\'' installato, ma non ancora configurato.' ;;
    it:installer.setup_done_team_needs_space) printf '%s' 'Il setup è finito e salvato, ma la squadra non è partita: sul disco serve più spazio libero. Liberalo come detto sopra, poi avvia la squadra con  jht team start  (non serve rifare il setup).' ;;
    it:installer.starting_podman_machine) printf '%s' 'Avvio la macchina Podman '\''%s'\''...' ;;
    it:installer.subuid_subgid_range) printf '%s' 'intervallo subuid/subgid %s-%s per %s' ;;
    it:installer.system_detection) printf '%s' 'Rilevamento del sistema' ;;
    it:installer.team_running) printf '%s' 'Job Hunter Team è acceso su questo computer (%s). Se il setup si era interrotto, riprendilo con «jht setup» in questo terminale; non serve spegnere niente. Per reinstallare invece: spegnilo con «jht down», rilancia l'\''installer, poi riaccendilo con «jht up». Non è stato cambiato niente: il tuo profilo e i tuoi documenti in ~/.jht e ~/Documents/Job Hunter Team restano dove sono.' ;;
    it:installer.team_running_update) printf '%s' 'Job Hunter Team è acceso su questo computer (%s). Per aggiornarlo, spegnilo con «jht down», rilancia l'\''installer, poi riaccendilo con «jht up». Non è stato cambiato niente: il tuo profilo e i tuoi documenti in ~/.jht e ~/Documents/Job Hunter Team restano dove sono.' ;;
    it:installer.terminal_run) printf '%s' 'In questo terminale, lancia:' ;;
    it:installer.uid_1001_taken) printf '%s' 'l'\''uid 1001 su questo computer e'\'' l'\''account '\''%s'\''. Il container di Job Hunter Team gira come uid 1001, quindi quell'\''account sarebbe il proprietario di ~/.jht (i tuoi dati e le credenziali dei portali). Non e'\'' stato cambiato niente. Lancia JHT dall'\''account '\''%s'\'', o dai a '\''%s'\'' un altro uid, poi riprova.' ;;
    it:installer.uninstall_keeps_your_data) printf '%s' 'Per disinstallare (i tuoi dati in ~/.jht e ~/Documents/Job Hunter Team restano):' ;;
    it:installer.wrapper_dir_bad_ancestor) printf '%s' 'La cartella del wrapper sull'\''host ha sopra di se'\'' un collegamento o un percorso non canonico: %s' ;;
    it:installer.wrapper_dir_in_mount) printf '%s' 'La cartella del wrapper sull'\''host deve stare fuori dalle cartelle che il container puo'\'' scrivere: %s' ;;
    it:installer.wsl_not_supported) printf '%s' 'su Windows, installa JHT da PowerShell con install.ps1 (vedi docs/guides/QUICKSTART.md), non da dentro WSL. Non e'\'' stato cambiato niente.' ;;
    hu:installer.agents_can_only_see) printf '%s' 'Az ügynökök csak ezt látják:' ;;
    hu:installer.already_path) printf '%s' 'a(z) %s már benne van a PATH-ban' ;;
    hu:installer.also_delete_your_data) printf '%s' 'Ha az adataidat is törölni akarod (beállítás, adatbázis, önéletrajzok, eredmények):' ;;
    hu:installer.also_deletes_api_key) printf '%s' '(törli a csapathoz mentett API-kulcsot, a levelezés jelszavát és a Telegram-tokeneket is)' ;;
    hu:installer.apt_get_update_failed) printf '%s' 'az apt-get update nem sikerült: azért megpróbálom a telepítést.' ;;
    hu:installer.branch) printf '%s' 'ág:      ' ;;
    hu:installer.cannot_list_containers) printf '%s' 'Nem tudom kilistázni a futó konténereket ezzel: %s. Semmi sem lett telepítve.' ;;
    hu:installer.check.adapter_bad_ancestor) printf '%s' 'A Podman adapter bin mappája fölött nem kanonikus útvonal van: %s' ;;
    hu:installer.check.adapter_is_link) printf '%s' 'A Podman adapter bin mappája szimbolikus link: %s' ;;
    hu:installer.check.adapter_not_dir) printf '%s' 'A Podman adapter bin útvonala nem mappa: %s' ;;
    hu:installer.check.branch_unresolved) printf '%s' 'A(z) '\''%s'\'' ág nem vezethető vissza egy megváltoztathatatlan kiadási commitra.' ;;
    hu:installer.check.compose_boundary) printf '%s' 'A letöltött docker-compose.yml nem érvényesíti a runtime védett határát.' ;;
    hu:installer.check.compose_gone) printf '%s' 'A Podman Compose szolgáltató eltűnt a telepítés után.' ;;
    hu:installer.check.compose_version_unreadable) printf '%s' 'Nem sikerült kiolvasni a Podman Compose szolgáltató verzióját.' ;;
    hu:installer.check.digests_not_written) printf '%s' 'a gazdagép szkriptjeinek lenyomatai nem íródtak ki' ;;
    hu:installer.check.machine_name_invalid) printf '%s' 'Érvénytelen a JHT Podman gépének neve: %s' ;;
    hu:installer.check.marker_invalid) printf '%s' 'A JHT runtime kiválasztását jelző fájl érvénytelen' ;;
    hu:installer.check.marker_unsafe) printf '%s' 'A JHT runtime kiválasztását jelző fájl nem biztonságos: %s' ;;
    hu:installer.check.os_unsupported) printf '%s' 'Nem támogatott operációs rendszer: %s' ;;
    hu:installer.check.podman_gone) printf '%s' 'A Podman CLI eltűnt a telepítés után.' ;;
    hu:installer.check.podman_not_on_path) printf '%s' 'a podman eltűnt a PATH-ból' ;;
    hu:installer.check.podman_path_unsafe) printf '%s' 'A Podman futtatható fájljának útvonala nem biztonságos: %s' ;;
    hu:installer.check.shim_unsafe) printf '%s' 'Nem írom felül a nem biztonságos vagy nem a JHT-hoz tartozó futtatható fájlt: %s' ;;
    hu:installer.check.wrapper_protocol) printf '%s' 'A letöltött wrapper nem valósítja meg a runtime védett protokollját.' ;;
    hu:installer.chown_not_needed) printf '%s' 'a chown 1001-re nem sikerült — itt semmi sem fut konténerben (--no-docker), így nincs rá szükség' ;;
    hu:installer.config_db_agents) printf '%s' '(beállítás, adatbázis, ügynökök)' ;;
    hu:installer.configuration_wizard_also_starts) printf '%s' 'beállító varázsló (a konténert is elindítja)' ;;
    hu:installer.container_mode_active_podman) printf '%s' 'Konténeres mód bekapcsolva (Podman).' ;;
    hu:installer.container_runtime) printf '%s' 'Konténermotor' ;;
    hu:installer.container_runtime_check) printf '%s' 'A konténermotor ellenőrzése' ;;
    hu:installer.container_runtime_podman_rootless) printf '%s' 'Konténermotor (Podman rootless)' ;;
    hu:installer.container_will_complete_pairing) printf '%s' 'A konténer az első indításkor befejezi a párosítást.' ;;
    hu:installer.creating_rootless_podman_machine) printf '%s' 'Létrehozom a(z) '\''%s'\'' rootless Podman-gépet...' ;;
    hu:installer.cvs_attachments_output) printf '%s' '(önéletrajzok, mellékletek, eredmények)' ;;
    hu:installer.disk_low_dry_run) printf '%s' 'Csak %s GiB szabad hely van itt: %s; egy valódi telepítéshez legalább %s GiB kell.' ;;
    hu:installer.disk_not_enough) printf '%s' 'nincs elég szabad hely a lemezen: %s GiB szabad itt: %s, a Job Hunter Team képének és adatainak legalább %s GiB kell. Szabadíts fel helyet (egy olyan szerveren, ahol már fut a Docker, a '\''docker image prune -af'\'' eltávolítja a nem használt képeket), és futtasd újra a telepítőt. Semmi sem változott.' ;;
    hu:installer.disk_room_short) printf '%s' 'A Job Hunter Team körülbelül %s GiB-ot tölt le, és a letöltés után az ügynököknek kevesebb maradna a szükséges %s GiB lemezterületnél: most %s GiB szabad. Szabadíts fel még legalább %s GiB-ot (ürítsd ki a Kukát, töröld a nagy fájlokat, amelyekre nincs szükséged), majd futtasd újra a telepítőt: semmi nem lett letöltve, és a Job Hunter Team telepített verziójához nem nyúltunk.' ;;
    hu:installer.done_compose) printf '%s' 'compose: %s' ;;
    hu:installer.done_host_setup) printf '%s' 'host-setup: %s' ;;
    hu:installer.done_wrapper) printf '%s' 'wrapper: %s' ;;
    hu:installer.download_failed) printf '%s' 'A letöltés nem sikerült: %s. Ellenőrizd a kapcsolatot és az ágat (%s).' ;;
    hu:installer.download_wrapper_docker_compose) printf '%s' 'A wrapper és a docker-compose.yml letöltése' ;;
    hu:installer.downloading_docker_compose_yml) printf '%s' 'A docker-compose.yml letöltése...' ;;
    hu:installer.downloading_host_setup_sh) printf '%s' 'A host-setup.sh letöltése (VPS/swap előzetes ellenőrzés)...' ;;
    hu:installer.downloading_jht_wrapper) printf '%s' 'A jht wrapper letöltése...' ;;
    hu:installer.enabling_linger) printf '%s' 'A linger bekapcsolása ehhez: %s...' ;;
    hu:installer.existing_podman_machine_has) printf '%s' 'A meglévő '\''%s'\'' Podman-gép erőforrásai: '\''%s'\''; a JHT %s CPU-t, %s MiB RAM-ot és %s GiB lemezt javasol. A meglévő gép nem változott.' ;;
    hu:installer.extras_image_pinned_ghcr) printf '%s' 'rögzített kiegészítő kép: ghcr.io/leopu00/jht@%s (akkor töltődik le, amikor egy eszközt kérnek)' ;;
    hu:installer.giving_subordinate_uid_gid) printf '%s' 'Alárendelt uid/gid tartományt adok ennek: %s, %s-%s...' ;;
    hu:installer.helper_download_failed) printf '%s' 'a(z) %s letöltése vagy ellenőrzése nem sikerült: %s/scripts/%s' ;;
    hu:installer.host_file_tmp_failed) printf '%s' 'nem tudok ideiglenes fájlt létrehozni itt: %s; a(z) %s nem lesz megírva' ;;
    hu:installer.host_setup_completed_auto) printf '%s' 'a host-setup kész (a gazdagép típusa automatikusan felismerve)' ;;
    hu:installer.host_setup_completed_forced) printf '%s' 'a host-setup kész (kényszerítve: vps)' ;;
    hu:installer.host_setup_download_failed) printf '%s' 'a host-setup.sh letöltése vagy ellenőrzése nem sikerült: %s' ;;
    hu:installer.host_setup_exited_error) printf '%s' 'a host-setup hibával állt le — folytatom (lehet, hogy kézi párosítás kell)' ;;
    hu:installer.host_setup_exited_error_2) printf '%s' 'a host-setup hibával állt le — folytatom' ;;
    hu:installer.host_setup_missing) printf '%s' 'a host-setup.sh nem érhető el itt: %s — kihagyom az előzetes ellenőrzést' ;;
    hu:installer.image) printf '%s' 'kép:     ' ;;
    hu:installer.image_download_failed) printf '%s' 'a JHT képének letöltése nem sikerült: %s' ;;
    hu:installer.installation_complete) printf '%s' 'A telepítés kész!' ;;
    hu:installer.installed) printf '%s' 'Telepítve:%s' ;;
    hu:installer.installing_podman_cli) printf '%s' 'A Podman CLI telepítése...' ;;
    hu:installer.installing_podman_compose_provider) printf '%s' 'A Podman Compose szolgáltató telepítése...' ;;
    hu:installer.installing_sudo_podman_rootless) printf '%s' 'Telepítés:%s sudóval (Podman rootless; a Docker nem települ)...' ;;
    hu:installer.linger_enabled) printf '%s' 'a linger bekapcsolva ehhez: %s' ;;
    hu:installer.loginctl_not_found_linger) printf '%s' 'a loginctl nem található: a linger nem lett ellenőrizve.' ;;
    hu:installer.mac.cannot_create_folder) printf '%s' 'Nem tudom létrehozni a(z) %s mappát a Podman-géphez.' ;;
    hu:installer.mac.compose_install_failed) printf '%s' 'a podman-compose telepítése nem sikerült' ;;
    hu:installer.mac.compose_version_unsupported) printf '%s' 'A JHT-nak Macen a podman-compose %s kell; ezen a Macen ez van: %s. Futtasd: «brew upgrade podman-compose» (vagy «brew install podman-compose»), majd újra ezt a telepítőt.' ;;
    hu:installer.mac.homebrew_missing) printf '%s' 'A JHT a Podmant Homebrew-val telepíti, ami nincs ezen a Macen. Semmi sem változott. Telepítsd a Homebrew-t innen: https://brew.sh (egy parancs a Terminálban; kéri a Maced jelszavát), nyiss egy új Terminál-ablakot, és futtasd újra ezt a telepítőt.' ;;
    hu:installer.mac.machine_init_failed) printf '%s' 'A Podman-gép inicializálása nem sikerült; a Colima nem változott.' ;;
    hu:installer.mac.machine_name_placeholder) printf '%s' '<név>' ;;
    hu:installer.mac.machine_not_responding) printf '%s' 'A JHT Podman-gépe nem válaszol.' ;;
    hu:installer.mac.machine_start_failed) printf '%s' 'A Podman-gép indítása nem sikerült; a Colima nem változott.' ;;
    hu:installer.mac.machine_unreachable) printf '%s' 'A(z) '\''%s'\'' Podman-gép nem érhető el.' ;;
    hu:installer.mac.other_machine_any) printf '%s' 'egy másik Podman-gép fut (a '\''podman machine list'\'' paranccsal megtalálod)' ;;
    hu:installer.mac.other_machine_named) printf '%s' 'egy másik Podman-gép fut: %s' ;;
    hu:installer.mac.other_machine_running) printf '%s' '%s, és egy Macen egyszerre csak egy futhat. Állítsd le a '\''podman machine stop %s'\'' paranccsal (vagy abból az alkalmazásból, amellyel használod), és futtasd újra a telepítőt: a Job Hunter Team sosem állítja le helyetted, és utána újra elindíthatod.' ;;
    hu:installer.mac.podman_install_failed) printf '%s' 'A Podman telepítése nem sikerült' ;;
    hu:installer.mac.podman_no_version) printf '%s' 'egy podman, amely nem mondja meg a verzióját' ;;
    hu:installer.mac.podman_version_unsupported) printf '%s' 'A JHT-nak Macen Podman %s.%s vagy egy későbbi %s.x kell (nem 6.2 vagy újabb); ezen a Macen ez van: %s. Ha a Homebrew a Podmant a(z) %s sorozaton túlra frissítette, töltsd le újra a mai JHT-telepítőt (megmondja, melyik sorozatot támogatja); a JHT-ból semmi sem lett telepítve.' ;;
    hu:installer.migration.colima_default) printf '%s' 'Ha a Colimát csak a JHT miatt telepítetted, az eltávolítás után a virtuális gépe (a default profil, amelyet a JHT telepítője indított el) leállítva a lemezen marad: távolítsd el a «colima delete -p default» paranccsal, hogy felszabadítsd a helyet. Ha a Colimát másra is használod, hagyd meg.' ;;
    hu:installer.migration.colima_started) printf '%s' 'Az eltávolítás után a JHT által létrehozott Colima virtuális gép (%s profil) leállítva a lemezen marad: ha semmi másra nem használod, távolítsd el a «colima delete -p %s» paranccsal, hogy felszabadítsd a helyet.' ;;
    hu:installer.migration.refused) printf '%s' 'ez a gép Dockeren futtatja a JHT-t (Colima, Docker Desktop vagy Docker Engine). A 0.4 óta a JHT csak Podmanen fut, és semmi sem változott. Az adataid megmaradnak: a ~/.jht (beállítás, adatbázis, profil) és a ~/Documents/Job Hunter Team (önéletrajzok, eredmények) ennek a gépnek a mappái. Ami a Docker köteteiben marad, és újra meg kell adni: a beállítás által tárolt API-kulcs, a levelezés jelszava, a Telegram-tokenek. Átállás a Podmanre: %s, futtasd újra ezt a telepítőt, majd a «jht setup» parancsot az API-kulcsoddal.%s' ;;
    hu:installer.migration.uninstall) printf '%s' 'futtasd: «jht uninstall --confirm» (megtartja azt a két mappát)' ;;
    hu:installer.migration.uninstall_old_jht) printf '%s' 'a jht parancsod egy olyan verzióból való, amely nem tudja eltávolítani önmagát, ezért ennek a verziónak a parancsát használd: «f="$(mktemp)" && curl -fsSL '\''%s'\'' -o "$f" && bash "$f" uninstall --confirm; rm -f "$f"» (eltávolítja a Dockeren futó JHT-t és a régi jht parancsot, és megtartja azt a két mappát)' ;;
    hu:installer.min_free_invalid) printf '%s' 'Érvénytelen JHT_MIN_FREE_GIB: %s' ;;
    hu:installer.mode) printf '%s' 'mód:     ' ;;
    hu:installer.mount_repair_failed) printf '%s' 'A(z) %s és a(z) %s nem tehető írhatóvá a Job Hunter Team konténere számára (uid 1001-ként fut), és semmi sem indult el. Vagy engedd, hogy ez a fiók futtassa a Dockert (add hozzá a '\''docker'\'' csoporthoz, majd jelentkezz be újra), vagy futtasd egyszer: sudo chown -R 1001:1001 "%s" "%s" — majd futtasd újra ezt a telepítőt.' ;;
    hu:installer.next_step_run_finish) printf '%s' 'Következő lépés: futtasd a  %s  parancsot a beállítás befejezéséhez.' ;;
    hu:installer.next_steps) printf '%s' 'Következő lépések:' ;;
    hu:installer.no_interactive_terminal_no) printf '%s' 'Nincs interaktív terminál (nincs /dev/tty): kihagyom a varázslót.' ;;
    hu:installer.no_shell_rc_file) printf '%s' 'Nem lett shell rc fájl írva. Add hozzá kézzel:' ;;
    hu:installer.open_new_terminal_window) printf '%s' 'Előbb nyiss egy új terminálablakot (vagy futtasd: . ~/.profile), hogy megtalálja a jht-t.' ;;
    hu:installer.ownership_1001_1001_container) printf '%s' 'A(z) %s és a(z) %s tulajdonosa → 1001:1001 (a konténer UID-ja)' ;;
    hu:installer.ownership_1001_1001_container_2) printf '%s' 'A(z) %s és a(z) %s tulajdonosa → 1001:1001 (a konténer UID-ja, egy egyszeri konténer állította be: nem kell sudo)' ;;
    hu:installer.ownership_stays_user_macos) printf '%s' 'A(z) %s és a(z) %s tulajdonosa ez a felhasználó marad (macOS)' ;;
    hu:installer.ownership_stays_user_rootless) printf '%s' 'A(z) %s és a(z) %s tulajdonosa ez a felhasználó marad (rootless Podman)' ;;
    hu:installer.pairing_token_present_skipping) printf '%s' 'Van párosítási token: kihagyom az interaktív varázslót.' ;;
    hu:installer.pairing_token_saved) printf '%s' 'A párosítási token elmentve ide: %s (mód 0600)' ;;
    hu:installer.path_added) printf '%s' 'A PATH hozzáadva ehhez: %s' ;;
    hu:installer.path_added_etc_profile) printf '%s' 'A PATH hozzáadva a /etc/profile.d/jht.sh fájlhoz (az egész rendszerre)' ;;
    hu:installer.podman.answers_rootful) printf '%s' 'a podman rootfulként válaszol ennek: %s (Rootless=%s): a JHT-nak Podman rootless kell.' ;;
    hu:installer.podman.apt_failed) printf '%s' 'az apt-get install%s nem sikerült. Hogy lásd, miért, futtasd: sudo apt-get install%s' ;;
    hu:installer.podman.apt_would_remove) printf '%s' 'a(z)%s telepítése ELTÁVOLÍTANA más csomagokat erről a gépről (gyakran a containerd.io-t, a Dockerét): semmi sem változott. Hogy lásd, melyeket, futtasd: sudo apt-get -s install%s. Telepítsd a Podmant magad úgy, hogy azok megmaradjanak (vagy döntsd el, hogy eltávolítod őket), majd futtasd újra ezt a telepítőt.' ;;
    hu:installer.podman.compose_missing) printf '%s' 'a podman-compose nem érhető el a rendszer csomagjai között. Kérd meg a szerver rendszergazdáját, hogy telepítse rootként: apt install podman-compose' ;;
    hu:installer.podman.compose_too_old) printf '%s' 'a podman-compose %s régebbi, mint %s. Kérj újabb podman-compose-t a szerver rendszergazdájától.' ;;
    hu:installer.podman.distribution_too_old) printf '%s' 'ez a disztribúció ezt telepítené: %s %s, a Job Hunter Team 0.4.0-nak pedig %s %s vagy újabb kell: semmi sem lett telepítve. Disztribúciók, amelyek ezt adják: Ubuntu 26.04 LTS, Debian 13, Fedora 43 vagy újabb.' ;;
    hu:installer.podman.dnf_failed) printf '%s' 'a dnf install%s nem sikerült (a dnf semmit sem távolít el: egy telepített csomaggal való ütközés megállítja). Hogy lásd, miért, futtasd: sudo dnf install%s' ;;
    hu:installer.podman.info_fails) printf '%s' 'a '\''podman info'\'' hibát ad ennek: %s, tehát a rootless tárhely vagy futtatókörnyezet nincs kész. Futtasd kézzel, hogy lásd, miért.' ;;
    hu:installer.podman.linger_failed) printf '%s' 'a loginctl enable-linger %s nem sikerült.' ;;
    hu:installer.podman.linger_missing) printf '%s' 'a(z) %s konténerei leállnának a munkamenet végén. Kérd meg a szerver rendszergazdáját, hogy futtassa rootként: loginctl enable-linger %s' ;;
    hu:installer.podman.missing_default) printf '%s' 'a subuid tartomány vagy a linger' ;;
    hu:installer.podman.no_package_manager) printf '%s' 'nincs ismert csomagkezelő (apt, dnf, pacman) a telepítéshez:%s' ;;
    hu:installer.podman.pacman_failed) printf '%s' 'a pacman -S%s nem sikerült (semmi sem lett eltávolítva). Hogy lásd, miért, futtasd: sudo pacman -S%s' ;;
    hu:installer.podman.root_refused) printf '%s' 'A JHT Podman rootless módban fut, egy nem root felhasználóként. Jelentkezz be azzal a felhasználóval, és futtasd újra a telepítést.' ;;
    hu:installer.podman.runtime_dir_missing) printf '%s' 'ennek a felhasználónak nincs runtime könyvtára (%s): a munkamenetnek nincs felhasználói kezelője. Jelentkezz be újra, vagy kérd meg a rendszergazdát, hogy futtassa rootként: loginctl enable-linger %s' ;;
    hu:installer.podman.still_missing) printf '%s' 'a podman a telepítés után sincs meg. Kérd meg a szerver rendszergazdáját, hogy futtassa rootként: apt install podman' ;;
    hu:installer.podman.subuid_missing) printf '%s' 'a(z) %s felhasználónak nincs alárendelt uid/gid tartománya itt: %s/subuid és %s/subgid. Kérd meg a szerver rendszergazdáját, hogy futtassa rootként: usermod --add-subuids 100000-165535 --add-subgids 100000-165535 %s' ;;
    hu:installer.podman.sudo_required) printf '%s' 'A Podmanhez olyan beállítás kell, amelyet csak rendszergazda végezhet el (hiányzik:%s), és a(z) %s felhasználónak nincs jelszó nélküli sudója. Kérd meg a szerver rendszergazdáját, hogy engedjen a(z) %s felhasználónak jelszó nélküli sudót, vagy futtassa rootként: apt install podman podman-compose uidmap; loginctl enable-linger %s' ;;
    hu:installer.podman.too_old) printf '%s' 'a podman %s régebbi, mint %s. Kérj újabb podmant a szerver rendszergazdájától.' ;;
    hu:installer.podman.unknown_version) printf '%s' 'ismeretlen verziójú' ;;
    hu:installer.podman.unsupported_host) printf '%s' 'a --runtime podman Linuxra és macOS-re való; ez a rendszer: %s.' ;;
    hu:installer.podman.usermod_failed) printf '%s' 'a usermod nem tudta hozzáadni az alárendelt tartományt (%s-%s) ehhez: %s.' ;;
    hu:installer.podman_already_installed) printf '%s' 'a podman már telepítve van' ;;
    hu:installer.podman_compose_already_installed) printf '%s' 'a podman-compose már telepítve van' ;;
    hu:installer.podman_machine_already_running) printf '%s' 'A(z) '\''%s'\'' Podman-gép már fut' ;;
    hu:installer.podman_machine_reachable) printf '%s' 'A Podman-gép elérhető' ;;
    hu:installer.podman_ready_but_weekly) printf '%s' 'A Podman kész, de a heti lemeztrim időzítőjét nem sikerült bekapcsolni.' ;;
    hu:installer.podman_ready_colima_retained) printf '%s' 'A Podman kész (a Colima megmaradt)' ;;
    hu:installer.podman_rootless_podman_compose) printf '%s' 'Podman rootless %s + podman-compose %s ehhez: %s' ;;
    hu:installer.podman_rootless_reachable) printf '%s' 'a podman rootless elérhető' ;;
    hu:installer.private_jht_docker_shim) printf '%s' 'Privát JHT docker shim: %s (nincs hozzáadva a globális PATH-hoz; a Colima érintetlen)' ;;
    hu:installer.private_jht_docker_shim_2) printf '%s' 'Privát JHT docker shim: %s (nincs hozzáadva a globális PATH-hoz; rootless Podman, gép nélkül)' ;;
    hu:installer.run_manually_jht_setup) printf '%s' 'Futtasd kézzel: jht setup' ;;
    hu:installer.running_host_setup_sh) printf '%s' 'A host-setup.sh futtatása (megírja a ~/.jht/host.env fájlt + swap előzetes ellenőrzés)...' ;;
    hu:installer.runtime) printf '%s' 'runtime: ' ;;
    hu:installer.runtime_dir_bad_ancestor) printf '%s' 'A gazdagép futtatókörnyezetének egyik szülőmappája link vagy nem kanonikus: %s' ;;
    hu:installer.runtime_dir_in_mount) printf '%s' 'A gazdagép futtatókörnyezetének a konténer által írható bind mountokon kívül kell lennie: %s' ;;
    hu:installer.runtime_dir_is_link) printf '%s' 'A gazdagép futtatókörnyezetének útvonala link: %s' ;;
    hu:installer.runtime_image_pinned) printf '%s' 'rögzített futtatókép: %s' ;;
    hu:installer.runtime_tier_core_tools) printf '%s' 'futtatási szint: core (az eszközök az üdvözlés után jönnek)' ;;
    hu:installer.same_as_above_empties) printf '%s' '(mint fent, és kiüríti a ~/.jht és a ~/Documents/Job Hunter Team mappát is)' ;;
    hu:installer.setup_did_not_finish) printf '%s' 'A beállítás nem fejeződött be (kilépési kód: %s): a Job Hunter Team telepítve van, de még nincs beállítva.' ;;
    hu:installer.setup_done_team_needs_space) printf '%s' 'A beállítás kész és mentve, de a csapat nem indult el: több szabad hely kell a lemezen. Szabadíts fel helyet a fent leírt módon, majd indítsd el a csapatot ezzel:  jht team start  (a beállítást nem kell újra futtatni).' ;;
    hu:installer.starting_podman_machine) printf '%s' 'A(z) '\''%s'\'' Podman-gép indítása...' ;;
    hu:installer.subuid_subgid_range) printf '%s' 'subuid/subgid tartomány %s-%s ehhez: %s' ;;
    hu:installer.system_detection) printf '%s' 'A rendszer felismerése' ;;
    hu:installer.team_running) printf '%s' 'A Job Hunter Team fut ezen a gépen (%s). Ha a beállítás megszakadt, folytasd a «jht setup» paranccsal ebben a terminálban; nem kell leállítani. Ha inkább újratelepítenéd: állítsd le a «jht down» paranccsal, futtasd újra a telepítőt, majd indítsd el a «jht up» paranccsal. Semmi sem változott: a profilod és a dokumentumaid a ~/.jht és a ~/Documents/Job Hunter Team mappában maradnak.' ;;
    hu:installer.team_running_update) printf '%s' 'A Job Hunter Team fut ezen a gépen (%s). A frissítéshez állítsd le a «jht down» paranccsal, futtasd újra a telepítőt, majd indítsd el a «jht up» paranccsal. Semmi sem változott: a profilod és a dokumentumaid a ~/.jht és a ~/Documents/Job Hunter Team mappában maradnak.' ;;
    hu:installer.terminal_run) printf '%s' 'Ebben a terminálban futtasd:' ;;
    hu:installer.uid_1001_taken) printf '%s' 'Ezen a gépen az uid 1001 a(z) '\''%s'\'' fiók. A Job Hunter Team konténere uid 1001-ként fut, így az a fiók lenne a ~/.jht tulajdonosa (az adataid és a portálok hitelesítő adatai). Semmi sem változott. Futtasd a JHT-t a(z) '\''%s'\'' fiókból, vagy adj a(z) '\''%s'\'' fióknak másik uid-t, majd próbáld újra.' ;;
    hu:installer.uninstall_keeps_your_data) printf '%s' 'Eltávolítás (az adataid megmaradnak a ~/.jht és a ~/Documents/Job Hunter Team mappában):' ;;
    hu:installer.wrapper_dir_bad_ancestor) printf '%s' 'A gazdagép wrapper-mappájának egyik szülőmappája link vagy nem kanonikus: %s' ;;
    hu:installer.wrapper_dir_in_mount) printf '%s' 'A gazdagép wrapperének a konténer által írható bind mountokon kívül kell lennie: %s' ;;
    hu:installer.wsl_not_supported) printf '%s' 'Windowson a JHT-t PowerShellből telepítsd az install.ps1-gyel (lásd docs/guides/QUICKSTART.md), ne a WSL-en belülről. Semmi sem változott.' ;;
    es:installer.agents_can_only_see) printf '%s' 'Los agentes solo ven:' ;;
    es:installer.already_path) printf '%s' '%s ya está en el PATH' ;;
    es:installer.also_delete_your_data) printf '%s' 'Para borrar también tus datos (configuración, db, CV, resultados):' ;;
    es:installer.also_deletes_api_key) printf '%s' '(también borra la clave API, la contraseña del correo y los tokens de Telegram guardados para el equipo)' ;;
    es:installer.apt_get_update_failed) printf '%s' 'apt-get update ha fallado: intento instalar de todos modos.' ;;
    es:installer.branch) printf '%s' 'rama:    ' ;;
    es:installer.cannot_list_containers) printf '%s' 'No puedo listar los contenedores en marcha con %s: no se ha instalado nada.' ;;
    es:installer.check.adapter_bad_ancestor) printf '%s' 'La carpeta bin del adaptador de Podman tiene por encima una ruta no canónica: %s' ;;
    es:installer.check.adapter_is_link) printf '%s' 'La carpeta bin del adaptador de Podman es un enlace simbólico: %s' ;;
    es:installer.check.adapter_not_dir) printf '%s' 'La ruta bin del adaptador de Podman no es una carpeta: %s' ;;
    es:installer.check.branch_unresolved) printf '%s' 'No puedo resolver la rama '\''%s'\'' a un commit de versión inmutable.' ;;
    es:installer.check.compose_boundary) printf '%s' 'El docker-compose.yml descargado no aplica el límite protegido del runtime.' ;;
    es:installer.check.compose_gone) printf '%s' 'El proveedor de Podman Compose ha desaparecido después de la instalación.' ;;
    es:installer.check.compose_version_unreadable) printf '%s' 'No puedo leer la versión del proveedor de Podman Compose.' ;;
    es:installer.check.digests_not_written) printf '%s' 'no se han escrito las huellas de los scripts del host' ;;
    es:installer.check.machine_name_invalid) printf '%s' 'Nombre de la máquina Podman de JHT no válido: %s' ;;
    es:installer.check.marker_invalid) printf '%s' 'El marcador del runtime elegido para JHT no es válido' ;;
    es:installer.check.marker_unsafe) printf '%s' 'El marcador del runtime elegido para JHT no es seguro: %s' ;;
    es:installer.check.os_unsupported) printf '%s' 'Sistema operativo no compatible: %s' ;;
    es:installer.check.podman_gone) printf '%s' 'La CLI de Podman ha desaparecido después de la instalación.' ;;
    es:installer.check.podman_not_on_path) printf '%s' 'podman ha desaparecido del PATH' ;;
    es:installer.check.podman_path_unsafe) printf '%s' 'La ruta del ejecutable de Podman no es segura: %s' ;;
    es:installer.check.shim_unsafe) printf '%s' 'No sobrescribo un ejecutable no seguro o que no es de JHT: %s' ;;
    es:installer.check.wrapper_protocol) printf '%s' 'El wrapper descargado no implementa el protocolo protegido del runtime.' ;;
    es:installer.chown_not_needed) printf '%s' 'chown a 1001 ha fallado: aquí no se ejecuta nada en un contenedor (--no-docker), así que no hace falta' ;;
    es:installer.config_db_agents) printf '%s' '(configuración, db, agentes)' ;;
    es:installer.configuration_wizard_also_starts) printf '%s' 'configuración guiada (también arranca el contenedor)' ;;
    es:installer.container_mode_active_podman) printf '%s' 'Modo contenedor activo (Podman).' ;;
    es:installer.container_runtime) printf '%s' 'Motor de contenedores' ;;
    es:installer.container_runtime_check) printf '%s' 'Comprobación del motor de contenedores' ;;
    es:installer.container_runtime_podman_rootless) printf '%s' 'Motor de contenedores (Podman rootless)' ;;
    es:installer.container_will_complete_pairing) printf '%s' 'El contenedor completará el emparejamiento en el primer arranque.' ;;
    es:installer.creating_rootless_podman_machine) printf '%s' 'Creando la máquina Podman rootless '\''%s'\''...' ;;
    es:installer.cvs_attachments_output) printf '%s' '(CV, adjuntos, resultados)' ;;
    es:installer.disk_low_dry_run) printf '%s' 'Solo hay %s GiB libres en %s; una instalación de verdad necesita al menos %s GiB.' ;;
    es:installer.disk_not_enough) printf '%s' 'no hay espacio libre suficiente en el disco: %s GiB libres en %s, la imagen de Job Hunter Team y sus datos necesitan al menos %s GiB. Libera algo de espacio (en un servidor que ya usa Docker, '\''docker image prune -af'\'' quita las imágenes que no se usan) y vuelve a ejecutar el instalador. No se ha cambiado nada.' ;;
    es:installer.disk_room_short) printf '%s' 'Job Hunter Team descarga unos %s GiB, y después de la descarga a los agentes les quedarían menos de los %s GiB de disco que necesitan: ahora hay %s GiB libres. Libera al menos %s GiB más (vacía la Papelera, borra los archivos grandes que no necesites) y vuelve a ejecutar el instalador: no se ha descargado nada, y la versión de Job Hunter Team que tienes instalada no se ha tocado.' ;;
    es:installer.done_compose) printf '%s' 'compose: %s' ;;
    es:installer.done_host_setup) printf '%s' 'host-setup: %s' ;;
    es:installer.done_wrapper) printf '%s' 'wrapper: %s' ;;
    es:installer.download_failed) printf '%s' 'La descarga ha fallado: %s. Comprueba la conexión y la rama (%s).' ;;
    es:installer.download_wrapper_docker_compose) printf '%s' 'Descarga del wrapper y docker-compose.yml' ;;
    es:installer.downloading_docker_compose_yml) printf '%s' 'Descargando docker-compose.yml...' ;;
    es:installer.downloading_host_setup_sh) printf '%s' 'Descargando host-setup.sh (comprobaciones previas de VPS/swap)...' ;;
    es:installer.downloading_jht_wrapper) printf '%s' 'Descargando el wrapper jht...' ;;
    es:installer.enabling_linger) printf '%s' 'Activando el linger para %s...' ;;
    es:installer.existing_podman_machine_has) printf '%s' 'La máquina Podman '\''%s'\'' que ya existe tiene los recursos '\''%s'\''; JHT recomienda %s CPU, %s MiB de RAM y %s GiB de disco. No se ha cambiado la máquina.' ;;
    es:installer.extras_image_pinned_ghcr) printf '%s' 'imagen extras fijada: ghcr.io/leopu00/jht@%s (se descarga cuando se pide una herramienta)' ;;
    es:installer.giving_subordinate_uid_gid) printf '%s' 'Asignando a %s el rango de uid/gid subordinados %s-%s...' ;;
    es:installer.helper_download_failed) printf '%s' 'la descarga o la verificación de %s ha fallado: %s/scripts/%s' ;;
    es:installer.host_file_tmp_failed) printf '%s' 'no puedo crear un archivo temporal en %s: no escribo %s' ;;
    es:installer.host_setup_completed_auto) printf '%s' 'host-setup completado (tipo de host detectado solo)' ;;
    es:installer.host_setup_completed_forced) printf '%s' 'host-setup completado (vps forzado)' ;;
    es:installer.host_setup_download_failed) printf '%s' 'la descarga o la verificación de host-setup.sh ha fallado: %s' ;;
    es:installer.host_setup_exited_error) printf '%s' 'host-setup ha terminado con un error: sigo (puede hacer falta un emparejamiento a mano)' ;;
    es:installer.host_setup_exited_error_2) printf '%s' 'host-setup ha terminado con un error: sigo' ;;
    es:installer.host_setup_missing) printf '%s' 'host-setup.sh no está disponible en %s: me salto las comprobaciones previas' ;;
    es:installer.image) printf '%s' 'imagen:  ' ;;
    es:installer.image_download_failed) printf '%s' 'La descarga de la imagen de JHT ha fallado: %s' ;;
    es:installer.installation_complete) printf '%s' '¡Instalación completada!' ;;
    es:installer.installed) printf '%s' 'Instalado:%s' ;;
    es:installer.installing_podman_cli) printf '%s' 'Instalando la CLI de Podman...' ;;
    es:installer.installing_podman_compose_provider) printf '%s' 'Instalando el proveedor de Podman Compose...' ;;
    es:installer.installing_sudo_podman_rootless) printf '%s' 'Instalando%s con sudo (Podman rootless; Docker no se instala)...' ;;
    es:installer.linger_enabled) printf '%s' 'linger activado para %s' ;;
    es:installer.loginctl_not_found_linger) printf '%s' 'loginctl no encontrado: no se ha comprobado el linger.' ;;
    es:installer.mac.cannot_create_folder) printf '%s' 'No puedo crear %s para la máquina Podman.' ;;
    es:installer.mac.compose_install_failed) printf '%s' 'la instalación de podman-compose ha fallado' ;;
    es:installer.mac.compose_version_unsupported) printf '%s' 'JHT en un Mac necesita podman-compose %s; este Mac tiene %s. Ejecuta «brew upgrade podman-compose» (o «brew install podman-compose») y luego otra vez este instalador.' ;;
    es:installer.mac.homebrew_missing) printf '%s' 'JHT instala Podman con Homebrew, que no está en este Mac. No se ha cambiado nada. Instala Homebrew desde https://brew.sh (un comando en Terminal; te pide la contraseña del Mac), abre una nueva ventana de Terminal y vuelve a ejecutar este instalador.' ;;
    es:installer.mac.machine_init_failed) printf '%s' 'La creación de la máquina Podman ha fallado; no se ha cambiado Colima.' ;;
    es:installer.mac.machine_name_placeholder) printf '%s' '<nombre>' ;;
    es:installer.mac.machine_not_responding) printf '%s' 'La máquina Podman de JHT no responde.' ;;
    es:installer.mac.machine_start_failed) printf '%s' 'El arranque de la máquina Podman ha fallado; no se ha cambiado Colima.' ;;
    es:installer.mac.machine_unreachable) printf '%s' 'La máquina Podman '\''%s'\'' no es accesible.' ;;
    es:installer.mac.other_machine_any) printf '%s' 'hay otra máquina Podman en marcha (búscala con '\''podman machine list'\'')' ;;
    es:installer.mac.other_machine_named) printf '%s' 'hay otra máquina Podman, %s, en marcha' ;;
    es:installer.mac.other_machine_running) printf '%s' '%s, y un Mac solo ejecuta una a la vez. Detenla con '\''podman machine stop %s'\'' (o desde la app con la que la usas) y vuelve a ejecutar el instalador: Job Hunter Team nunca la detiene por ti, y luego puedes volver a arrancarla.' ;;
    es:installer.mac.podman_install_failed) printf '%s' 'La instalación de Podman ha fallado' ;;
    es:installer.mac.podman_no_version) printf '%s' 'un podman que no dice su versión' ;;
    es:installer.mac.podman_version_unsupported) printf '%s' 'JHT en un Mac necesita Podman %s.%s o un %s.x posterior (no 6.2 ni posteriores); este Mac tiene %s. Si Homebrew ha llevado Podman más allá de la serie %s, vuelve a descargar el instalador de JHT de hoy (dice qué serie admite); no se ha instalado nada de JHT.' ;;
    es:installer.migration.colima_default) printf '%s' 'Si instalaste Colima solo para JHT, tras la desinstalación su máquina virtual (perfil default, la que arrancaba el instalador de JHT) se queda en el disco, detenida: elimínala con «colima delete -p default» para liberar el espacio. Si usas Colima para otras cosas, déjala.' ;;
    es:installer.migration.colima_started) printf '%s' 'Tras la desinstalación, la máquina virtual de Colima que creó JHT (perfil %s) se queda en el disco, detenida: si no la usas para nada más, elimínala con «colima delete -p %s» para liberar el espacio.' ;;
    es:installer.migration.refused) printf '%s' 'este ordenador ejecuta JHT en Docker (Colima, Docker Desktop o Docker Engine). Desde la 0.4, JHT solo funciona con Podman, y no se ha cambiado nada. Tus datos se quedan: ~/.jht (configuración, base de datos, perfil) y ~/Documents/Job Hunter Team (CV, resultados) son carpetas de este ordenador. Lo que se queda en los volúmenes de Docker y tendrás que dar otra vez: la clave API guardada por la configuración, la contraseña del correo, los tokens de Telegram. Para pasar a Podman: %s, vuelve a ejecutar este instalador y luego «jht setup» con tu clave API.%s' ;;
    es:installer.migration.uninstall) printf '%s' 'ejecuta «jht uninstall --confirm» (conserva esas dos carpetas)' ;;
    es:installer.migration.uninstall_old_jht) printf '%s' 'tu comando jht es de una versión que no sabe desinstalarse, así que usa el de esta versión: «f="$(mktemp)" && curl -fsSL '\''%s'\'' -o "$f" && bash "$f" uninstall --confirm; rm -f "$f"» (quita el JHT en Docker y el comando jht antiguo, y conserva esas dos carpetas)' ;;
    es:installer.min_free_invalid) printf '%s' 'JHT_MIN_FREE_GIB no válido: %s' ;;
    es:installer.mode) printf '%s' 'modo:    ' ;;
    es:installer.mount_repair_failed) printf '%s' '%s y %s no se pueden hacer escribibles para el contenedor de Job Hunter Team (se ejecuta como uid 1001) y no se ha arrancado nada. O deja que Docker funcione para esta cuenta (añádela al grupo '\''docker'\'' y vuelve a iniciar sesión), o ejecuta una vez: sudo chown -R 1001:1001 "%s" "%s" y luego vuelve a ejecutar este instalador.' ;;
    es:installer.next_step_run_finish) printf '%s' 'Siguiente paso: ejecuta  %s  para terminar la configuración.' ;;
    es:installer.next_steps) printf '%s' 'Siguientes pasos:' ;;
    es:installer.no_interactive_terminal_no) printf '%s' 'No hay terminal interactivo (no hay /dev/tty): me salto el asistente.' ;;
    es:installer.no_shell_rc_file) printf '%s' 'No se ha escrito ningún archivo rc de la shell. Añade a mano:' ;;
    es:installer.open_new_terminal_window) printf '%s' 'Primero abre una nueva ventana del terminal (o ejecuta: . ~/.profile), para que encuentre jht.' ;;
    es:installer.ownership_1001_1001_container) printf '%s' 'Propietario de %s y %s → 1001:1001 (UID del contenedor)' ;;
    es:installer.ownership_1001_1001_container_2) printf '%s' 'Propietario de %s y %s → 1001:1001 (UID del contenedor, puesto por un contenedor de un solo uso: sin sudo)' ;;
    es:installer.ownership_stays_user_macos) printf '%s' '%s y %s siguen siendo de este usuario (macOS)' ;;
    es:installer.ownership_stays_user_rootless) printf '%s' '%s y %s siguen siendo de este usuario (Podman rootless)' ;;
    es:installer.pairing_token_present_skipping) printf '%s' 'Hay un token de emparejamiento: me salto el asistente interactivo.' ;;
    es:installer.pairing_token_saved) printf '%s' 'Token de emparejamiento guardado en %s (permisos 0600)' ;;
    es:installer.path_added) printf '%s' 'PATH añadido a %s' ;;
    es:installer.path_added_etc_profile) printf '%s' 'PATH añadido a /etc/profile.d/jht.sh (para todo el sistema)' ;;
    es:installer.podman.answers_rootful) printf '%s' 'podman responde como rootful para %s (Rootless=%s): JHT necesita Podman rootless.' ;;
    es:installer.podman.apt_failed) printf '%s' 'apt-get install%s ha fallado. Para ver por qué, ejecuta: sudo apt-get install%s' ;;
    es:installer.podman.apt_would_remove) printf '%s' 'instalar%s QUITARÍA otros paquetes de este ordenador (a menudo containerd.io, el de Docker): no se ha cambiado nada. Para ver cuáles, ejecuta: sudo apt-get -s install%s. Instala tú Podman de forma que se queden (o decide quitarlos) y luego vuelve a ejecutar este instalador.' ;;
    es:installer.podman.compose_missing) printf '%s' 'podman-compose no está disponible en los paquetes de este sistema. Pide al administrador de este servidor que lo instale, como root: apt install podman-compose' ;;
    es:installer.podman.compose_too_old) printf '%s' 'podman-compose %s es más antiguo que %s. Pide al administrador de este servidor un podman-compose más reciente.' ;;
    es:installer.podman.distribution_too_old) printf '%s' 'esta distribución instalaría %s %s, y Job Hunter Team 0.4.0 necesita %s %s o posterior: no se ha instalado nada. Distribuciones que lo traen: Ubuntu 26.04 LTS, Debian 13, Fedora 43 o posteriores.' ;;
    es:installer.podman.dnf_failed) printf '%s' 'dnf install%s ha fallado (dnf no quita nada: lo detiene un conflicto con un paquete instalado). Para ver por qué, ejecuta: sudo dnf install%s' ;;
    es:installer.podman.info_fails) printf '%s' ''\''podman info'\'' falla para %s, así que el almacenamiento o el runtime rootless no están listos. Ejecútalo a mano para ver por qué.' ;;
    es:installer.podman.linger_failed) printf '%s' 'loginctl enable-linger %s ha fallado.' ;;
    es:installer.podman.linger_missing) printf '%s' 'los contenedores de %s se detendrían al terminar la sesión. Pide al administrador de este servidor que ejecute, como root: loginctl enable-linger %s' ;;
    es:installer.podman.missing_default) printf '%s' 'el rango subuid o el linger' ;;
    es:installer.podman.no_package_manager) printf '%s' 'ningún gestor de paquetes conocido (apt, dnf, pacman) para instalar:%s' ;;
    es:installer.podman.pacman_failed) printf '%s' 'pacman -S%s ha fallado (no se ha quitado nada). Para ver por qué, ejecuta: sudo pacman -S%s' ;;
    es:installer.podman.root_refused) printf '%s' 'JHT funciona con Podman rootless, como un usuario que no es root. Entra con ese usuario y vuelve a ejecutar la instalación.' ;;
    es:installer.podman.runtime_dir_missing) printf '%s' 'no hay carpeta de runtime para este usuario (%s): la sesión no tiene un gestor de usuario. Vuelve a iniciar sesión, o pide al administrador que ejecute, como root: loginctl enable-linger %s' ;;
    es:installer.podman.still_missing) printf '%s' 'podman sigue sin estar después de la instalación. Pide al administrador de este servidor que ejecute, como root: apt install podman' ;;
    es:installer.podman.subuid_missing) printf '%s' '%s no tiene un rango de uid/gid subordinados en %s/subuid y %s/subgid. Pide al administrador de este servidor que ejecute, como root: usermod --add-subuids 100000-165535 --add-subgids 100000-165535 %s' ;;
    es:installer.podman.sudo_required) printf '%s' 'Podman necesita una preparación que solo puede hacer un administrador (falta:%s), y sudo para %s no está disponible sin contraseña. Pide al administrador de este servidor que dé a %s sudo sin contraseña, o que ejecute, como root: apt install podman podman-compose uidmap; loginctl enable-linger %s' ;;
    es:installer.podman.too_old) printf '%s' 'podman %s es más antiguo que %s. Pide al administrador de este servidor un podman más reciente.' ;;
    es:installer.podman.unknown_version) printf '%s' 'de versión desconocida' ;;
    es:installer.podman.unsupported_host) printf '%s' '--runtime podman es para Linux y macOS; este sistema es %s.' ;;
    es:installer.podman.usermod_failed) printf '%s' 'usermod no ha podido añadir el rango subordinado (%s-%s) para %s.' ;;
    es:installer.podman_already_installed) printf '%s' 'podman ya instalado' ;;
    es:installer.podman_compose_already_installed) printf '%s' 'podman-compose ya instalado' ;;
    es:installer.podman_machine_already_running) printf '%s' 'La máquina Podman '\''%s'\'' ya está en marcha' ;;
    es:installer.podman_machine_reachable) printf '%s' 'Máquina Podman accesible' ;;
    es:installer.podman_ready_but_weekly) printf '%s' 'Podman está listo, pero no se ha podido activar su temporizador semanal que libera el disco.' ;;
    es:installer.podman_ready_colima_retained) printf '%s' 'Podman listo (Colima se queda como estaba)' ;;
    es:installer.podman_rootless_podman_compose) printf '%s' 'Podman rootless %s + podman-compose %s para %s' ;;
    es:installer.podman_rootless_reachable) printf '%s' 'podman rootless accesible' ;;
    es:installer.private_jht_docker_shim) printf '%s' 'Shim docker privado de JHT: %s (no añadido al PATH global; Colima sin tocar)' ;;
    es:installer.private_jht_docker_shim_2) printf '%s' 'Shim docker privado de JHT: %s (no añadido al PATH global; Podman rootless, sin máquina)' ;;
    es:installer.run_manually_jht_setup) printf '%s' 'Ejecuta a mano: jht setup' ;;
    es:installer.running_host_setup_sh) printf '%s' 'Ejecutando host-setup.sh (escribe ~/.jht/host.env y comprueba el swap)...' ;;
    es:installer.runtime) printf '%s' 'runtime: ' ;;
    es:installer.runtime_dir_bad_ancestor) printf '%s' 'La carpeta del runtime en el host tiene por encima un enlace simbólico o una ruta no canónica: %s' ;;
    es:installer.runtime_dir_in_mount) printf '%s' 'La carpeta del runtime en el host tiene que estar fuera de las carpetas en las que el contenedor puede escribir: %s' ;;
    es:installer.runtime_dir_is_link) printf '%s' 'La carpeta del runtime en el host es un enlace simbólico: %s' ;;
    es:installer.runtime_image_pinned) printf '%s' 'imagen del runtime fijada: %s' ;;
    es:installer.runtime_tier_core_tools) printf '%s' 'nivel del runtime: core (las herramientas llegan después de la bienvenida)' ;;
    es:installer.same_as_above_empties) printf '%s' '(igual que arriba, y además vacía ~/.jht y ~/Documents/Job Hunter Team)' ;;
    es:installer.setup_did_not_finish) printf '%s' 'La configuración no ha terminado (código de salida %s): Job Hunter Team está instalado, pero todavía no está configurado.' ;;
    es:installer.setup_done_team_needs_space) printf '%s' 'La configuración está terminada y guardada, pero el equipo no ha arrancado: hace falta más espacio libre en el disco. Libéralo como se indica arriba y luego arranca el equipo con  jht team start  (no hace falta repetir la configuración).' ;;
    es:installer.starting_podman_machine) printf '%s' 'Arrancando la máquina Podman '\''%s'\''...' ;;
    es:installer.subuid_subgid_range) printf '%s' 'rango subuid/subgid %s-%s para %s' ;;
    es:installer.system_detection) printf '%s' 'Detección del sistema' ;;
    es:installer.team_running) printf '%s' 'Job Hunter Team está en marcha en este ordenador (%s). Si la configuración se interrumpió, retómala con «jht setup» en este terminal; no hace falta apagar nada. Para reinstalar, en cambio: detenlo con «jht down», vuelve a ejecutar el instalador y luego arráncalo con «jht up». No se ha cambiado nada: tu perfil y tus documentos en ~/.jht y ~/Documents/Job Hunter Team se quedan donde están.' ;;
    es:installer.team_running_update) printf '%s' 'Job Hunter Team está en marcha en este ordenador (%s). Para actualizarlo, detenlo con «jht down», vuelve a ejecutar el instalador y luego arráncalo con «jht up». No se ha cambiado nada: tu perfil y tus documentos en ~/.jht y ~/Documents/Job Hunter Team se quedan donde están.' ;;
    es:installer.terminal_run) printf '%s' 'En este terminal, ejecuta:' ;;
    es:installer.uid_1001_taken) printf '%s' 'el uid 1001 en este ordenador es la cuenta '\''%s'\''. El contenedor de Job Hunter Team se ejecuta como uid 1001, así que esa cuenta sería la propietaria de ~/.jht (tus datos y las credenciales de los portales). No se ha cambiado nada. Ejecuta JHT desde la cuenta '\''%s'\'', o da a '\''%s'\'' otro uid, y vuelve a intentarlo.' ;;
    es:installer.uninstall_keeps_your_data) printf '%s' 'Para desinstalar (tus datos en ~/.jht y ~/Documents/Job Hunter Team se quedan):' ;;
    es:installer.wrapper_dir_bad_ancestor) printf '%s' 'La carpeta del wrapper en el host tiene por encima un enlace simbólico o una ruta no canónica: %s' ;;
    es:installer.wrapper_dir_in_mount) printf '%s' 'La carpeta del wrapper en el host tiene que estar fuera de las carpetas en las que el contenedor puede escribir: %s' ;;
    es:installer.wsl_not_supported) printf '%s' 'en Windows, instala JHT desde PowerShell con install.ps1 (mira docs/guides/QUICKSTART.md), no desde dentro de WSL. No se ha cambiado nada.' ;;
    de:installer.agents_can_only_see) printf '%s' 'Die Agenten sehen nur:' ;;
    de:installer.already_path) printf '%s' '%s ist schon im PATH' ;;
    de:installer.also_delete_your_data) printf '%s' 'Um auch deine Daten zu löschen (Konfiguration, Datenbank, Lebensläufe, Ergebnisse):' ;;
    de:installer.also_deletes_api_key) printf '%s' '(es löscht auch den API-Schlüssel, das Mail-Passwort und die Telegram-Tokens, die für das Team gespeichert sind)' ;;
    de:installer.apt_get_update_failed) printf '%s' 'apt-get update fehlgeschlagen: Ich versuche die Installation trotzdem.' ;;
    de:installer.branch) printf '%s' 'Branch:  ' ;;
    de:installer.cannot_list_containers) printf '%s' 'Die laufenden Container lassen sich mit %s nicht auflisten: Nichts wurde installiert.' ;;
    de:installer.check.adapter_bad_ancestor) printf '%s' 'Über dem bin-Ordner des Podman-Adapters liegt ein nicht kanonischer Pfad: %s' ;;
    de:installer.check.adapter_is_link) printf '%s' 'Der bin-Ordner des Podman-Adapters ist ein symbolischer Link: %s' ;;
    de:installer.check.adapter_not_dir) printf '%s' 'Der bin-Pfad des Podman-Adapters ist kein Ordner: %s' ;;
    de:installer.check.branch_unresolved) printf '%s' 'Der Branch '\''%s'\'' lässt sich keinem unveränderlichen Release-Commit zuordnen.' ;;
    de:installer.check.compose_boundary) printf '%s' 'Die heruntergeladene docker-compose.yml setzt die geschützte Grenze der Runtime nicht durch.' ;;
    de:installer.check.compose_gone) printf '%s' 'Der Podman-Compose-Provider ist nach der Installation verschwunden.' ;;
    de:installer.check.compose_version_unreadable) printf '%s' 'Die Version des Podman-Compose-Providers lässt sich nicht lesen.' ;;
    de:installer.check.digests_not_written) printf '%s' 'die Prüfsummen der Host-Skripte wurden nicht geschrieben' ;;
    de:installer.check.machine_name_invalid) printf '%s' 'Ungültiger Name der Podman-Maschine von JHT: %s' ;;
    de:installer.check.marker_invalid) printf '%s' 'Ungültige Markierung der Runtime-Auswahl von JHT' ;;
    de:installer.check.marker_unsafe) printf '%s' 'Unsichere Markierung der Runtime-Auswahl von JHT: %s' ;;
    de:installer.check.os_unsupported) printf '%s' 'Nicht unterstütztes Betriebssystem: %s' ;;
    de:installer.check.podman_gone) printf '%s' 'Die Podman-CLI ist nach der Installation verschwunden.' ;;
    de:installer.check.podman_not_on_path) printf '%s' 'podman ist aus dem PATH verschwunden' ;;
    de:installer.check.podman_path_unsafe) printf '%s' 'Unsicherer Pfad der ausführbaren Podman-Datei: %s' ;;
    de:installer.check.shim_unsafe) printf '%s' 'Ich überschreibe keine unsichere oder nicht zu JHT gehörende ausführbare Datei: %s' ;;
    de:installer.check.wrapper_protocol) printf '%s' 'Der heruntergeladene Wrapper implementiert das geschützte Protokoll der Runtime nicht.' ;;
    de:installer.chown_not_needed) printf '%s' 'chown auf 1001 fehlgeschlagen — hier läuft nichts in einem Container (--no-docker), also braucht es niemand' ;;
    de:installer.config_db_agents) printf '%s' '(Konfiguration, Datenbank, Agenten)' ;;
    de:installer.configuration_wizard_also_starts) printf '%s' 'Einrichtungsassistent (startet auch den Container)' ;;
    de:installer.container_mode_active_podman) printf '%s' 'Container-Modus aktiv (Podman).' ;;
    de:installer.container_runtime) printf '%s' 'Container-Engine' ;;
    de:installer.container_runtime_check) printf '%s' 'Prüfung der Container-Engine' ;;
    de:installer.container_runtime_podman_rootless) printf '%s' 'Container-Engine (Podman rootless)' ;;
    de:installer.container_will_complete_pairing) printf '%s' 'Der Container schließt die Kopplung beim ersten Start ab.' ;;
    de:installer.creating_rootless_podman_machine) printf '%s' 'Erstelle die rootless Podman-Maschine '\''%s'\''...' ;;
    de:installer.cvs_attachments_output) printf '%s' '(Lebensläufe, Anhänge, Ergebnisse)' ;;
    de:installer.disk_low_dry_run) printf '%s' 'Nur %s GiB frei auf %s; eine echte Installation braucht mindestens %s GiB.' ;;
    de:installer.disk_not_enough) printf '%s' 'nicht genug freier Speicherplatz: %s GiB frei auf %s, das Image von Job Hunter Team und seine Daten brauchen mindestens %s GiB. Schaffe Platz (auf einem Server, auf dem schon Docker läuft, entfernt '\''docker image prune -af'\'' ungenutzte Images) und führe den Installer erneut aus. Nichts wurde geändert.' ;;
    de:installer.disk_room_short) printf '%s' 'Job Hunter Team lädt etwa %s GiB herunter, und nach dem Download hätten die Agenten weniger als die %s GiB Speicherplatz, die sie brauchen: Jetzt sind %s GiB frei. Gib mindestens %s GiB mehr frei (leere den Papierkorb, lösche große Dateien, die du nicht brauchst), dann führe den Installer erneut aus: Es wurde nichts heruntergeladen, und die installierte Version von Job Hunter Team wurde nicht angerührt.' ;;
    de:installer.done_compose) printf '%s' 'Compose: %s' ;;
    de:installer.done_host_setup) printf '%s' 'host-setup: %s' ;;
    de:installer.done_wrapper) printf '%s' 'Wrapper: %s' ;;
    de:installer.download_failed) printf '%s' 'Download fehlgeschlagen: %s. Prüfe deine Verbindung und den Branch (%s).' ;;
    de:installer.download_wrapper_docker_compose) printf '%s' 'Wrapper + docker-compose.yml herunterladen' ;;
    de:installer.downloading_docker_compose_yml) printf '%s' 'Lade docker-compose.yml herunter...' ;;
    de:installer.downloading_host_setup_sh) printf '%s' 'Lade host-setup.sh herunter (VPS-/Swap-Vorprüfung)...' ;;
    de:installer.downloading_jht_wrapper) printf '%s' 'Lade den jht-Wrapper herunter...' ;;
    de:installer.enabling_linger) printf '%s' 'Aktiviere linger für %s...' ;;
    de:installer.existing_podman_machine_has) printf '%s' 'Die vorhandene Podman-Maschine '\''%s'\'' hat die Ressourcen '\''%s'\''; JHT empfiehlt %s CPU, %s MiB RAM und %s GiB Festplatte. Die vorhandene Maschine wurde nicht geändert.' ;;
    de:installer.extras_image_pinned_ghcr) printf '%s' 'Extras-Image festgelegt: ghcr.io/leopu00/jht@%s (wird geladen, wenn ein Werkzeug angefordert wird)' ;;
    de:installer.giving_subordinate_uid_gid) printf '%s' 'Gebe %s den untergeordneten uid/gid-Bereich %s-%s...' ;;
    de:installer.helper_download_failed) printf '%s' 'Download oder Prüfung von %s fehlgeschlagen: %s/scripts/%s' ;;
    de:installer.host_file_tmp_failed) printf '%s' 'kann in %s keine temporäre Datei anlegen: %s wird nicht geschrieben' ;;
    de:installer.host_setup_completed_auto) printf '%s' 'host-setup abgeschlossen (Host-Typ automatisch erkannt)' ;;
    de:installer.host_setup_completed_forced) printf '%s' 'host-setup abgeschlossen (vps erzwungen)' ;;
    de:installer.host_setup_download_failed) printf '%s' 'Download oder Prüfung von host-setup.sh fehlgeschlagen: %s' ;;
    de:installer.host_setup_exited_error) printf '%s' 'host-setup mit Fehler beendet — es geht weiter (eventuell ist eine manuelle Kopplung nötig)' ;;
    de:installer.host_setup_exited_error_2) printf '%s' 'host-setup mit Fehler beendet — es geht weiter' ;;
    de:installer.host_setup_missing) printf '%s' 'host-setup.sh ist unter %s nicht verfügbar — Vorprüfung übersprungen' ;;
    de:installer.image) printf '%s' 'Image:   ' ;;
    de:installer.image_download_failed) printf '%s' 'Download des JHT-Images fehlgeschlagen: %s' ;;
    de:installer.installation_complete) printf '%s' 'Installation abgeschlossen!' ;;
    de:installer.installed) printf '%s' 'Installiert:%s' ;;
    de:installer.installing_podman_cli) printf '%s' 'Installiere die Podman-CLI...' ;;
    de:installer.installing_podman_compose_provider) printf '%s' 'Installiere den Podman-Compose-Provider...' ;;
    de:installer.installing_sudo_podman_rootless) printf '%s' 'Installiere%s mit sudo (Podman rootless; Docker wird nicht installiert)...' ;;
    de:installer.linger_enabled) printf '%s' 'linger für %s aktiviert' ;;
    de:installer.loginctl_not_found_linger) printf '%s' 'loginctl nicht gefunden: linger wurde nicht geprüft.' ;;
    de:installer.mac.cannot_create_folder) printf '%s' 'Kann %s für die Podman-Maschine nicht anlegen.' ;;
    de:installer.mac.compose_install_failed) printf '%s' 'Installation von podman-compose fehlgeschlagen' ;;
    de:installer.mac.compose_version_unsupported) printf '%s' 'JHT auf dem Mac braucht podman-compose %s; dieser Mac hat %s. Führe «brew upgrade podman-compose» (oder «brew install podman-compose») aus, dann noch einmal diesen Installer.' ;;
    de:installer.mac.homebrew_missing) printf '%s' 'JHT installiert Podman mit Homebrew, das auf diesem Mac nicht da ist. Nichts wurde geändert. Installiere Homebrew von https://brew.sh (ein Befehl im Terminal; er fragt nach deinem Mac-Passwort), öffne ein neues Terminalfenster und führe diesen Installer erneut aus.' ;;
    de:installer.mac.machine_init_failed) printf '%s' 'Initialisierung der Podman-Maschine fehlgeschlagen; Colima wurde nicht geändert.' ;;
    de:installer.mac.machine_name_placeholder) printf '%s' '<Name>' ;;
    de:installer.mac.machine_not_responding) printf '%s' 'Die JHT-Podman-Maschine antwortet nicht.' ;;
    de:installer.mac.machine_start_failed) printf '%s' 'Start der Podman-Maschine fehlgeschlagen; Colima wurde nicht geändert.' ;;
    de:installer.mac.machine_unreachable) printf '%s' 'Die Podman-Maschine '\''%s'\'' ist nicht erreichbar.' ;;
    de:installer.mac.other_machine_any) printf '%s' 'eine andere Podman-Maschine läuft (finde sie mit '\''podman machine list'\'')' ;;
    de:installer.mac.other_machine_named) printf '%s' 'eine andere Podman-Maschine, %s, läuft' ;;
    de:installer.mac.other_machine_running) printf '%s' '%s, und ein Mac lässt nur eine gleichzeitig laufen. Stoppe sie mit '\''podman machine stop %s'\'' (oder aus der App, mit der du sie nutzt) und führe den Installer erneut aus: Job Hunter Team stoppt sie nie für dich, und du kannst sie danach wieder starten.' ;;
    de:installer.mac.podman_install_failed) printf '%s' 'Installation von Podman fehlgeschlagen' ;;
    de:installer.mac.podman_no_version) printf '%s' 'ein podman, das seine Version nicht nennt' ;;
    de:installer.mac.podman_version_unsupported) printf '%s' 'JHT auf dem Mac braucht Podman %s.%s oder ein neueres %s.x (nicht 6.2 oder neuer); dieser Mac hat %s. Wenn Homebrew Podman über die Reihe %s hinaus aktualisiert hat, hol dir den JHT-Installer von heute neu (er sagt, welche Reihe er unterstützt); von JHT wurde nichts installiert.' ;;
    de:installer.migration.colima_default) printf '%s' 'Wenn du Colima nur für JHT installiert hast, bleibt nach der Deinstallation seine virtuelle Maschine (Profil default, die der JHT-Installer gestartet hat) gestoppt auf der Festplatte: Entferne sie mit «colima delete -p default», um den Platz freizugeben. Wenn du Colima für andere Dinge nutzt, lass es.' ;;
    de:installer.migration.colima_started) printf '%s' 'Nach der Deinstallation bleibt die virtuelle Maschine von Colima, die JHT erstellt hat (Profil %s), gestoppt auf der Festplatte: Wenn du sie für nichts anderes nutzt, entferne sie mit «colima delete -p %s», um den Platz freizugeben.' ;;
    de:installer.migration.refused) printf '%s' 'dieser Computer führt JHT auf Docker aus (Colima, Docker Desktop oder Docker Engine). Seit 0.4 läuft JHT nur auf Podman, und nichts wurde geändert. Deine Daten bleiben: ~/.jht (Konfiguration, Datenbank, Profil) und ~/Documents/Job Hunter Team (Lebensläufe, Ergebnisse) sind Ordner dieses Computers. Was in den Volumes von Docker zurückbleibt und neu angegeben werden muss: der vom Setup gespeicherte API-Schlüssel, das Mail-Passwort, die Telegram-Tokens. Um zu Podman zu wechseln: %s, führe diesen Installer erneut aus, dann «jht setup» mit deinem API-Schlüssel.%s' ;;
    de:installer.migration.uninstall) printf '%s' 'führe «jht uninstall --confirm» aus (es behält diese beiden Ordner)' ;;
    de:installer.migration.uninstall_old_jht) printf '%s' 'dein jht-Befehl stammt aus einer Version, die sich nicht selbst deinstallieren kann, also nimm den dieser Version: «f="$(mktemp)" && curl -fsSL '\''%s'\'' -o "$f" && bash "$f" uninstall --confirm; rm -f "$f"» (er entfernt das JHT auf Docker und den alten jht-Befehl und behält diese beiden Ordner)' ;;
    de:installer.min_free_invalid) printf '%s' 'Ungültiges JHT_MIN_FREE_GIB: %s' ;;
    de:installer.mode) printf '%s' 'Modus:   ' ;;
    de:installer.mount_repair_failed) printf '%s' '%s und %s lassen sich für den Container von Job Hunter Team (er läuft als uid 1001) nicht beschreibbar machen, und nichts wurde gestartet. Lass entweder Docker für dieses Konto laufen (füge es zur Gruppe '\''docker'\'' hinzu und melde dich neu an), oder führe einmal aus: sudo chown -R 1001:1001 "%s" "%s" — dann führe diesen Installer erneut aus.' ;;
    de:installer.next_step_run_finish) printf '%s' 'Nächster Schritt: Führe  %s  aus, um die Einrichtung abzuschließen.' ;;
    de:installer.next_steps) printf '%s' 'Nächste Schritte:' ;;
    de:installer.no_interactive_terminal_no) printf '%s' 'Kein interaktives Terminal (kein /dev/tty): Assistent übersprungen.' ;;
    de:installer.no_shell_rc_file) printf '%s' 'Es wurde keine rc-Datei der Shell geschrieben. Füge von Hand hinzu:' ;;
    de:installer.open_new_terminal_window) printf '%s' 'Öffne zuerst ein neues Terminalfenster (oder führe aus: . ~/.profile), damit es jht findet.' ;;
    de:installer.ownership_1001_1001_container) printf '%s' 'Eigentümer von %s und %s → 1001:1001 (UID des Containers)' ;;
    de:installer.ownership_1001_1001_container_2) printf '%s' 'Eigentümer von %s und %s → 1001:1001 (UID des Containers, gesetzt von einem einmaligen Container: kein sudo nötig)' ;;
    de:installer.ownership_stays_user_macos) printf '%s' '%s und %s bleiben im Besitz dieses Benutzers (macOS)' ;;
    de:installer.ownership_stays_user_rootless) printf '%s' '%s und %s bleiben im Besitz dieses Benutzers (rootless Podman)' ;;
    de:installer.pairing_token_present_skipping) printf '%s' 'Kopplungstoken vorhanden: Der interaktive Assistent wird übersprungen.' ;;
    de:installer.pairing_token_saved) printf '%s' 'Kopplungstoken gespeichert in %s (Modus 0600)' ;;
    de:installer.path_added) printf '%s' 'PATH zu %s hinzugefügt' ;;
    de:installer.path_added_etc_profile) printf '%s' 'PATH zu /etc/profile.d/jht.sh hinzugefügt (systemweit)' ;;
    de:installer.podman.answers_rootful) printf '%s' 'podman antwortet für %s als rootful (Rootless=%s): JHT braucht Podman rootless.' ;;
    de:installer.podman.apt_failed) printf '%s' 'apt-get install%s fehlgeschlagen. Um zu sehen, warum, führe aus: sudo apt-get install%s' ;;
    de:installer.podman.apt_would_remove) printf '%s' 'die Installation von%s würde ANDERE Pakete dieses Computers ENTFERNEN (oft containerd.io, das von Docker): Nichts wurde geändert. Um zu sehen, welche, führe aus: sudo apt-get -s install%s. Installiere Podman selbst so, dass sie bleiben (oder entscheide dich, sie zu entfernen), dann führe diesen Installer erneut aus.' ;;
    de:installer.podman.compose_missing) printf '%s' 'podman-compose ist in den Paketen dieses Systems nicht verfügbar. Bitte den Administrator dieses Servers, es als root zu installieren: apt install podman-compose' ;;
    de:installer.podman.compose_too_old) printf '%s' 'podman-compose %s ist älter als %s. Bitte den Administrator dieses Servers um ein neueres podman-compose.' ;;
    de:installer.podman.distribution_too_old) printf '%s' 'diese Distribution würde %s %s installieren, und Job Hunter Team 0.4.0 braucht %s %s oder neuer: Nichts wurde installiert. Distributionen, die es liefern: Ubuntu 26.04 LTS, Debian 13, Fedora 43 oder neuer.' ;;
    de:installer.podman.dnf_failed) printf '%s' 'dnf install%s fehlgeschlagen (dnf entfernt nichts: Ein Konflikt mit einem installierten Paket hält es auf). Um zu sehen, warum, führe aus: sudo dnf install%s' ;;
    de:installer.podman.info_fails) printf '%s' ''\''podman info'\'' schlägt für %s fehl, also ist der rootless Speicher oder die Runtime nicht bereit. Führe es von Hand aus, um zu sehen, warum.' ;;
    de:installer.podman.linger_failed) printf '%s' 'loginctl enable-linger %s fehlgeschlagen.' ;;
    de:installer.podman.linger_missing) printf '%s' 'die Container von %s würden stoppen, wenn die Sitzung endet. Bitte den Administrator dieses Servers, als root auszuführen: loginctl enable-linger %s' ;;
    de:installer.podman.missing_default) printf '%s' 'der subuid-Bereich oder linger' ;;
    de:installer.podman.no_package_manager) printf '%s' 'kein bekannter Paketmanager (apt, dnf, pacman), um zu installieren:%s' ;;
    de:installer.podman.pacman_failed) printf '%s' 'pacman -S%s fehlgeschlagen (nichts wurde entfernt). Um zu sehen, warum, führe aus: sudo pacman -S%s' ;;
    de:installer.podman.root_refused) printf '%s' 'JHT läuft auf Podman rootless, als ein Benutzer, der nicht root ist. Melde dich als dieser Benutzer an und führe die Installation erneut aus.' ;;
    de:installer.podman.runtime_dir_missing) printf '%s' 'es gibt kein Runtime-Verzeichnis für diesen Benutzer (%s): Die Sitzung hat keinen Benutzer-Manager. Melde dich neu an, oder bitte den Administrator, als root auszuführen: loginctl enable-linger %s' ;;
    de:installer.podman.still_missing) printf '%s' 'podman ist nach der Installation immer noch nicht da. Bitte den Administrator dieses Servers, als root auszuführen: apt install podman' ;;
    de:installer.podman.subuid_missing) printf '%s' '%s hat keinen untergeordneten uid/gid-Bereich in %s/subuid und %s/subgid. Bitte den Administrator dieses Servers, als root auszuführen: usermod --add-subuids 100000-165535 --add-subgids 100000-165535 %s' ;;
    de:installer.podman.sudo_required) printf '%s' 'Podman braucht eine Einrichtung, die nur ein Administrator machen kann (fehlt:%s), und sudo ist für %s nicht ohne Passwort verfügbar. Bitte den Administrator dieses Servers, %s sudo ohne Passwort zu erlauben, oder als root auszuführen: apt install podman podman-compose uidmap; loginctl enable-linger %s' ;;
    de:installer.podman.too_old) printf '%s' 'podman %s ist älter als %s. Bitte den Administrator dieses Servers um ein neueres podman.' ;;
    de:installer.podman.unknown_version) printf '%s' 'unbekannter Version' ;;
    de:installer.podman.unsupported_host) printf '%s' '--runtime podman ist für Linux und macOS; dieses System ist %s.' ;;
    de:installer.podman.usermod_failed) printf '%s' 'usermod konnte den untergeordneten Bereich (%s-%s) für %s nicht hinzufügen.' ;;
    de:installer.podman_already_installed) printf '%s' 'podman ist schon installiert' ;;
    de:installer.podman_compose_already_installed) printf '%s' 'podman-compose ist schon installiert' ;;
    de:installer.podman_machine_already_running) printf '%s' 'Podman-Maschine '\''%s'\'' läuft schon' ;;
    de:installer.podman_machine_reachable) printf '%s' 'Podman-Maschine erreichbar' ;;
    de:installer.podman_ready_but_weekly) printf '%s' 'Podman ist bereit, aber sein wöchentlicher Timer zum Trimmen der Festplatte ließ sich nicht aktivieren.' ;;
    de:installer.podman_ready_colima_retained) printf '%s' 'Podman bereit (Colima bleibt erhalten)' ;;
    de:installer.podman_rootless_podman_compose) printf '%s' 'Podman rootless %s + podman-compose %s für %s' ;;
    de:installer.podman_rootless_reachable) printf '%s' 'podman rootless erreichbar' ;;
    de:installer.private_jht_docker_shim) printf '%s' 'Privater JHT-Docker-Shim: %s (nicht zum globalen PATH hinzugefügt; Colima unangetastet)' ;;
    de:installer.private_jht_docker_shim_2) printf '%s' 'Privater JHT-Docker-Shim: %s (nicht zum globalen PATH hinzugefügt; rootless Podman, keine Maschine)' ;;
    de:installer.run_manually_jht_setup) printf '%s' 'Führe von Hand aus: jht setup' ;;
    de:installer.running_host_setup_sh) printf '%s' 'Führe host-setup.sh aus (schreibt ~/.jht/host.env + Swap-Vorprüfung)...' ;;
    de:installer.runtime) printf '%s' 'Runtime: ' ;;
    de:installer.runtime_dir_bad_ancestor) printf '%s' 'Die Host-Runtime hat einen übergeordneten Ordner, der ein symbolischer Link oder nicht kanonisch ist: %s' ;;
    de:installer.runtime_dir_in_mount) printf '%s' 'Die Host-Runtime muss außerhalb der Bind-Mounts liegen, in die der Container schreiben kann: %s' ;;
    de:installer.runtime_dir_is_link) printf '%s' 'Der Pfad der Host-Runtime ist ein symbolischer Link: %s' ;;
    de:installer.runtime_image_pinned) printf '%s' 'Runtime-Image festgelegt: %s' ;;
    de:installer.runtime_tier_core_tools) printf '%s' 'Runtime-Stufe: core (die Werkzeuge kommen nach der Begrüßung)' ;;
    de:installer.same_as_above_empties) printf '%s' '(wie oben, und es leert auch ~/.jht und ~/Documents/Job Hunter Team)' ;;
    de:installer.setup_did_not_finish) printf '%s' 'Die Einrichtung wurde nicht abgeschlossen (Exit-Code %s): Job Hunter Team ist installiert, aber noch nicht eingerichtet.' ;;
    de:installer.setup_done_team_needs_space) printf '%s' 'Die Einrichtung ist abgeschlossen und gespeichert, aber das Team ist nicht gestartet: Auf dem Datenträger wird mehr freier Platz gebraucht. Gib ihn wie oben beschrieben frei und starte dann das Team mit  jht team start  (die Einrichtung musst du nicht wiederholen).' ;;
    de:installer.starting_podman_machine) printf '%s' 'Starte die Podman-Maschine '\''%s'\''...' ;;
    de:installer.subuid_subgid_range) printf '%s' 'subuid/subgid-Bereich %s-%s für %s' ;;
    de:installer.system_detection) printf '%s' 'Systemerkennung' ;;
    de:installer.team_running) printf '%s' 'Job Hunter Team läuft auf diesem Computer (%s). Wenn die Einrichtung unterbrochen wurde, setze sie mit «jht setup» in diesem Terminal fort; ein down ist nicht nötig. Um stattdessen neu zu installieren, stoppe es mit «jht down», führe den Installer erneut aus und starte es dann mit «jht up». Nichts wurde geändert: Dein Profil und deine Dokumente in ~/.jht und ~/Documents/Job Hunter Team bleiben, wo sie sind.' ;;
    de:installer.team_running_update) printf '%s' 'Job Hunter Team läuft auf diesem Computer (%s). Zum Aktualisieren stoppe es mit «jht down», führe den Installer erneut aus und starte es dann mit «jht up». Nichts wurde geändert: Dein Profil und deine Dokumente in ~/.jht und ~/Documents/Job Hunter Team bleiben, wo sie sind.' ;;
    de:installer.terminal_run) printf '%s' 'Führe in diesem Terminal aus:' ;;
    de:installer.uid_1001_taken) printf '%s' 'uid 1001 ist auf diesem Computer das Konto '\''%s'\''. Der Container von Job Hunter Team läuft als uid 1001, also würde dieses Konto ~/.jht besitzen (deine Daten und die Zugangsdaten der Portale). Nichts wurde geändert. Starte JHT vom Konto '\''%s'\'' aus, oder gib '\''%s'\'' eine andere uid, dann versuch es erneut.' ;;
    de:installer.uninstall_keeps_your_data) printf '%s' 'Zum Deinstallieren (deine Daten in ~/.jht und ~/Documents/Job Hunter Team bleiben):' ;;
    de:installer.wrapper_dir_bad_ancestor) printf '%s' 'Der Wrapper-Ordner auf dem Host hat einen übergeordneten Ordner, der ein symbolischer Link oder nicht kanonisch ist: %s' ;;
    de:installer.wrapper_dir_in_mount) printf '%s' 'Der Wrapper auf dem Host muss außerhalb der Bind-Mounts liegen, in die der Container schreiben kann: %s' ;;
    de:installer.wsl_not_supported) printf '%s' 'unter Windows installierst du JHT aus der PowerShell mit install.ps1 (siehe docs/guides/QUICKSTART.md), nicht aus WSL heraus. Nichts wurde geändert.' ;;
    fr:installer.agents_can_only_see) printf '%s' 'Les agents ne voient que :' ;;
    fr:installer.already_path) printf '%s' '%s est déjà dans le PATH' ;;
    fr:installer.also_delete_your_data) printf '%s' 'Pour effacer aussi tes données (configuration, db, CV, résultats) :' ;;
    fr:installer.also_deletes_api_key) printf '%s' '(ça efface aussi la clé API, le mot de passe mail et les tokens Telegram enregistrés pour l'\''équipe)' ;;
    fr:installer.apt_get_update_failed) printf '%s' 'échec de apt-get update : j'\''essaie quand même d'\''installer.' ;;
    fr:installer.branch) printf '%s' 'branche : ' ;;
    fr:installer.cannot_list_containers) printf '%s' 'Impossible de lister les conteneurs actifs avec %s : rien n'\''a été installé.' ;;
    fr:installer.check.adapter_bad_ancestor) printf '%s' 'Le dossier bin de l'\''adaptateur Podman a au-dessus de lui un chemin non canonique : %s' ;;
    fr:installer.check.adapter_is_link) printf '%s' 'Le dossier bin de l'\''adaptateur Podman est un lien symbolique : %s' ;;
    fr:installer.check.adapter_not_dir) printf '%s' 'Le chemin bin de l'\''adaptateur Podman n'\''est pas un dossier : %s' ;;
    fr:installer.check.branch_unresolved) printf '%s' 'Impossible de ramener la branche '\''%s'\'' à un commit de version immuable.' ;;
    fr:installer.check.compose_boundary) printf '%s' 'Le docker-compose.yml téléchargé n'\''applique pas la frontière protégée du runtime.' ;;
    fr:installer.check.compose_gone) printf '%s' 'Le provider Podman Compose a disparu après l'\''installation.' ;;
    fr:installer.check.compose_version_unreadable) printf '%s' 'Impossible de lire la version du provider Podman Compose.' ;;
    fr:installer.check.digests_not_written) printf '%s' 'les empreintes des scripts de l'\''hôte n'\''ont pas été écrites' ;;
    fr:installer.check.machine_name_invalid) printf '%s' 'Nom de la machine Podman de JHT non valide : %s' ;;
    fr:installer.check.marker_invalid) printf '%s' 'Le marqueur du runtime choisi pour JHT n'\''est pas valide' ;;
    fr:installer.check.marker_unsafe) printf '%s' 'Le marqueur du runtime choisi pour JHT n'\''est pas sûr : %s' ;;
    fr:installer.check.os_unsupported) printf '%s' 'Système d'\''exploitation non pris en charge : %s' ;;
    fr:installer.check.podman_gone) printf '%s' 'La CLI de Podman a disparu après l'\''installation.' ;;
    fr:installer.check.podman_not_on_path) printf '%s' 'podman a disparu du PATH' ;;
    fr:installer.check.podman_path_unsafe) printf '%s' 'Le chemin de l'\''exécutable Podman n'\''est pas sûr : %s' ;;
    fr:installer.check.shim_unsafe) printf '%s' 'Je n'\''écrase pas un exécutable non sûr ou qui n'\''est pas de JHT : %s' ;;
    fr:installer.check.wrapper_protocol) printf '%s' 'Le wrapper téléchargé n'\''implémente pas le protocole protégé du runtime.' ;;
    fr:installer.chown_not_needed) printf '%s' 'échec du chown vers 1001 — ici rien ne tourne dans un conteneur (--no-docker), donc ce n'\''est pas nécessaire' ;;
    fr:installer.config_db_agents) printf '%s' '(configuration, db, agents)' ;;
    fr:installer.configuration_wizard_also_starts) printf '%s' 'assistant de configuration (démarre aussi le conteneur)' ;;
    fr:installer.container_mode_active_podman) printf '%s' 'Mode conteneur actif (Podman).' ;;
    fr:installer.container_runtime) printf '%s' 'Moteur de conteneurs' ;;
    fr:installer.container_runtime_check) printf '%s' 'Vérification du moteur de conteneurs' ;;
    fr:installer.container_runtime_podman_rootless) printf '%s' 'Moteur de conteneurs (Podman rootless)' ;;
    fr:installer.container_will_complete_pairing) printf '%s' 'Le conteneur terminera l'\''appairage à son premier démarrage.' ;;
    fr:installer.creating_rootless_podman_machine) printf '%s' 'Création de la machine Podman rootless '\''%s'\''...' ;;
    fr:installer.cvs_attachments_output) printf '%s' '(CV, pièces jointes, résultats)' ;;
    fr:installer.disk_low_dry_run) printf '%s' 'Seulement %s GiB libres sur %s ; une vraie installation demande au moins %s GiB.' ;;
    fr:installer.disk_not_enough) printf '%s' 'pas assez d'\''espace libre sur le disque : %s GiB libres sur %s, l'\''image de Job Hunter Team et ses données demandent au moins %s GiB. Libère de l'\''espace (sur un serveur qui utilise déjà Docker, '\''docker image prune -af'\'' supprime les images inutilisées) et relance l'\''installeur. Rien n'\''a été modifié.' ;;
    fr:installer.disk_room_short) printf '%s' 'Job Hunter Team télécharge environ %s Gio, et après le téléchargement il resterait aux agents moins que les %s Gio de disque dont ils ont besoin : %s Gio sont libres maintenant. Libère au moins %s Gio de plus (vide la Corbeille, supprime les gros fichiers dont tu n'\''as pas besoin), puis relance l'\''installateur : rien n'\''a été téléchargé, et la version de Job Hunter Team que tu as installée n'\''a pas été touchée.' ;;
    fr:installer.done_compose) printf '%s' 'compose : %s' ;;
    fr:installer.done_host_setup) printf '%s' 'host-setup : %s' ;;
    fr:installer.done_wrapper) printf '%s' 'wrapper : %s' ;;
    fr:installer.download_failed) printf '%s' 'Échec du téléchargement : %s. Vérifie ta connexion et la branche (%s).' ;;
    fr:installer.download_wrapper_docker_compose) printf '%s' 'Téléchargement du wrapper et de docker-compose.yml' ;;
    fr:installer.downloading_docker_compose_yml) printf '%s' 'Téléchargement de docker-compose.yml...' ;;
    fr:installer.downloading_host_setup_sh) printf '%s' 'Téléchargement de host-setup.sh (vérifications préalables VPS/swap)...' ;;
    fr:installer.downloading_jht_wrapper) printf '%s' 'Téléchargement du wrapper jht...' ;;
    fr:installer.enabling_linger) printf '%s' 'Activation du linger pour %s...' ;;
    fr:installer.existing_podman_machine_has) printf '%s' 'La machine Podman '\''%s'\'' déjà présente a les ressources '\''%s'\'' ; JHT recommande %s CPU, %s MiB de RAM et %s GiB de disque. La machine existante n'\''a pas été modifiée.' ;;
    fr:installer.extras_image_pinned_ghcr) printf '%s' 'image extras fixée : ghcr.io/leopu00/jht@%s (téléchargée quand un outil est demandé)' ;;
    fr:installer.giving_subordinate_uid_gid) printf '%s' 'J'\''attribue à %s la plage d'\''uid/gid subordonnés %s-%s...' ;;
    fr:installer.helper_download_failed) printf '%s' 'échec du téléchargement ou de la vérification de %s : %s/scripts/%s' ;;
    fr:installer.host_file_tmp_failed) printf '%s' 'impossible de créer un fichier temporaire dans %s : je n'\''écris pas %s' ;;
    fr:installer.host_setup_completed_auto) printf '%s' 'host-setup terminé (type d'\''hôte détecté automatiquement)' ;;
    fr:installer.host_setup_completed_forced) printf '%s' 'host-setup terminé (vps imposé)' ;;
    fr:installer.host_setup_download_failed) printf '%s' 'échec du téléchargement ou de la vérification de host-setup.sh : %s' ;;
    fr:installer.host_setup_exited_error) printf '%s' 'host-setup s'\''est terminé avec une erreur — je continue (un appairage manuel peut être nécessaire)' ;;
    fr:installer.host_setup_exited_error_2) printf '%s' 'host-setup s'\''est terminé avec une erreur — je continue' ;;
    fr:installer.host_setup_missing) printf '%s' 'host-setup.sh n'\''est pas disponible dans %s — je saute les vérifications préalables' ;;
    fr:installer.image) printf '%s' 'image :   ' ;;
    fr:installer.image_download_failed) printf '%s' 'Échec du téléchargement de l'\''image JHT : %s' ;;
    fr:installer.installation_complete) printf '%s' 'Installation terminée !' ;;
    fr:installer.installed) printf '%s' 'Installé :%s' ;;
    fr:installer.installing_podman_cli) printf '%s' 'Installation de la CLI de Podman...' ;;
    fr:installer.installing_podman_compose_provider) printf '%s' 'Installation du provider Podman Compose...' ;;
    fr:installer.installing_sudo_podman_rootless) printf '%s' 'J'\''installe%s avec sudo (Podman rootless ; Docker n'\''est pas installé)...' ;;
    fr:installer.linger_enabled) printf '%s' 'linger activé pour %s' ;;
    fr:installer.loginctl_not_found_linger) printf '%s' 'loginctl introuvable : le linger n'\''a pas été vérifié.' ;;
    fr:installer.mac.cannot_create_folder) printf '%s' 'Impossible de créer %s pour la machine Podman.' ;;
    fr:installer.mac.compose_install_failed) printf '%s' 'échec de l'\''installation de podman-compose' ;;
    fr:installer.mac.compose_version_unsupported) printf '%s' 'JHT sur Mac a besoin de podman-compose %s ; ce Mac a %s. Lance «brew upgrade podman-compose» (ou «brew install podman-compose»), puis relance cet installeur.' ;;
    fr:installer.mac.homebrew_missing) printf '%s' 'JHT installe Podman avec Homebrew, qui n'\''est pas sur ce Mac. Rien n'\''a été modifié. Installe Homebrew depuis https://brew.sh (une commande dans le Terminal ; il demande le mot de passe de ton Mac), ouvre une nouvelle fenêtre du Terminal et relance cet installeur.' ;;
    fr:installer.mac.machine_init_failed) printf '%s' 'Échec de la création de la machine Podman ; Colima n'\''a pas été modifié.' ;;
    fr:installer.mac.machine_name_placeholder) printf '%s' '<nom>' ;;
    fr:installer.mac.machine_not_responding) printf '%s' 'La machine Podman de JHT ne répond pas.' ;;
    fr:installer.mac.machine_start_failed) printf '%s' 'Échec du démarrage de la machine Podman ; Colima n'\''a pas été modifié.' ;;
    fr:installer.mac.machine_unreachable) printf '%s' 'La machine Podman '\''%s'\'' est injoignable.' ;;
    fr:installer.mac.other_machine_any) printf '%s' 'une autre machine Podman est démarrée (trouve-la avec '\''podman machine list'\'')' ;;
    fr:installer.mac.other_machine_named) printf '%s' 'une autre machine Podman, %s, est démarrée' ;;
    fr:installer.mac.other_machine_running) printf '%s' '%s, et un Mac n'\''en fait tourner qu'\''une à la fois. Arrête-la avec '\''podman machine stop %s'\'' (ou depuis l'\''app avec laquelle tu l'\''utilises) et relance l'\''installeur : Job Hunter Team ne l'\''arrête jamais à ta place, et tu pourras la redémarrer ensuite.' ;;
    fr:installer.mac.podman_install_failed) printf '%s' 'Échec de l'\''installation de Podman' ;;
    fr:installer.mac.podman_no_version) printf '%s' 'un podman qui ne donne pas sa version' ;;
    fr:installer.mac.podman_version_unsupported) printf '%s' 'JHT sur Mac a besoin de Podman %s.%s ou d'\''un %s.x plus récent (pas 6.2 ou plus) ; ce Mac a %s. Si Homebrew a fait passer Podman au-delà de la série %s, retélécharge l'\''installeur JHT d'\''aujourd'\''hui (il dit quelle série il prend en charge) ; rien de JHT n'\''a été installé.' ;;
    fr:installer.migration.colima_default) printf '%s' 'Si tu as installé Colima seulement pour JHT, après la désinstallation sa machine virtuelle (profil default, celle que l'\''installeur JHT démarrait) reste sur le disque, arrêtée : supprime-la avec «colima delete -p default» pour libérer l'\''espace. Si tu utilises Colima pour autre chose, laisse-la.' ;;
    fr:installer.migration.colima_started) printf '%s' 'Après la désinstallation, la machine virtuelle Colima créée par JHT (profil %s) reste sur le disque, arrêtée : si tu ne t'\''en sers pour rien d'\''autre, supprime-la avec «colima delete -p %s» pour libérer l'\''espace.' ;;
    fr:installer.migration.refused) printf '%s' 'cet ordinateur fait tourner JHT sur Docker (Colima, Docker Desktop ou Docker Engine). Depuis la 0.4, JHT tourne uniquement sur Podman, et rien n'\''a été modifié. Tes données restent : ~/.jht (configuration, base de données, profil) et ~/Documents/Job Hunter Team (CV, résultats) sont des dossiers de cet ordinateur. Ce qui reste dans les volumes de Docker et doit être redonné : la clé API gardée par la configuration, le mot de passe mail, les tokens Telegram. Pour passer à Podman : %s, relance cet installeur, puis «jht setup» avec ta clé API.%s' ;;
    fr:installer.migration.uninstall) printf '%s' 'lance «jht uninstall --confirm» (il garde ces deux dossiers)' ;;
    fr:installer.migration.uninstall_old_jht) printf '%s' 'ta commande jht vient d'\''une version qui ne sait pas se désinstaller, alors utilise celle de cette version : «f="$(mktemp)" && curl -fsSL '\''%s'\'' -o "$f" && bash "$f" uninstall --confirm; rm -f "$f"» (elle supprime le JHT sur Docker et l'\''ancienne commande jht, et garde ces deux dossiers)' ;;
    fr:installer.min_free_invalid) printf '%s' 'JHT_MIN_FREE_GIB non valide : %s' ;;
    fr:installer.mode) printf '%s' 'mode :    ' ;;
    fr:installer.mount_repair_failed) printf '%s' '%s et %s ne peuvent pas être rendus accessibles en écriture pour le conteneur de Job Hunter Team (il tourne en uid 1001) et rien n'\''a été démarré. Soit tu laisses Docker tourner pour ce compte (ajoute-le au groupe '\''docker'\'', puis reconnecte-toi), soit tu lances une fois : sudo chown -R 1001:1001 "%s" "%s" — puis relance cet installeur.' ;;
    fr:installer.next_step_run_finish) printf '%s' 'Étape suivante : lance  %s  pour terminer la configuration.' ;;
    fr:installer.next_steps) printf '%s' 'Étapes suivantes :' ;;
    fr:installer.no_interactive_terminal_no) printf '%s' 'Pas de terminal interactif (pas de /dev/tty) : je saute l'\''assistant.' ;;
    fr:installer.no_shell_rc_file) printf '%s' 'Aucun fichier rc du shell n'\''a été écrit. Ajoute à la main :' ;;
    fr:installer.open_new_terminal_window) printf '%s' 'Ouvre d'\''abord une nouvelle fenêtre de terminal (ou lance : . ~/.profile), pour qu'\''il trouve jht.' ;;
    fr:installer.ownership_1001_1001_container) printf '%s' 'Propriétaire de %s et %s → 1001:1001 (UID du conteneur)' ;;
    fr:installer.ownership_1001_1001_container_2) printf '%s' 'Propriétaire de %s et %s → 1001:1001 (UID du conteneur, réglé par un conteneur jetable : pas besoin de sudo)' ;;
    fr:installer.ownership_stays_user_macos) printf '%s' '%s et %s restent à cet utilisateur (macOS)' ;;
    fr:installer.ownership_stays_user_rootless) printf '%s' '%s et %s restent à cet utilisateur (Podman rootless)' ;;
    fr:installer.pairing_token_present_skipping) printf '%s' 'Token d'\''appairage présent : je saute l'\''assistant interactif.' ;;
    fr:installer.pairing_token_saved) printf '%s' 'Token d'\''appairage enregistré dans %s (permissions 0600)' ;;
    fr:installer.path_added) printf '%s' 'PATH ajouté à %s' ;;
    fr:installer.path_added_etc_profile) printf '%s' 'PATH ajouté à /etc/profile.d/jht.sh (pour tout le système)' ;;
    fr:installer.podman.answers_rootful) printf '%s' 'podman répond en rootful pour %s (Rootless=%s) : JHT a besoin de Podman rootless.' ;;
    fr:installer.podman.apt_failed) printf '%s' 'échec de apt-get install%s. Pour voir pourquoi, lance : sudo apt-get install%s' ;;
    fr:installer.podman.apt_would_remove) printf '%s' 'installer%s SUPPRIMERAIT d'\''autres paquets de cet ordinateur (souvent containerd.io, celui de Docker) : rien n'\''a été modifié. Pour voir lesquels, lance : sudo apt-get -s install%s. Installe Podman toi-même d'\''une façon qui les garde (ou décide de les supprimer), puis relance cet installeur.' ;;
    fr:installer.podman.compose_missing) printf '%s' 'podman-compose n'\''est pas disponible dans les paquets de ce système. Demande à l'\''administrateur de ce serveur de l'\''installer, en root : apt install podman-compose' ;;
    fr:installer.podman.compose_too_old) printf '%s' 'podman-compose %s est plus ancien que %s. Demande à l'\''administrateur de ce serveur un podman-compose plus récent.' ;;
    fr:installer.podman.distribution_too_old) printf '%s' 'cette distribution installerait %s %s, et Job Hunter Team 0.4.0 a besoin de %s %s ou plus récent : rien n'\''a été installé. Distributions qui le fournissent : Ubuntu 26.04 LTS, Debian 13, Fedora 43 ou plus récentes.' ;;
    fr:installer.podman.dnf_failed) printf '%s' 'échec de dnf install%s (dnf ne supprime rien : un conflit avec un paquet installé l'\''arrête). Pour voir pourquoi, lance : sudo dnf install%s' ;;
    fr:installer.podman.info_fails) printf '%s' ''\''podman info'\'' échoue pour %s, donc le stockage ou le runtime rootless n'\''est pas prêt. Lance-le à la main pour voir pourquoi.' ;;
    fr:installer.podman.linger_failed) printf '%s' 'échec de loginctl enable-linger %s.' ;;
    fr:installer.podman.linger_missing) printf '%s' 'les conteneurs de %s s'\''arrêteraient à la fin de la session. Demande à l'\''administrateur de ce serveur de lancer, en root : loginctl enable-linger %s' ;;
    fr:installer.podman.missing_default) printf '%s' 'la plage subuid ou le linger' ;;
    fr:installer.podman.no_package_manager) printf '%s' 'aucun gestionnaire de paquets connu (apt, dnf, pacman) pour installer :%s' ;;
    fr:installer.podman.pacman_failed) printf '%s' 'échec de pacman -S%s (rien n'\''a été supprimé). Pour voir pourquoi, lance : sudo pacman -S%s' ;;
    fr:installer.podman.root_refused) printf '%s' 'JHT tourne sur Podman rootless, avec un utilisateur qui n'\''est pas root. Connecte-toi avec cet utilisateur et relance l'\''installation.' ;;
    fr:installer.podman.runtime_dir_missing) printf '%s' 'il n'\''y a pas de dossier de runtime pour cet utilisateur (%s) : la session n'\''a pas de gestionnaire utilisateur. Reconnecte-toi, ou demande à l'\''administrateur de lancer, en root : loginctl enable-linger %s' ;;
    fr:installer.podman.still_missing) printf '%s' 'podman n'\''est toujours pas là après l'\''installation. Demande à l'\''administrateur de ce serveur de lancer, en root : apt install podman' ;;
    fr:installer.podman.subuid_missing) printf '%s' '%s n'\''a pas de plage d'\''uid/gid subordonnés dans %s/subuid et %s/subgid. Demande à l'\''administrateur de ce serveur de lancer, en root : usermod --add-subuids 100000-165535 --add-subgids 100000-165535 %s' ;;
    fr:installer.podman.sudo_required) printf '%s' 'Podman a besoin d'\''une préparation que seul un administrateur peut faire (manque :%s), et sudo pour %s n'\''est pas disponible sans mot de passe. Demande à l'\''administrateur de ce serveur de donner à %s sudo sans mot de passe, ou de lancer, en root : apt install podman podman-compose uidmap; loginctl enable-linger %s' ;;
    fr:installer.podman.too_old) printf '%s' 'podman %s est plus ancien que %s. Demande à l'\''administrateur de ce serveur un podman plus récent.' ;;
    fr:installer.podman.unknown_version) printf '%s' 'de version inconnue' ;;
    fr:installer.podman.unsupported_host) printf '%s' '--runtime podman est pour Linux et macOS ; ce système est %s.' ;;
    fr:installer.podman.usermod_failed) printf '%s' 'usermod n'\''a pas pu ajouter la plage subordonnée (%s-%s) pour %s.' ;;
    fr:installer.podman_already_installed) printf '%s' 'podman déjà installé' ;;
    fr:installer.podman_compose_already_installed) printf '%s' 'podman-compose déjà installé' ;;
    fr:installer.podman_machine_already_running) printf '%s' 'Machine Podman '\''%s'\'' déjà démarrée' ;;
    fr:installer.podman_machine_reachable) printf '%s' 'Machine Podman joignable' ;;
    fr:installer.podman_ready_but_weekly) printf '%s' 'Podman est prêt, mais son minuteur hebdomadaire qui libère le disque n'\''a pas pu être activé.' ;;
    fr:installer.podman_ready_colima_retained) printf '%s' 'Podman prêt (Colima laissé tel quel)' ;;
    fr:installer.podman_rootless_podman_compose) printf '%s' 'Podman rootless %s + podman-compose %s pour %s' ;;
    fr:installer.podman_rootless_reachable) printf '%s' 'podman rootless joignable' ;;
    fr:installer.private_jht_docker_shim) printf '%s' 'Shim docker privé de JHT : %s (pas ajouté au PATH global ; Colima pas touché)' ;;
    fr:installer.private_jht_docker_shim_2) printf '%s' 'Shim docker privé de JHT : %s (pas ajouté au PATH global ; Podman rootless, sans machine)' ;;
    fr:installer.run_manually_jht_setup) printf '%s' 'Lance à la main : jht setup' ;;
    fr:installer.running_host_setup_sh) printf '%s' 'Exécution de host-setup.sh (écrit ~/.jht/host.env et vérifie le swap)...' ;;
    fr:installer.runtime) printf '%s' 'runtime : ' ;;
    fr:installer.runtime_dir_bad_ancestor) printf '%s' 'Le dossier du runtime sur l'\''hôte a au-dessus de lui un lien symbolique ou un chemin non canonique : %s' ;;
    fr:installer.runtime_dir_in_mount) printf '%s' 'Le dossier du runtime sur l'\''hôte doit être en dehors des dossiers que le conteneur peut écrire : %s' ;;
    fr:installer.runtime_dir_is_link) printf '%s' 'Le dossier du runtime sur l'\''hôte est un lien symbolique : %s' ;;
    fr:installer.runtime_image_pinned) printf '%s' 'image du runtime fixée : %s' ;;
    fr:installer.runtime_tier_core_tools) printf '%s' 'niveau du runtime : core (les outils arrivent après l'\''accueil)' ;;
    fr:installer.same_as_above_empties) printf '%s' '(comme ci-dessus, et ça vide aussi ~/.jht et ~/Documents/Job Hunter Team)' ;;
    fr:installer.setup_did_not_finish) printf '%s' 'La configuration ne s'\''est pas terminée (code de sortie %s) : Job Hunter Team est installé, mais pas encore configuré.' ;;
    fr:installer.setup_done_team_needs_space) printf '%s' 'La configuration est terminée et enregistrée, mais l'\''équipe n'\''a pas démarré : il faut plus d'\''espace libre sur le disque. Libère-le comme indiqué ci-dessus, puis démarre l'\''équipe avec  jht team start  (inutile de refaire la configuration).' ;;
    fr:installer.starting_podman_machine) printf '%s' 'Démarrage de la machine Podman '\''%s'\''...' ;;
    fr:installer.subuid_subgid_range) printf '%s' 'plage subuid/subgid %s-%s pour %s' ;;
    fr:installer.system_detection) printf '%s' 'Détection du système' ;;
    fr:installer.team_running) printf '%s' 'Job Hunter Team tourne sur cet ordinateur (%s). Si la configuration a été interrompue, reprends-la avec «jht setup» dans ce terminal ; pas besoin d'\''arrêter quoi que ce soit. Pour réinstaller plutôt : arrête-le avec «jht down», relance l'\''installeur, puis démarre-le avec «jht up». Rien n'\''a été modifié : ton profil et tes documents dans ~/.jht et ~/Documents/Job Hunter Team restent où ils sont.' ;;
    fr:installer.team_running_update) printf '%s' 'Job Hunter Team tourne sur cet ordinateur (%s). Pour le mettre à jour, arrête-le avec «jht down», relance l'\''installeur, puis démarre-le avec «jht up». Rien n'\''a été modifié : ton profil et tes documents dans ~/.jht et ~/Documents/Job Hunter Team restent où ils sont.' ;;
    fr:installer.terminal_run) printf '%s' 'Dans ce terminal, lance :' ;;
    fr:installer.uid_1001_taken) printf '%s' 'l'\''uid 1001 sur cet ordinateur est le compte '\''%s'\''. Le conteneur de Job Hunter Team tourne en uid 1001, donc ce compte serait propriétaire de ~/.jht (tes données et les identifiants des portails). Rien n'\''a été modifié. Lance JHT depuis le compte '\''%s'\'', ou donne à '\''%s'\'' un autre uid, puis réessaie.' ;;
    fr:installer.uninstall_keeps_your_data) printf '%s' 'Pour désinstaller (tes données dans ~/.jht et ~/Documents/Job Hunter Team restent) :' ;;
    fr:installer.wrapper_dir_bad_ancestor) printf '%s' 'Le dossier du wrapper sur l'\''hôte a au-dessus de lui un lien symbolique ou un chemin non canonique : %s' ;;
    fr:installer.wrapper_dir_in_mount) printf '%s' 'Le wrapper sur l'\''hôte doit être en dehors des dossiers que le conteneur peut écrire : %s' ;;
    fr:installer.wsl_not_supported) printf '%s' 'sur Windows, installe JHT depuis PowerShell avec install.ps1 (voir docs/guides/QUICKSTART.md), pas depuis WSL. Rien n'\''a été modifié.' ;;
    pt:installer.agents_can_only_see) printf '%s' 'Os agentes só veem:' ;;
    pt:installer.already_path) printf '%s' '%s já está no PATH' ;;
    pt:installer.also_delete_your_data) printf '%s' 'Para apagar também os teus dados (configuração, db, CV, resultados):' ;;
    pt:installer.also_deletes_api_key) printf '%s' '(apaga também a chave API, a palavra-passe do correio e os tokens do Telegram guardados para a equipa)' ;;
    pt:installer.apt_get_update_failed) printf '%s' 'apt-get update falhou: vou tentar instalar na mesma.' ;;
    pt:installer.branch) printf '%s' 'ramo:    ' ;;
    pt:installer.cannot_list_containers) printf '%s' 'Não é possível listar os contentores a correr com %s: não foi instalado nada.' ;;
    pt:installer.check.adapter_bad_ancestor) printf '%s' 'A pasta bin do adaptador do Podman tem acima de si um caminho não canónico: %s' ;;
    pt:installer.check.adapter_is_link) printf '%s' 'A pasta bin do adaptador do Podman é uma ligação simbólica: %s' ;;
    pt:installer.check.adapter_not_dir) printf '%s' 'O caminho bin do adaptador do Podman não é uma pasta: %s' ;;
    pt:installer.check.branch_unresolved) printf '%s' 'Não consigo associar o ramo '\''%s'\'' a um commit de versão imutável.' ;;
    pt:installer.check.compose_boundary) printf '%s' 'O docker-compose.yml descarregado não aplica a fronteira protegida do runtime.' ;;
    pt:installer.check.compose_gone) printf '%s' 'O fornecedor do Podman Compose desapareceu depois da instalação.' ;;
    pt:installer.check.compose_version_unreadable) printf '%s' 'Não consigo ler a versão do fornecedor do Podman Compose.' ;;
    pt:installer.check.digests_not_written) printf '%s' 'as impressões digitais dos scripts do anfitrião não foram escritas' ;;
    pt:installer.check.machine_name_invalid) printf '%s' 'Nome da máquina Podman do JHT inválido: %s' ;;
    pt:installer.check.marker_invalid) printf '%s' 'O marcador do runtime escolhido para o JHT não é válido' ;;
    pt:installer.check.marker_unsafe) printf '%s' 'O marcador do runtime escolhido para o JHT não é seguro: %s' ;;
    pt:installer.check.os_unsupported) printf '%s' 'Sistema operativo não suportado: %s' ;;
    pt:installer.check.podman_gone) printf '%s' 'A CLI do Podman desapareceu depois da instalação.' ;;
    pt:installer.check.podman_not_on_path) printf '%s' 'o podman desapareceu do PATH' ;;
    pt:installer.check.podman_path_unsafe) printf '%s' 'O caminho do executável do Podman não é seguro: %s' ;;
    pt:installer.check.shim_unsafe) printf '%s' 'Não substituo um executável inseguro ou que não é do JHT: %s' ;;
    pt:installer.check.wrapper_protocol) printf '%s' 'O wrapper descarregado não implementa o protocolo protegido do runtime.' ;;
    pt:installer.chown_not_needed) printf '%s' 'chown para 1001 falhou — aqui nada corre num contentor (--no-docker), por isso não é preciso' ;;
    pt:installer.config_db_agents) printf '%s' '(configuração, db, agentes)' ;;
    pt:installer.configuration_wizard_also_starts) printf '%s' 'configuração guiada (também inicia o contentor)' ;;
    pt:installer.container_mode_active_podman) printf '%s' 'Modo contentor ativo (Podman).' ;;
    pt:installer.container_runtime) printf '%s' 'Motor de contentores' ;;
    pt:installer.container_runtime_check) printf '%s' 'Verificação do motor de contentores' ;;
    pt:installer.container_runtime_podman_rootless) printf '%s' 'Motor de contentores (Podman rootless)' ;;
    pt:installer.container_will_complete_pairing) printf '%s' 'O contentor vai concluir o emparelhamento no primeiro arranque.' ;;
    pt:installer.creating_rootless_podman_machine) printf '%s' 'A criar a máquina Podman rootless '\''%s'\''...' ;;
    pt:installer.cvs_attachments_output) printf '%s' '(CV, anexos, resultados)' ;;
    pt:installer.disk_low_dry_run) printf '%s' 'Só %s GiB livres em %s; uma instalação real precisa de pelo menos %s GiB.' ;;
    pt:installer.disk_not_enough) printf '%s' 'espaço livre em disco insuficiente: %s GiB livres em %s, a imagem do Job Hunter Team e os seus dados precisam de pelo menos %s GiB. Liberta algum espaço (num servidor que já usa o Docker, '\''docker image prune -af'\'' remove as imagens não usadas) e corre o instalador de novo. Não foi alterado nada.' ;;
    pt:installer.disk_room_short) printf '%s' 'O Job Hunter Team descarrega cerca de %s GiB, e depois do descarregamento os agentes ficariam com menos dos %s GiB de disco de que precisam: agora há %s GiB livres. Liberta pelo menos mais %s GiB (esvazia o Lixo, apaga os ficheiros grandes de que não precisas) e corre o instalador de novo: nada foi descarregado, e a versão do Job Hunter Team que tens instalada não foi tocada.' ;;
    pt:installer.done_compose) printf '%s' 'compose: %s' ;;
    pt:installer.done_host_setup) printf '%s' 'host-setup: %s' ;;
    pt:installer.done_wrapper) printf '%s' 'wrapper: %s' ;;
    pt:installer.download_failed) printf '%s' 'O descarregamento falhou: %s. Verifica a ligação e o ramo (%s).' ;;
    pt:installer.download_wrapper_docker_compose) printf '%s' 'Descarregar o wrapper + docker-compose.yml' ;;
    pt:installer.downloading_docker_compose_yml) printf '%s' 'A descarregar docker-compose.yml...' ;;
    pt:installer.downloading_host_setup_sh) printf '%s' 'A descarregar host-setup.sh (verificação prévia de VPS/swap)...' ;;
    pt:installer.downloading_jht_wrapper) printf '%s' 'A descarregar o wrapper jht...' ;;
    pt:installer.enabling_linger) printf '%s' 'A ativar o linger para %s...' ;;
    pt:installer.existing_podman_machine_has) printf '%s' 'A máquina Podman '\''%s'\'' que já existe tem os recursos '\''%s'\''; o JHT recomenda %s CPU, %s MiB de RAM e %s GiB de disco. A máquina existente não foi alterada.' ;;
    pt:installer.extras_image_pinned_ghcr) printf '%s' 'imagem extras fixada: ghcr.io/leopu00/jht@%s (é descarregada quando é pedida uma ferramenta)' ;;
    pt:installer.giving_subordinate_uid_gid) printf '%s' 'A dar a %s o intervalo de uid/gid subordinados %s-%s...' ;;
    pt:installer.helper_download_failed) printf '%s' 'o descarregamento ou a verificação de %s falhou: %s/scripts/%s' ;;
    pt:installer.host_file_tmp_failed) printf '%s' 'não é possível criar um ficheiro temporário em %s: não vou escrever %s' ;;
    pt:installer.host_setup_completed_auto) printf '%s' 'host-setup concluído (tipo de anfitrião detetado automaticamente)' ;;
    pt:installer.host_setup_completed_forced) printf '%s' 'host-setup concluído (vps forçado)' ;;
    pt:installer.host_setup_download_failed) printf '%s' 'o descarregamento ou a verificação de host-setup.sh falhou: %s' ;;
    pt:installer.host_setup_exited_error) printf '%s' 'host-setup terminou com um erro — vou continuar (pode ser preciso um emparelhamento manual)' ;;
    pt:installer.host_setup_exited_error_2) printf '%s' 'host-setup terminou com um erro — vou continuar' ;;
    pt:installer.host_setup_missing) printf '%s' 'host-setup.sh não está disponível em %s — vou saltar a verificação prévia' ;;
    pt:installer.image) printf '%s' 'imagem:  ' ;;
    pt:installer.image_download_failed) printf '%s' 'O descarregamento da imagem do JHT falhou: %s' ;;
    pt:installer.installation_complete) printf '%s' 'Instalação concluída!' ;;
    pt:installer.installed) printf '%s' 'Instalado:%s' ;;
    pt:installer.installing_podman_cli) printf '%s' 'A instalar a CLI do Podman...' ;;
    pt:installer.installing_podman_compose_provider) printf '%s' 'A instalar o fornecedor do Podman Compose...' ;;
    pt:installer.installing_sudo_podman_rootless) printf '%s' 'A instalar%s com sudo (Podman rootless; o Docker não é instalado)...' ;;
    pt:installer.linger_enabled) printf '%s' 'linger ativo para %s' ;;
    pt:installer.loginctl_not_found_linger) printf '%s' 'loginctl não encontrado: o linger não foi verificado.' ;;
    pt:installer.mac.cannot_create_folder) printf '%s' 'Não é possível criar %s para a máquina Podman.' ;;
    pt:installer.mac.compose_install_failed) printf '%s' 'a instalação do podman-compose falhou' ;;
    pt:installer.mac.compose_version_unsupported) printf '%s' 'O JHT num Mac precisa do podman-compose %s; este Mac tem %s. Corre «brew upgrade podman-compose» (ou «brew install podman-compose») e depois este instalador de novo.' ;;
    pt:installer.mac.homebrew_missing) printf '%s' 'O JHT instala o Podman com o Homebrew, que não está neste Mac. Não foi alterado nada. Instala o Homebrew a partir de https://brew.sh (um comando no Terminal; pede a palavra-passe do Mac), abre uma nova janela do Terminal e corre este instalador de novo.' ;;
    pt:installer.mac.machine_init_failed) printf '%s' 'A criação da máquina Podman falhou; o Colima não foi alterado.' ;;
    pt:installer.mac.machine_name_placeholder) printf '%s' '<nome>' ;;
    pt:installer.mac.machine_not_responding) printf '%s' 'A máquina Podman do JHT não responde.' ;;
    pt:installer.mac.machine_start_failed) printf '%s' 'O arranque da máquina Podman falhou; o Colima não foi alterado.' ;;
    pt:installer.mac.machine_unreachable) printf '%s' 'A máquina Podman '\''%s'\'' não está acessível.' ;;
    pt:installer.mac.other_machine_any) printf '%s' 'outra máquina Podman está ligada (encontra-a com '\''podman machine list'\'')' ;;
    pt:installer.mac.other_machine_named) printf '%s' 'outra máquina Podman, %s, está ligada' ;;
    pt:installer.mac.other_machine_running) printf '%s' '%s, e um Mac só corre uma de cada vez. Desliga-a com '\''podman machine stop %s'\'' (ou a partir da app com que a usas) e corre o instalador de novo: o Job Hunter Team nunca a desliga por ti, e depois podes voltar a ligá-la.' ;;
    pt:installer.mac.podman_install_failed) printf '%s' 'A instalação do Podman falhou' ;;
    pt:installer.mac.podman_no_version) printf '%s' 'um podman que não diz a sua versão' ;;
    pt:installer.mac.podman_version_unsupported) printf '%s' 'O JHT num Mac precisa do Podman %s.%s ou de um %s.x posterior (não do 6.2 ou posterior); este Mac tem %s. Se o Homebrew levou o Podman para além da série %s, descarrega de novo o instalador do JHT de hoje (diz que série suporta); não foi instalado nada do JHT.' ;;
    pt:installer.migration.colima_default) printf '%s' 'Se instalaste o Colima só para o JHT, depois da desinstalação a sua máquina virtual (perfil default, a que o instalador do JHT iniciou) fica no disco, parada: remove-a com «colima delete -p default» para libertar o espaço. Se usas o Colima para outras coisas, deixa-a.' ;;
    pt:installer.migration.colima_started) printf '%s' 'Depois da desinstalação, a máquina virtual Colima que o JHT criou (perfil %s) fica no disco, parada: se não a usas para mais nada, remove-a com «colima delete -p %s» para libertar o espaço.' ;;
    pt:installer.migration.refused) printf '%s' 'este computador corre o JHT no Docker (Colima, Docker Desktop ou Docker Engine). Desde a 0.4 o JHT só corre no Podman, e não foi alterado nada. Os teus dados ficam: ~/.jht (configuração, base de dados, perfil) e ~/Documents/Job Hunter Team (CV, resultados) são pastas deste computador. O que fica para trás nos volumes do Docker e tem de ser dado de novo: a chave API guardada pela configuração, a palavra-passe do correio, os tokens do Telegram. Para passar para o Podman: %s, corre este instalador de novo e depois «jht setup» com a tua chave API.%s' ;;
    pt:installer.migration.uninstall) printf '%s' 'corre «jht uninstall --confirm» (mantém essas duas pastas)' ;;
    pt:installer.migration.uninstall_old_jht) printf '%s' 'o teu comando jht é de uma versão que não se consegue desinstalar a si própria, por isso usa o desta versão: «f="$(mktemp)" && curl -fsSL '\''%s'\'' -o "$f" && bash "$f" uninstall --confirm; rm -f "$f"» (remove o JHT no Docker e o comando jht antigo, e mantém essas duas pastas)' ;;
    pt:installer.min_free_invalid) printf '%s' 'JHT_MIN_FREE_GIB inválido: %s' ;;
    pt:installer.mode) printf '%s' 'modo:    ' ;;
    pt:installer.mount_repair_failed) printf '%s' 'Não é possível tornar %s e %s graváveis para o contentor do Job Hunter Team (corre como uid 1001) e não foi iniciado nada. Deixa o Docker correr para esta conta (adiciona-a ao grupo '\''docker'\'' e depois volta a iniciar sessão), ou corre uma vez: sudo chown -R 1001:1001 "%s" "%s" — e depois corre este instalador de novo.' ;;
    pt:installer.next_step_run_finish) printf '%s' 'Próximo passo: corre  %s  para concluir a configuração.' ;;
    pt:installer.next_steps) printf '%s' 'Próximos passos:' ;;
    pt:installer.no_interactive_terminal_no) printf '%s' 'Sem terminal interativo (sem /dev/tty): vou saltar o assistente.' ;;
    pt:installer.no_shell_rc_file) printf '%s' 'Não foi escrito nenhum ficheiro rc da shell. Acrescenta à mão:' ;;
    pt:installer.open_new_terminal_window) printf '%s' 'Abre primeiro uma nova janela do terminal (ou corre: . ~/.profile), para que encontre o jht.' ;;
    pt:installer.ownership_1001_1001_container) printf '%s' 'Proprietário de %s e %s → 1001:1001 (UID do contentor)' ;;
    pt:installer.ownership_1001_1001_container_2) printf '%s' 'Proprietário de %s e %s → 1001:1001 (UID do contentor, definido por um contentor descartável: sem sudo)' ;;
    pt:installer.ownership_stays_user_macos) printf '%s' '%s e %s continuam a pertencer a este utilizador (macOS)' ;;
    pt:installer.ownership_stays_user_rootless) printf '%s' '%s e %s continuam a pertencer a este utilizador (Podman rootless)' ;;
    pt:installer.pairing_token_present_skipping) printf '%s' 'Token de emparelhamento presente: vou saltar o assistente interativo.' ;;
    pt:installer.pairing_token_saved) printf '%s' 'Token de emparelhamento guardado em %s (permissões 0600)' ;;
    pt:installer.path_added) printf '%s' 'PATH acrescentado a %s' ;;
    pt:installer.path_added_etc_profile) printf '%s' 'PATH acrescentado a /etc/profile.d/jht.sh (para todo o sistema)' ;;
    pt:installer.podman.answers_rootful) printf '%s' 'o podman responde como rootful para %s (Rootless=%s): o JHT precisa do Podman rootless.' ;;
    pt:installer.podman.apt_failed) printf '%s' 'apt-get install%s falhou. Para ver porquê, corre: sudo apt-get install%s' ;;
    pt:installer.podman.apt_would_remove) printf '%s' 'instalar%s REMOVERIA outros pacotes deste computador (muitas vezes containerd.io, do Docker): não foi alterado nada. Para ver quais, corre: sudo apt-get -s install%s. Instala tu o Podman de uma forma que os mantenha (ou decide removê-los) e depois corre este instalador de novo.' ;;
    pt:installer.podman.compose_missing) printf '%s' 'o podman-compose não está disponível nos pacotes deste sistema. Pede ao administrador deste servidor que o instale, como root: apt install podman-compose' ;;
    pt:installer.podman.compose_too_old) printf '%s' 'o podman-compose %s é mais antigo do que %s. Pede ao administrador deste servidor um podman-compose mais recente.' ;;
    pt:installer.podman.distribution_too_old) printf '%s' 'esta distribuição instalaria %s %s, e o Job Hunter Team 0.4.0 precisa de %s %s ou posterior: não foi instalado nada. Distribuições que o têm: Ubuntu 26.04 LTS, Debian 13, Fedora 43 ou posteriores.' ;;
    pt:installer.podman.dnf_failed) printf '%s' 'dnf install%s falhou (o dnf não remove nada: um conflito com um pacote instalado trava-o). Para ver porquê, corre: sudo dnf install%s' ;;
    pt:installer.podman.info_fails) printf '%s' ''\''podman info'\'' falha para %s, por isso o armazenamento ou o runtime rootless não estão prontos. Corre-o à mão para ver porquê.' ;;
    pt:installer.podman.linger_failed) printf '%s' 'loginctl enable-linger %s falhou.' ;;
    pt:installer.podman.linger_missing) printf '%s' 'os contentores de %s parariam quando a sessão terminasse. Pede ao administrador deste servidor que corra, como root: loginctl enable-linger %s' ;;
    pt:installer.podman.missing_default) printf '%s' 'o intervalo subuid ou o linger' ;;
    pt:installer.podman.no_package_manager) printf '%s' 'nenhum gestor de pacotes conhecido (apt, dnf, pacman) para instalar:%s' ;;
    pt:installer.podman.pacman_failed) printf '%s' 'pacman -S%s falhou (não foi removido nada). Para ver porquê, corre: sudo pacman -S%s' ;;
    pt:installer.podman.root_refused) printf '%s' 'O JHT corre no Podman rootless, como um utilizador que não é root. Inicia sessão com esse utilizador e corre a instalação de novo.' ;;
    pt:installer.podman.runtime_dir_missing) printf '%s' 'não há pasta de runtime para este utilizador (%s): a sessão não tem gestor de utilizador. Inicia sessão de novo, ou pede ao administrador que corra, como root: loginctl enable-linger %s' ;;
    pt:installer.podman.still_missing) printf '%s' 'o podman continua a não estar lá depois da instalação. Pede ao administrador deste servidor que corra, como root: apt install podman' ;;
    pt:installer.podman.subuid_missing) printf '%s' '%s não tem um intervalo de uid/gid subordinados em %s/subuid e %s/subgid. Pede ao administrador deste servidor que corra, como root: usermod --add-subuids 100000-165535 --add-subgids 100000-165535 %s' ;;
    pt:installer.podman.sudo_required) printf '%s' 'O Podman precisa de uma preparação que só um administrador pode fazer (em falta:%s), e o sudo para %s não está disponível sem palavra-passe. Pede ao administrador deste servidor que dê a %s sudo sem palavra-passe, ou que corra, como root: apt install podman podman-compose uidmap; loginctl enable-linger %s' ;;
    pt:installer.podman.too_old) printf '%s' 'o podman %s é mais antigo do que %s. Pede ao administrador deste servidor um podman mais recente.' ;;
    pt:installer.podman.unknown_version) printf '%s' 'de versão desconhecida' ;;
    pt:installer.podman.unsupported_host) printf '%s' '--runtime podman é para Linux e macOS; este sistema é %s.' ;;
    pt:installer.podman.usermod_failed) printf '%s' 'o usermod não conseguiu acrescentar o intervalo subordinado (%s-%s) para %s.' ;;
    pt:installer.podman_already_installed) printf '%s' 'podman já instalado' ;;
    pt:installer.podman_compose_already_installed) printf '%s' 'podman-compose já instalado' ;;
    pt:installer.podman_machine_already_running) printf '%s' 'Máquina Podman '\''%s'\'' já a correr' ;;
    pt:installer.podman_machine_reachable) printf '%s' 'Máquina Podman acessível' ;;
    pt:installer.podman_ready_but_weekly) printf '%s' 'O Podman está pronto, mas não foi possível ativar o seu temporizador semanal que liberta espaço no disco.' ;;
    pt:installer.podman_ready_colima_retained) printf '%s' 'Podman pronto (Colima mantido como estava)' ;;
    pt:installer.podman_rootless_podman_compose) printf '%s' 'Podman rootless %s + podman-compose %s para %s' ;;
    pt:installer.podman_rootless_reachable) printf '%s' 'podman rootless acessível' ;;
    pt:installer.private_jht_docker_shim) printf '%s' 'Shim docker privado do JHT: %s (não acrescentado ao PATH global; Colima intocado)' ;;
    pt:installer.private_jht_docker_shim_2) printf '%s' 'Shim docker privado do JHT: %s (não acrescentado ao PATH global; Podman rootless, sem máquina)' ;;
    pt:installer.run_manually_jht_setup) printf '%s' 'Corre à mão: jht setup' ;;
    pt:installer.running_host_setup_sh) printf '%s' 'A executar host-setup.sh (escreve ~/.jht/host.env + verificação prévia do swap)...' ;;
    pt:installer.runtime) printf '%s' 'runtime: ' ;;
    pt:installer.runtime_dir_bad_ancestor) printf '%s' 'A pasta do runtime no anfitrião tem acima de si uma ligação simbólica ou um caminho não canónico: %s' ;;
    pt:installer.runtime_dir_in_mount) printf '%s' 'A pasta do runtime no anfitrião tem de ficar fora das pastas em que o contentor pode escrever: %s' ;;
    pt:installer.runtime_dir_is_link) printf '%s' 'A pasta do runtime no anfitrião é uma ligação simbólica: %s' ;;
    pt:installer.runtime_image_pinned) printf '%s' 'imagem do runtime fixada: %s' ;;
    pt:installer.runtime_tier_core_tools) printf '%s' 'nível do runtime: core (as ferramentas vêm depois das boas-vindas)' ;;
    pt:installer.same_as_above_empties) printf '%s' '(o mesmo que acima, e esvazia também ~/.jht e ~/Documents/Job Hunter Team)' ;;
    pt:installer.setup_did_not_finish) printf '%s' 'A configuração não terminou (código de saída %s): o Job Hunter Team está instalado, mas ainda não está configurado.' ;;
    pt:installer.setup_done_team_needs_space) printf '%s' 'A configuração está concluída e guardada, mas a equipa não arrancou: é preciso mais espaço livre no disco. Liberta-o como dito acima e depois arranca a equipa com  jht team start  (não é preciso refazer a configuração).' ;;
    pt:installer.starting_podman_machine) printf '%s' 'A iniciar a máquina Podman '\''%s'\''...' ;;
    pt:installer.subuid_subgid_range) printf '%s' 'intervalo subuid/subgid %s-%s para %s' ;;
    pt:installer.system_detection) printf '%s' 'Deteção do sistema' ;;
    pt:installer.team_running) printf '%s' 'O Job Hunter Team está a correr neste computador (%s). Se a configuração foi interrompida, retoma-a com «jht setup» neste terminal; não é preciso desligar nada. Para reinstalar em vez disso, para-o com «jht down», corre o instalador de novo e depois inicia-o com «jht up». Não foi alterado nada: o teu perfil e os teus documentos em ~/.jht e ~/Documents/Job Hunter Team ficam onde estão.' ;;
    pt:installer.team_running_update) printf '%s' 'O Job Hunter Team está a correr neste computador (%s). Para o atualizar, para-o com «jht down», corre o instalador de novo e depois inicia-o com «jht up». Não foi alterado nada: o teu perfil e os teus documentos em ~/.jht e ~/Documents/Job Hunter Team ficam onde estão.' ;;
    pt:installer.terminal_run) printf '%s' 'Neste terminal, corre:' ;;
    pt:installer.uid_1001_taken) printf '%s' 'o uid 1001 neste computador é a conta '\''%s'\''. O contentor do Job Hunter Team corre como uid 1001, por isso essa conta seria a proprietária de ~/.jht (os teus dados e as credenciais dos portais). Não foi alterado nada. Corre o JHT a partir da conta '\''%s'\'', ou dá a '\''%s'\'' outro uid, e depois tenta de novo.' ;;
    pt:installer.uninstall_keeps_your_data) printf '%s' 'Para desinstalar (os teus dados em ~/.jht e ~/Documents/Job Hunter Team ficam):' ;;
    pt:installer.wrapper_dir_bad_ancestor) printf '%s' 'A pasta do wrapper no anfitrião tem acima de si uma ligação simbólica ou um caminho não canónico: %s' ;;
    pt:installer.wrapper_dir_in_mount) printf '%s' 'A pasta do wrapper no anfitrião tem de ficar fora das pastas em que o contentor pode escrever: %s' ;;
    pt:installer.wsl_not_supported) printf '%s' 'no Windows, instala o JHT a partir do PowerShell com install.ps1 (vê docs/guides/QUICKSTART.md), não a partir do WSL. Não foi alterado nada.' ;;
    *) return 1 ;;
  esac
}
# <<< texts in the 7 languages

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
      printf "  ${DIM}%s${RESET}${BOLD}Container (Podman rootless)${RESET}\n" "$(ts installer.mode 'mode:    ')"
    else
      printf "  ${DIM}%s${RESET}${BOLD}Container (Podman)${RESET}\n" "$(ts installer.mode 'mode:    ')"
    fi
    printf "  ${DIM}%s%s${RESET}\n" "$(ts installer.image 'image:   ')" "$IMAGE"
    printf "  ${DIM}%s%s${RESET}\n" "$(ts installer.branch 'branch:  ')" "$BRANCH"
    printf "  ${DIM}%s%s${RESET}\n" "$(ts installer.runtime 'runtime: ')" "$RUNTIME_DIR"
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
    *) fail "$(tsf installer.check.os_unsupported 'Unsupported operating system: %s' "$uname_s")" ;;
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
# LC_ALL, LC_MESSAGES, LANG that is set decides). Files are read as data, only a known value: one of the 7 languages of JHT (en it
# hu es de fr pt); any other is English.
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
  case "$value" in en|it|hu|es|de|fr|pt) printf '%s\n' "$value" ;; *) printf 'en\n' ;; esac
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
      || fail "$(tsf installer.check.marker_unsafe 'Unsafe JHT runtime selection marker: %s' "$marker")"
    current="$(tr -d '\r\n' < "$marker")"
    case "$current" in docker|podman) ;; *) fail "$(ts installer.check.marker_invalid 'Invalid JHT runtime selection marker')" ;; esac
  elif [ -e "$RUNTIME_DIR/.runtime-integrity" ] || [ -L "$RUNTIME_DIR/.runtime-integrity" ]; then
    # A completed install without the marker: the Docker path of Linux never wrote it, nor did a Mac before the marker.
    current="docker"
  else
    return 0
  fi
  [ "$current" = "podman" ] && return 0
  local profile colima_line="" uninstall wrapper_url
  # The jht of an install older than 09/10 (0.3.9 and before) has no `uninstall`: on it the command reaches the CLI inside the
  # container, which does not know it, and nothing is removed. Then the first step is the uninstall of this release's wrapper, from
  # the place the installer downloads it from (the commit of the test channel, or the release branch), saved in a new private file
  # (mktemp: never a fixed name in the shared /tmp, which another user could create first), run once and deleted. No network here:
  # the refusal stays before any I/O.
  uninstall="$(ts installer.migration.uninstall 'run «jht uninstall --confirm» (it keeps those two folders)')"
  if installed_jht_lacks_uninstall; then
    local ref="$BRANCH"
    [ "$TEST_CHANNEL" -eq 1 ] && ref="$SOURCE_SHA"
    # Pasted by the person into a shell: only the characters of a branch or a commit, else the release branch.
    case "$ref" in ''|-*|*[!A-Za-z0-9._/-]*|*..*) ref="production" ;; esac
    wrapper_url="https://raw.githubusercontent.com/leopu00/job-hunter-team/$ref/scripts/jht-wrapper.sh"
    uninstall="$(tsf installer.migration.uninstall_old_jht 'your jht command is from a version that cannot uninstall itself, so use the one of this version: «f="$(mktemp)" && curl -fsSL '\''%s'\'' -o "$f" && bash "$f" uninstall --confirm; rm -f "$f"» (it removes the JHT on Docker and the old jht command, and keeps those two folders)' "$wrapper_url")"
  fi
  # The Colima virtual machine stays on the disk, stopped, after the move (up to 100 GiB). Name only the profile JHT made: the one of
  # the marker of the installer that started it (1st line «colima», 2nd the profile); an install older than the marker started the
  # «default» profile, which is named only if it is there, and only for a person who installed Colima for JHT alone.
  if profile="$(jht_started_colima_profile)"; then
    colima_line=" $(tsf installer.migration.colima_started 'After the uninstall the Colima virtual machine JHT created (profile %s) stays on the disk, stopped: if you use it for nothing else, remove it with «colima delete -p %s» to free the space.' "$profile" "$profile")"
  elif [ "$OS" = macos ] && [ -d "$HOME/.colima/default" ] && [ ! -L "$HOME/.colima/default" ]; then
    colima_line=" $(ts installer.migration.colima_default 'If you installed Colima only for JHT, after the uninstall its virtual machine (profile default, the one the JHT installer started) stays on the disk, stopped: remove it with «colima delete -p default» to free the space. If you use Colima for other things, leave it.')"
  fi
  jht_error_marker runtime_change_requires_migration
  printf "  ${RED}✗${RESET} %s%s\n" "$(jht_code_prefix runtime_change_requires_migration)" "$(tsf installer.migration.refused 'this computer runs JHT on Docker (Colima, Docker Desktop or Docker Engine). Since 0.4 JHT runs only on Podman, and nothing was changed. Your data stays: ~/.jht (configuration, database, profile) and ~/Documents/Job Hunter Team (CVs, outputs) are folders of this computer. What stays behind in Docker'\''s volumes and has to be given again: the API key kept by the setup, the mail password, the Telegram tokens. To move to Podman: %s, run this installer again, then «jht setup» with your API key.%s' "$uninstall" "$colima_line")" >&2
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
  step 1 "$total" "$(ts installer.system_detection 'System detection')"
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

# Podman 5 or later is what JHT runs on; the distributions that give it (13/11/2026), named in the sentence, in the person's language.
podman_refuse_old_candidate() { # package found wanted
  podman_refuse podman_version_unsupported 93 "$(tsf installer.podman.distribution_too_old 'this distribution would install %s %s, and Job Hunter Team 0.4.0 needs %s %s or later: nothing was installed. Distributions that give it: Ubuntu 26.04 LTS, Debian 13, Fedora 43 or later.' "$1" "$2" "$1" "$3")"
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
    || podman_refuse podman_sudo_required 89 "$(tsf installer.podman.sudo_required 'Podman needs a setup that only an administrator can do (missing:%s), and sudo for %s is not available without a password. Ask the administrator of this server to allow %s sudo without a password, or to run, as root: apt install podman podman-compose uidmap; loginctl enable-linger %s' "${missing:- $(ts installer.podman.missing_default 'the subuid range or linger')}" "$user" "$user" "$user")"
  if [ -n "$missing" ]; then
    info "$(tsf installer.installing_sudo_podman_rootless 'Installing%s with sudo (Podman rootless; Docker is not installed)...' "$missing")"
    case "$PKG" in
      apt)
        # A server just bought runs unattended-upgrades, which holds the dpkg
        # lock for minutes: wait for it (apt-get gives up at once otherwise).
        sudo -n apt-get -o DPkg::Lock::Timeout=180 update -qq >/dev/null 2>&1 || warn "$(ts installer.apt_get_update_failed 'apt-get update failed: trying the install anyway.')"
        podman_check_candidates "$missing"
        # --no-remove: Podman never takes the place of anything. On a computer with Docker from Docker's own repository,
        # containerd.io conflicts with runc, and `install -y` alone would have removed it to make room (Docker broken).
        # apt then stops before changing anything, and the person is told what it wanted and what to run.
        if ! apt_err="$(sudo -n env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=180 install -y --no-remove $missing 2>&1 >/dev/null)"; then
          case "$apt_err" in
            *"remove is disabled"*|*"Packages need to be removed"*)
              podman_refuse podman_install_failed 88 "$(tsf installer.podman.apt_would_remove 'installing%s would REMOVE other packages of this computer (often containerd.io, Docker'\''s): nothing was changed. To see which, run: sudo apt-get -s install%s. Install Podman yourself in a way that keeps them (or decide to remove them), then run this installer again.' "$missing" "$missing")" ;;
            *) podman_refuse podman_install_failed 88 "$(tsf installer.podman.apt_failed 'apt-get install%s failed. To see why, run: sudo apt-get install%s' "$missing" "$missing")" ;;
          esac
        fi
        ;;
      dnf)
        podman_check_candidates "$missing"
        # dnf never removes a package to install one unless --allowerasing is given: it stops on the conflict.
        sudo -n dnf install -y $missing >/dev/null \
          || podman_refuse podman_install_failed 88 "$(tsf installer.podman.dnf_failed 'dnf install%s failed (dnf removes nothing: a conflict with an installed package stops it). To see why, run: sudo dnf install%s' "$missing" "$missing")"
        ;;
      pacman)
        podman_check_candidates "$missing"
        # --noconfirm answers the default, which is «no» to removing a conflicting package: pacman stops.
        sudo -n pacman -S --noconfirm --needed $missing >/dev/null \
          || podman_refuse podman_install_failed 88 "$(tsf installer.podman.pacman_failed 'pacman -S%s failed (nothing was removed). To see why, run: sudo pacman -S%s' "$missing" "$missing")"
        ;;
      *) podman_refuse podman_install_failed 88 "$(tsf installer.podman.no_package_manager 'no known package manager (apt, dnf, pacman) to install:%s' "$missing")" ;;
    esac
    hash -r 2>/dev/null || true
    ok "$(tsf installer.installed 'Installed:%s' "$missing")"
  fi
  if [ "$need_subuid$need_subgid" != "00" ]; then
    start="$(podman_free_subid_start "$etc")"
    end=$((start + 65535))
    info "$(tsf installer.giving_subordinate_uid_gid 'Giving %s the subordinate uid/gid range %s-%s...' "$user" "$start" "$end")"
    {
      if [ "$need_subuid" = 1 ] && [ "$need_subgid" = 1 ]; then
        sudo -n usermod --add-subuids "$start-$end" --add-subgids "$start-$end" "$user"
      elif [ "$need_subuid" = 1 ]; then
        sudo -n usermod --add-subuids "$start-$end" "$user"
      else
        sudo -n usermod --add-subgids "$start-$end" "$user"
      fi
    } || podman_refuse podman_subuid_missing 96 "$(tsf installer.podman.usermod_failed 'usermod could not add the subordinate range (%s-%s) for %s.' "$start" "$end" "$user")"
    if command -v podman >/dev/null 2>&1; then podman system migrate >/dev/null 2>&1 || true; fi
    ok "$(tsf installer.subuid_subgid_range 'subuid/subgid range %s-%s for %s' "$start" "$end" "$user")"
  fi
  if [ "$need_linger" = 1 ]; then
    info "$(tsf installer.enabling_linger 'Enabling linger for %s...' "$user")"
    sudo -n loginctl enable-linger "$user" \
      || podman_refuse podman_linger_missing 94 "$(tsf installer.podman.linger_failed 'loginctl enable-linger %s failed.' "$user")"
    # The user manager starts a moment later: the runtime directory follows it.
    for i in 1 2 3 4 5 6 7 8 9 10; do
      [ -d "$run_user" ] && break
      sleep 1
    done
    ok "$(tsf installer.linger_enabled 'linger enabled for %s' "$user")"
  fi
}

check_podman_linux() {
  step 2 "$TOTAL_STEPS_DOCKER" "$(ts installer.container_runtime_podman_rootless 'Container runtime (Podman rootless)')"
  [ "$OS" = "linux" ] \
    || podman_refuse podman_unsupported_host 1 "$(tsf installer.podman.unsupported_host '--runtime podman is for Linux and macOS; this system is %s.' "$OS")"
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
    || podman_refuse podman_rootful_refused 91 "$(ts installer.podman.root_refused 'JHT runs on Podman rootless, as a user that is not root. Sign in as that user and run the install again.')"
  provision_podman_linux "$uid" "$user" "$etc" "$run_user"
  command -v podman >/dev/null 2>&1 \
    || podman_refuse podman_missing 90 "$(ts installer.podman.still_missing 'podman is still not there after the install. Ask the administrator of this server to run, as root: apt install podman')"
  command -v podman-compose >/dev/null 2>&1 \
    || podman_refuse podman_compose_missing 92 "$(ts installer.podman.compose_missing 'podman-compose is not available from this system'\''s packages. Ask the administrator of this server to install it, as root: apt install podman-compose')"
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
    || podman_refuse podman_runtime_dir_missing 95 "$(tsf installer.podman.runtime_dir_missing 'there is no runtime directory for this user (%s): the session has no user manager. Sign in again, or ask the administrator to run, as root: loginctl enable-linger %s' "$xdg" "$user")"
  if command -v loginctl >/dev/null 2>&1; then
    loginctl show-user "$user" -p Linger 2>/dev/null | grep -qx 'Linger=yes' \
      || podman_refuse podman_linger_missing 94 "$(tsf installer.podman.linger_missing 'the containers of %s would stop when the session ends. Ask the administrator of this server to run, as root: loginctl enable-linger %s' "$user" "$user")"
  else
    warn "$(ts installer.loginctl_not_found_linger 'loginctl not found: linger was not checked.')"
  fi
  { podman_subid_range "$etc/subuid" "$user" "$uid" && podman_subid_range "$etc/subgid" "$user" "$uid"; } \
    || podman_refuse podman_subuid_missing 96 "$(tsf installer.podman.subuid_missing '%s has no subordinate uid/gid range in %s/subuid and %s/subgid. Ask the administrator of this server to run, as root: usermod --add-subuids 100000-165535 --add-subgids 100000-165535 %s' "$user" "$etc" "$etc" "$user")"
  rootless="$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null)" \
    || podman_refuse podman_rootless_unavailable 97 "$(tsf installer.podman.info_fails ''\''podman info'\'' fails for %s, so the rootless storage or runtime is not ready. Run it by hand to see why.' "$user")"
  [ "$rootless" = "true" ] \
    || podman_refuse podman_rootful_refused 91 "$(tsf installer.podman.answers_rootful 'podman answers as rootful for %s (Rootless=%s): JHT needs Podman rootless.' "$user" "$rootless")"
  have_podman="$(podman --version 2>/dev/null | awk '{ print $NF }' | sed 's/[^0-9.].*$//')"
  # awk reads every line: exiting at the first would close the pipe while podman-compose still
  # writes its "podman version" line, and under pipefail that SIGPIPE (141) stops the install.
  have_compose="$(podman-compose --version 2>/dev/null | awk '/^podman-compose version/ && v == "" { v = $3 } END { print v }' | sed 's/[^0-9.].*$//')"
  { [ -n "$have_podman" ] && version_at_least "$have_podman" "$PODMAN_MIN_VERSION"; } \
    || podman_refuse podman_version_unsupported 93 "$(tsf installer.podman.too_old 'podman %s is older than %s. Ask the administrator of this server for a newer podman.' "${have_podman:-$(ts installer.podman.unknown_version 'of unknown version')}" "$PODMAN_MIN_VERSION")"
  { [ -n "$have_compose" ] && version_at_least "$have_compose" "$PODMAN_COMPOSE_MIN_VERSION"; } \
    || podman_refuse podman_version_unsupported 93 "$(tsf installer.podman.compose_too_old 'podman-compose %s is older than %s. Ask the administrator of this server for a newer podman-compose.' "${have_compose:-$(ts installer.podman.unknown_version 'of unknown version')}" "$PODMAN_COMPOSE_MIN_VERSION")"
  ok "$(tsf installer.podman_rootless_podman_compose 'Podman rootless %s + podman-compose %s for %s' "$have_podman" "$have_compose" "$user")"
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
  printf 'homebrew_missing: %s\n' "$(ts installer.mac.homebrew_missing 'JHT installs Podman with Homebrew, which is not on this Mac. Nothing was changed. Install Homebrew from https://brew.sh (one command in Terminal; it asks for your Mac password), open a new Terminal window and run this installer again.')" >&2
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
  local which
  which="$(ts installer.mac.other_machine_any 'another Podman machine is running (find it with '\''podman machine list'\'')')"
  [ -n "$running" ] && which="$(tsf installer.mac.other_machine_named 'another Podman machine, %s, is running' "$running")"
  printf "  ${RED}✗${RESET} %s%s\n" "$(jht_code_prefix podman_other_machine_running)" "$(tsf installer.mac.other_machine_running '%s, and a Mac runs only one at a time. Stop it with '\''podman machine stop %s'\'' (or from the app you use it with) and run the installer again: Job Hunter Team never stops it for you, and you can start it again afterwards.' "$which" "${running:-$(ts installer.mac.machine_name_placeholder '<name>')}")" >&2
  return 0
}

enable_podman_trim_timer() {
  local podman_bin="$1"
  "$podman_bin" machine ssh "$PODMAN_MACHINE_NAME" \
    sudo systemctl enable --now fstrim.timer >/dev/null 2>&1
}

# The Podman machine (vfkit and gvproxy, started by `podman machine start`/`init --now`) must not live and die with the terminal
# the person ran this from: closing that window sends SIGHUP to what it started, and the machine with the team stopped. The
# command runs in a session of its own, with no terminal and SIGHUP ignored (perl's setsid on macOS, which has no setsid
# command; setsid -w where there is one; nohup otherwise). `podman machine stop` (jht down) still stops it as before.
jht_detached_from_terminal() {
  if command -v perl >/dev/null 2>&1; then
    perl -MPOSIX -e '$SIG{HUP} = "IGNORE"; POSIX::setsid(); exec { $ARGV[0] } @ARGV or exit 127' "$@" </dev/null
  elif command -v setsid >/dev/null 2>&1; then
    setsid -w "$@" </dev/null
  else
    nohup "$@" </dev/null
  fi
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
    info "$(ts installer.installing_podman_cli 'Installing Podman CLI...')"
    run brew install podman || fail "$(ts installer.mac.podman_install_failed 'Podman installation failed')"
  else
    ok "$(ts installer.podman_already_installed 'podman already installed')"
  fi
  if ! command -v podman-compose &>/dev/null; then
    jht_phase compose_install
    info "$(ts installer.installing_podman_compose_provider 'Installing the Podman Compose provider...')"
    run brew install podman-compose || fail "$(ts installer.mac.compose_install_failed 'podman-compose installation failed')"
  else
    ok "$(ts installer.podman_compose_already_installed 'podman-compose already installed')"
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
    ''|*[!A-Za-z0-9_.-]*) fail "$(tsf installer.check.machine_name_invalid 'Invalid JHT Podman machine name: %s' "$PODMAN_MACHINE_NAME")" ;;
  esac
  local podman_bin compose_bin compose_version podman_version
  podman_bin="$(command -v podman)" \
    || fail "$(ts installer.check.podman_gone 'Podman CLI disappeared after installation.')"
  compose_bin="$(command -v podman-compose)" \
    || fail "$(ts installer.check.compose_gone 'Podman Compose provider disappeared after installation.')"
  podman_version="$("$podman_bin" --version 2>/dev/null)" || podman_version=""
  podman_version="${podman_version#podman version }"
  podman_mac_version_supported "$podman_version" \
    || fail "podman_version_unsupported: $(tsf installer.mac.podman_version_unsupported 'JHT on a Mac needs Podman %s.%s or a later %s.x (not 6.2 or later); this Mac has %s. If Homebrew moved Podman past the %s series, get the JHT installer of today again (it says which series it supports); nothing of JHT was installed.' "$PODMAN_MAC_SERIES" "$PODMAN_MAC_MIN_PATCH" "$PODMAN_MAC_SERIES" "${podman_version:-$(ts installer.mac.podman_no_version 'a podman that does not say its version')}" "$PODMAN_MAC_SERIES")"
  compose_version="$(CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME" \
    "$compose_bin" --version 2>/dev/null)" \
    || fail "$(ts installer.check.compose_version_unreadable 'Podman Compose provider version probe failed.')"
  printf '%s\n' "$compose_version" | grep -Fqx "podman-compose version $PODMAN_COMPOSE_MAC_VERSION" \
    || fail "podman_compose_version_unsupported: $(tsf installer.mac.compose_version_unsupported 'JHT on a Mac needs podman-compose %s; this Mac has %s. Run «brew upgrade podman-compose» (or «brew install podman-compose»), then this installer again.' "$PODMAN_COMPOSE_MAC_VERSION" "$(printf '%s\n' "$compose_version" | sed -n 's/^podman-compose version //p' | head -n 1)")"
  # The only Mac folders the JHT machine may see are the two the compose
  # file binds. Without --volume, `podman machine init` on macOS mounts
  # /Users (every user's home), /private, /var/folders and
  # ~/.config/containers (measured on 08/10/2026). A declared folder that
  # does not exist stops the machine from booting, so both are created
  # before init and before every start.
  local jht_home_dir="$HOME/.jht" jht_docs_dir="$HOME/Documents/Job Hunter Team"
  if [ ! -d "$jht_home_dir" ]; then
    mkdir -p "$jht_home_dir" && chmod 700 "$jht_home_dir" \
      || fail "$(tsf installer.mac.cannot_create_folder 'Cannot create %s for the Podman machine.' "$jht_home_dir")"
  fi
  mkdir -p "$jht_docs_dir" || fail "$(tsf installer.mac.cannot_create_folder 'Cannot create %s for the Podman machine.' "$jht_docs_dir")"
  if podman machine inspect "$PODMAN_MACHINE_NAME" &>/dev/null; then
    local machine_resources
    machine_resources="$("$podman_bin" machine inspect \
      --format '{{.Resources.CPUs}} {{.Resources.Memory}} {{.Resources.DiskSize}}' \
      "$PODMAN_MACHINE_NAME" 2>/dev/null || true)"
    if [ "$machine_resources" != "$PODMAN_MACHINE_CPUS $PODMAN_MACHINE_MEMORY_MIB $PODMAN_MACHINE_DISK_GIB" ]; then
      warn "$(tsf installer.existing_podman_machine_has 'Existing Podman machine '\''%s'\'' has resources '\''%s'\''; JHT recommends %s CPU, %s MiB RAM and %s GiB disk. The existing machine was not changed.' "$PODMAN_MACHINE_NAME" "${machine_resources:-unknown}" "$PODMAN_MACHINE_CPUS" "$PODMAN_MACHINE_MEMORY_MIB" "$PODMAN_MACHINE_DISK_GIB")"
    fi
    if ! podman --connection "$PODMAN_MACHINE_NAME" info &>/dev/null; then
      jht_phase machine_start
      info "$(tsf installer.starting_podman_machine 'Starting Podman machine '\''%s'\''...' "$PODMAN_MACHINE_NAME")"
      local start_error start_status
      start_error="$(jht_detached_from_terminal "$podman_bin" machine start --update-connection=false "$PODMAN_MACHINE_NAME" 2>&1 >/dev/null)" \
        && start_status=0 || start_status=$?
      if [ "$start_status" -ne 0 ]; then
        report_podman_machine_conflict "$podman_bin" "$start_error" && exit 79
        fail "$(ts installer.mac.machine_start_failed 'Podman machine start failed; Colima was not changed.')"
      fi
    else
      ok "$(tsf installer.podman_machine_already_running 'Podman machine '\''%s'\'' already running' "$PODMAN_MACHINE_NAME")"
    fi
  else
    jht_phase machine_create
    jht_phase machine_start
    info "$(tsf installer.creating_rootless_podman_machine 'Creating rootless Podman machine '\''%s'\''...' "$PODMAN_MACHINE_NAME")"
    local init_error init_status
    init_error="$(jht_detached_from_terminal "$podman_bin" machine init --now --update-connection=false \
      --cpus "$PODMAN_MACHINE_CPUS" \
      --memory "$PODMAN_MACHINE_MEMORY_MIB" \
      --disk-size "$PODMAN_MACHINE_DISK_GIB" \
      --volume "$jht_home_dir:$jht_home_dir" \
      --volume "$jht_docs_dir:$jht_docs_dir" \
      "$PODMAN_MACHINE_NAME" 2>&1 >/dev/null)" && init_status=0 || init_status=$?
    if [ "$init_status" -ne 0 ]; then
      report_podman_machine_conflict "$podman_bin" "$init_error" && exit 79
      fail "$(ts installer.mac.machine_init_failed 'Podman machine initialization failed; Colima was not changed.')"
    fi
    PODMAN_MACHINE_CREATED=1
    PODMAN_MACHINE_CREATED_ID="$("$podman_bin" machine inspect --format '{{.Created}}' "$PODMAN_MACHINE_NAME" 2>/dev/null | head -n 1 || true)"
  fi
  "$podman_bin" --connection "$PODMAN_MACHINE_NAME" info &>/dev/null \
    || fail "$(tsf installer.mac.machine_unreachable 'Podman machine '\''%s'\'' is not reachable.' "$PODMAN_MACHINE_NAME")"
  # A team that is running refuses the reinstall: say so before the download of the image (minutes), not after it.
  refuse_running_team
  # Room for the download, before it: what stays free after it must keep the agents above their threshold.
  check_room_for_download
  jht_phase image_pull
  "$podman_bin" --connection "$PODMAN_MACHINE_NAME" pull "$IMAGE" >/dev/null \
    || fail "$(tsf installer.image_download_failed 'JHT image download failed: %s' "$IMAGE")"
  # Fedora CoreOS ships this weekly timer. Enabling the stock unit is
  # idempotent and lets applehv reclaim unused blocks from its sparse .raw;
  # do not start or stop a machine solely for trimming.
  enable_podman_trim_timer "$podman_bin" \
    || warn "$(ts installer.podman_ready_but_weekly 'Podman is ready, but its weekly disk trim timer could not be enabled.')"
  ok "$(ts installer.podman_ready_colima_retained 'Podman ready (Colima retained)')"
}



install_container_runtime() {
  step 2 "$TOTAL_STEPS_DOCKER" "$(ts installer.container_runtime 'Container runtime')"
  case "$OS" in
    macos) install_podman_macos ;;
    linux) check_podman_linux ;;
    # Windows runs JHT with install.ps1 (Podman in WSL, set up from Windows); inside a WSL distribution there is nothing to set up.
    wsl) fail "wsl_not_supported: $(ts installer.wsl_not_supported 'on Windows, install JHT from PowerShell with install.ps1 (see docs/guides/QUICKSTART.md), not from inside WSL. Nothing was changed.')" ;;
  esac
}



verify_docker_works() {
  step 3 "$TOTAL_STEPS_DOCKER" "$(ts installer.container_runtime_check 'Container runtime check')"
  if podman_native_mode; then
    # The check of the step before already ran podman info, rootless.
    [ "$DRY_RUN" -eq 1 ] || ok "$(ts installer.podman_rootless_reachable 'podman rootless reachable')"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would execute: podman --connection %s info\n" "$PODMAN_MACHINE_NAME"
    printf "  ${DIM}[dry-run]${RESET} would verify: Podman %s.x (from %s.%s) + podman-compose %s\n" "$PODMAN_MAC_SERIES" "$PODMAN_MAC_SERIES" "$PODMAN_MAC_MIN_PATCH" "$PODMAN_COMPOSE_MAC_VERSION"
    return 0
  fi
  podman --connection "$PODMAN_MACHINE_NAME" info &>/dev/null \
    || fail "$(ts installer.mac.machine_not_responding 'The JHT Podman machine is not responding.')"
  ok "$(ts installer.podman_machine_reachable 'Podman machine reachable')"
}

install_podman_adapter() {
  podman_machine_mode || podman_native_mode || return 0
  local podman_bin adapter_bin shim_dest shim_tmp selection_file machine_file
  podman_bin="$(command -v podman)" || fail "$(ts installer.check.podman_not_on_path 'podman disappeared from PATH')"
  case "$podman_bin" in *"'"*|*$'\n'*) fail "$(tsf installer.check.podman_path_unsafe 'Unsafe Podman executable path: %s' "$podman_bin")" ;; esac
  if podman_machine_mode; then
    case "$PODMAN_MACHINE_NAME" in
      ''|*[!A-Za-z0-9_.-]*) fail "$(tsf installer.check.machine_name_invalid 'Invalid JHT Podman machine name: %s' "$PODMAN_MACHINE_NAME")" ;;
    esac
  fi
  adapter_bin="$RUNTIME_DIR/bin"
  [ ! -L "$adapter_bin" ] || fail "$(tsf installer.check.adapter_is_link 'Podman adapter bin path is a symlink: %s' "$adapter_bin")"
  [ ! -e "$adapter_bin" ] || [ -d "$adapter_bin" ] \
    || fail "$(tsf installer.check.adapter_not_dir 'Podman adapter bin path is not a directory: %s' "$adapter_bin")"
  mkdir -p "$adapter_bin"
  chmod 700 "$adapter_bin"
  [ "$(cd -P "$adapter_bin" && pwd -P)" = "$adapter_bin" ] \
    || fail "$(tsf installer.check.adapter_bad_ancestor 'Podman adapter bin has a non-canonical ancestor: %s' "$adapter_bin")"
  shim_dest="$adapter_bin/docker"
  if [ -e "$shim_dest" ] || [ -L "$shim_dest" ]; then
    [ -f "$shim_dest" ] && [ ! -L "$shim_dest" ] \
      && grep -Fqx '# JHT_PODMAN_DOCKER_SHIM=1' "$shim_dest" 2>/dev/null \
      || fail "$(tsf installer.check.shim_unsafe 'Refusing to overwrite an unsafe or non-JHT executable: %s' "$shim_dest")"
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
    ok "$(tsf installer.private_jht_docker_shim 'Private JHT docker shim: %s (not added to global PATH; Colima untouched)' "$shim_dest")"
  else
    # Native Linux has no machine: the wrapper refuses a machine file here.
    rm -f "$machine_file"
    ok "$(tsf installer.private_jht_docker_shim_2 'Private JHT docker shim: %s (not added to global PATH; rootless Podman, no machine)' "$shim_dest")"
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
    && ok "$(ts installer.runtime_tier_core_tools 'runtime tier: core (the tools come after the welcome)')"
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
    && ok "$(tsf installer.extras_image_pinned_ghcr 'extras image pinned: ghcr.io/leopu00/jht@%s (pulled when a tool is asked for)' "$EXTRAS_IMAGE_DIGEST_OPT")"
}

download_runtime_files() {
  step 4 "$TOTAL_STEPS_DOCKER" "$(ts installer.download_wrapper_docker_compose 'Download wrapper + docker-compose.yml')"

  local release_base
  if [ "$DRY_RUN" -eq 1 ] && [ "$TEST_CHANNEL" -eq 0 ]; then
    release_base="${RAW_BASE_OVERRIDE:-https://raw.githubusercontent.com/leopu00/job-hunter-team/$BRANCH}"
  else
    release_base="$(attested_raw_base)" \
      || fail "$(tsf installer.check.branch_unresolved 'Cannot resolve branch '\''%s'\'' to an immutable release commit.' "$BRANCH")"
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
    fail "$(tsf installer.runtime_dir_is_link 'Host runtime path is a symlink: %s' "$RUNTIME_DIR")"
  fi
  case "$RUNTIME_DIR/" in
    "$HOME/.jht/"*|"$HOME/Documents/Job Hunter Team/"*)
      fail "$(tsf installer.runtime_dir_in_mount 'Host runtime must be outside container-writable bind mounts: %s' "$RUNTIME_DIR")"
      ;;
  esac
  case "$BIN_DIR/" in
    "$HOME/.jht/"*|"$HOME/Documents/Job Hunter Team/"*)
      fail "$(tsf installer.wrapper_dir_in_mount 'Host wrapper must be outside container-writable bind mounts: %s' "$BIN_DIR")"
      ;;
  esac
  umask 077
  mkdir -p "$RUNTIME_DIR" "$BIN_DIR"
  chmod 700 "$RUNTIME_DIR"
  local runtime_real bin_real
  runtime_real="$(cd -P "$RUNTIME_DIR" && pwd -P)"
  bin_real="$(cd -P "$BIN_DIR" && pwd -P)"
  [ "$runtime_real" = "${RUNTIME_DIR%/}" ] \
    || fail "$(tsf installer.runtime_dir_bad_ancestor 'Host runtime has a symlinked or non-canonical ancestor: %s' "$RUNTIME_DIR")"
  [ "$bin_real" = "${BIN_DIR%/}" ] \
    || fail "$(tsf installer.wrapper_dir_bad_ancestor 'Host wrapper directory has a symlinked or non-canonical ancestor: %s' "$BIN_DIR")"

  local compose_tmp wrapper_tmp hostsetup_tmp manifest_tmp
  compose_tmp="$(mktemp "$RUNTIME_DIR/.compose.XXXXXX")"
  wrapper_tmp="$(mktemp "$BIN_DIR/.jht.XXXXXX")"
  hostsetup_tmp="$(mktemp "$RUNTIME_DIR/.host-setup.XXXXXX")"
  manifest_tmp="$(mktemp "$RUNTIME_DIR/.integrity.XXXXXX")"

  info "$(ts installer.downloading_docker_compose_yml 'Downloading docker-compose.yml...')"
  if ! curl -fsSL "$compose_url" -o "$compose_tmp"; then
    fail "$(tsf installer.download_failed 'Download failed: %s. Check your connection and branch (%s).' "$compose_url" "$BRANCH")"
  fi
  grep -Eq '^[[:space:]]*-[[:space:]]*jht-runtime-mask:/jht_home/runtime([[:space:]]|$)' "$compose_tmp" \
    || fail "$(ts installer.check.compose_boundary 'Downloaded compose does not enforce the protected runtime boundary.')"
  chmod 600 "$compose_tmp"
  mv -f "$compose_tmp" "$compose_dest"
  ok "$(tsf installer.done_compose 'compose: %s' "$compose_dest")"

  info "$(ts installer.downloading_jht_wrapper 'Downloading jht wrapper...')"
  if ! curl -fsSL "$wrapper_url" -o "$wrapper_tmp"; then
    fail "$(tsf installer.download_failed 'Download failed: %s. Check your connection and branch (%s).' "$wrapper_url" "$BRANCH")"
  fi
  bash -n "$wrapper_tmp" \
    && grep -Fqx 'JHT_HOST_RUNTIME_PROTOCOL=1' "$wrapper_tmp" \
    || fail "$(ts installer.check.wrapper_protocol 'Downloaded wrapper does not implement the protected runtime protocol.')"
  chmod 700 "$wrapper_tmp"
  mv -f "$wrapper_tmp" "$wrapper_dest"
  ok "$(tsf installer.done_wrapper 'wrapper: %s' "$wrapper_dest")"

  info "$(ts installer.downloading_host_setup_sh 'Downloading host-setup.sh (VPS/swap preflight)...')"
  if ! curl -fsSL "$hostsetup_url" -o "$hostsetup_tmp" \
      || ! bash -n "$hostsetup_tmp" \
      || ! grep -Fqx 'JHT_HOST_SETUP_PROTOCOL=1' "$hostsetup_tmp"; then
    fail "$(tsf installer.host_setup_download_failed 'host-setup.sh download or validation failed: %s' "$hostsetup_url")"
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
      fail "$(tsf installer.helper_download_failed '%s download or validation failed: %s/scripts/%s' "$helper" "$release_base" "$helper")"
    fi
    chmod 700 "$helper_tmp"
    mv -f "$helper_tmp" "$RUNTIME_DIR/$helper"
    helper_lines="$helper_lines$helper=$( { sha256sum "$RUNTIME_DIR/$helper" 2>/dev/null || shasum -a 256 "$RUNTIME_DIR/$helper"; } | awk '{print $1}')"$'\n'
  done
  # Their digests are in a manifest of their own: the desktop app checks the main one key by key.
  printf '%s' "$helper_lines" > "$RUNTIME_DIR/.runtime-helpers.tmp" && chmod 600 "$RUNTIME_DIR/.runtime-helpers.tmp" \
    && mv -f "$RUNTIME_DIR/.runtime-helpers.tmp" "$RUNTIME_DIR/.runtime-helpers" || fail "$(ts installer.check.digests_not_written 'the digests of the host scripts were not written')"
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
    ok "$(tsf installer.runtime_image_pinned 'runtime image pinned: %s' "$(cat "$image_pin")")"
  fi
  publish_runtime_extras_pin
  publish_runtime_tier
  ok "$(tsf installer.done_host_setup 'host-setup: %s' "$hostsetup_dest")"

  case ":$PATH:" in
    *":$BIN_DIR:"*)
      ok "$(tsf installer.already_path '%s already in PATH' "$BIN_DIR")"
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
        ok "$(ts installer.path_added_etc_profile 'PATH added to /etc/profile.d/jht.sh (system-wide)')"
        persistent_added=1
      else
        # User-level fallback: append to ~/.bashrc + ~/.zshrc if they exist
        # and not already present. Idempotent: skip if already added.
        for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
          if [ -f "$rc" ] && ! grep -Fq -- "$BIN_DIR" "$rc" 2>/dev/null; then
            printf '\n# Added by JHT install.sh\nexport PATH="$PATH:%s"\n' "$BIN_DIR" >> "$rc"
            ok "$(tsf installer.path_added 'PATH added to %s' "$rc")"
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
              && { ok "$(tsf installer.path_added 'PATH added to %s' "$rc")"; persistent_added=1; }
          done
        fi
      fi
      if [ "$persistent_added" -eq 0 ]; then
        warn "$(ts installer.no_shell_rc_file 'No shell rc file was written. Add manually:')"
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
  printf "${GREEN}${BOLD}  %s${RESET}\n" "$(ts installer.installation_complete 'Installation complete!')"
  printf "${GREEN}${BOLD}══════════════════════════════════════════${RESET}\n"
  printf "\n"
  if [ "$USE_DOCKER" -eq 1 ]; then
    printf "  ${BOLD}%s${RESET}\n" "$(ts installer.container_mode_active_podman 'Container mode active (Podman).')"
    printf "  ${DIM}%s${RESET}\n" "$(ts installer.agents_can_only_see 'The agents can only see:')"
    printf "  ${DIM}  ~/.jht/                       → /jht_home %s${RESET}\n" "$(ts installer.config_db_agents '(config, db, agents)')"
    printf "  ${DIM}  ~/Documents/Job Hunter Team/  → /jht_user %s${RESET}\n" "$(ts installer.cvs_attachments_output '(CVs, attachments, output)')"
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
    printf "  ${BOLD}%s${RESET}\n" "$(ts installer.next_steps 'Next steps:')"
    printf "\n"
    if [ "${PATH_NEW_SHELL:-0}" -eq 1 ]; then
      printf "      ${DIM}%s${RESET}\n\n" "$(ts installer.open_new_terminal_window 'Open a new terminal window first (or run: . ~/.profile), so that it finds jht.')"
    fi
    if [ "${PATH_READY:-0}" -eq 1 ]; then
      if [ "$USE_DOCKER" -eq 1 ]; then
        printf "      ${BOLD}jht setup${RESET}        ${DIM}# %s${RESET}\n" "$(ts installer.configuration_wizard_also_starts 'configuration wizard (also starts the container)')"
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

  printf "  ${DIM}%s${RESET}\n" "$(ts installer.uninstall_keeps_your_data 'To uninstall (keeps your data in ~/.jht and ~/Documents/Job Hunter Team):')"
  if [ "$USE_DOCKER" -eq 1 ]; then
    # `jht uninstall` removes the containers, the networks and the VOLUMES of the project (broker, secrets, deps…: the
    # ten host-runtime_jht-* that `jht down && rm -rf` left behind, TEST 19i A2), then the runtime, the PATH lines and itself.
    # It is the only command printed for the engine: no `docker rmi`, no `rm -rf` and no `sudo` for the person to type.
    printf "  ${DIM}  jht uninstall --confirm${RESET}\n"
    printf "  ${DIM}  %s${RESET}\n" "$(ts installer.also_deletes_api_key '(it also deletes the API key, the mail password and the Telegram tokens saved for the team)')"
  else
    printf "  ${DIM}  rm -rf %s %s/jht${RESET}\n" "$INSTALL_DIR" "$BIN_DIR"
  fi
  printf "  ${DIM}%s${RESET}\n" "$(ts installer.also_delete_your_data 'To also delete your data (config, db, CVs, output):')"
  if [ "$USE_DOCKER" -eq 1 ]; then
    # With a container engine on Linux ~/.jht belongs to the container (uid 1001, often mode 700; with rootless Podman, to a
    # sub-uid): `rm -rf` from this account fails with "Permission denied" (TEST, Linux gate). `jht uninstall --confirm --purge`
    # empties the folders the right way for the engine (a one-shot container for Docker, `podman unshare` for Podman), without
    # sudo and without changing a permission, so it is the command printed for every engine.
    printf "  ${DIM}  jht uninstall --confirm --purge${RESET}\n"
    printf "  ${DIM}  %s${RESET}\n" "$(ts installer.same_as_above_empties '(same as above, and it empties ~/.jht and ~/Documents/Job Hunter Team too)')"
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
  tmp="$(mktemp "$dir/.jht-host-file.XXXXXX")" || { warn "$(tsf installer.host_file_tmp_failed 'cannot create a temporary file in %s: not writing %s' "$dir" "$target")"; return 1; }
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
  ok "$(tsf installer.pairing_token_saved 'Pairing token saved to %s (mode 0600)' "$token_file")"
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
  fail "$(tsf installer.uid_1001_taken 'uid 1001 on this computer is the account '\''%s'\''. The Job Hunter Team container runs as uid 1001, so that account would own ~/.jht (your data and the portal credentials). Nothing was changed. Run JHT from the account '\''%s'\'', or give '\''%s'\'' another uid, then try again.' "$name" "$name" "$name")"
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
    mkdir -p "$jht_user_dir/allegati" 2>/dev/null   # the folder the welcome names for the CV
    ok "$(tsf installer.ownership_stays_user_rootless 'Ownership of %s and %s stays with this user (rootless Podman)' "$jht_home" "$jht_user_dir")"
  elif [ "${OS:-}" = "macos" ]; then
    # The Mac shares the two folders with the container's VM, which shows
    # them as this user's and lets the container write: nothing needs
    # aligning. A chown to 1001 cannot work for a normal user (EPERM, on every
    # Mac) and, under sudo, would hand ~/.jht to a uid that is nobody here.
    mkdir -p "$jht_user_dir/allegati" 2>/dev/null   # the folder the welcome names for the CV
    ok "$(tsf installer.ownership_stays_user_macos 'Ownership of %s and %s stays with this user (macOS)' "$jht_home" "$jht_user_dir")"
  elif command -v chown >/dev/null 2>&1; then
    mkdir -p "$jht_user_dir/allegati" 2>/dev/null   # the folder the welcome names for the CV
    if chown -R 1001:1001 "$jht_home" "$jht_user_dir" 2>/dev/null; then
      ok "$(tsf installer.ownership_1001_1001_container 'Ownership %s and %s → 1001:1001 (container UID)' "$jht_home" "$jht_user_dir")"
    elif repair_bind_ownership_in_container "$jht_home" "$jht_user_dir"; then
      ok "$(tsf installer.ownership_1001_1001_container_2 'Ownership %s and %s → 1001:1001 (container UID, set by a one-shot container: no sudo needed)' "$jht_home" "$jht_user_dir")"
    elif [ "$USE_DOCKER" -ne 1 ]; then
      warn "$(ts installer.chown_not_needed 'chown to 1001 failed — nothing runs in a container here (--no-docker), so nothing needs it')"
    else
      # A normal user cannot chown to 1001 (EPERM) and without the repair above the container would start and die
      # on «mount_not_writable» in a restart loop (Gate CLI, 29/10): stop here, saying what to do.
      fail "mount_repair_failed: $(tsf installer.mount_repair_failed '%s and %s cannot be made writable for the Job Hunter Team container (it runs as uid 1001) and nothing was started. Either let Docker run for this account (add it to the '\''docker'\'' group, then log in again), or run once: sudo chown -R 1001:1001 "%s" "%s" — then run this installer again.' "$jht_home" "$jht_user_dir" "$jht_home" "$jht_user_dir")"
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
    warn "$(tsf installer.host_setup_missing 'host-setup.sh not available at %s — skipping preflight' "$hostsetup")"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    info "dry-run: would run $hostsetup${PAIRING_TOKEN:+ --host-type=vps}"
    return 0
  fi
  info "$(ts installer.running_host_setup_sh 'Running host-setup.sh (writes ~/.jht/host.env + swap preflight)...')"
  if [ -n "$PAIRING_TOKEN" ]; then
    if "$hostsetup" --host-type=vps </dev/null; then
      ok "$(ts installer.host_setup_completed_forced 'host-setup completed (forced vps)')"
    else
      warn "$(ts installer.host_setup_exited_error 'host-setup exited with an error — continuing (a manual pair may be needed)')"
    fi
  else
    if "$hostsetup" </dev/null; then
      ok "$(ts installer.host_setup_completed_auto 'host-setup completed (auto-detected host type)')"
    else
      warn "$(ts installer.host_setup_exited_error_2 'host-setup exited with an error — continuing')"
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
    info "$(ts installer.pairing_token_present_skipping 'Pairing token present: skipping the interactive wizard.')"
    info "$(ts installer.container_will_complete_pairing 'The container will complete the pairing on first boot.')"
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
      info "$(ts installer.no_interactive_terminal_no 'No interactive terminal (no /dev/tty): skipping the wizard.')"
      info "$(ts installer.run_manually_jht_setup 'Run manually: jht setup')"
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
  # 3 = the setup is done and saved, but the agents refused to start because the disk is almost full (the wizard said how much
  # and what to free): never «not set up yet», which sent the person through a setup they had already finished (giro Mac build8).
  if [ "$wizard_status" -eq 3 ]; then
    printf "\n"
    warn "$(ts installer.setup_done_team_needs_space 'The setup is done and saved, but the team did not start: the disk needs more free space. Free it as said above, then start the team with  jht team start  (no need to run the setup again).')"
    return "$wizard_status"
  fi
  if [ "$wizard_status" -ne 0 ]; then
    local setup_command="jht setup"
    [ "${PATH_READY:-0}" -eq 1 ] || setup_command="$BIN_DIR/jht setup"
    printf "\n"
    warn "$(tsf installer.setup_did_not_finish 'The setup did not finish (exit code %s): Job Hunter Team is installed, but it is not set up yet.' "$wizard_status")"
    info "$(tsf installer.next_step_run_finish 'Next step: run  %s  to finish the setup.' "$setup_command")"
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
  case "$MIN_FREE_GIB" in ''|*[!0-9]*) fail "$(tsf installer.min_free_invalid 'Invalid JHT_MIN_FREE_GIB: %s' "$MIN_FREE_GIB")" ;; esac
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
        warn "$(tsf installer.disk_low_dry_run 'Only %s GiB free on %s; a real install needs at least %s GiB.' "$((free_kib_value / 1024 / 1024))" "$path" "$MIN_FREE_GIB")"
        return 0
      fi
      fail "$(tsf installer.disk_not_enough 'not enough free disk space: %s GiB free on %s, the Job Hunter Team image and its data need at least %s GiB. Free some space (on a server that already runs Docker, '\''docker image prune -af'\'' removes unused images) and run the installer again. Nothing was changed.' "$((free_kib_value / 1024 / 1024))" "$path" "$MIN_FREE_GIB")"
    fi
  done
}

# ── Room on the disk for the download ───────────────────────────────────────
# The image goes into the engine and grows the disk of this computer (on a Mac the disk image of the Podman machine grows on the
# Mac's own disk); with a core install the full image follows by itself after the setup. The agents refuse to start when the
# disk is under 3% AND under 8 GiB free (the threshold of jht-wrapper.sh and cli/src/lib/disk-guard.js): an update that left the
# disk under it ended in a setup whose team could not start (giro Mac build8: 9.2 GiB free before the installer, 3.9 after).
# So, before the download: the old images of JHT that no container uses go (by ID, without -f, only the repositories of JHT by
# exact name, never an image that also has another name, never an image of the version installed now: the person must keep a
# version that starts, and the wrapper removes it only after the new one is here), the machine of a Mac trims its disk, and what
# stays free AFTER the download must keep the agents above the threshold. The image of a stopped JHT container counts as space that
# comes back: the setup moves the team onto the new image and the wrapper then removes the old one when the disk is short. The size
# of the download is read from the registry: the compressed layers of the pinned images for this computer, each layer once (core
# and full share some), less the layers already here, times PULL_DISK_PER_COMPRESSED (the unpacked layers plus the compressed copy
# of the pull: on giro Mac m21 core and full took some 4 GiB of the machine's disk, 5 at the peak, for 1.3 GiB compressed). When
# the registry cannot be read the wrapper's estimates stand in (pull_need_kib: JHT_PULL_CORE_GIB 1, JHT_PULL_FULL_GIB 5).
# Otherwise nothing is downloaded and the person is told how much to free. Space that cannot be measured refuses nothing.
DISK_BLOCK_FREE_PERMILLE=30
DISK_BLOCK_FREE_KIB=8388608
JHT_IMAGE_REPOSITORIES="ghcr.io/leopu00/jht jht localhost/jht"

installer_pull_gib() {
  local gib default
  case "$1" in core) default=1 gib="${JHT_PULL_CORE_GIB:-1}" ;; *) default=5 gib="${JHT_PULL_FULL_GIB:-5}" ;; esac
  case "$gib" in ''|*[!0-9]*) gib="$default" ;; esac
  printf '%s' "$gib"
}

installer_repo_is_jht() {
  local r
  for r in $JHT_IMAGE_REPOSITORIES; do [ "$1" != "$r" ] || return 0; done
  return 1
}

PULL_DISK_PER_COMPRESSED=4

# The platform of the images this computer pulls (the machine of a Mac has the Mac's own).
installer_registry_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'amd64' ;;
    arm64|aarch64) printf 'arm64' ;;
    *) return 1 ;;
  esac
}

# One JSON object of the registry per line, cut before each "mediaType": no jq on a fresh Mac.
installer_json_objects() {
  tr -d ' \t\r\n' | awk '{ gsub(/"mediaType"/, "\n&"); print }'
}

# «<diff_id> <compressed bytes>», one line per layer, of the pinned image $1 (ghcr.io/<repo>@sha256:…) for this computer; 1 when the
# registry cannot be read. Read-only and anonymous, as the pull itself.
installer_registry_layers() {
  local ref="$1" repo digest arch token auth accept manifest config layers diff_ids
  case "$ref" in ghcr.io/*@sha256:*) ;; *) return 1 ;; esac
  command -v curl >/dev/null 2>&1 || return 1
  repo="${ref#ghcr.io/}" repo="${repo%%@*}" digest="${ref#*@}"
  arch="$(installer_registry_arch)" || return 1
  token="$(curl -fsS --max-time 10 "https://ghcr.io/token?scope=repository:$repo:pull" 2>/dev/null | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  [ -n "$token" ] || return 1
  auth="Authorization: Bearer $token"
  accept="Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json"
  manifest="$(curl -fsSL --max-time 15 -H "$auth" -H "$accept" "https://ghcr.io/v2/$repo/manifests/$digest" 2>/dev/null | installer_json_objects)" || return 1
  if printf '%s\n' "$manifest" | grep -q '"manifests":'; then
    digest="$(printf '%s\n' "$manifest" | grep -F "\"architecture\":\"$arch\"" | grep -F '"os":"linux"' | head -n 1 \
      | sed -n 's/.*"digest":"\(sha256:[0-9a-f]*\)".*/\1/p')"
    [ -n "$digest" ] || return 1
    manifest="$(curl -fsSL --max-time 15 -H "$auth" -H "$accept" "https://ghcr.io/v2/$repo/manifests/$digest" 2>/dev/null | installer_json_objects)" || return 1
  fi
  config="$(printf '%s\n' "$manifest" | grep -E '"mediaType":"application/vnd\.(oci\.image\.config|docker\.container\.image)' | head -n 1 \
    | sed -n 's/.*"digest":"\(sha256:[0-9a-f]*\)".*/\1/p')"
  layers="$(printf '%s\n' "$manifest" | grep -E '"mediaType":"application/vnd\.(oci\.image\.layer|docker\.image\.rootfs)' \
    | sed -n 's/.*"size":\([0-9][0-9]*\).*/\1/p')"
  [ -n "$config" ] && [ -n "$layers" ] || return 1
  diff_ids="$(curl -fsSL --max-time 15 -H "$auth" "https://ghcr.io/v2/$repo/blobs/$config" 2>/dev/null | tr -d ' \t\r\n' \
    | sed -n 's/.*"diff_ids":\[\([^]]*\)\].*/\1/p' | tr ',' '\n' | tr -d '"')"
  [ -n "$diff_ids" ] || return 1
  [ "$(printf '%s\n' "$layers" | wc -l)" -eq "$(printf '%s\n' "$diff_ids" | wc -l)" ] || return 1
  paste -d ' ' <(printf '%s\n' "$diff_ids") <(printf '%s\n' "$layers")
}

# The layers (diff_id) of every image already here, one per line.
installer_local_layers() {
  local ids
  ids="$("${RUNTIME_ENGINE[@]}" image ls -q --no-trunc 2>/dev/null | awk '{print $1}' | sort -u)" || return 0
  [ -n "$ids" ] || return 0
  # shellcheck disable=SC2086
  "${RUNTIME_ENGINE[@]}" image inspect --format '{{range .RootFS.Layers}}{{println .}}{{end}}' $ids 2>/dev/null | grep '^sha256:' || true
}

# KiB the download of this install takes on the disk: the image (when it is not here yet) and, at core level, the full one that
# follows. Read from the registry, each layer once and none already here; the estimate of an image whose layers cannot be read.
installer_download_need_kib() {
  local refs="" ref kind gib=0 layers="" here bytes
  if ! "${RUNTIME_ENGINE[@]}" image inspect "$IMAGE" >/dev/null 2>&1; then
    if [ "$RUNTIME_TIER" = core ]; then refs="core $IMAGE"; else refs="full $IMAGE"; fi
  fi
  if [ "$RUNTIME_TIER" = core ] && ! "${RUNTIME_ENGINE[@]}" image inspect "$FULL_IMAGE" >/dev/null 2>&1; then
    refs="$refs
full $FULL_IMAGE"
  fi
  while read -r kind ref; do
    [ -n "$ref" ] || continue
    if here="$(installer_registry_layers "$ref")"; then
      layers="$layers
$here"
    else
      gib=$((gib + $(installer_pull_gib "$kind")))
    fi
  done <<EOF
$refs
EOF
  here="$(installer_local_layers)"
  bytes="$(awk 'FILENAME == ARGV[1] { if ($1 != "") have[$1] = 1; next }
    NF == 2 && !($1 in have) && !($1 in seen) { seen[$1] = 1; total += $2 }
    END { printf "%.0f", total }' <(printf '%s\n' "$here") <(printf '%s\n' "$layers"))"
  printf '%s' $(( gib * 1048576 + (bytes / 1024) * PULL_DISK_PER_COMPRESSED ))
}

# The ID (no prefix) of every image here of the version installed now (the pins in the files of the host runtime: the wrapper, the
# compose file, the tier and extras pins), one per line.
installer_installed_image_ids() {
  local digest id
  [ -d "$RUNTIME_DIR" ] || return 0
  find "$RUNTIME_DIR" -maxdepth 1 -type f -size -4096k -exec grep -ohE 'sha256:[0-9a-f]{64}' {} + 2>/dev/null | sort -u \
    | while IFS= read -r digest; do
        id="$("${RUNTIME_ENGINE[@]}" image inspect --format '{{.Id}}' "ghcr.io/leopu00/jht@$digest" 2>/dev/null | head -n 1)" || continue
        [ -z "$id" ] || printf '%s\n' "${id#sha256:}"
      done
}

# The ID (no prefix) of every image a container uses, one per line, between two empty lines; 1 when they cannot be read.
installer_images_in_use() {
  local ids images=""
  ids="$("${RUNTIME_ENGINE[@]}" container ls -a -q --no-trunc 2>/dev/null)" || return 1
  if [ -n "$ids" ]; then
    # shellcheck disable=SC2086
    images="$("${RUNTIME_ENGINE[@]}" inspect --format '{{.Image}}' $ids 2>/dev/null)" || return 1
  fi
  printf '\n%s\n\n' "$(printf '%s\n' "$images" | sed 's/^sha256://')"
}

# The old images of JHT that no container uses and that are not of the version installed now go; the machine of a Mac trims its
# disk after. Prints nothing; a refusal of the
# engine keeps the image.
installer_remove_unused_old_images() {
  local in_use listing foreign="" id repo plain seen=""
  [ "${JHT_KEEP_OLD_IMAGES:-0}" = "1" ] && return 0
  in_use="$(installer_images_in_use)" || return 0
  # the images of the version installed now are kept as if in use; $( ) drops the trailing newlines: the last ID needs its own
  in_use="$in_use
$(installer_installed_image_ids)
"
  listing="$("${RUNTIME_ENGINE[@]}" image ls --no-trunc --format '{{.ID}} {{.Repository}}' 2>/dev/null)" || return 0
  while IFS=' ' read -r id repo; do
    [ -n "$id" ] || continue
    installer_repo_is_jht "$repo" || foreign="$foreign
${id#sha256:}"
  done <<EOF
$listing
EOF
  while IFS=' ' read -r id repo; do
    [ -n "$id" ] || continue
    installer_repo_is_jht "$repo" || continue
    plain="${id#sha256:}"
    case "$in_use" in *"
$plain
"*) continue ;; esac
    case "$foreign
" in *"
$plain
"*) continue ;; esac
    case "$seen
" in *"
$plain
"*) continue ;; esac
    seen="$seen
$plain"
    "${RUNTIME_ENGINE[@]}" image rm "$plain" >/dev/null 2>&1 || true
  done <<EOF
$listing
EOF
  if podman_machine_mode; then
    podman machine ssh "$PODMAN_MACHINE_NAME" sudo fstrim -a </dev/null >/dev/null 2>&1 || true
  fi
}

# KiB of the JHT images that the stopped JHT containers use and that are not the image of this install: the setup replaces them.
installer_reclaimable_kib() {
  local name image new_id size total=0
  for name in jht; do
    image="$("${RUNTIME_ENGINE[@]}" container inspect --format '{{.Image}}' "$name" 2>/dev/null | head -n 1)" || continue
    [ -n "$image" ] || continue
    new_id="$("${RUNTIME_ENGINE[@]}" image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null | head -n 1)"
    [ "${image#sha256:}" != "${new_id#sha256:}" ] || continue
    "${RUNTIME_ENGINE[@]}" image inspect --format '{{range .RepoTags}}{{println .}}{{end}}{{range .RepoDigests}}{{println .}}{{end}}' "$image" 2>/dev/null \
      | sed -e 's/@.*//' -e 's/:[^/:]*$//' | grep -Fqx -e ghcr.io/leopu00/jht -e jht -e localhost/jht || continue
    size="$("${RUNTIME_ENGINE[@]}" image inspect --format '{{.Size}}' "$image" 2>/dev/null | head -n 1)"
    case "$size" in ''|*[!0-9]*) continue ;; esac
    total=$((total + size / 1024))
  done
  printf '%s' "$total"
}

# «<total KiB> <free KiB>» of the volume that holds $1 (its first ancestor that exists); 1 when it cannot be measured.
installer_disk_total_avail() {
  local target="$1" line total avail
  while [ ! -e "$target" ] && [ "$target" != "/" ] && [ "$target" != "." ]; do target="$(dirname "$target")"; done
  [ -e "$target" ] || return 1
  line="$(df -Pk "$target" 2>/dev/null | awk 'NR==2 {print $2 " " $4}')" || return 1
  read -r total avail <<<"$line"
  case "$total" in ''|*[!0-9]*) return 1 ;; esac
  case "$avail" in ''|*[!0-9]*) return 1 ;; esac
  [ "$total" -gt 0 ] || return 1
  printf '%s %s' "$total" "$avail"
}

# The volumes the download fills: the data folder and, on Linux, the engine's data root; on a Mac the folder of the Podman
# machine's disk image (the engine's own disk is inside the machine and grows on the Mac).
installer_download_volumes() {
  printf '%s\n' "$HOME/.jht"
  case "$OS" in
    macos) printf '%s\n' "${JHT_PODMAN_MACHINE_DIR:-$HOME/.local/share/containers/podman/machine}" ;;
    *) local root; for root in /var/lib/docker /var/lib/containers "$HOME/.local/share/containers"; do [ -d "$root" ] && printf '%s\n' "$root"; done ;;
  esac
}

# 0 = after a download of $1 KiB (less $2 KiB that come back) no measured volume falls under the threshold, or none can be measured.
# The least free KiB in ROOM_FREE_KIB; when short, the KiB to free in ROOM_SHORT_KIB.
ROOM_FREE_KIB="" ROOM_SHORT_KIB=""
installer_room_after_download() {
  local need="$1" back="${2:-0}" volume measure total avail after short pct_short worst=0
  ROOM_FREE_KIB="" ROOM_SHORT_KIB=""
  while IFS= read -r volume; do
    [ -n "$volume" ] || continue
    measure="$(installer_disk_total_avail "$volume")" || continue
    read -r total avail <<<"$measure"
    if [ -z "$ROOM_FREE_KIB" ] || [ "$avail" -lt "$ROOM_FREE_KIB" ]; then ROOM_FREE_KIB="$avail"; fi
    after=$((avail - need + back))
    if [ $((after * 1000)) -lt $((DISK_BLOCK_FREE_PERMILLE * total)) ] && [ "$after" -lt "$DISK_BLOCK_FREE_KIB" ]; then
      short=$((DISK_BLOCK_FREE_KIB - after))
      pct_short=$(( (DISK_BLOCK_FREE_PERMILLE * total + 999) / 1000 - after ))
      [ "$pct_short" -ge "$short" ] || short="$pct_short"
      [ "$short" -le "$worst" ] || worst="$short"
    fi
  done <<EOF
$(installer_download_volumes)
EOF
  [ "$worst" -gt 0 ] || return 0
  ROOM_SHORT_KIB="$worst"
  return 1
}

check_room_for_download() {
  local need back
  set_runtime_engine
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "  ${DIM}[dry-run]${RESET} would require that after the download the agents keep at least %s GiB of disk\n" $((DISK_BLOCK_FREE_KIB / 1048576))
    return 0
  fi
  need="$(installer_download_need_kib)"
  [ "$need" -gt 0 ] || return 0
  back="$(installer_reclaimable_kib)"
  installer_room_after_download "$need" "$back" && return 0
  installer_remove_unused_old_images
  installer_room_after_download "$need" "$back" && return 0
  jht_error_marker disk_low
  printf "  ${RED}✗${RESET} %s%s\n" "$(jht_code_prefix disk_low)" "$(tsf installer.disk_room_short 'Job Hunter Team downloads about %s GiB, and after the download the agents would have less than the %s GiB of disk they need: %s GiB are free now. Free at least %s GiB more (empty the Trash, delete large files you do not need), then run the installer again: nothing was downloaded, and the version of Job Hunter Team you have installed was not touched.' "$(( (need + 1048575) / 1048576 ))" $((DISK_BLOCK_FREE_KIB / 1048576)) "$(( ${ROOM_FREE_KIB:-0} / 1048576 ))" "$(( (ROOM_SHORT_KIB + 1048575) / 1048576 ))")" >&2
  exit 1
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
    fail "$(tsf installer.cannot_list_containers 'Cannot list the running containers with %s: nothing was installed.' "${RUNTIME_ENGINE[*]}")"
  fi
  for name in $TEAM_CONTAINERS; do
    printf '%s\n' "$names" | grep -Fqx "$name" && running="${running:+$running, }$name"
  done
  [ -z "$running" ] && return 0
  jht_error_marker team_running
  # a setup that was finished (its configuration is there): this is an update, and there is no setup to resume
  if [ -f "$HOME/.jht/jht.config.json" ]; then
    printf "  ${RED}✗${RESET} %s%s\n" "$(jht_code_prefix team_running)" "$(tsf installer.team_running_update 'Job Hunter Team is running on this computer (%s). To update it, stop it with «jht down», run the installer again, then start it with «jht up». Nothing was changed: your profile and documents in ~/.jht and ~/Documents/Job Hunter Team stay where they are.' "$running")" >&2
    exit "$TEAM_RUNNING_EXIT"
  fi
  printf "  ${RED}✗${RESET} %s%s\n" "$(jht_code_prefix team_running)" "$(tsf installer.team_running 'Job Hunter Team is running on this computer (%s). If setup was interrupted, resume it with «jht setup» in this terminal; no down is needed. To reinstall instead, stop it with «jht down», run the installer again, then start it with «jht up». Nothing was changed: your profile and documents in ~/.jht and ~/Documents/Job Hunter Team stay where they are.' "$running")" >&2
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
  info "Pulling the test image $IMAGE..."
  "${engine[@]}" pull "$IMAGE" >/dev/null || fail "Cannot pull the test image $IMAGE."
  digests="$("${engine[@]}" image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$IMAGE" 2>/dev/null)" \
    || fail "Cannot inspect the test image $IMAGE."
  printf '%s\n' "$digests" | grep -Fqx "$wanted" \
    || fail "The test image $IMAGE is not $EXPECTED_IMAGE_DIGEST: nothing was installed."
  ok "test image: $wanted"
}

main_docker() {
  detect_system "$TOTAL_STEPS_DOCKER"
  check_free_disk
  install_container_runtime
  verify_docker_works
  refuse_running_team
  # On a Mac the room was checked before the pull of the machine; on Linux `jht setup` pulls, after this installer.
  [ "$OS" = macos ] || check_room_for_download
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
  # The PATH of the shell that launched the installer, before any step adds to it: when it already has BIN_DIR, `jht`
  # works there and the last line has nothing to say.
  local path_had_bin=0
  case ":$PATH:" in *":$BIN_DIR:"*) path_had_bin=1 ;; esac
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
  maybe_onboard; local wizard_result=$?
  [ "$path_had_bin" -eq 1 ] || printf '\n  %s export PATH=%q:"$PATH"\n' "$(ts installer.terminal_run 'In this terminal, run:')" "$BIN_DIR"
  return "$wizard_result"
}

if [ "${JHT_INSTALLER_SOURCE_ONLY:-0}" != "1" ]; then
  main
fi
