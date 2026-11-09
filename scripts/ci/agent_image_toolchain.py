#!/usr/bin/env python3
"""What an agent needs to start is in the image, pi is baked at its pin, and Codex installs at its pin.

The launcher proof of 08/10 died before any agent started: `tmux
new-session` answered rc=127 in an image without tmux, and nothing had said
so before the run. On the image just built, before it is pushed, as the
image's own user and with no network:

  - tmux runs and opens a session (the binary alone is not enough: a missing
    library fails only when the server starts);
  - start-agent.sh and entrypoint.sh are executable, spawn-lib.sh (sourced)
    is readable, and all three parse with `bash -n`;
  - the installers of the provider CLIs are on PATH: node and npm (claude,
    codex), python3 and pip3 (kimi), plus bash, jht, git and curl;
  - the image resolves the same provider pins as this checkout's
    shared/config/provider-versions.json, through the product's own
    shared/runtime/provider-pins.js: a missing or unreadable manifest makes
    it fall back to `latest`, which is the drift the pin exists to prevent;
  - pi (the harness baked into the image, from the reviewed lock) runs, says the
    version the launcher demands (JHT_PI_VERSION), accepts the flags jht_pi_args
    gives it, and fd and rg are on the PATH so it downloads nothing at its first start.

The other provider CLIs are not baked into the image (Dockerfile: they install on
first start into /opt/jht-deps). With `--install codex` a second container,
with network, runs `jht providers update codex` the way the product does;
`codex --version` must report the pinned version, and the installed CLI must
accept the flags the launcher gives it (start-agent.sh): `--yolo`, `--search`
and the `-c` overrides, among them project_doc_max_bytes=131072.
Nothing calls the model and no login is needed:

  - the flags are parsed with `--help` last: clap refuses an unknown flag
    before it reaches --help (rc=2), so a refused flag is a red check;
  - the `-c` values are loaded with `codex features list`, which reads the
    configuration and fails on a value it cannot parse.

Each probe has a control that must be refused (an unknown flag, a value that
is not a number): if the control passes too, the probe proved nothing on this
version of the CLI and the check is red. The install seconds are printed.

Usage:
  agent_image_toolchain.py IMAGE [--install codex]
Exit 0 when every check passes; 1 with one FAIL line per broken check.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PINS = ROOT / "shared" / "config" / "provider-versions.json"

# Runs inside the container. Every FAIL line starts with a stable tag in
# brackets: the tests assert on the tags, not on the wording. JHT_APP is /app
# in the image; tests/test_agent_image_toolchain.py points it at a fake tree.
INSIDE = r"""
set -u
app="${JHT_APP:-/app}"
fails=0
fail() { echo "FAIL [$1] $2"; fails=$((fails + 1)); }
if version="$(tmux -V 2>&1)"; then
  echo "tmux: $version"
  sock="jht-image-check-$$"
  if tmux -L "$sock" new-session -d -s probe 'sleep 30' 2>/dev/null \
    && tmux -L "$sock" has-session -t probe 2>/dev/null; then
    :
  else
    fail tmux-session "tmux cannot open a session"
  fi
  tmux -L "$sock" kill-server 2>/dev/null
else
  fail tmux "tmux does not run: $version"
fi
for script in .launcher/start-agent.sh .launcher/entrypoint.sh .launcher/spawn-lib.sh; do
  path="$app/$script"
  case "$script" in
    */spawn-lib.sh) [ -r "$path" ] || fail launcher "$script is absent" ;;
    *) [ -x "$path" ] || fail launcher "$script is absent or not executable" ;;
  esac
  if [ -r "$path" ] && ! bash -n "$path" 2>/dev/null; then fail launcher-syntax "$script does not parse"; fi
done
for tool in bash node npm python3 pip3 jht git curl; do
  command -v "$tool" >/dev/null 2>&1 || fail tool "$tool is not on PATH"
done
# pi is the one provider harness baked into the image (Dockerfile, /opt/jht-pi, from the
# reviewed lock). It must run, be the version the launcher demands, accept the flags
# the launcher gives it, and find fd and rg on the PATH (else it downloads them from
# GitHub at its first start). `pi --help` after the flags: an unknown flag does not
# change its exit status, it prints "Unknown option", so that is what is looked for;
# the control (a flag that does not exist) must be refused the same way.
export PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0
export PI_CODING_AGENT_DIR="${TMPDIR:-/tmp}/jht-image-check-pi-$$"
if [ -r "$app/.launcher/spawn-lib.sh" ]; then
  want_pi="$(bash -c '. "$1" >/dev/null 2>&1; printf %s "$JHT_PI_VERSION"' _ "$app/.launcher/spawn-lib.sh")"
  if got_pi="$(pi --version 2>&1)"; then
    set -- $got_pi
    got_pi="${1:-}"
    echo "pi: $got_pi"
    if [ -z "$want_pi" ] || [ "$got_pi" != "$want_pi" ]; then
      fail pi-version "pi says '$got_pi', the launcher needs '$want_pi'"
    fi
    pi_flags="$(bash -c '. "$1" >/dev/null 2>&1; jht_pi_args /tmp/jht-image-check gpt-5.6-terra high' _ "$app/.launcher/spawn-lib.sh")"
    if [ -z "$pi_flags" ]; then
      fail pi-flags "the launcher gives no pi flags (jht_pi_args)"
    else
      control="$(pi --jht-not-a-flag --help 2>&1 >/dev/null)"
      case "$control" in
        *"Unknown option"*) ;;
        *) fail pi-flags-probe "pi accepts an unknown flag before --help: the flag probe proves nothing" ;;
      esac
      refused="$(eval "pi $pi_flags --help" 2>&1 >/dev/null)"
      case "$refused" in
        *"Unknown option"*|*Invalid*|*"Error:"*) fail pi-flags "pi refuses the launcher flags ($pi_flags): $refused" ;;
      esac
    fi
  else
    fail pi "pi does not run: $got_pi"
  fi
else
  echo "pi: not checked, the launcher library is absent (reported above)"
fi
command -v rg >/dev/null 2>&1 || fail pi-tools "rg is not on PATH: pi would download it at its first start"
command -v fdfind >/dev/null 2>&1 || command -v fd >/dev/null 2>&1 \
  || fail pi-tools "fd (fdfind) is not on PATH: pi would download it at its first start"
resolved="$(node --input-type=module -e "
import { pinnedVersion } from '$app/shared/runtime/provider-pins.js';
for (const t of ['claude', 'codex', 'kimi']) console.log(t + '=' + pinnedVersion(t));
" 2>&1)" || fail pin "the image cannot resolve the provider pins: $resolved"
for expected in $JHT_EXPECTED_PINS; do
  case "
$resolved
" in
    *"
$expected
"*) ;;
    *) fail pin "expected $expected, the image resolves: $(echo $resolved)" ;;
  esac
done
echo "checks done: $fails failed"
[ "$fails" = 0 ]
"""

# Runs in the install container: $1 is the provider, the rest are the -c
# overrides and the flags of the launcher, split by a lone "--".
INSTALL = r"""
set -u
target="$1"; shift
overrides=""
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do overrides="$overrides -c $1"; shift; done
[ "$#" -gt 0 ] && shift
flags="$*"
export CODEX_HOME="$(mktemp -d)"
fails=0
fail() { echo "FAIL [$1] $2"; fails=$((fails + 1)); }
jht providers update "$target" || { echo "FAIL [install] jht providers update $target exited $?"; exit 1; }
echo "VERSION: $("$target" --version 2>&1 | tail -n 1)"
if "$target" --jht-not-a-flag --help >/dev/null 2>&1; then
  fail flags-probe "$target accepts an unknown flag before --help: the flag probe proves nothing"
elif ! out="$("$target" $flags $overrides --help 2>&1 >/dev/null)"; then
  fail flags "$target refuses the launcher flags ($flags $overrides): $out"
fi
if "$target" -c project_doc_max_bytes=not_a_number features list >/dev/null 2>&1; then
  fail config-probe "$target loads a project_doc_max_bytes that is not a number: the config probe proves nothing"
elif ! out="$("$target" $overrides features list 2>&1 >/dev/null)"; then
  fail config "$target refuses the launcher overrides ($overrides): $out"
fi
exit "$fails"
"""

# What start-agent.sh gives Codex (spawn-lib.sh for the prompt budget, e104f0e10;
# --search for the web-search roles, 7f891f9d3). Fixed here, not read from the
# launcher, so the image check asks the CLI before those commits are merged:
# it is the check that says whether the pinned CLI accepts them.
# tests/test_agent_image_toolchain.py keeps it equal to the launcher once they are.
CODEX_OVERRIDES = [
    "model_reasoning_effort=high", "project_doc_max_bytes=131072",
    "notice.hide_rate_limit_model_nudge=true", "check_for_update_on_startup=false",
]
CODEX_FLAGS = ["--yolo", "--search"]


def expected_pins() -> str:
    pins = json.loads(PINS.read_text(encoding="utf-8"))["pins"]
    return " ".join(f"{target}={pins[target]['version']}" for target in ("claude", "codex", "kimi"))


def check_contents(image: str) -> int:
    cmd = [
        "docker", "run", "--rm", "--network", "none", "--entrypoint", "/bin/sh",
        "-e", f"JHT_EXPECTED_PINS={expected_pins()}",
        image, "-c", INSIDE,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    return 0 if result.returncode == 0 else 1


def check_install(image: str, target: str) -> int:
    pinned = json.loads(PINS.read_text(encoding="utf-8"))["pins"][target]["version"]
    overrides, flags = CODEX_OVERRIDES, CODEX_FLAGS
    started = time.monotonic()
    result = subprocess.run(
        ["docker", "run", "--rm", "--entrypoint", "/bin/sh", image, "-c", INSTALL, "sh",
         target, *overrides, "--", *flags],
        capture_output=True, text=True, timeout=600,
    )
    seconds = time.monotonic() - started
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    print(f"{target} install and flag checks: {seconds:.1f} s")
    code = 0 if result.returncode == 0 else 1
    version = next((line[len("VERSION: "):] for line in result.stdout.splitlines() if line.startswith("VERSION: ")), "")
    if result.returncode == 0 and pinned not in version.split():
        # codex prints "codex-cli 0.147.0": the version is a word of the line.
        print(f"FAIL [install-version] {target} --version says {version!r}, the pin is {pinned}")
        code = 1
    return code


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("image")
    parser.add_argument("--install", choices=["codex"], help="also install this provider CLI at its pin")
    args = parser.parse_args(argv)
    code = check_contents(args.image)
    if args.install:
        code |= check_install(args.image, args.install)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
