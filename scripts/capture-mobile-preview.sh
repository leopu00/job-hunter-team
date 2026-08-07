#!/usr/bin/env bash
# Capture a mobile-width review bundle for any public-site route.
#
# The route is deliberately required instead of baked into this file: page
# naming remains an editorial decision. The script attaches to an existing
# server when possible; otherwise it starts `next dev` and stops only the
# process it created.

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
WEB_DIR="$REPO_ROOT/web"

ROUTE=""
PORT=3011
BASE_URL=""
BASE_URL_EXPLICIT=0
OUTPUT_DIR="$REPO_ROOT/screenshots/mobile-preview"
LANGUAGE="en-US"
SITE_LANG="en"
WIDTH=390
HEIGHT=844
WAIT_MS=1200
MAX_CHAPTERS=8
CHAPTERS=()
SERVER_PID=""
TEMP_DIR=""

usage() {
    cat <<'EOF'
Usage: scripts/capture-mobile-preview.sh --route /path [options]

Required:
  --route PATH             Route to capture, for example /some-guide

Server:
  --base-url URL           Attach only to this existing server
  --port PORT              Auto-start next dev on this port (default: 3011)

Capture:
  --output-dir DIR         Stable output directory (default: screenshots/mobile-preview)
  --chapter ID             Capture this chapter anchor; repeatable
  --max-chapters N         Auto-capture at most N discovered chapters (default: 8)
  --lang LOCALE            Browser and site language (default: en-US)
  --width PX               Viewport width (default: 390)
  --height PX              Viewport height (default: 844)
  --wait-ms MS             Settle time after navigation (default: 1200)

The bundle always contains 00-index-full.png. With no --chapter arguments,
the script discovers section ids beginning with "chapter-" from server HTML
and captures each at mobile viewport size. If a route has no chapters, it
creates 01-main-viewport.png so the harness can still be smoke-tested.
EOF
}

fail() {
    echo "[mobile-preview] ERROR: $*" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --route)
            [[ $# -ge 2 ]] || fail "--route requires a value"
            ROUTE=$2
            shift 2
            ;;
        --base-url)
            [[ $# -ge 2 ]] || fail "--base-url requires a value"
            BASE_URL=${2%/}
            BASE_URL_EXPLICIT=1
            shift 2
            ;;
        --port)
            [[ $# -ge 2 ]] || fail "--port requires a value"
            PORT=$2
            shift 2
            ;;
        --output-dir)
            [[ $# -ge 2 ]] || fail "--output-dir requires a value"
            OUTPUT_DIR=$2
            shift 2
            ;;
        --chapter)
            [[ $# -ge 2 ]] || fail "--chapter requires a value"
            CHAPTERS+=("$2")
            shift 2
            ;;
        --max-chapters)
            [[ $# -ge 2 ]] || fail "--max-chapters requires a value"
            MAX_CHAPTERS=$2
            shift 2
            ;;
        --lang)
            [[ $# -ge 2 ]] || fail "--lang requires a value"
            LANGUAGE=$2
            shift 2
            ;;
        --width)
            [[ $# -ge 2 ]] || fail "--width requires a value"
            WIDTH=$2
            shift 2
            ;;
        --height)
            [[ $# -ge 2 ]] || fail "--height requires a value"
            HEIGHT=$2
            shift 2
            ;;
        --wait-ms)
            [[ $# -ge 2 ]] || fail "--wait-ms requires a value"
            WAIT_MS=$2
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail "unknown option: $1"
            ;;
    esac
done

[[ -n "$ROUTE" ]] || fail "--route is required"
[[ "$ROUTE" == /* ]] || fail "--route must begin with /"
[[ "$PORT" =~ ^[0-9]+$ ]] || fail "--port must be numeric"
[[ "$WIDTH" =~ ^[0-9]+$ && "$HEIGHT" =~ ^[0-9]+$ ]] \
    || fail "--width and --height must be numeric"
[[ "$WAIT_MS" =~ ^[0-9]+$ && "$MAX_CHAPTERS" =~ ^[0-9]+$ ]] \
    || fail "--wait-ms and --max-chapters must be numeric"
SITE_LANG=$(printf '%s' "$LANGUAGE" | sed -E 's/[-_].*$//' | tr '[:upper:]' '[:lower:]')
case "$SITE_LANG" in
    en|it|hu|es|de|fr|pt) ;;
    *) fail "unsupported site language: $LANGUAGE (use en, it, hu, es, de, fr or pt)" ;;
esac

if [[ "$OUTPUT_DIR" != /* ]]; then
    OUTPUT_DIR="$REPO_ROOT/$OUTPUT_DIR"
fi
mkdir -p "$OUTPUT_DIR"

# Un bundle deve descrivere soltanto QUESTO run. Non cancelliamo mai materiale
# precedente: una directory con PNG o manifest già presenti è un errore e va
# sostituita esplicitamente dall'operatore con una directory vuota/nuova.
shopt -s nullglob
EXISTING_PNGS=("$OUTPUT_DIR"/*.png)
shopt -u nullglob
if [[ ${#EXISTING_PNGS[@]} -gt 0 || -e "$OUTPUT_DIR/manifest.txt" ]]; then
    fail "output directory contains an earlier bundle; use an empty/new directory: $OUTPUT_DIR"
fi

if [[ -z "$BASE_URL" ]]; then
    BASE_URL="http://127.0.0.1:$PORT"
fi
PAGE_URL="$BASE_URL$ROUTE"

cleanup() {
    if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
        find "$TEMP_DIR" -depth -delete
    fi
}
trap cleanup EXIT INT TERM

server_ready() {
    curl -fsS --max-time 2 "$BASE_URL/" >/dev/null 2>&1
}

if server_ready; then
    echo "[mobile-preview] attaching to $BASE_URL"
elif [[ "$BASE_URL_EXPLICIT" -eq 1 ]]; then
    fail "no dev server responded at explicit --base-url $BASE_URL"
else
    [[ -x "$WEB_DIR/node_modules/.bin/next" ]] \
        || fail "web dependencies missing; run 'cd web && npm ci' once"
    echo "[mobile-preview] starting next dev on $BASE_URL"
    (
        cd "$WEB_DIR"
        # Webpack also supports a dependency directory shared between local
        # worktrees; Turbopack rejects such symlinks before serving a page.
        npm run dev -- --webpack --hostname 127.0.0.1 --port "$PORT"
    ) >"$OUTPUT_DIR/next-dev.log" 2>&1 &
    SERVER_PID=$!
    for _attempt in $(seq 1 60); do
        server_ready && break
        kill -0 "$SERVER_PID" 2>/dev/null \
            || fail "next dev exited; inspect $OUTPUT_DIR/next-dev.log"
        sleep 1
    done
    server_ready || fail "next dev did not become ready in 60 seconds"
fi

# La prima visita può compilare la route su un Next dev appena avviato. Il
# processo è già vivo, ma 10 secondi non bastano sempre su una cache fredda.
curl -fsS --max-time 30 "$PAGE_URL" >/dev/null \
    || fail "route did not return success: $PAGE_URL"

# LandingI18n intentionally defaults to English and reads `jht-lang` from
# localStorage; browser locale alone does not switch the site's catalog. Seed
# an isolated Playwright storage state so `--lang it-IT` (and the other six
# locales) changes both navigator.language and the actual rendered copy.
command -v node >/dev/null 2>&1 || fail "node is required to prepare browser language state"
TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/jht-mobile-preview.XXXXXX")
STORAGE_STATE="$TEMP_DIR/storage.json"
node - "$STORAGE_STATE" "$BASE_URL" "$SITE_LANG" <<'NODE'
const fs = require("node:fs");
const [path, baseUrl, language] = process.argv.slice(2);
const origin = new URL(baseUrl).origin;
fs.writeFileSync(path, JSON.stringify({
  cookies: [],
  origins: [{
    origin,
    localStorage: [
      { name: "jht-lang", value: language },
      // The fixed cookie banner would cover the bottom of every chapter.
      // Record a necessary-only choice in this isolated preview context.
      { name: "jht:cookie-consent", value: "necessary" },
    ],
  }],
}));
NODE

PW=(npx --yes playwright@1.61.0 screenshot
    --browser chromium
    --lang "$LANGUAGE"
    --load-storage "$STORAGE_STATE"
    --color-scheme dark
    --viewport-size "$WIDTH,$HEIGHT"
    --wait-for-selector main
    --wait-for-timeout "$WAIT_MS"
    --timeout 30000)

capture() {
    local url=$1
    local destination=$2
    shift 2
    echo "[mobile-preview] capture $(basename -- "$destination")"
    if ! "${PW[@]}" "$@" "$url" "$destination"; then
        fail "Playwright capture failed; if Chromium is missing run 'npx playwright@1.61.0 install chromium'"
    fi
}

capture "$PAGE_URL" "$OUTPUT_DIR/00-index-full.png" --full-page

if [[ ${#CHAPTERS[@]} -eq 0 ]]; then
    if ! HTML=$(curl -fsS --max-time 30 "$PAGE_URL"); then
        fail "could not read route HTML to discover chapters: $PAGE_URL"
    fi
    while IFS= read -r chapter_id; do
        [[ -n "$chapter_id" && "$chapter_id" != *-title ]] || continue
        CHAPTERS+=("$chapter_id")
        [[ ${#CHAPTERS[@]} -ge "$MAX_CHAPTERS" ]] && break
    done < <(
        printf '%s' "$HTML" \
            | grep -oE 'id="chapter-[A-Za-z0-9_-]+"' \
            | sed -E 's/^id="|"$//g' \
            | awk '!seen[$0]++' \
            || true
    )
fi

if [[ ${#CHAPTERS[@]} -eq 0 ]]; then
    capture "$PAGE_URL" "$OUTPUT_DIR/01-main-viewport.png"
else
    index=1
    for chapter in "${CHAPTERS[@]}"; do
        chapter=${chapter#\#}
        [[ "$chapter" == chapter-* ]] || chapter="chapter-$chapter"
        safe_name=$(printf '%s' "$chapter" | tr -cs 'A-Za-z0-9_-' '-')
        filename=$(printf '%02d-%s.png' "$index" "$safe_name")
        capture "$PAGE_URL#$chapter" "$OUTPUT_DIR/$filename"
        index=$((index + 1))
    done
fi

{
    echo "route=$ROUTE"
    echo "base_url=$BASE_URL"
    echo "viewport=${WIDTH}x${HEIGHT}"
    echo "browser_language=$LANGUAGE"
    echo "site_language=$SITE_LANG"
    find "$OUTPUT_DIR" -maxdepth 1 -type f -name '*.png' -print \
        | sed "s#^$OUTPUT_DIR/##" \
        | sort
} >"$OUTPUT_DIR/manifest.txt"

echo "[mobile-preview] READY: $OUTPUT_DIR"
