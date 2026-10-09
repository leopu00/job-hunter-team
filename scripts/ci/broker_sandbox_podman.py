#!/usr/bin/env python3
"""The broker's login browser under ROOTLESS Podman (T3 part B, a risk of
stage 1 of the Podman plan), measured on a real Linux in CI.

Stage 1 moves the VPSs to rootless Podman. The question: does rootless
Podman apply the host's `jht-broker` AppArmor profile (loaded by root), so
that the broker sees itself confined and Chromium starts with its sandbox?
If it does not, the login view stays off on every migrated VPS (fail
closed, `secure_browser_unavailable`): stage 1 must know before migrating.

Runs IMAGE, as a NON-ROOT user, with the same hardening and the same
profiles as the Docker gate (broker_sandbox.py). The probe launches
Chromium even when the broker refuses (`JHT_PROBE_LAUNCH_ANYWAY`, this run
only: the product never does), to tell "the profile is not applied" apart
from "the sandbox cannot start at all".

FAILS (the risk is real) unless:
- Podman runs rootless (otherwise the measure answers another question);
- the broker's process and Chromium's carry the `jht-broker` label;
- the broker's `confinement()` says ready;
- Chromium starts with its sandbox: chrome://sandbox read as sandboxed, no
  `--no-sandbox`, a renderer in a user namespace of its own.

Usage: broker_sandbox_podman.py IMAGE SECCOMP_JSON
The caller loads the AppArmor profile as root first, and makes IMAGE known
to the user's rootless Podman.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location("broker_sandbox", Path(__file__).with_name("broker_sandbox.py"))
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

PROFILE = "jht-broker"


def confined_by_the_profile(label: str | None) -> bool:
    """`jht-broker (enforce)`, or stacked under Podman's runtime
    (`jht-broker//&crun (enforce)`)."""
    if not label:
        return False
    name = label.split(" (", 1)[0]
    return name == PROFILE or name.startswith(PROFILE + "//&")


def podman_info() -> dict:
    result = subprocess.run(["podman", "info", "--format", "json"], capture_output=True, text=True, timeout=120)
    try:
        info = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"error": result.stderr[-400:]}
    host = info.get("host", {})
    security = host.get("security", {})
    return {
        "version": info.get("version", {}).get("Version"),
        "rootless": security.get("rootless"),
        "apparmor_enabled": security.get("apparmorEnabled"),
        "seccomp_enabled": security.get("seccompEnabled"),
        "oci_runtime": host.get("ociRuntime", {}).get("name"),
    }


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

    info = podman_info()
    print("MEASURE podman " + json.dumps(info))
    if info.get("rootless") is not True:
        fail("rootless", f"Podman is not rootless here: the measure would answer another question ({info})")

    got = gate.run(image, ["--security-opt", f"apparmor={PROFILE}", "--security-opt", f"seccomp={seccomp}",
                           "-e", "JHT_PROBE_LAUNCH_ANYWAY=1"], engine="podman")
    print("MEASURE rootless-with-profiles " + json.dumps(got))
    if "error" in got:
        if "apparmor" in got["error"].lower() and "not enabled" in got["error"].lower():
            # Measured with Podman 4.9.3: rootless Podman refuses the
            # container outright. Then: could Chromium's sandbox start there
            # at all, with the seccomp profile only?
            fail("apparmor-refused", f"rootless Podman refuses a container with apparmor={PROFILE}: {got['error']}")
            bare = gate.run(image, ["--security-opt", f"seccomp={seccomp}", "-e", "JHT_PROBE_LAUNCH_ANYWAY=1"],
                            engine="podman")
            print("MEASURE rootless-seccomp-only " + json.dumps(bare))
            print(f"MEASURE rootless-seccomp-only-sandbox launch={bare.get('launch')} sandboxed={bare.get('sandboxed')}"
                  f" renderer_in_own_userns={bare.get('renderer_in_own_userns')} label={bare.get('own_label')!r}"
                  f" confinement={bare.get('confinement')}")
        else:
            fail("probe", f"the probe gave no answer under rootless Podman: {got['error']}")
        print("MEASURE rootless-verdict='the risk is real: the view stays off'")
        print(f"checks done: {fails} failed")
        return 1

    applied = confined_by_the_profile(got.get("own_label"))
    print(f"MEASURE rootless-apparmor-label broker={got.get('own_label')!r} chromium={got.get('chromium_labels')}")
    if not applied:
        fail("apparmor-label", f"rootless Podman did not apply {PROFILE} to the broker: {got.get('own_label')!r}")
    elif got.get("launch") == "ok" and not got.get("chromium_labels"):
        fail("apparmor-label", "Chromium started but no label of its processes was read")
    elif got.get("chromium_labels") and not all(confined_by_the_profile(label) for label in got["chromium_labels"]):
        fail("apparmor-label", f"a Chromium process is not under {PROFILE}: {got['chromium_labels']}")
    if got.get("confinement", {}).get("ready") is not True:
        fail("confinement", f"the broker does not see itself confined: {got.get('confinement')}")
    if got.get("launch") != "ok":
        fail("launch", f"Chromium did not start with its sandbox: {got.get('launch_error')}")
        for line in got.get("browser_log") or []:
            print("  browser: " + line)
        alone = got.get("chrome_alone") or {}
        print(f"  chrome alone: exit {alone.get('exit')}")
        for line in alone.get("stderr") or []:
            print("  chrome: " + line)
    else:
        if got.get("no_sandbox_flag"):
            fail("flag", "a Chromium process runs with --no-sandbox")
        if got.get("sandboxed") is not True:
            fail("chrome-sandbox", f"chrome://sandbox: {got.get('sandbox_text')}")
        if not got.get("renderer_userns"):
            fail("renderer-userns", "no renderer process was found: the probe could not compare namespaces")
        elif got.get("renderer_in_own_userns") is not True:
            fail("renderer-userns", f"renderers {got.get('renderer_userns')} vs own {got.get('own_userns')}")

    verdict = "the view works under rootless Podman" if fails == 0 else "the risk is real: the view stays off"
    print(f"MEASURE rootless-verdict={verdict!r}")
    print(f"checks done: {fails} failed")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
