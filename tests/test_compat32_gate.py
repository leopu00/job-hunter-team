"""The 32-bit gate of the broker's seccomp profile (scripts/ci/compat32_gate.py),
without a container engine.

The gate runs only in CI on real x86_64 and arm64 hosts. Here its verdicts
are checked with the engine's answers faked, and the probe's source is
checked for the four ways it must try. A gate that cannot fail would prove
nothing, and a probe that never ran would prove nothing either.

Run with: pytest tests/test_compat32_gate.py -v
"""

import importlib.util
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("compat32_gate", ROOT / "scripts" / "ci" / "compat32_gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

CLEAN_IMAGE = {"roots": ["/opt/playwright"], "elf_files": 412, "elf32": [], "elf32_count": 0,
               "i386_libs": False, "armhf_libs": False}


def _verdict(monkeypatch, capsys, control, profiled, engine="docker", scan=None):
    calls = []

    def fake_run(engine_, seccomp):
        calls.append((engine_, seccomp))
        return control if seccomp == "unconfined" else profiled

    monkeypatch.setattr(gate, "make_image", lambda engine_, binary: None)
    monkeypatch.setattr(gate, "run", fake_run)
    monkeypatch.setattr(gate, "image_check", lambda engine_, image: dict(scan or CLEAN_IMAGE))
    argv = [engine, "seccomp.json", "compat32"] + (["--image-check", "jht:x"] if scan is not None else [])
    code = gate.main(argv)
    return code, capsys.readouterr().out, calls


@pytest.mark.parametrize("profiled", [16, 159, 132])
def test_refused_or_killed_32_bit_code_passes(monkeypatch, capsys, profiled):
    # 16: every way refused; 159: SIGSYS at the first 32-bit call (no 32-bit
    # sub-architecture); 132: the probe's own trap when even exit is refused.
    code, out, calls = _verdict(monkeypatch, capsys, control=31, profiled=profiled)
    assert code == 0 and "checks done: 0 failed" in out
    assert calls == [("docker", "unconfined"), ("docker", "seccomp.json")]


@pytest.mark.parametrize("profiled,way", [
    (17, "socketcall AF_ALG"),
    (18, "socket AF_ALG"),
    (20, "socketcall AF_VSOCK"),
    (24, "socket AF_VSOCK"),
])
def test_any_way_open_under_the_profile_fails(monkeypatch, capsys, profiled, way):
    code, out, _ = _verdict(monkeypatch, capsys, control=31, profiled=profiled)
    assert code == 1 and "FAIL [compat32]" in out and way in out


@pytest.mark.parametrize("profiled", [0, 1, 125, 126])
def test_no_answer_under_the_profile_fails(monkeypatch, capsys, profiled):
    code, out, _ = _verdict(monkeypatch, capsys, control=31, profiled=profiled)
    assert code == 1 and "FAIL [compat32-run]" in out


def test_a_host_that_runs_no_32_bit_code_says_so(monkeypatch, capsys):
    # A CPU without AArch32: the binary does not run even unfiltered.
    code, out, _ = _verdict(monkeypatch, capsys, control=255, profiled=255)
    assert code == 0 and "not provable here: 32-bit code does not run on this host" in out


def test_a_kernel_that_opens_neither_family_says_so(monkeypatch, capsys):
    code, out, _ = _verdict(monkeypatch, capsys, control=16, profiled=16)
    assert code == 0 and "opens neither family" in out


def test_the_image_has_no_32_bit_chromium_or_python(monkeypatch, capsys):
    code, out, _ = _verdict(monkeypatch, capsys, control=31, profiled=159, scan=CLEAN_IMAGE)
    assert code == 0
    dirty = {**CLEAN_IMAGE, "elf32": ["/opt/playwright/chromium/lib32.so"], "elf32_count": 1}
    code, out, _ = _verdict(monkeypatch, capsys, control=31, profiled=159, scan=dirty)
    assert code == 1 and "FAIL [image-32bit]" in out


def test_an_image_scan_that_finds_no_elf_at_all_fails(monkeypatch, capsys):
    code, out, _ = _verdict(monkeypatch, capsys, control=31, profiled=159, scan={**CLEAN_IMAGE, "elf_files": 0})
    assert code == 1 and "FAIL [image-check]" in out


def test_the_probe_tries_both_families_both_ways_on_both_architectures():
    source = (ROOT / "scripts" / "ci" / "compat32_socket.c.txt").read_text()
    for needle in ("by_socketcall(AF_ALG", "by_socket(AF_ALG", "by_socketcall(AF_VSOCK", "by_socket(AF_VSOCK",
                   "#if defined(__i386__)", "#elif defined(__arm__)", "__builtin_trap();"):
        assert needle in source, needle
    assert gate.WAYS == {1: "socketcall AF_ALG", 2: "socket AF_ALG", 4: "socketcall AF_VSOCK", 8: "socket AF_VSOCK"}


def test_docker_runs_are_free_of_apparmor_so_only_seccomp_answers():
    import inspect
    source = inspect.getsource(gate.run)
    assert '["--security-opt", "apparmor=unconfined"] if engine == "docker"' in source


def test_the_workflow_runs_the_gate_on_x86_under_both_engines_and_on_native_arm64():
    workflow = yaml.load((ROOT / ".github" / "workflows" / "broker-sandbox.yml").read_text(), Loader=yaml.BaseLoader)
    jobs = workflow["jobs"]

    def runs(job):
        return " ".join(step.get("run", "") for step in jobs[job]["steps"])

    assert "compat32_gate.py docker" in runs("broker-sandbox") and "--image-check jht:broker-sandbox" in runs("broker-sandbox")
    assert "compat32_gate.py podman" in runs("broker-sandbox-podman")
    arm = jobs["broker-seccomp-compat32-arm"]
    assert arm["runs-on"] == "ubuntu-24.04-arm"
    assert "arm-linux-gnueabihf-gcc -marm" in runs("broker-seccomp-compat32-arm")
    assert "qemu" not in runs("broker-seccomp-compat32-arm")
    assert "compat32_gate.py docker" in runs("broker-seccomp-compat32-arm")
    assert "compat32_gate.py podman" in runs("broker-seccomp-compat32-arm")
    assert "gcc -m32 -static -nostdlib" in runs("broker-sandbox")
