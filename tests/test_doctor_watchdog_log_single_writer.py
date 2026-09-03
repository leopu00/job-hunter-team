"""Un path di log, un solo scrittore.

`doctor-watchdog.sh` scriveva con `tee -a` su logs/doctor-watchdog.log, e pid1
cattura la stdout dello stesso processo sullo stesso path
(`spawnLabeled('doctor-watchdog')`). Due scrittori significavano ogni riga
scritta due volte nello stesso file — byte doppi su un bind mount — e, appena
qualcuno ruota il file mentre il daemon gira, un fd persistente che continua a
scrivere su un inode scollegato: da quel momento meta' del diario e'
invisibile.

Il pattern vigente nel repo e' un path per scrittore, col `tee` mantenuto
perche' e' cosi' che la rotazione arriva gratis da pid1 (vedi
docs/internal/reviews/2026-09-01-lee-launcher-prs/223-4-igiene-log.md §2.1 e
214-7-osservabilita-spawn.md §6.4).
"""

import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / ".launcher"
PID1 = ROOT / "cli" / "src" / "commands" / "pid1.js"

# (script bash, label di spawnLabeled in pid1.js)
PID1_BASH_DAEMONS = (
    ("agent-watchdog.sh", "watchdog"),
    ("pager-unstick-watchdog.sh", "pager-unstick"),
    ("doctor-watchdog.sh", "doctor-watchdog"),
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _log_paths(source: str) -> set[str]:
    """I nomi di file .log a cui lo script scrive (tee/redirect/jht_daemon_log)."""
    names: set[str] = set()
    for line in source.splitlines():
        if line.strip().startswith("#"):
            continue
        for match in re.finditer(r"([A-Za-z0-9_.-]+\.log)", line):
            if "tee " in line or ">>" in line or "jht_daemon_log" in line or "LOG" in line:
                names.add(match.group(1))
    return names


@pytest.mark.parametrize(("script", "label"), PID1_BASH_DAEMONS)
def test_no_pid1_child_writes_on_the_path_pid1_already_owns(script: str, label: str):
    # pid1 apre $JHT_HOME/logs/<label>.log con un fd persistente e lo ruota con
    # renameSync: quel path deve avere lui come unico scrittore.
    # NOTA: `auto-report-loop.sh` / label `auto-report` ha ancora la stessa
    # collisione. E' fuori dal perimetro di questo fix, non una svista.
    written = _log_paths(_read(LAUNCHER / script))
    assert f"{label}.log" not in written, (
        f"{script} scrive sul path di pid1 ({label}.log): due scrittori"
    )
    assert written, f"{script} deve avere un proprio diario"


def test_pid1_still_owns_the_historical_doctor_watchdog_log():
    # La continuita' storica sta qui: doctor-watchdog.log continua a esistere e
    # a ricevere le stesse righe, via la cattura della stdout da parte di pid1.
    # Se questa label cambia, il path storico smette di essere alimentato.
    assert "spawnLabeled('doctor-watchdog'" in _read(PID1)


def test_the_loop_keeps_teeing_so_pid1_still_sees_and_rotates_the_lines():
    # Il `tee` non e' cosmesi: e' il meccanismo con cui la famiglia dei daemon
    # bash di pid1 ottiene una copia ruotata (223-4 §2.4).
    source = _read(LAUNCHER / "doctor-watchdog.sh")
    body = source[source.index("\nlog() {") :]
    body = body[: body.index("\n}\n")]
    assert 'tee -a "$LOG_FILE"' in body


def test_the_loop_diary_has_a_name_of_its_own_and_a_rotation():
    source = _read(LAUNCHER / "doctor-watchdog.sh")
    assert 'LOG_FILE="$(jht_daemon_log doctor-watchdog-loop.log)"' in source
    # jht_daemon_log ruota solo quando viene chiamata: un loop che vive mesi la
    # deve richiamare, altrimenti il diario cresce senza limite.
    finish = source[source.index("finish_tick() {") :]
    finish = finish[: finish.index("\n}\n")]
    assert "jht_daemon_log doctor-watchdog-loop.log" in finish


def test_the_diary_still_lives_under_the_persistent_logs_directory():
    # jht_daemon_log risolve sotto $JHT_LOGS_DIR/$JHT_HOME/logs, che e'
    # bind-mountata: /tmp e' il layer effimero e i log ci sparivano a ogni
    # recreate del container.
    daemon_lib = _read(LAUNCHER / "daemon-lib.sh")
    assert 'JHT_LOGS_DIR:-${JHT_HOME:-/jht_home}/logs' in daemon_lib
    source = _read(LAUNCHER / "doctor-watchdog.sh")
    assert 'jht_daemon_log() { printf ' in source, "fallback se daemon-lib manca"
