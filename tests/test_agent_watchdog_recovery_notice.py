"""Il recupero del watchdog non deve cancellare la traccia del guasto.

Non avviamo una TUI o una macchina: eseguiamo le funzioni vere di
``agent-watchdog.sh`` con i tre confini iniettati (liveness, spawner, sender).
Così il test vede sia il registro durevole, necessario per contare i recuperi
del giorno, sia l'avviso che il Capitano riceverebbe.
"""

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
WATCHDOG = ROOT / ".launcher" / "agent-watchdog.sh"


def _prelude():
    """Variabili e funzioni del watchdog, senza il daemon infinito."""
    source = WATCHDOG.read_text(encoding="utf-8")
    marker = 'log "watchdog start'
    assert marker in source, "il marker prima del loop watchdog è cambiato"
    return source[:source.index(marker)]


def _bash_path(path: Path) -> str:
    """C:/x → /mnt/c/x per il bash WSL; no-op su POSIX."""
    posix = Path(path).resolve().as_posix()
    if len(posix) >= 3 and posix[1:3] == ":/":
        return f"/mnt/{posix[0].lower()}/{posix[3:]}"
    return posix


def _fake(path: Path, body: str):
    path.write_text("#!/usr/bin/env bash\nset -eu\n" + body, encoding="utf-8",
                    newline="\n")
    path.chmod(0o755)
    return path


def _run(tmp_path, body: str, *, start_rc=0):
    logs = tmp_path / "logs"
    logs.mkdir(parents=True)
    node_calls = tmp_path / "node-calls.txt"
    sender_calls = tmp_path / "sender-calls.txt"
    start_calls = tmp_path / "start-calls.txt"
    node = _fake(tmp_path / "node",
                 f'printf "%s\\n" "$*" >> "{_bash_path(node_calls)}"\nexit {start_rc}\n')
    sender = _fake(tmp_path / "sender",
                   f'printf "%s\\n" "$*" >> "{_bash_path(sender_calls)}"\n')
    start = _fake(tmp_path / "start-agent",
                  f'printf "%s\\n" "$*" >> "{_bash_path(start_calls)}"\n')
    journal = logs / "agent-recoveries.tsv"
    # I confini si iniettano NELLO script, non nell'ambiente, e lo script gira
    # da file invece che da `bash -c`. Due motivi, entrambi appresi qui:
    #  • il prelude ha passato i 32 KB e su Windows la riga di comando non lo
    #    regge piu' (WinError 206);
    #  • dove il `bash` e' un ponte verso WSL l'ambiente Windows non attraversa
    #    il confine (passa solo cio' che e' in `WSLENV`), quindi una env passata
    #    a subprocess veniva ignorata in silenzio e il watchdog usava i default
    #    del container. Su POSIX il comportamento e' identico a prima.
    header = "".join(
        f"export {key}='{value}'\n"
        for key, value in (
            ("JHT_HOME", _bash_path(tmp_path)),
            ("JHT_NODE_BIN", _bash_path(node)),
            ("JHT_TMUX_SENDER", _bash_path(sender)),
            ("JHT_START_AGENT", _bash_path(start)),
            ("JHT_AGENT_RECOVERY_LOG", _bash_path(journal)),
        )
    )
    script_path = tmp_path / "case.sh"
    script_path.write_text(header + _prelude() + "\n" + body + "\n",
                           encoding="utf-8", newline="\n")
    result = subprocess.run(
        ["bash", _bash_path(script_path)],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        env={**os.environ},
    )
    return result, journal, node_calls, sender_calls, start_calls


def _rows(path: Path):
    if not path.exists():
        return []
    return [line.split("\t") for line in path.read_text(encoding="utf-8").splitlines()]


def test_core_recovery_is_durable_and_notified_with_its_daily_count(tmp_path):
    result, journal, node_calls, sender_calls, _ = _run(
        tmp_path,
        "checks=0\n"
        "is_session_alive() { checks=$((checks + 1)); [ $((checks % 2)) -eq 0 ]; }\n"
        "ensure_agent capitano\nensure_agent capitano",
    )

    assert result.returncode == 0, result.stderr
    assert node_calls.read_text().splitlines() == [
        "/app/cli/bin/jht.js team start capitano",
        "/app/cli/bin/jht.js team start capitano",
    ]
    rows = _rows(journal)
    assert [row[1:] for row in rows] == [
        ["CAPITANO", "inactive at the watchdog check"],
        ["CAPITANO", "inactive at the watchdog check"],
    ]
    assert all(row[0].endswith("Z") for row in rows)
    notices = sender_calls.read_text(encoding="utf-8").splitlines()
    assert len(notices) == 2
    assert "CAPITANO [WATCHDOG] Automatic recovery: CAPITANO was inactive at the watchdog check" in notices[0]
    assert "Recovery #1 for CAPITANO today" in notices[0]
    assert "Recovery #2 for CAPITANO today" in notices[1]
    assert "observed an inactive session, not the cause" in notices[1]


def test_worker_recovery_uses_the_same_measure_and_ttl_does_not_pollute_it(tmp_path):
    result, journal, _, sender_calls, start_calls = _run(
        tmp_path,
        "is_session_alive() { return 0; }\nworker_kickoff() { :; }\n"
        "respawn_worker scorer 2 SCORER-2 unexpected\n"
        "respawn_worker scorer 2 SCORER-2 intentional_ttl",
    )

    assert result.returncode == 0, result.stderr
    assert start_calls.read_text().splitlines() == ["scorer 2", "scorer 2"]
    assert [row[1:] for row in _rows(journal)] == [
        ["SCORER-2", "missing after recent worker activity"],
    ]
    notices = sender_calls.read_text(encoding="utf-8").splitlines()
    assert len(notices) == 1
    assert "Recovery #1 for SCORER-2 today" in notices[0]


def test_planned_core_refresh_and_failed_start_do_not_claim_a_recovery(tmp_path):
    planned, journal, _, sender_calls, _ = _run(
        tmp_path,
        "INTENTIONAL_RECREATE_SESSION=MENTOR\n"
        "checks=0\nis_session_alive() { checks=$((checks + 1)); [ $checks -eq 2 ]; }\n"
        "ensure_agent mentor",
    )
    assert planned.returncode == 0, planned.stderr
    assert _rows(journal) == []
    assert not sender_calls.exists()

    failed, failed_journal, _, failed_sender, _ = _run(
        tmp_path / "failed",
        "is_session_alive() { return 1; }\nensure_agent mentor",
        start_rc=1,
    )
    assert failed.returncode == 0, failed.stderr
    assert _rows(failed_journal) == []
    assert not failed_sender.exists()


def test_start_success_without_a_live_session_is_not_a_recovery(tmp_path):
    result, journal, _, sender_calls, _ = _run(
        tmp_path,
        "is_session_alive() { return 1; }\nensure_agent assistente",
    )

    assert result.returncode == 1
    assert _rows(journal) == []
    assert not sender_calls.exists()
