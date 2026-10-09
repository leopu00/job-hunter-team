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
    "python_unshare_user": True,
    "python_unshare_mount": False,
    "python_chroot": False,
}
BARE = {"confinement": {"ready": False, "reason": "secure_browser_unavailable"}, "python_unshare_mount": False}
CONTROL = 'audit: apparmor="DENIED" operation="userns_create" class="namespace" profile="jht-journal-control" pid=7 comm="python3"'


def _verdict(monkeypatch, capsys, good=GOOD, bare=BARE, denied=(CONTROL,), sysctl="1", checked=None):
    monkeypatch.setattr(gate, "run", lambda image, extra: dict(good) if extra else dict(bare))
    monkeypatch.setattr(gate, "control", lambda image, seccomp: dict(checked or {"unshare_user": False}))
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
    ({"python_unshare_mount": True}, "python-mountns"),
    ({"python_chroot": True}, "python-chroot"),
])
def test_each_broken_fact_with_the_profiles_fails(monkeypatch, capsys, change, tag):
    code, out = _verdict(monkeypatch, capsys, good={**GOOD, **change})
    assert code == 1 and f"FAIL [{tag}]" in out


def test_an_apparmor_denial_fails(monkeypatch, capsys):
    line = 'audit: apparmor="DENIED" operation="signal" profile="jht-broker//&crun" signal=term'
    code, out = _verdict(monkeypatch, capsys, denied=[CONTROL, line])
    assert code == 1 and "FAIL [apparmor-denied]" in out


def test_the_expected_denial_of_the_probe_is_not_a_failure(monkeypatch, capsys):
    code, out = _verdict(monkeypatch, capsys, denied=[CONTROL])
    assert code == 0 and "control-denials=1" in out


def test_a_journal_that_shows_nothing_fails(monkeypatch, capsys):
    # The probe's own unshare must be denied and logged: with no line at all
    # the reader would report 0 denials for anything.
    code, out = _verdict(monkeypatch, capsys, denied=[])
    assert code == 1 and "FAIL [journal]" in out


def test_chromium_s_own_log_is_printed_when_it_does_not_start(monkeypatch, capsys):
    broken = {**GOOD, "launch": "failed", "launch_error": "Target page, context or browser has been closed",
              "browser_log": ["[ERROR:zygote_host_impl_linux.cc] No usable sandbox!"],
              "chrome_alone": {"exit": 1, "stderr": ["FATAL: Check failed: clone"]}}
    code, out = _verdict(monkeypatch, capsys, good=broken)
    assert code == 1 and "browser: [ERROR:zygote_host_impl_linux.cc] No usable sandbox!" in out
    assert "chrome: FATAL: Check failed: clone" in out


def test_without_the_profiles_a_mount_namespace_stays_refused(monkeypatch, capsys):
    code, out = _verdict(monkeypatch, capsys, bare={**BARE, "python_unshare_mount": True})
    assert code == 1 and "FAIL [bare-mountns]" in out


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


def test_a_probe_that_prints_nothing_is_reported_as_such(monkeypatch, capsys):
    # Second CI run: the probe died before printing; every check then failed
    # on missing data with a misleading message. Now it is one clear FAIL.
    code, out = _verdict(monkeypatch, capsys, good={"error": "the probe printed nothing (exit 1): Traceback"})
    assert code == 1 and "FAIL [probe]" in out
    assert "FAIL [python-userns]" not in out and "FAIL [python-mountns]" not in out


def test_an_exec_refused_is_an_answer_of_the_probe():
    assert "except OSError as refused:" in gate.PROBE


def test_the_broker_python_creating_a_user_namespace_is_declared_not_failed(monkeypatch, capsys):
    # userns is in the whole jht-broker profile: no-new-privileges forbids
    # the transition to a Chromium-only child profile (measured in CI).
    code, out = _verdict(monkeypatch, capsys)
    assert code == 0 and "MEASURE broker-python-userns=allowed" in out


def test_a_control_profile_that_allows_user_namespaces_fails(monkeypatch, capsys):
    code, out = _verdict(monkeypatch, capsys, checked={"unshare_user": True})
    assert code == 1 and "FAIL [control]" in out


def test_the_control_profile_has_no_userns_and_is_loaded_by_the_job():
    control = (ROOT / "scripts" / "ci" / "jht-journal-control.apparmor.txt").read_text()
    assert "profile jht-journal-control" in control and "userns" not in control.split("profile jht-journal-control", 1)[1]
    workflow = (ROOT / ".github" / "workflows" / "broker-sandbox.yml").read_text()
    assert "apparmor_parser -r /etc/apparmor.d/jht-journal-control" in workflow

