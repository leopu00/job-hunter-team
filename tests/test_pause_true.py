"""JHT-T181: la pausa VERA. Le sessioni restano accese col loro contesto, nessuno lavora, e alla
ripresa ognuno riparte dal punto in cui era. Non è lo spegnimento.

Origine (05/11): all'ordine «fate una pausa» l'Assistente ha chiesto un «controlled freeze» al Capitano,
che non aveva nessuna skill per la pausa e ha scritto `.team-halted.flag` + chiuso tutte le sessioni
(il contesto perso); l'utente ha letto «Paused ✅». Qui si fissa il motore: pausa di squadra «finché
dico io» (tetto 7 giorni), pausa del singolo agente, messaggi che dicono «pausa, non spegnimento»,
Assistente non zittito, esito onesto (chi è stato raggiunto e chi no).

Tutto gira su un tmux finto, un jht-tmux-send finto che registra e una JHT_HOME privata (come
test_agent_control.py): niente può toccare un tmux o un agente veri.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timedelta, timezone

import pytest

from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared" / "skills"))
from test_agent_control import Team  # noqa: E402,F401  (la stessa officina di finti)

ALL = ("CAPITANO", "ASSISTENTE", "SENTINELLA", "SCOUT-1", "ANALISTA-1")


@pytest.fixture
def team(tmp_path, monkeypatch):
    t = Team(tmp_path, monkeypatch)
    t.up(*ALL)
    return t


def _sent(team):
    """[(sessione, testo)] dal registro del jht-tmux-send finto: un invio = «SESSIONE [testo…», le righe
    che seguono (un messaggio può andare a capo) sono dello stesso invio."""
    log = team.tmp / "send.log"
    if not log.exists():
        return []
    out = []
    for line in log.read_text().splitlines():
        found = re.match(r"^([A-Z][A-Z0-9-]*) (\[.*)$", line)
        if found:
            out.append([found.group(1), found.group(2)])
        elif out:
            out[-1][1] += "\n" + line
    return [(a, b) for a, b in out]


def _to(team, session):
    return [m for s, m in _sent(team) if s == session]


def _flag(team):
    return json.loads((team.home / ".team-standby.flag").read_text())


# ── la pausa di squadra «finché dico io» ───────────────────────────────────
def test_a_pause_until_resumed_has_the_users_word_as_exit_and_a_seven_day_cap(team, capsys):
    before = datetime.now(timezone.utc)
    code, answer = team.run("pause", "--until-resumed", capsys=capsys)
    assert (code, answer["result"]) == (0, "paused")
    flag = _flag(team)
    assert flag["mode"] == "pause" and flag["manual"] is True and flag["requested_by"] == "user"
    until = datetime.fromisoformat(flag["until"])
    assert timedelta(days=7) - timedelta(seconds=10) <= until - before <= timedelta(days=7, seconds=10)


def test_a_pause_is_not_a_stop_and_nothing_is_closed(team, capsys):
    team.run("pause", "--until-resumed", capsys=capsys)
    assert all(team.alive(s) for s in ALL)                       # tmux ls: ci sono tutte
    assert not (team.home / ".team-halted.flag").exists()        # non è lo STOP
    assert "kill-session" not in (team.tmp / "tmux.log").read_text()
    assert not list(team.home.glob("**/*.hold.json"))             # e nessuno è «contenuto»


def test_every_role_is_told_it_is_a_pause_not_a_shutdown(team, capsys):
    team.run("pause", "--until-resumed", capsys=capsys)
    for session in ("SCOUT-1", "ANALISTA-1"):
        (text,) = _to(team, session)
        assert "[PAUSA]" in text and "PAUSE, not a shutdown" in text and "context stay" in text
        assert "WAIT SILENTLY" in text and "[RIPRENDI]" in text
    (captain,) = _to(team, "CAPITANO")
    # il Capitano è quello che il 05/11 ha spento tutto: gli si dice cosa NON fare
    assert "Do NOT write `.team-halted.flag`" in captain and "do NOT run `jht team stop`" in captain
    assert "do NOT kill or spawn any session" in captain
    (sentinel,) = _to(team, "SENTINELLA")
    assert "NOT a source failure" in sentinel


def test_the_assistente_is_not_silenced_and_is_told_what_is_true(team, capsys):
    team.run("pause", "--until-resumed", capsys=capsys)
    (text,) = _to(team, "ASSISTENTE")
    assert "You are NOT paused" in text and "every session is still on" in text
    assert "Do not wake the Capitano" in text


def test_a_pause_the_assistente_asked_for_does_not_tell_it_twice(team, capsys):
    code, answer = team.run("pause", "--until-resumed", "--from-assistant", capsys=capsys)
    assert code == 0
    assert _to(team, "ASSISTENTE") == []
    assert _flag(team)["requested_by"] == "assistente"
    assert "ASSISTENTE" not in answer["detail"]["reached"] + answer["detail"]["not_reached"]


def test_the_answer_says_who_was_reached_and_who_was_not(team, capsys):
    team.up("SCORER-1")
    # una sessione che non risponde al trasporto: il finto la rifiuta
    (team.tmp / "bin" / "jht-tmux-send").write_text(
        '#!/bin/bash\necho "$*" >> "$FAKE_TMUX_DIR/../send.log"\n[ "$1" = "SCORER-1" ] && exit 1\nexit 0\n')
    answer = team.run("pause", "--until-resumed", capsys=capsys)[1]
    detail = answer["detail"]
    assert "SCORER-1" in detail["not_reached"] and "SCORER-1" not in detail["reached"]
    assert {"CAPITANO", "ASSISTENTE", "SCOUT-1"} <= set(detail["reached"])
    assert detail["until_resumed"] is True


def test_until_resumed_excludes_the_other_exit_conditions(team, capsys):
    for extra in (("--for-hours", "2"), ("--wake-on-weekly",)):
        code, answer = team.run("pause", "--until-resumed", *extra, capsys=capsys)
        assert (code, answer["error"]) == (100, "agent_control_invalid")
    assert not (team.home / ".team-standby.flag").exists()


def test_resume_tells_everyone_to_pick_up_where_they_were(team, capsys):
    team.run("pause", "--until-resumed", capsys=capsys)
    (team.tmp / "send.log").unlink()
    assert team.run("resume", capsys=capsys)[1]["result"] == "resumed"
    assert not (team.home / ".team-standby.flag").exists()
    for session in ALL:
        (text,) = _to(team, session)
        assert "[RIPRENDI]" in text and "EXACTLY where you were" in text and "do not start over" in text


def test_the_team_read_says_pause_and_that_it_waits_for_the_user(team, capsys):
    team.run("pause", "--until-resumed", capsys=capsys)
    standby = team.run("team", capsys=capsys)[1]["data"]["standby"]
    assert standby["state"] == "active" and standby["mode"] == "pause" and standby["until_resumed"] is True
    team.run("resume", capsys=capsys)
    team.run("pause", "--for-hours", "2", capsys=capsys)
    standby = team.run("team", capsys=capsys)[1]["data"]["standby"]
    assert standby["mode"] == "pause" and standby["until_resumed"] is False


def test_the_technical_standby_keeps_its_old_flag_and_texts(tmp_path, monkeypatch):
    import standby as sb
    sb.STANDBY_FLAG = tmp_path / ".team-standby.flag"
    payload = sb.enter(wake_on_weekly=100)
    assert "mode" not in payload and "manual" not in payload
    assert sb.status()["mode"] == "standby" and sb.status()["manual"] is False


def test_only_a_pause_can_wait_for_the_user(tmp_path):
    import standby as sb
    sb.STANDBY_FLAG = tmp_path / ".team-standby.flag"
    with pytest.raises(ValueError):
        sb.enter(manual=True)                                      # lo standby tecnico non aspetta nessuno
    assert not sb.STANDBY_FLAG.exists()


def test_the_cap_rings_like_any_deadline(tmp_path):
    import standby as sb
    sb.STANDBY_FLAG = tmp_path / ".team-standby.flag"
    now = datetime(2026, 11, 5, 22, 0, tzinfo=timezone.utc)
    sb.enter(mode="pause", manual=True, reason="x", now=now)
    assert sb.status(now + timedelta(days=6))["state"] == "active"
    late = sb.status(now + timedelta(days=7, seconds=1))
    assert late["state"] == "expired" and late["active"] is False   # mai muti per sempre


# ── la pausa del singolo agente ────────────────────────────────────────────
def test_pausing_one_agent_tells_only_that_one_and_closes_nothing(team, capsys):
    code, answer = team.run("pause-agent", "SCOUT-1", capsys=capsys)
    assert (code, answer["result"]) == (0, "agent_paused") and answer["detail"] == {"notified": True}
    (text,) = _to(team, "SCOUT-1")
    assert "paused YOU" in text and "The rest of the team keeps working" in text
    assert [s for s, _ in _sent(team)] == ["SCOUT-1"]
    assert team.alive("SCOUT-1") and not (team.home / ".team-halted.flag").exists()
    assert not team.roster().is_contained("SCOUT-1")              # non è lo STOP: nessun blocco
    marker = json.loads((team.home / ".agent-pauses" / "SCOUT-1.json").read_text())
    until = datetime.fromisoformat(marker["until"])
    assert timedelta(days=7) - timedelta(minutes=1) <= until - datetime.now(timezone.utc) <= timedelta(days=7)


def test_the_list_marks_the_paused_agent(team, capsys):
    team.run("pause-agent", "SCOUT-1", capsys=capsys)
    rows = {r["name"]: r["paused"] for r in team.run("list", capsys=capsys)[1]["data"]["items"]}
    assert rows["SCOUT-1"] is True and rows["ANALISTA-1"] is False


def test_pausing_twice_is_one_message(team, capsys):
    team.run("pause-agent", "SCOUT-1", capsys=capsys)
    assert team.run("pause-agent", "SCOUT-1", capsys=capsys)[1]["result"] == "agent_already_paused"
    assert len(_to(team, "SCOUT-1")) == 1


def test_resume_agent_removes_the_mark_before_it_speaks(team, capsys):
    team.run("pause-agent", "SCOUT-1", capsys=capsys)
    assert team.run("resume-agent", "SCOUT-1", capsys=capsys)[1]["result"] == "agent_resumed"
    assert not (team.home / ".agent-pauses" / "SCOUT-1.json").exists()
    assert "EXACTLY where you were" in _to(team, "SCOUT-1")[-1]
    assert team.run("resume-agent", "SCOUT-1", capsys=capsys)[1]["result"] == "agent_not_paused"


@pytest.mark.parametrize("session,expected", [("SCORER-1", (107, "agent_not_running")),
                                              ("DOTTORE", (101, "agent_control_refused")),
                                              ("scout-1", (100, "agent_control_invalid"))])
def test_pause_agent_refuses_what_it_cannot_pause(team, capsys, session, expected):
    code, answer = team.run("pause-agent", session, capsys=capsys)
    assert (code, answer["error"]) == expected


def test_pause_agent_refuses_a_contained_agent_and_a_stopped_team(team, capsys):
    team.run("stop", "ANALISTA-1", capsys=capsys)
    team.up("ANALISTA-1")                                         # tornata su, ma il blocco dell'utente c'è
    assert team.run("pause-agent", "ANALISTA-1", capsys=capsys)[1]["error"] == "agent_contained"
    (team.home / ".team-halted.flag").write_text("halted_by=user\n")
    assert team.run("pause-agent", "SCOUT-1", capsys=capsys)[1]["error"] == "team_halted"


def test_stop_and_restart_clear_the_pause_of_the_old_session(team, capsys):
    team.run("pause-agent", "SCOUT-1", capsys=capsys)
    team.run("stop", "SCOUT-1", capsys=capsys)
    assert not (team.home / ".agent-pauses" / "SCOUT-1.json").exists()
    team.up("ANALISTA-1")
    team.run("pause-agent", "ANALISTA-1", capsys=capsys)
    team.run("restart", "ANALISTA-1", capsys=capsys)
    assert not (team.home / ".agent-pauses" / "ANALISTA-1.json").exists()


def test_the_team_resume_does_not_wake_an_agent_the_user_paused_alone(team, capsys):
    team.run("pause-agent", "SCOUT-1", capsys=capsys)
    team.run("pause", "--until-resumed", capsys=capsys)
    (team.tmp / "send.log").unlink()
    team.run("resume", capsys=capsys)
    assert _to(team, "SCOUT-1") == []
    assert len(_to(team, "ANALISTA-1")) == 1


# ── il predicato e la sveglia del tetto ────────────────────────────────────
def test_a_mark_without_a_valid_exit_or_past_it_is_not_a_pause(tmp_path):
    import agent_pause as ap
    now = datetime(2026, 11, 5, 22, 0, tzinfo=timezone.utc)
    (tmp_path / ".agent-pauses").mkdir()
    (tmp_path / ".agent-pauses" / "SCOUT-1.json").write_text('{"session": "SCOUT-1"}')
    (tmp_path / ".agent-pauses" / "SCOUT-2.json").write_text("{")
    assert not ap.is_paused("SCOUT-1", now, tmp_path) and ap.status("SCOUT-1", now, tmp_path)["state"] == "invalid"
    assert not ap.is_paused("SCOUT-2", now, tmp_path)
    ap.pause("SCOUT-3", now=now, home=tmp_path, notify=False)
    assert ap.is_paused("SCOUT-3", now + timedelta(days=6), tmp_path)
    assert not ap.is_paused("SCOUT-3", now + timedelta(days=7, seconds=1), tmp_path)
    assert ap.paused_sessions(now, tmp_path) == ["SCOUT-3"]
    assert ap.is_paused("../etc", now, tmp_path) is False           # nome fuori grammatica: mai un percorso


def test_the_cap_wakes_the_agent_and_removes_the_mark(tmp_path, monkeypatch):
    import agent_pause as ap
    sent = []
    monkeypatch.setattr(ap, "_send", lambda s, m: sent.append((s, m)) or True)
    monkeypatch.setattr(ap, "_live_sessions", lambda: ["SCOUT-3"])
    monkeypatch.setattr(ap, "LOG", tmp_path / "logs" / "agent-pauses.jsonl")
    now = datetime(2026, 11, 5, 22, 0, tzinfo=timezone.utc)
    ap.pause("SCOUT-3", now=now, home=tmp_path)
    assert ap.wake_expired(now + timedelta(days=1), tmp_path) == []
    assert ap.wake_expired(now + timedelta(days=8), tmp_path) == ["SCOUT-3"]
    assert not (tmp_path / ".agent-pauses" / "SCOUT-3.json").exists()
    assert sent[-1][0] == "SCOUT-3" and "7 day limit" in sent[-1][1]


# ── chi manda cose a un agente solo la rispetta ────────────────────────────
def _load_file(name, path):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


REPO = Path(__file__).resolve().parent.parent


def _mark(home, session, days=1):
    d = home / ".agent-pauses"
    d.mkdir(parents=True, exist_ok=True)
    until = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    (d / f"{session}.json").write_text(json.dumps({"session": session, "since": 1, "until": until}))


def test_the_stepcap_watchdog_leaves_a_paused_agent_alone(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    wd = _load_file("stepcap_under_pause_test", REPO / ".launcher" / "stepcap-watchdog.py")
    touched = []
    monkeypatch.setattr(wd, "capture_pane", lambda s: touched.append(s))
    _mark(tmp_path, "SCOUT-1")
    wd._handle_agent("SCOUT-1", "scout-1", {}, 1000.0, 0)
    assert touched == []                                            # nemmeno guardato, figurarsi nudge
    wd._handle_agent("SCOUT-2", "scout-2", {}, 1000.0, 0)
    assert touched == ["SCOUT-2"]                                   # gli altri, come prima


def test_the_unblock_scan_skips_a_paused_agent(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    ub = _load_file("agent_unblock_under_pause_test", REPO / "shared" / "skills" / "agent_unblock.py")

    class R:
        returncode = 0
        stdout = "SCOUT-1\nSCOUT-2\nCAPITANO\n"
    monkeypatch.setattr(ub, "_tmux", lambda *a, **k: R())
    _mark(tmp_path, "SCOUT-1")
    assert sorted(ub.agent_sessions()) == ["CAPITANO", "SCOUT-2"]


def _bash_fn(name):
    src = (REPO / ".launcher" / "agent-watchdog.sh").read_text()
    start = src.index(f"{name}() {{")
    return src[start:src.index("\n}\n", start) + 3]


def _run_bash(tmp_path, call):
    import subprocess
    script = f'JHT_HOME="{tmp_path}"\nAGENT_PAUSE_PY="{REPO}/shared/skills/agent_pause.py"\n{_bash_fn("agent_is_paused")}\n{call}\n'
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=20).returncode


def test_the_agent_watchdog_predicate_says_paused_only_for_a_live_pause(tmp_path):
    assert _run_bash(tmp_path, 'agent_is_paused SCOUT-1') == 1             # nessun marcatore
    _mark(tmp_path, "SCOUT-1")
    assert _run_bash(tmp_path, 'agent_is_paused SCOUT-1') == 0
    assert _run_bash(tmp_path, 'agent_is_paused SCOUT-2') == 1
    _mark(tmp_path, "SCOUT-3", days=-1)                                      # scaduta: non e' una pausa
    assert _run_bash(tmp_path, 'agent_is_paused SCOUT-3') == 1


def test_the_refreshes_and_the_mail_tick_of_the_watchdog_ask_the_predicate():
    src = (REPO / ".launcher" / "agent-watchdog.sh").read_text()
    for fn in ("maybe_refresh_sentinella", "maybe_ttl_refresh", "maybe_mail_tick"):
        body = src[src.index(f"{fn}() {{"):]
        body = body[:body.index("\n}\n")]
        assert "agent_is_paused" in body, f"{fn} would wipe or wake a paused agent"


def test_the_sentinel_bridge_rings_the_cap_of_the_agent_pauses_every_tick():
    src = (REPO / ".launcher" / "sentinel-bridge.py").read_text()
    assert "_standby_step(parsed)\n        _agent_pause_step()" in src
