"""The rootless Podman gate of the broker's login browser
(scripts/ci/broker_sandbox_podman.py), without Podman.

the security review's decision (a), 09/10: under rootless Podman the broker runs
with the seccomp profile alone, accepted only in a verified rootless
container. The gate runs only in CI on a real Linux; here its verdicts are
checked with the containers' answers faked: a confined broker with a
sandboxed Chromium, refused counter-proofs and a rootful container that
stays off pass; every broken fact fails.

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
    "own_label": "crun (unconfined)",
    "chromium_labels": ["crun (unconfined)"],
    "launch": "ok",
    "sandboxed": True,
    "no_sandbox_flag": False,
    "own_userns": "user:[4026532001]",
    "renderer_userns": ["user:[4026532300]"],
    "renderer_in_own_userns": True,
    "python_unshare_mount": False,
    "python_chroot": False,
    "python_af_alg": False,
    "python_af_vsock": False,
}
OFF = {"confinement": {"ready": False, "reason": "secure_browser_unavailable"}, "own_label": "docker-default (enforce)"}
ROOTLESS = {"version": "4.9.3", "rootless": True, "apparmor_enabled": False}
OPENS_BOTH = {"af_alg": True, "af_vsock": True}


def _verdict(monkeypatch, capsys, got=GOOD, rootful=OFF, info=ROOTLESS, control=OPENS_BOTH):
    calls = []

    def fake_run(image, extra, engine="docker"):
        calls.append((engine, image, list(extra)))
        return dict(got if engine == "podman" else rootful)

    monkeypatch.setattr(measure.gate, "run", fake_run)
    monkeypatch.setattr(measure, "podman_info", lambda: dict(info))
    monkeypatch.setattr(measure, "socket_control", lambda image: dict(control))
    code = measure.main(["localhost/jht:x", "jht:broker-sandbox", "seccomp.json"])
    return code, capsys.readouterr().out, calls


def test_a_confined_broker_a_sandboxed_chromium_and_a_rootful_container_off_pass(monkeypatch, capsys):
    code, out, calls = _verdict(monkeypatch, capsys)
    assert code == 0 and "checks done: 0 failed" in out
    (podman, docker) = calls
    # Under Podman, as the wrapper starts the broker there: seccomp, no AppArmor.
    assert podman == ("podman", "localhost/jht:x", ["--security-opt", "seccomp=seccomp.json"])
    # The rootful counter-proof: Docker, the same seccomp, no jht-broker label.
    assert docker == ("docker", "jht:broker-sandbox", ["--security-opt", "seccomp=seccomp.json"])


@pytest.mark.parametrize("change,tag", [
    ({"confinement": {"ready": False, "reason": "secure_browser_unavailable"}}, "confinement"),
    ({"launch": "failed", "launch_error": "No usable sandbox!"}, "launch"),
    ({"no_sandbox_flag": True}, "flag"),
    ({"sandboxed": False}, "chrome-sandbox"),
    ({"renderer_in_own_userns": False}, "renderer-userns"),
    ({"renderer_userns": []}, "renderer-userns"),
    ({"python_unshare_mount": True}, "python-mountns"),
    ({"python_chroot": True}, "python-chroot"),
    ({"python_af_alg": True}, "python-af-alg"),
    ({"python_af_vsock": True}, "python-af-vsock"),
])
def test_each_broken_fact_under_rootless_podman_fails(monkeypatch, capsys, change, tag):
    code, out, _ = _verdict(monkeypatch, capsys, got={**GOOD, **change})
    assert code == 1 and f"FAIL [{tag}]" in out


def test_a_rootful_container_without_the_label_that_is_not_off_fails(monkeypatch, capsys):
    code, out, _ = _verdict(monkeypatch, capsys, rootful={"confinement": {"ready": True, "reason": None}})
    assert code == 1 and "FAIL [rootful]" in out


def test_a_rootful_podman_would_check_another_case(monkeypatch, capsys):
    code, out, _ = _verdict(monkeypatch, capsys, info={**ROOTLESS, "rootless": False})
    assert code == 1 and "FAIL [rootless]" in out


def test_no_answer_from_the_probe_is_said_as_such(monkeypatch, capsys):
    code, out, _ = _verdict(monkeypatch, capsys, got={"error": "the probe printed nothing (exit 125)"})
    assert code == 1 and "FAIL [probe]" in out and "FAIL [python-mountns]" not in out


def test_a_socket_family_the_kernel_never_opens_is_declared_not_proved(monkeypatch, capsys):
    code, out, _ = _verdict(monkeypatch, capsys, control={"af_alg": True, "af_vsock": False})
    assert code == 0
    assert "python-af-vsock=refused, not provable here" in out and "python-af-alg=refused, not provable" not in out


def test_the_probe_opens_the_two_families_from_the_broker_s_python():
    probe = measure.gate.PROBE
    assert 'out["python_af_alg"] = socket_works(38, socket.SOCK_SEQPACKET)' in probe
    assert 'out["python_af_vsock"] = socket_works(40, socket.SOCK_STREAM)' in probe
    # Measured before the broker's refusal stops the probe: the rootful run
    # reports them too.
    assert probe.index('out["python_af_vsock"]') < probe.index('if not out["confinement"]["ready"]:')
    assert "JHT_PROBE_LAUNCH_ANYWAY" not in probe


def test_the_gate_runs_wherever_the_docker_gate_runs_as_the_runner_user():
    workflow = yaml.load((ROOT / ".github" / "workflows" / "broker-sandbox.yml").read_text(), Loader=yaml.BaseLoader)
    job = workflow["jobs"]["broker-sandbox-podman"]
    assert "if" not in job
    (step,) = [s for s in job["steps"] if "broker_sandbox_podman.py" in s.get("run", "")]
    assert not step["run"].lstrip().startswith("sudo")
    # The rootful counter-proof needs a container WITHOUT the jht-broker
    # label: this job never loads the profile.
    assert not any("apparmor_parser" in s.get("run", "") for s in job["steps"])
