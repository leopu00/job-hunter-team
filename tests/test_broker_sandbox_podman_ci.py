"""The rootless Podman measure of the broker's login browser
(scripts/ci/broker_sandbox_podman.py), without Podman.

The measure runs only in CI on a real Linux. Here its verdicts are checked
with the container's answers faked: a broker and a Chromium under the
jht-broker label, sandboxed, pass; every missing fact (label not applied,
confinement refused, Chromium not starting, Podman not rootless, no answer)
fails. Red is the answer "the risk is real".

Run with: pytest tests/test_broker_sandbox_podman_ci.py -v
"""

import importlib.util
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("broker_sandbox_podman", ROOT / "scripts" / "ci" / "broker_sandbox_podman.py")
measure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(measure)

GOOD = {
    "confinement": {"ready": True, "reason": None},
    "own_label": "jht-broker//&crun (enforce)",
    "chromium_labels": ["jht-broker//&crun (enforce)"],
    "launch": "ok",
    "sandboxed": True,
    "no_sandbox_flag": False,
    "own_userns": "user:[4026532001]",
    "renderer_userns": ["user:[4026532300]"],
    "renderer_in_own_userns": True,
}
ROOTLESS = {"version": "4.9.3", "rootless": True, "apparmor_enabled": True}


def _verdict(monkeypatch, capsys, got=GOOD, info=ROOTLESS):
    calls = []

    def fake_run(image, extra, engine="docker"):
        calls.append((engine, extra))
        return dict(got)

    monkeypatch.setattr(measure.gate, "run", fake_run)
    monkeypatch.setattr(measure, "podman_info", lambda: dict(info))
    code = measure.main(["localhost/jht:x", "seccomp.json"])
    return code, capsys.readouterr().out, calls


def test_a_broker_and_chromium_under_the_profile_pass(monkeypatch, capsys):
    code, out, calls = _verdict(monkeypatch, capsys)
    assert code == 0 and "checks done: 0 failed" in out
    assert "the view works under rootless Podman" in out
    ((engine, extra),) = calls
    assert engine == "podman"
    assert "apparmor=jht-broker" in extra and "JHT_PROBE_LAUNCH_ANYWAY=1" in extra


@pytest.mark.parametrize("change,tag", [
    ({"own_label": "unconfined"}, "apparmor-label"),
    ({"own_label": None}, "apparmor-label"),
    ({"own_label": "containers-default-0.57.4 (enforce)"}, "apparmor-label"),
    ({"chromium_labels": ["jht-broker//&crun (enforce)", "unconfined"]}, "apparmor-label"),
    ({"chromium_labels": []}, "apparmor-label"),
    ({"confinement": {"ready": False, "reason": "secure_browser_unavailable"}}, "confinement"),
    ({"launch": "failed", "launch_error": "No usable sandbox!"}, "launch"),
    ({"no_sandbox_flag": True}, "flag"),
    ({"sandboxed": False}, "chrome-sandbox"),
    ({"renderer_in_own_userns": False}, "renderer-userns"),
    ({"renderer_userns": []}, "renderer-userns"),
])
def test_each_missing_fact_says_the_risk_is_real(monkeypatch, capsys, change, tag):
    code, out, _ = _verdict(monkeypatch, capsys, got={**GOOD, **change})
    assert code == 1 and f"FAIL [{tag}]" in out
    assert "the risk is real" in out


def test_a_rootful_podman_answers_another_question(monkeypatch, capsys):
    code, out, _ = _verdict(monkeypatch, capsys, info={**ROOTLESS, "rootless": False})
    assert code == 1 and "FAIL [rootless]" in out


def test_no_answer_from_the_probe_is_said_as_such(monkeypatch, capsys):
    code, out, _ = _verdict(monkeypatch, capsys, got={"error": "the probe printed nothing (exit 125): apparmor"})
    assert code == 1 and "FAIL [probe]" in out and "FAIL [apparmor-label]" not in out


@pytest.mark.parametrize("label,confined", [
    ("jht-broker (enforce)", True),
    ("jht-broker//&crun (enforce)", True),
    ("jht-broker-old (enforce)", False),
    ("jht-broker (complain)", True),  # the name only: the mode is the broker's own check
    ("unconfined", False),
    ("", False),
])
def test_the_label_is_read_by_the_profile_s_name(label, confined):
    assert measure.confined_by_the_profile(label) is confined


def test_the_probe_launches_anyway_only_when_asked_and_reports_labels():
    probe = measure.gate.PROBE
    assert 'os.environ.get("JHT_PROBE_LAUNCH_ANYWAY") != "1"' in probe
    assert 'out["own_label"] = label_of("self")' in probe
    assert 'out["chromium_labels"] = sorted(set(labels))' in probe
    assert 'labels.append(label_of(pid) or "unreadable")' in probe
    # The Docker gate never sets it: there the broker's refusal stops the probe.
    assert "JHT_PROBE_LAUNCH_ANYWAY" not in Path(measure.gate.__file__).read_text().split("PROBE = r'''", 1)[0]
    assert "JHT_PROBE_LAUNCH_ANYWAY" not in Path(measure.gate.__file__).read_text().split("'''", 2)[2]


def test_the_measure_runs_only_on_trial_branches_and_by_hand_as_the_runner_user():
    workflow = yaml.load((ROOT / ".github" / "workflows" / "broker-sandbox.yml").read_text(), Loader=yaml.BaseLoader)
    job = workflow["jobs"]["broker-sandbox-podman"]
    assert job["if"] == "startsWith(github.ref, 'refs/heads/ci-') || github.event_name == 'workflow_dispatch'"
    (step,) = [s for s in job["steps"] if "broker_sandbox_podman.py" in s.get("run", "")]
    assert not step["run"].lstrip().startswith("sudo")
    loaded = [s for s in job["steps"] if "apparmor_parser" in s.get("run", "")]
    assert loaded and "sudo apparmor_parser -r -W /etc/apparmor.d/jht-broker" in loaded[0]["run"]
