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
  - the broker's own Python cannot create a mount namespace (a user
    namespace it may, as Chromium may: `userns,` is in the whole profile,
    see scripts/security/README.md; the job prints it);
  - the kernel logged no `apparmor="DENIED"` for the profile meanwhile
    (userns, signal, ptrace: the Podman plan's risk too). That "no" is
    trusted only after the control: under the job's own profile
    jht-journal-control (no `userns,`, scripts/ci), an unshare of a user
    namespace must be refused and logged, or a journal reader that sees
    nothing would report 0 denials for anything.
  If Chromium does not start, Chromium's own log and the binary's stderr
  are printed.
- WITHOUT them (the runtime's defaults). It FAILS unless the broker refuses
  with `secure_browser_unavailable`, and its Python still cannot create a
  mount namespace: the fail-closed path.

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
import ctypes, json, os, subprocess, sys, time
from broker import view

def unshare_works(flag):
    # In a forked child, so the probe itself stays where it is.
    pid = os.fork()
    if pid == 0:
        libc = ctypes.CDLL(None, use_errno=True)
        os._exit(0 if libc.unshare(flag) == 0 else 1)
    return os.WEXITSTATUS(os.waitpid(pid, 0)[1]) == 0

def chroot_works():
    pid = os.fork()
    if pid == 0:
        libc = ctypes.CDLL(None, use_errno=True)
        os._exit(0 if libc.chroot(b"/") == 0 else 1)
    return os.WEXITSTATUS(os.waitpid(pid, 0)[1]) == 0

KEEP = ("FATAL", "ERROR", "Check failed", "sandbox", "zygote", "namespace", "clone", "unshare",
        "denied", "not permitted", "No such", "error while loading", "Missing X")

def keep(text):
    return [line.strip()[:300] for line in text.splitlines() if any(k in line for k in KEEP)][:25]

out = {"confinement": view.confinement()}
# The broker's own Python: it may create a user namespace, as Chromium may
# (userns is in the whole profile); a mount namespace is refused to everyone,
# and chroot, which seccomp now lets through, is still refused by the kernel
# outside a user namespace of its own.
out["python_unshare_user"] = unshare_works(0x10000000)
out["python_unshare_mount"] = unshare_works(0x00020000)
out["python_chroot"] = chroot_works()
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
    # Playwright appends Chromium's own log to the error; and the binary run
    # alone, for a few seconds, says on stderr why it stops.
    out["browser_log"] = keep(str(exc))
    try:
        alone = subprocess.run([pw.chromium.executable_path, "--enable-logging=stderr", "--user-data-dir=/tmp/diag",
                                "--disable-dev-shm-usage", "about:blank"],
                               env={**os.environ, "DISPLAY": ":99", "HOME": "/tmp"},
                               capture_output=True, text=True, timeout=15)
        out["chrome_alone"] = {"exit": alone.returncode, "stderr": keep(alone.stderr)}
    except subprocess.TimeoutExpired as running:
        out["chrome_alone"] = {"exit": "still running after 15 s", "stderr": keep((running.stderr or b"").decode(errors="replace"))}
    except OSError as refused:
        # The exec itself refused (an AppArmor transition, a missing binary):
        # it is the answer, not a crash of the probe.
        out["chrome_alone"] = {"exit": f"exec refused: {type(refused).__name__} errno {refused.errno}", "stderr": []}
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
    lines = result.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"error": f"the probe printed nothing (exit {result.returncode}): {result.stderr[-800:]}"}
    except json.JSONDecodeError:
        return {"error": (result.stderr or result.stdout)[-800:]}


CONTROL_PROFILE = "jht-journal-control"

# Runs inside the control container: an unshare of a user namespace, which
# the control profile (no `userns,`) must refuse, and log.
CONTROL_PROBE = r'''
import ctypes, json, os
pid = os.fork()
if pid == 0:
    libc = ctypes.CDLL(None, use_errno=True)
    os._exit(0 if libc.unshare(0x10000000) == 0 else 1)
print(json.dumps({"unshare_user": os.WEXITSTATUS(os.waitpid(pid, 0)[1]) == 0}))
'''


def expected_denial(line: str) -> bool:
    """The denial the control provokes on purpose."""
    return 'operation="userns_create"' in line and f'profile="{CONTROL_PROFILE}"' in line


def denials(since: str) -> list[str]:
    log = subprocess.run(["sudo", "journalctl", "-k", "--since", since, "--no-pager"], capture_output=True, text=True)
    return [line for line in log.stdout.splitlines()
            if 'apparmor="DENIED"' in line and ("jht-broker" in line or CONTROL_PROFILE in line)]


def control(image: str, seccomp: str) -> dict:
    result = subprocess.run(["docker", "run", "--rm", *HARDENING, "--security-opt", f"apparmor={CONTROL_PROFILE}",
                             "--security-opt", f"seccomp={seccomp}", "--entrypoint", "python3", image,
                             "-c", CONTROL_PROBE], capture_output=True, text=True, timeout=120)
    lines = result.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"error": result.stderr[-800:]}
    except json.JSONDecodeError:
        return {"error": (result.stderr or result.stdout)[-800:]}


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
    checked = control(image, seccomp)
    print("MEASURE journal-control " + json.dumps(checked))
    if checked.get("unshare_user") is not False:
        fail("control", f"the control profile did not refuse a user namespace: {checked}")
    good = run(image, ["--security-opt", "apparmor=jht-broker", "--security-opt", f"seccomp={seccomp}"])
    print("MEASURE with-profiles " + json.dumps(good))
    if "error" in good:
        # No answer is not an answer: say so, instead of failing every check
        # on missing data.
        fail("probe", f"the probe gave no answer with the profiles: {good['error']}")
    elif good.get("confinement", {}).get("ready") is not True:
        fail("confinement", f"the broker does not see its profiles: {good.get('confinement') or good.get('error')}")
    elif good.get("launch") != "ok":
        fail("launch", f"Chromium did not start with its sandbox: {good.get('launch_error')}")
        for line in good.get("browser_log") or []:
            print("  browser: " + line)
        alone = good.get("chrome_alone") or {}
        print(f"  chrome alone: exit {alone.get('exit')}")
        for line in alone.get("stderr") or []:
            print("  chrome: " + line)
    else:
        if good.get("no_sandbox_flag"):
            fail("flag", "a Chromium process runs with --no-sandbox")
        if good.get("sandboxed") is not True:
            fail("chrome-sandbox", f"chrome://sandbox: {good.get('sandbox_text')}")
        if good.get("renderer_in_own_userns") is not True:
            fail("renderer-userns", f"renderers {good.get('renderer_userns')} vs own {good.get('own_userns')}")
    # Declared, not a failure: userns is in the whole jht-broker profile,
    # because no-new-privileges forbids a transition to a Chromium-only child.
    print(f"MEASURE broker-python-userns={'allowed' if good.get('python_unshare_user') else 'refused'}")
    if "error" not in good and good.get("python_unshare_mount") is not False:
        fail("python-mountns", "the broker's Python created a mount namespace under the profiles")
    if "error" not in good and good.get("python_chroot") is not False:
        fail("python-chroot", "the broker's Python chrooted without a user namespace of its own")
    denied = denials(since)
    controls = [line for line in denied if expected_denial(line)]
    unexpected = [line for line in denied if not expected_denial(line)]
    print(f"MEASURE apparmor-denials={len(unexpected)} control-denials={len(controls)}")
    for line in unexpected[:20]:
        print("  " + line)
    if not controls:
        # The control's unshare must show up: if it does not, the journal
        # reader would miss real denials too, and "0" would prove nothing.
        fail("journal", f"no DENIED line for the {CONTROL_PROFILE} unshare: the journal reader sees nothing")
    if unexpected:
        fail("apparmor-denied", f"{len(unexpected)} DENIED lines for jht-broker")

    bare = run(image, [])
    print("MEASURE without-profiles " + json.dumps(bare))
    if bare.get("confinement") != {"ready": False, "reason": "secure_browser_unavailable"}:
        fail("fail-closed", f"without the profiles the broker says {bare.get('confinement') or bare.get('error')}")
    if bare.get("python_unshare_mount") is not False:
        fail("bare-mountns", "without the profiles the broker's Python created a mount namespace")

    print(f"checks done: {fails} failed")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
