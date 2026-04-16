#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# Job Hunter Team — Pre-release version consistency check
#
# Verifies that the git tag matches the "version" field in both
# package.json (root) and desktop/package.json. Run as the first
# step of the release workflow: electron-builder uses desktop's
# version for artifactName, so a mismatch produces assets named
# after a stale version (e.g. tag v0.1.8 → asset 0.1.7-windows.exe).
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

if git rev-parse --show-toplevel >/dev/null 2>&1; then
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
DESKTOP_PKG="$ROOT/desktop/package.json"

ROOT_VERSION="$(read_version "$ROOT_PKG")"
DESKTOP_VERSION="$(read_version "$DESKTOP_PKG")"

info "tag:      $TAG (version $TAG_VERSION)"
info "root:     $ROOT_VERSION  ($ROOT_PKG)"
info "desktop:  $DESKTOP_VERSION  ($DESKTOP_PKG)"

mismatch=0
if [ "$ROOT_VERSION" != "$TAG_VERSION" ]; then
  error "root package.json version ($ROOT_VERSION) does not match tag ($TAG_VERSION)"
  mismatch=1
fi
if [ "$DESKTOP_VERSION" != "$TAG_VERSION" ]; then
  error "desktop/package.json version ($DESKTOP_VERSION) does not match tag ($TAG_VERSION)"
  mismatch=1
fi

if [ "$mismatch" -ne 0 ]; then
  error "bump the package.json files, commit, re-tag, and push the tag again"
  exit 3
fi

info "OK — all versions aligned with tag $TAG"
