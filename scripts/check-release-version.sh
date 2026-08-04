#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# Job Hunter Team — Pre-release version consistency check
#
# Verifies that the git tag matches the root package and every Godot
# application metadata field. Godot is the only desktop application.
#
# Usage:
#   scripts/check-release-version.sh [TAG]
#
# TAG resolution order:
#   1. First positional argument
#   2. $GITHUB_REF_NAME (set by GitHub Actions)
#   3. git describe --exact-match --tags HEAD
#
# Exit codes:
#   0  versions aligned
#   1  no tag resolvable
#   2  tag format invalid (expected vX.Y.Z[-prerelease])
#   3  version mismatch
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

error() { echo "[check-release-version] ERROR: $*" >&2; }
info()  { echo "[check-release-version] $*"; }

TAG="${1:-${GITHUB_REF_NAME:-}}"
if [ -z "$TAG" ] && git rev-parse --git-dir >/dev/null 2>&1; then
  TAG="$(git describe --exact-match --tags HEAD 2>/dev/null || true)"
fi

if [ -z "$TAG" ]; then
  error "no tag provided (pass as first arg, set GITHUB_REF_NAME, or tag HEAD)"
  exit 1
fi

if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  error "tag '$TAG' does not match the expected format 'vX.Y.Z' (optional '-prerelease' suffix)"
  exit 2
fi

TAG_VERSION="${TAG#v}"

if [ -n "${JHT_RELEASE_ROOT:-}" ]; then
  ROOT="$JHT_RELEASE_ROOT"
elif git rev-parse --show-toplevel >/dev/null 2>&1; then
  ROOT="$(git rev-parse --show-toplevel)"
else
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

read_version() {
  local file="$1"
  if [ ! -f "$file" ]; then
    error "missing $file"
    return 1
  fi
  awk -F'"' '/^[[:space:]]*"version"[[:space:]]*:/ {print $4; exit}' "$file"
}

ROOT_PKG="$ROOT/package.json"
GAME_PROJECT="$ROOT/game/project.godot"
GAME_PRESETS="$ROOT/game/export_presets.cfg"
NSIS_INSTALLER="$ROOT/game/installer/windows.nsi"

# Ogni componente che può finire in un artefatto o nel payload segue la
# versione della release. tests/js è intenzionalmente escluso: è un runner
# interno, non viene distribuito.
VERSIONED_PACKAGES=(
  package.json
  web/package.json
  cli/package.json
  cli/wizard/package.json
  shared/package.json
  shared/cron/package.json
  e2e/package.json
  desktop/app-payload/package.json
  desktop/app-payload/cli/package.json
  desktop/app-payload/cli/wizard/package.json
  desktop/app-payload/web/package.json
  desktop/app-payload/shared/cron/package.json
  desktop/app-payload/shared/deploy/package.json
  desktop/app-payload/shared/providers/package.json
  desktop/app-payload/shared/telegram/package.json
  desktop/app-payload/shared/tools/package.json
)

# Questi file vengono eseguiti o consegnati agli utenti. Il canale dev
# scripts/dev-up.sh resta deliberatamente su latest e non appartiene al tag.
PINNED_IMAGE_ASSERTIONS=(
  'docker-compose.yml|image: ${JHT_IMAGE:-ghcr.io/leopu00/jht:__VERSION__}'
  'game/scripts/backend/payloads/runtime_compose.yml|image: ${JHT_IMAGE:-ghcr.io/leopu00/jht:__VERSION__}'
  'game/scripts/setup/setup_service.gd|const DEFAULT_RUNTIME_IMAGE := "ghcr.io/leopu00/jht:__VERSION__"'
  "cli/src/commands/container.js|'ghcr.io/leopu00/jht:__VERSION__'"
  'scripts/install.sh|IMAGE="${JHT_IMAGE:-ghcr.io/leopu00/jht:__VERSION__}"'
  'web/public/install.sh|IMAGE="${JHT_IMAGE:-ghcr.io/leopu00/jht:__VERSION__}"'
  "scripts/install.ps1|else { 'ghcr.io/leopu00/jht:__VERSION__' }"
  "web/public/install.ps1|else { 'ghcr.io/leopu00/jht:__VERSION__' }"
  'scripts/jht-wrapper.sh|${candidate_ref:-${JHT_IMAGE:-ghcr.io/leopu00/jht:__VERSION__}}'
  "scripts/jht-wrapper.ps1|else { 'ghcr.io/leopu00/jht:__VERSION__' }"
  'docs/guides/CLI-INSTALL.md|`ghcr.io/leopu00/jht:__VERSION__`'
  '.env.example|# {ghcr.io/leopu00/jht:__VERSION__}'
)

# Copie legacy del payload desktop che mostrano la versione senza poter
# importare il package.json al build time.
PAYLOAD_VERSION_FILES=(
  web/app/\(protected\)/cron/page.tsx
  web/app/\(protected\)/setup/page.tsx
  desktop/app-payload/web/app/cron/page.tsx
  desktop/app-payload/web/app/page.tsx
  desktop/app-payload/web/app/setup/page.tsx
  desktop/app-payload/web/app/download/page.tsx
  desktop/app-payload/web/app/download/layout.tsx
  desktop/app-payload/web/app/api/download/route.ts
  desktop/app-payload/web/app/demo/page.tsx
)

STABLE_SOURCE_ASSERTIONS=(
  'scripts/install.sh|BRANCH="${JHT_BRANCH:-production}"'
  'scripts/install.sh|export JHT_IMAGE="$IMAGE"'
  "scripts/install.ps1|else { 'production' }"
  'scripts/install.ps1|$env:JHT_IMAGE = $Image'
  'scripts/jht-wrapper.sh|${JHT_BRANCH:-production}'
  'scripts/jht-wrapper.ps1|job-hunter-team/production'
)

ROOT_VERSION="$(read_version "$ROOT_PKG")"
GAME_VERSION="$(awk -F'=' '/^config\/version=/{gsub(/"/, "", $2); print $2; exit}' "$GAME_PROJECT")"
GAME_MAC_SHORT="$(awk -F'=' '/^application\/short_version=/{gsub(/"/, "", $2); print $2; exit}' "$GAME_PRESETS")"
GAME_MAC_VERSION="$(awk -F'=' '/^application\/version=/{gsub(/"/, "", $2); print $2; exit}' "$GAME_PRESETS")"
GAME_WIN_FILE="$(awk -F'=' '/^application\/file_version=/{gsub(/"/, "", $2); print $2; exit}' "$GAME_PRESETS")"
GAME_WIN_PRODUCT="$(awk -F'=' '/^application\/product_version=/{gsub(/"/, "", $2); print $2; exit}' "$GAME_PRESETS")"
GAME_NUMERIC_VERSION="${TAG_VERSION%%-*}.0"
NSIS_VERSION="$(awk -F'"' '/^[[:space:]]*!define VERSION /{print $2; exit}' "$NSIS_INSTALLER")"
CONTAINER_IMAGE="ghcr.io/leopu00/jht:$TAG_VERSION"

info "tag:      $TAG (version $TAG_VERSION)"
info "root:     $ROOT_VERSION  ($ROOT_PKG)"
info "game:     $GAME_VERSION  ($GAME_PROJECT)"
info "game mac: $GAME_MAC_SHORT / $GAME_MAC_VERSION"
info "game win: $GAME_WIN_FILE / $GAME_WIN_PRODUCT"
info "NSIS:     $NSIS_VERSION"
info "container: $CONTAINER_IMAGE"

mismatch=0
if [ "$ROOT_VERSION" != "$TAG_VERSION" ]; then
  error "root package.json version ($ROOT_VERSION) does not match tag ($TAG_VERSION)"
  mismatch=1
fi
if [ "$GAME_VERSION" != "$TAG_VERSION" ] || \
   [ "$GAME_MAC_SHORT" != "$TAG_VERSION" ] || \
   [ "$GAME_MAC_VERSION" != "$TAG_VERSION" ]; then
  error "Godot project/macOS metadata does not match tag ($TAG_VERSION)"
  mismatch=1
fi
if [ "$GAME_WIN_FILE" != "$GAME_NUMERIC_VERSION" ] || \
   [ "$GAME_WIN_PRODUCT" != "$GAME_NUMERIC_VERSION" ]; then
  error "Godot Windows metadata must be numeric $GAME_NUMERIC_VERSION"
  mismatch=1
fi

for relative in "${VERSIONED_PACKAGES[@]}"; do
  package_file="$ROOT/$relative"
  package_version="$(read_version "$package_file")"
  if [ "$package_version" != "$TAG_VERSION" ]; then
    error "$relative version ($package_version) does not match tag ($TAG_VERSION)"
    mismatch=1
  fi

  lock_file="$(dirname "$package_file")/package-lock.json"
  if [ -f "$lock_file" ]; then
    lock_versions="$(node - "$lock_file" <<'NODE'
const lock = require(process.argv[2]);
process.stdout.write(`${lock.version ?? ""}\t${lock.packages?.[""]?.version ?? ""}`);
NODE
)"
    lock_version="${lock_versions%%$'\t'*}"
    lock_root_version="${lock_versions#*$'\t'}"
    if [ "$lock_version" != "$TAG_VERSION" ] || [ "$lock_root_version" != "$TAG_VERSION" ]; then
      error "${lock_file#"$ROOT/"} versions ($lock_version / $lock_root_version) do not match tag ($TAG_VERSION)"
      mismatch=1
    fi
  fi
done

if [ "$NSIS_VERSION" != "$TAG_VERSION" ]; then
  error "NSIS fallback version ($NSIS_VERSION) does not match tag ($TAG_VERSION)"
  mismatch=1
fi

for assertion in "${PINNED_IMAGE_ASSERTIONS[@]}"; do
  relative="${assertion%%|*}"
  expected="${assertion#*|}"
  expected="${expected//__VERSION__/$TAG_VERSION}"
  if ! grep -Fq "$expected" "$ROOT/$relative"; then
    error "$relative does not contain the pinned runtime field for $CONTAINER_IMAGE"
    mismatch=1
  fi
done

for relative in "${PAYLOAD_VERSION_FILES[@]}"; do
  if ! grep -Fq "$TAG_VERSION" "$ROOT/$relative"; then
    error "$relative does not expose payload version $TAG_VERSION"
    mismatch=1
  fi
done

for assertion in "${STABLE_SOURCE_ASSERTIONS[@]}"; do
  relative="${assertion%%|*}"
  expected="${assertion#*|}"
  if ! grep -Fq "$expected" "$ROOT/$relative"; then
    error "$relative does not use the stable production source or enforce JHT_IMAGE"
    mismatch=1
  fi
done

if ! cmp -s "$ROOT/scripts/install.sh" "$ROOT/web/public/install.sh"; then
  error "web/public/install.sh drifted from scripts/install.sh"
  mismatch=1
fi
if ! cmp -s "$ROOT/scripts/install.ps1" "$ROOT/web/public/install.ps1"; then
  error "web/public/install.ps1 drifted from scripts/install.ps1"
  mismatch=1
fi
if ! grep -Fq "## [$TAG_VERSION]" "$ROOT/CHANGELOG.md"; then
  error "CHANGELOG.md has no release section for $TAG_VERSION"
  mismatch=1
fi

if [ "$mismatch" -ne 0 ]; then
  error "align component, lock, installer and container versions before tagging"
  exit 3
fi

info "OK — all versions aligned with tag $TAG"
