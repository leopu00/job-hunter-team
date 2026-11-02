"""Il TTL dei coordinatori: tetto duro a 24 h e, sotto il tetto, solo in orario di lavoro e con il contesto >= 50%.

Fino al 02/11/2026 il TTL era di sola eta' (12 h) e ignorava l'orario di proposito: nell'incidente del 28-29/07 le
sessioni avevano 38,5 · 29,5 · 27,0 · 14,5 · 14,2 ore e TUTTE le euristiche dicevano «sano» mentre il team era fermo da
undici ore. Misurando i cicli di una squadra reale (29/10 - 02/11), la maggior parte delle ricreazioni cadeva quando la squadra dorme
o ai bordi dell'orario: un kick-off LLM dei core senza niente da fare.

Il TTL di sola eta' era la risposta giusta a un'euristica che sbaglia; il tetto duro la mantiene. Le sessioni piu'
vecchie dell'incidente avevano 38,5 · 29,5 · 27 h: a 24 h il tetto le ricrea comunque, di giorno e di notte, senza
guardare ne' orario ne' contesto ne' PARKED (test_doctor_unblock_ttl.py, 01/02/11c). Fra 12 h e il tetto:

  1. in orario e contesto >= 50%        → ricreata;
  2. in orario e contesto < 50%         → resta;
  3. contesto non misurato / strumento assente → resta (vale solo il tetto);
  4. fuori orario                        → resta, e alla riapertura (in orario) scatta se il contesto lo chiede.
"""
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from fake_tmux import FakeTmux

REPO_ROOT = Path(__file__).resolve().parent.parent
LAUNCHER = REPO_ROOT / ".launcher" / "agent-watchdog.sh"


def _now():
    return datetime.now(timezone.utc)


def _hours_ago(h):
    return int((_now() - timedelta(hours=h)).timestamp())


def _prelude():
    src = LAUNCHER.read_text()
    return src[: src.index('log "watchdog start')]


@pytest.fixture
def home(tmp_path):
    h = tmp_path / "jht_home"
    (h / "logs").mkdir(parents=True)
    return h


def _hours(home, inside):
    """Orario di lavoro che contiene (o esclude) l'ora attuale."""
    now = _now()
    if inside:
        start, end = (now - timedelta(hours=2)).hour, (now + timedelta(hours=2)).hour
    else:
        start, end = (now + timedelta(hours=3)).hour, (now + timedelta(hours=5)).hour
    (home / "jht.config.json").write_text(json.dumps({"team": {"working_hours": {
        "timezone": "UTC",
        "windows": [{"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                     "start": f"{start:02d}:00", "end": f"{end:02d}:00"}]}}}))


def _context_tool(tmp_path, pct):
    """Un finto session_context.py: stampa il JSON che la skill vera stampa (pct null = non misurato)."""
    tool = tmp_path / "session_context.py"
    tool.write_text("import json, sys\nprint(json.dumps({'session': sys.argv[1], 'pct': %r, 'closed': True}))\n" % (pct,))
    return tool


def _run(tmp_path, home, sessions, *, pct=None, inside=True, tool=True, state=None):
    tmux = FakeTmux(tmp_path / "fake", sessions)
    fake_start = tmux.bin / "start-agent.sh"
    fake_start.write_text("#!/bin/sh\nexit 0\n")
    fake_start.chmod(0o755)
    _hours(home, inside)
    env = {
        "JHT_START_AGENT": str(fake_start),
        "JHT_APP_ROOT": str(REPO_ROOT),
        "JHT_AGENT_TTL_STATE_DIR": str(state or home / "state"),
        "JHT_SESSION_CONTEXT_TOOL": str(_context_tool(tmp_path, pct)) if tool else str(tmp_path / "missing.py"),
    }
    r = subprocess.run(["bash", "-c", _prelude() + "\nmaybe_ttl_refresh\n"], text=True, capture_output=True,
                       env=tmux.env(home, **env))
    assert r.returncode == 0, r.stderr
    return tmux, r


def test_between_12h_and_the_cap_a_full_context_in_hours_is_recreated(tmp_path, home):
    tmux, r = _run(tmp_path, home, {"CAPITANO": {"created": _hours_ago(13)}}, pct=72.5)
    assert "CAPITANO" not in tmux.sessions()
    assert "context 72.5% used" in r.stdout


def test_the_threshold_itself_counts(tmp_path, home):
    tmux, _ = _run(tmp_path, home, {"CAPITANO": {"created": _hours_ago(13)}}, pct=50)
    assert "CAPITANO" not in tmux.sessions()


def test_between_12h_and_the_cap_a_light_context_stays(tmp_path, home):
    tmux, r = _run(tmp_path, home, {"CAPITANO": {"created": _hours_ago(20)}}, pct=49)
    assert "CAPITANO" in tmux.sessions()
    assert "ttl:" not in r.stdout


def test_an_unmeasured_context_waits_for_the_cap(tmp_path, home):
    tmux, _ = _run(tmp_path, home, {"CAPITANO": {"created": _hours_ago(20)}}, pct=None)
    assert "CAPITANO" in tmux.sessions()


def test_a_missing_context_tool_waits_for_the_cap(tmp_path, home):
    tmux, _ = _run(tmp_path, home, {"CAPITANO": {"created": _hours_ago(20)}}, pct=90, tool=False)
    assert "CAPITANO" in tmux.sessions()


def test_outside_working_hours_nothing_is_recreated_below_the_cap(tmp_path, home):
    tmux, r = _run(tmp_path, home, {"CAPITANO": {"created": _hours_ago(14)},
                                    "SCOUT-1": {"created": _hours_ago(23)}}, pct=95, inside=False)
    assert {"CAPITANO", "SCOUT-1"} <= set(tmux.sessions())
    assert "ttl:" not in r.stdout


def test_the_same_session_is_recreated_once_the_hours_open(tmp_path, home):
    """Fuori orario aspetta; alla riapertura il contesto pieno la fa ricreare (la scadenza si sposta, non sparisce)."""
    sessions = {"CAPITANO": {"created": _hours_ago(14)}}
    tmux, _ = _run(tmp_path, home, sessions, pct=95, inside=False)
    assert "CAPITANO" in tmux.sessions()
    (tmp_path / "second").mkdir()
    tmux, _ = _run(tmp_path / "second", home, sessions, pct=95, inside=True)
    assert "CAPITANO" not in tmux.sessions()


def test_the_hard_cap_wins_over_hours_and_context(tmp_path, home):
    tmux, r = _run(tmp_path, home, {"MENTOR": {"created": _hours_ago(24) - 60}}, pct=3, inside=False, tool=False)
    assert "MENTOR" not in tmux.sessions()
    assert "hard cap 24h" in r.stdout


def test_the_cap_is_overridable_and_never_below_the_age_threshold(tmp_path, home):
    src = LAUNCHER.read_text()
    assert 'AGENT_HARD_CAP_H="${JHT_AGENT_HARD_CAP_H:-24}"' in src
    assert 'AGENT_TTL_CONTEXT_PCT="${JHT_AGENT_TTL_CONTEXT_PCT:-50}"' in src


def test_a_context_just_measured_is_not_measured_again_every_tick(tmp_path, home):
    """Il watchdog gira ogni 30 s: una misura sotto soglia vale per AGENT_TTL_CONTEXT_RECHECK_SEC."""
    state = home / "state"
    sessions = {"CAPITANO": {"created": _hours_ago(14)}}
    _run(tmp_path, home, sessions, pct=10, state=state)
    assert (state / "ttl-ctx-CAPITANO").exists()
    (tmp_path / "again").mkdir()
    tmux, _ = _run(tmp_path / "again", home, sessions, pct=99, state=state)
    assert "CAPITANO" in tmux.sessions(), "la misura recente non e' stata riusata"


def test_one_session_per_tick_oldest_first_among_the_eligible(tmp_path, home):
    tmux, r = _run(tmp_path, home, {"CAPITANO": {"created": _hours_ago(13)},
                                    "SENTINELLA": {"created": _hours_ago(18)},
                                    "MENTOR": {"created": _hours_ago(16)}}, pct=80)
    killed = [c[c.index("-t") + 1] for c in tmux.calls("kill-session")]
    assert killed == ["=SENTINELLA"], killed
