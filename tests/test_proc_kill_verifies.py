"""Un kill che non riesce lo dice: proc-kill.py e jht_kill_by_marker.

Su Ubuntu 26.04 + Podman 5.7 + crun 1.21 AppArmor nega i segnali dentro il
container («kill: (162) - Permission denied», apparmor=DENIED
operation=signal): i daemon vecchi restavano vivi, proc-kill.py usciva 0 lo
stesso e start-agent.sh lanciava un secondo daemon accanto al primo. Qui:
  - proc-kill.py esce 1 se un bersaglio sopravvive (segnale rifiutato o
    ignorato), 0 se sono spariti tutti o non c'era nessuno;
  - jht_kill_by_marker propaga l'esito, lo scrive su stderr e lo registra.
Che lo spawner non lanci il doppione lo prova
tests/test_tg_bridge_spawn_race.py, eseguendo start-agent.sh.
"""

from __future__ import annotations

import importlib.util
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
PROC_KILL = ROOT / ".launcher" / "proc-kill.py"
DAEMON_LIB = ROOT / ".launcher" / "daemon-lib.sh"
MARKER = "/app/.launcher/fake-daemon.py"


def _load():
    spec = importlib.util.spec_from_file_location("proc_kill", PROC_KILL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeProc:
    """Un /proc finto: chi muore a quale segnale, chi rifiuta, chi ignora."""

    def __init__(self, pk, monkeypatch, *, ignores=(), refuses=(), dies_as=None):
        self.alive = {101, 102}
        self.ignores = set(ignores)
        self.refuses = set(refuses)
        self.dies_as = dies_as or {}  # pid -> cmdline dopo la morte ("" = zombie)
        self.sent: list[tuple[int, int]] = []
        monkeypatch.setattr(pk, "_ancestors", lambda: set())
        monkeypatch.setattr(pk, "find_targets", lambda marker, protected: sorted(self.alive))
        monkeypatch.setattr(pk, "_read_cmdline", self.cmdline)
        monkeypatch.setattr(pk.os, "kill", self.kill)
        monkeypatch.setattr(pk.time, "sleep", lambda _s: None)

    def cmdline(self, pid):
        if pid in self.alive:
            return f"python3 -u {MARKER}"
        return self.dies_as.get(pid)

    def kill(self, pid, sig):
        self.sent.append((pid, sig))
        if pid in self.refuses:
            raise PermissionError(1, "Operation not permitted")
        if pid not in self.alive:
            raise ProcessLookupError(3, "No such process")
        if sig == signal.SIGKILL or pid not in self.ignores:
            self.alive.discard(pid)


def _run(pk, monkeypatch, capsys, *args):
    monkeypatch.setattr(sys, "argv", ["proc-kill.py", MARKER, "--verify", "0.2", *args])
    code = pk.main()
    return code, capsys.readouterr().err


def test_targets_that_die_exit_zero(monkeypatch, capsys):
    pk = _load()
    proc = FakeProc(pk, monkeypatch)
    code, err = _run(pk, monkeypatch, capsys)
    assert code == 0, err
    assert {pid for pid, _ in proc.sent} == {101, 102}


def test_no_target_is_not_an_error(monkeypatch, capsys):
    pk = _load()
    proc = FakeProc(pk, monkeypatch)
    proc.alive.clear()
    assert _run(pk, monkeypatch, capsys) == (0, "")


def test_a_target_that_ignores_sigterm_makes_it_exit_nonzero(monkeypatch, capsys):
    pk = _load()
    FakeProc(pk, monkeypatch, ignores={102})
    code, err = _run(pk, monkeypatch, capsys)
    assert code != 0
    assert "still running after the signal" in err and "102" in err


def test_sigkill_after_the_grace_clears_a_target_that_ignored_sigterm(monkeypatch, capsys):
    pk = _load()
    proc = FakeProc(pk, monkeypatch, ignores={102})
    code, err = _run(pk, monkeypatch, capsys, "--grace", "1")
    assert code == 0, err
    assert (102, signal.SIGKILL) in proc.sent


def test_a_refused_signal_makes_it_exit_nonzero_even_with_sigkill(monkeypatch, capsys):
    """Il caso AppArmor: EPERM a ogni segnale, il processo resta vivo."""
    pk = _load()
    FakeProc(pk, monkeypatch, refuses={101})
    code, err = _run(pk, monkeypatch, capsys, "--grace", "1")
    assert code != 0
    assert "DENIED kill 101" in err
    assert "signal refused" in err


@pytest.mark.parametrize("after", ["", "python3 /usr/bin/something-else.py"], ids=["zombie", "pid-reused"])
def test_a_zombie_or_a_reused_pid_is_not_a_survivor(monkeypatch, capsys, after):
    pk = _load()
    FakeProc(pk, monkeypatch, dies_as={101: after, 102: after})
    code, err = _run(pk, monkeypatch, capsys)
    assert code == 0, err


@pytest.mark.skipif(not Path("/proc/self/cmdline").exists(), reason="proc-kill.py legge /proc (Linux)")
def test_on_linux_a_real_process_ignoring_sigterm_is_reported(tmp_path):
    marker = str(tmp_path / "stubborn-daemon.py")
    child = subprocess.Popen(
        [sys.executable, "-c",
         "import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)",
         marker],
    )
    try:
        time.sleep(0.3)
        stubborn = subprocess.run([sys.executable, str(PROC_KILL), marker, "--verify", "0.5"],
                                  capture_output=True, text=True, timeout=30)
        assert stubborn.returncode != 0, stubborn.stderr
        assert str(child.pid) in stubborn.stderr
        assert child.poll() is None
        # Con il SIGKILL dopo la grazia sparisce: lo zombie non conta.
        killed = subprocess.run([sys.executable, str(PROC_KILL), marker, "--grace", "0.3", "--verify", "2"],
                                capture_output=True, text=True, timeout=30)
        assert killed.returncode == 0, killed.stderr
    finally:
        child.kill()
        child.wait(timeout=10)


def _kill_by_marker(tmp_path, proc_kill_body: str):
    fake = tmp_path / "fake-proc-kill.py"
    fake.write_text(proc_kill_body, encoding="utf-8")
    home = tmp_path / "home"
    script = f'. "{DAEMON_LIB}"; jht_kill_by_marker "{MARKER}" 0 0; echo "rc=$?"'
    result = subprocess.run(
        ["bash", "-c", script], capture_output=True, text=True, timeout=30,
        env={**os.environ, "JHT_HOME": str(home), "JHT_PROC_KILL_PY": str(fake)},
    )
    log = home / "logs" / "daemon-kill.log"
    return result, (log.read_text(encoding="utf-8") if log.exists() else "")


def test_jht_kill_by_marker_reports_a_survivor_and_returns_nonzero(tmp_path):
    result, log = _kill_by_marker(
        tmp_path,
        "import sys\nprint('[proc-kill] FAIL x: signal refused: [162]', file=sys.stderr)\nsys.exit(1)\n",
    )
    assert "rc=1" in result.stdout
    assert "not starting a second one" in result.stderr
    assert "signal refused: [162]" in result.stderr
    assert f"marker={MARKER}" in log and "signal refused" in log


def test_jht_kill_by_marker_is_silent_when_the_kill_succeeds(tmp_path):
    result, log = _kill_by_marker(tmp_path, "import sys\nsys.exit(0)\n")
    assert "rc=0" in result.stdout
    assert result.stderr == ""
    assert log == ""
