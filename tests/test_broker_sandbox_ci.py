"""The CI gate of Chromium's sandbox in the broker (scripts/ci/broker_sandbox.py).

The gate runs only in CI on a real Linux; here its verdicts are checked with
the container's answers faked: a good run passes, and every broken fact
(confinement, launch, --no-sandbox, chrome://sandbox, renderer namespace, an
AppArmor denial, the fail-closed path, a runner without the userns
restriction) fails it. A gate that cannot fail would prove nothing.

Run with: pytest tests/test_broker_sandbox_ci.py -v
"""

import importlib.util
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("broker_sandbox", ROOT / "scripts" / "ci" / "broker_sandbox.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

GOOD = {
    "confinement": {"ready": True, "reason": None},
    "launch": "ok",
    "sandboxed": True,
    "no_sandbox_flag": False,
    "own_userns": "user:[4026531837]",
    "renderer_userns": ["user:[4026532300]"],
    "renderer_in_own_userns": True,
}
BARE = {"confinement": {"ready": False, "reason": "secure_browser_unavailable"}}


def _verdict(monkeypatch, capsys, good=GOOD, bare=BARE, denied=(), sysctl="1"):
    monkeypatch.setattr(gate, "run", lambda image, extra: dict(good) if extra else dict(bare))
    monkeypatch.setattr(gate, "denials", lambda since: list(denied))
    monkeypatch.setattr(gate.time, "sleep", lambda s: None)
    real_run = subprocess.run

    def fake_run(argv, **kwargs):
        if argv[:2] == ["sysctl", "-n"]:
            return subprocess.CompletedProcess(argv, 0, stdout=sysctl + "\n", stderr="")
        return real_run(argv, **kwargs)

    monkeypatch.setattr(gate.subprocess, "run", fake_run)
    code = gate.main(["jht:x", "seccomp.json"])
    return code, capsys.readouterr().out


def test_a_good_run_passes(monkeypatch, capsys):
    code, out = _verdict(monkeypatch, capsys)
    assert code == 0 and "checks done: 0 failed" in out


@pytest.mark.parametrize("change,tag", [
    ({"confinement": {"ready": False, "reason": "secure_browser_unavailable"}}, "confinement"),
    ({"launch": "failed", "launch_error": "Failed to move to new namespace"}, "launch"),
    ({"no_sandbox_flag": True}, "flag"),
    ({"sandboxed": False, "sandbox_text": "You are not adequately sandboxed!"}, "chrome-sandbox"),
    ({"renderer_in_own_userns": False}, "renderer-userns"),
])
def test_each_broken_fact_with_the_profiles_fails(monkeypatch, capsys, change, tag):
    code, out = _verdict(monkeypatch, capsys, good={**GOOD, **change})
    assert code == 1 and f"FAIL [{tag}]" in out


def test_an_apparmor_denial_fails(monkeypatch, capsys):
    line = 'audit: apparmor="DENIED" operation="signal" profile="jht-broker//&crun" signal=term'
    code, out = _verdict(monkeypatch, capsys, denied=[line])
    assert code == 1 and "FAIL [apparmor-denied]" in out


def test_the_broker_must_refuse_without_the_profiles(monkeypatch, capsys):
    code, out = _verdict(monkeypatch, capsys, bare={"confinement": {"ready": True, "reason": None}})
    assert code == 1 and "FAIL [fail-closed]" in out


def test_a_runner_without_the_userns_restriction_proves_nothing(monkeypatch, capsys):
    code, out = _verdict(monkeypatch, capsys, sysctl="0")
    assert code == 1 and "FAIL [host]" in out


def test_the_probe_never_asks_for_no_sandbox():
    assert "chromium_sandbox=True" in gate.PROBE and "chromium_sandbox=False" not in gate.PROBE
    # The one mention of the flag is the check that looks for it.
    assert gate.PROBE.count("--no-sandbox") == 1 and '"--no-sandbox" in c' in gate.PROBE
