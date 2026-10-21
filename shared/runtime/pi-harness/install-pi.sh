#!/usr/bin/env bash
# Installa il pi della release (l'harness di JHT_AGENT_HARNESS_<RUOLO>=pi) dal
# lock di questa cartella: una versione esatta, ogni dipendenza con la sua
# integrity sha512, nessuno script d'installazione.
#
# Prima di installare controlla che package.json e package-lock.json siano
# quelli rivisti (sha256 qui sotto) e che il Node della macchina soddisfi il
# minimo che pi dichiara nel lock. Installa in una cartella per versione, la
# rende visibile come /opt/jht-deps/bin/pi solo dopo che `pi --version` ha
# risposto la versione attesa, e non tocca un'installazione già verificata.
#
# Alzare pi: cambiare la versione in package.json, rigenerare il lock con
# `npm install --package-lock-only --ignore-scripts`, passarlo a osv-scanner,
# aggiornare i due sha256 e JHT_PI_VERSION in .launcher/spawn-lib.sh.
# tests/test_pi_harness_lock.py tiene insieme le quattro cose.
#
# Uso: install-pi.sh            (prefisso di default /opt/jht-deps)
#      JHT_PI_PREFIX=/altro install-pi.sh
set -euo pipefail

readonly PI_VERSION="1.3.0"
readonly PACKAGE_JSON_SHA256="89c5e060e5856ac41a0c7d3464e9dc2e1e91e5256432af7dee9ab69763ab95f0"
readonly PACKAGE_LOCK_SHA256="35b8b8243d57cf2be11c41dd1e3f0267e6ddc05b838601a4e1642f913ad8e786"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${JHT_PI_PREFIX:-/opt/jht-deps}"
TARGET="$PREFIX/pi/$PI_VERSION"
LINK="$PREFIX/bin/pi"

die() {
  printf 'install-pi: %s\n' "$*" >&2
  exit 2
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

pi_answers() {
  [ -x "$1/node_modules/.bin/pi" ] || return 1
  [ "$(PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 "$1/node_modules/.bin/pi" --version 2>/dev/null \
        | tr -d '[:space:]')" = "$PI_VERSION" ]
}

[ "$(sha256_of "$HERE/package.json")" = "$PACKAGE_JSON_SHA256" ] \
  || die "package.json is not the reviewed one for pi $PI_VERSION"
[ "$(sha256_of "$HERE/package-lock.json")" = "$PACKAGE_LOCK_SHA256" ] \
  || die "package-lock.json is not the reviewed one for pi $PI_VERSION"

command -v node >/dev/null 2>&1 || die "node is not installed"
command -v npm >/dev/null 2>&1 || die "npm is not installed"

# Il minimo di Node lo dice pi stesso nel lock (`engines.node`, oggi
# ">=22.19.0"). Solo la forma ">=X.Y.Z" è capita: qualunque altra ferma
# l'installazione invece di indovinare.
node - "$HERE/package-lock.json" <<'NODE' || exit 2
const lock = require(process.argv[2]);
const pi = lock.packages["node_modules/@earendil-works/pi-coding-agent"];
const wanted = (pi && pi.engines && pi.engines.node) || "";
const match = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(wanted.trim());
if (!match) {
  console.error(`install-pi: pi asks for node '${wanted}', a form this script does not read`);
  process.exit(1);
}
const need = match.slice(1).map(Number);
const have = process.versions.node.split(".").map(Number);
for (let i = 0; i < 3; i++) {
  if (have[i] > need[i]) process.exit(0);
  if (have[i] < need[i]) {
    console.error(`install-pi: node ${process.versions.node} is older than the ${wanted} pi needs`);
    process.exit(1);
  }
}
NODE

if pi_answers "$TARGET"; then
  printf 'install-pi: pi %s already installed at %s\n' "$PI_VERSION" "$TARGET"
else
  [ ! -e "$TARGET" ] || die "refusing to replace $TARGET: it exists but is not a working pi $PI_VERSION"
  mkdir -p "$PREFIX/pi"
  STAGE="$(mktemp -d "$PREFIX/pi/.stage-$PI_VERSION.XXXXXX")"
  trap 'rm -rf -- "$STAGE"' EXIT
  cp "$HERE/package.json" "$HERE/package-lock.json" "$STAGE/"
  (cd "$STAGE" && npm ci --ignore-scripts --no-audit --no-fund --loglevel=warn)
  pi_answers "$STAGE" || die "the installed pi does not answer $PI_VERSION"
  mv "$STAGE" "$TARGET"
  trap - EXIT
  printf 'install-pi: installed pi %s at %s\n' "$PI_VERSION" "$TARGET"
fi

mkdir -p "$PREFIX/bin"
ln -sfn "$TARGET/node_modules/.bin/pi" "$LINK"
printf 'install-pi: %s -> %s\n' "$LINK" "$TARGET/node_modules/.bin/pi"
