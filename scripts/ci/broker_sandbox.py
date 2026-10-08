#!/usr/bin/env python3
"""Chromium's sandbox in the jht-broker container, on a real Linux (design R3,
way a; stage T1 of PIANO-chromium-sandbox-broker).

Runs IMAGE as the compose runs `jht-broker` (uid 1002, read-only root, no
capabilities, no new privileges, no network), twice:

- WITH the host's `jht-broker` profiles (AppArmor loaded by the caller,
  seccomp from scripts/security). It FAILS unless:
  - the broker's own check (`confinement()`) says ready;
  - Chromium starts with its sandbox, with no `--no-sandbox` on any of its
    command lines;
  - chrome://sandbox says the namespace sandbox and seccomp-bpf are on, with
    the positive verdict (`view.sandboxed()`);
  - a renderer runs in a user namespace of its own, not the browser's;
  - the kernel logged no `apparmor="DENIED"` for the profile meanwhile
    (userns, signal, ptrace: the Podman plan's risk too).
- WITHOUT them (the runtime's defaults). It FAILS unless the broker refuses
  with `secure_browser_unavailable`: the fail-closed path.

Usage: broker_sandbox.py IMAGE SECCOMP_JSON
The caller loads the AppArmor profile first (`apparmor_parser -r`). Prints
one MEASURE line per fact and one FAIL line per broken check; exit 0 when
every check passes.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time

HARDENING = ["--user", "1002:1002", "--read-only", "--tmpfs", "/tmp:size=512m,mode=1777",
             "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--network", "none",
             "-e", "HOME=/tmp", "-e", "PYTHONPATH=/app/shared"]

# Runs inside the container. Prints one JSON line.
PROBE = r'''
import json, os, subprocess, sys, time
from broker import view

out = {"confinement": view.confinement()}
if not out["confinement"]["ready"]:
    print(json.dumps(out)); sys.exit(0)
xvfb = subprocess.Popen(["Xvfb", ":99", "-screen", "0", "1280x900x24", "-nolisten", "tcp"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5)
from playwright.sync_api import sync_playwright
pw = sync_playwright().start()
try:
    context = pw.chromium.launch_persistent_context(
        "/tmp/profile", headless=False, chromium_sandbox=True, args=list(view.BROWSER_ARGS),
        env={**os.environ, "DISPLAY": ":99", "HOME": "/tmp"})
except Exception as exc:
    out["launch"] = "failed"
    out["launch_error"] = str(exc).splitlines()[0][:300]
    print(json.dumps(out)); sys.exit(0)
out["launch"] = "ok"
page = context.new_page()
page.goto("chrome://sandbox")
text = page.inner_text("body")
out["sandbox_text"] = " | ".join(line.strip() for line in text.splitlines() if line.strip())[:2000]
out["sandboxed"] = view.sandboxed(text)
page.goto("about:blank")
mine = os.readlink("/proc/self/ns/user")
browsers, renderers, cmdlines = [], [], []
for pid in os.listdir("/proc"):
    if not pid.isdigit():
        continue
    try:
        cmd = open(f"/proc/{pid}/cmdline", "rb").read().split(b"\0")
    except OSError:
        continue
    joined = b" ".join(cmd).decode(errors="replace")
    if "chrom" not in joined:
        continue
    cmdlines.append(joined)
    try:
        ns = os.readlink(f"/proc/{pid}/ns/user")
    except OSError as exc:
        ns = f"unreadable:{exc.errno}"
    (renderers if "--type=renderer" in joined else browsers).append(ns)
out["no_sandbox_flag"] = any("--no-sandbox" in c for c in cmdlines)
out["own_userns"] = mine
out["renderer_userns"] = sorted(set(renderers))
out["renderer_in_own_userns"] = bool(renderers) and all(ns != mine and not ns.startswith("unreadable") for ns in renderers)
context.close(); pw.stop(); xvfb.terminate()
print(json.dumps(out))
'''


def run(image: str, extra: list[str]) -> dict:
    result = subprocess.run(["docker", "run", "--rm", *HARDENING, *extra, "--entrypoint", "python3", image, "-c", PROBE],
                            capture_output=True, text=True, timeout=300)
    line = (result.stdout.strip().splitlines() or ["{}"])[-1]
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return {"error": (result.stderr or result.stdout)[-800:]}


def denials(since: str) -> list[str]:
    log = subprocess.run(["sudo", "journalctl", "-k", "--since", since, "--no-pager"], capture_output=True, text=True)
    return [line for line in log.stdout.splitlines() if 'apparmor="DENIED"' in line and "jht-broker" in line]


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    image, seccomp = argv
    fails = 0

    def fail(tag: str, message: str) -> None:
        nonlocal fails
        print(f"FAIL [{tag}] {message}")
        fails += 1

    sysctl = subprocess.run(["sysctl", "-n", "kernel.apparmor_restrict_unprivileged_userns"],
                            capture_output=True, text=True).stdout.strip()
    print(f"MEASURE apparmor_restrict_unprivileged_userns={sysctl or 'absent'}")
    if sysctl != "1":
        fail("host", "the runner does not restrict unprivileged user namespaces: the measure would prove nothing")

    since = time.strftime("%Y-%m-%d %H:%M:%S")
    time.sleep(1)
    good = run(image, ["--security-opt", "apparmor=jht-broker", "--security-opt", f"seccomp={seccomp}"])
    print("MEASURE with-profiles " + json.dumps(good))
    if good.get("confinement", {}).get("ready") is not True:
        fail("confinement", f"the broker does not see its profiles: {good.get('confinement') or good.get('error')}")
    elif good.get("launch") != "ok":
        fail("launch", f"Chromium did not start with its sandbox: {good.get('launch_error')}")
    else:
        if good.get("no_sandbox_flag"):
            fail("flag", "a Chromium process runs with --no-sandbox")
        if good.get("sandboxed") is not True:
            fail("chrome-sandbox", f"chrome://sandbox: {good.get('sandbox_text')}")
        if good.get("renderer_in_own_userns") is not True:
            fail("renderer-userns", f"renderers {good.get('renderer_userns')} vs own {good.get('own_userns')}")
    denied = denials(since)
    print(f"MEASURE apparmor-denials={len(denied)}")
    for line in denied[:20]:
        print("  " + line)
    if denied:
        fail("apparmor-denied", f"{len(denied)} DENIED lines for jht-broker")

    bare = run(image, [])
    print("MEASURE without-profiles " + json.dumps(bare))
    if bare.get("confinement") != {"ready": False, "reason": "secure_browser_unavailable"}:
        fail("fail-closed", f"without the profiles the broker says {bare.get('confinement') or bare.get('error')}")

    print(f"checks done: {fails} failed")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
