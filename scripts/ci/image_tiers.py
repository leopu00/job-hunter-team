#!/usr/bin/env python3
"""The two images of one build (core and full) say what they are and carry the same code.

The Dockerfile builds `core` and `full` from one file (T307 A). Before they are pushed, with
both loaded in the local engine, this checks what no single image can prove about itself:

  [tier]      each image's ENV JHT_IMAGE_TIER is the one it is supposed to be;
  [tools]     core has none of the tools of full, full has all of them;
  [sweep]     tool_health.py inside core reports every tool NOT_INSTALLED and exits 0;
  [revision]  both carry the same org.opencontainers.image.revision (the commit), and it is
              the expected one when --revision is given;
  [content]   the code (/app), Pi (/opt/jht-pi), the users, the groups and the links that
              point into them are identical byte for byte: neither image carries code the
              other one does not;
  [size]      core is much smaller than full (a core that grew back is a core that lost
              its reason).

Usage:  image_tiers.py CORE_IMAGE FULL_IMAGE [--revision SHA]
Exit 0 when everything holds; 1 with one FAIL line per broken check, each starting with a
stable tag in brackets (the tests assert on the tags).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

TOOLS = ("chromium", "openbox", "Xvfb", "x11vnc", "websockify", "pandoc", "wkhtmltopdf", "ffmpeg", "tesseract", "playwright")
REVISION_LABEL = "org.opencontainers.image.revision"
MIN_SAVING = 0.4  # core must weigh at most 60% of full

# Runs inside each image. Prints a single sha256 per subject: the files of the code and of Pi
# (names, modes, owners and bytes), the account lines of the three users of the product, and the
# links of /usr/local/bin that point into /app or /opt/jht-pi (the links of the tools do not count).
CONTENT_PROBE = r"""
set -eu
hash_tree() { find "$1" -xdev \( -type f -o -type l \) -printf '%P %m %U:%G %l\n' | LC_ALL=C sort | sha256sum | cut -d' ' -f1; }
echo "app-names $(hash_tree /app)"
echo "app-bytes $(find /app -xdev -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | cut -d' ' -f1 | sha256sum | cut -d' ' -f1)"
echo "pi-names $(hash_tree /opt/jht-pi)"
echo "pi-bytes $(find /opt/jht-pi -xdev -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | cut -d' ' -f1 | sha256sum | cut -d' ' -f1)"
echo "users $(getent passwd jht jhtbroker jhttelegram | sha256sum | cut -d' ' -f1)"
echo "groups $(getent group jht jhtbroker jhttelegram | sha256sum | cut -d' ' -f1)"
echo "links $(find /usr/local/bin -maxdepth 1 -type l \( -lname '/app/*' -o -lname '/opt/jht-pi/*' \) -printf '%f %l\n' | LC_ALL=C sort | sha256sum | cut -d' ' -f1)"
"""


# docker in CI; a machine with only podman sets JHT_CONTAINER_ENGINE=podman (same arguments, same JSON).
ENGINE = os.environ.get("JHT_CONTAINER_ENGINE", "docker")


def docker(*args: str, input_text: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run([ENGINE, *args], capture_output=True, text=True, input=input_text)


def inspect(image: str) -> dict:
    out = docker("image", "inspect", image)
    if out.returncode != 0:
        raise SystemExit(f"FAIL [image] {image} is not in the local engine: {out.stderr.strip()[:200]}")
    return json.loads(out.stdout)[0]


def env_value(info: dict, name: str) -> str | None:
    for item in info.get("Config", {}).get("Env") or []:
        key, _, value = item.partition("=")
        if key == name:
            return value
    return None


def run_in(image: str, script: str) -> subprocess.CompletedProcess:
    return docker("run", "--rm", "--entrypoint", "bash", "-i", image, "-s", input_text=script)


def tools_present(image: str) -> set[str]:
    probe = "for b in %s; do command -v \"$b\" >/dev/null 2>&1 && echo \"$b\"; done; exit 0" % " ".join(TOOLS)
    out = run_in(image, probe)
    return set(out.stdout.split())


def content_digests(image: str) -> dict[str, str]:
    out = run_in(image, CONTENT_PROBE)
    if out.returncode != 0:
        raise SystemExit(f"FAIL [content] the probe failed in {image}: {out.stderr.strip()[:300]}")
    return dict(line.split(" ", 1) for line in out.stdout.splitlines() if " " in line)


def compare(core: dict[str, str], full: dict[str, str]) -> list[str]:
    fails = [f"FAIL [content] {key} differs between core and full" for key in sorted(set(core) | set(full)) if core.get(key) != full.get(key)]
    if not core:
        fails.append("FAIL [content] the probe printed nothing")
    return fails


def check(core_image: str, full_image: str, revision: str | None) -> list[str]:
    fails: list[str] = []
    core, full = inspect(core_image), inspect(full_image)
    for name, info, tier in (("core", core, "core"), ("full", full, "full")):
        if env_value(info, "JHT_IMAGE_TIER") != tier:
            fails.append(f"FAIL [tier] the {name} image says JHT_IMAGE_TIER={env_value(info, 'JHT_IMAGE_TIER')!r}, not {tier!r}")
    in_core, in_full = tools_present(core_image), tools_present(full_image)
    fails += [f"FAIL [tools] {tool} is in the core image" for tool in sorted(in_core)]
    fails += [f"FAIL [tools] {tool} is missing from the full image" for tool in sorted(set(TOOLS) - in_full)]
    sweep = run_in(core_image, "python3 /app/shared/skills/tool_health.py")
    try:
        statuses = {name: tool["status"] for name, tool in json.loads(sweep.stdout)["tools"].items()}
    except (ValueError, KeyError):
        statuses = {}
    if sweep.returncode != 0 or not statuses or set(statuses.values()) != {"NOT_INSTALLED"}:
        fails.append(f"FAIL [sweep] tool_health in core: exit {sweep.returncode}, statuses {sorted(set(statuses.values()))}")
    labels = {n: (i.get("Config", {}).get("Labels") or {}).get(REVISION_LABEL) for n, i in (("core", core), ("full", full))}
    if not labels["core"] or labels["core"] != labels["full"]:
        fails.append(f"FAIL [revision] core {labels['core']!r} and full {labels['full']!r} must carry the same commit")
    elif revision and labels["core"] != revision:
        fails.append(f"FAIL [revision] the images carry {labels['core']!r}, not {revision!r}")
    fails += compare(content_digests(core_image), content_digests(full_image))
    if core["Size"] > full["Size"] * (1 - MIN_SAVING):
        fails.append(f"FAIL [size] core is {core['Size'] / 1e6:.0f} MB against {full['Size'] / 1e6:.0f} MB of full: not smaller enough")
    print(f"core {core['Size'] / 1e6:.0f} MB · full {full['Size'] / 1e6:.0f} MB · revision {labels['core']}")
    return fails


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("core_image")
    parser.add_argument("full_image")
    parser.add_argument("--revision")
    args = parser.parse_args(argv)
    fails = check(args.core_image, args.full_image, args.revision)
    for line in fails:
        print(line)
    print("OK" if not fails else f"{len(fails)} check(s) failed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
