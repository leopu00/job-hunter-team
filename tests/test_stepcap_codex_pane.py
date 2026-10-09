"""Il watchdog degli stalli davanti al pane di un worker CODEX.

La rilevazione senza marcatore (pane immobile per IDLE_STALL_ROUNDS giri) è
indipendente dal provider, ma i test esistenti la provano solo su pane in stile
Claude/Kimi (box `│ >`). Codex disegna altro: composer `›`, riga di stato
`• Working (1m 23s • esc to interrupt)` col timer che avanza mentre lavora, e a
quota esaurita «You've hit your usage limit», che non contiene «limit reached».

Misura di riferimento: nella prova live dell'08/10 il pane dello Scout Codex,
fermo dopo il primo `task_complete`, ha tenuto lo stesso sha256 per 41 minuti.
Un pane Codex fermo è immobile davvero, quindi la strada per hash lo vede.
"""

import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_watchdog():
    path = REPO_ROOT / ".launcher" / "stepcap-watchdog.py"
    spec = importlib.util.spec_from_file_location("stepcap_watchdog_codex", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


wd = _load_watchdog()

T0 = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc).timestamp()
ROUNDS = 4

CODEX_TRANSCRIPT = (
    "• Ran python3 /app/agents/_tools/jht-db positions count\n"
    "  └ 0\n"
    "\n"
    "• Giro chiuso: nessuna posizione nuova da salvare.\n"
    "\n"
)

CODEX_IDLE = CODEX_TRANSCRIPT + (
    "› Summarize recent commits\n"
    "\n"
    "  gpt-5.5 high · 82% context left · /jht_home/agents/scout-1\n"
)


def codex_working(seconds):
    return CODEX_TRANSCRIPT + (
        "• Working (%dm %02ds • esc to interrupt)\n"
        "\n"
        "› \n"
        "\n"
        "  gpt-5.5 high · 82%% context left · /jht_home/agents/scout-1\n"
        % divmod(seconds, 60)
    )


CODEX_QUOTA = CODEX_TRANSCRIPT + (
    "■ You've hit your usage limit. Upgrade to Plus to continue using Codex "
    "(https://chatgpt.com/explore/plus), or try again at 6:12 PM.\n"
    "\n"
    "› \n"
    "\n"
    "  gpt-5.5 high · 82% context left · /jht_home/agents/scout-1\n"
)


class FakeTmux:
    def __init__(self, sessions):
        self.panes = dict(sessions)
        self.resumes = []

    def install(self, monkeypatch):
        monkeypatch.setattr(wd, "list_sessions",
                            lambda: [(n, "1000") for n in self.panes])
        monkeypatch.setattr(wd, "capture_pane", lambda s: self.panes.get(s))
        monkeypatch.setattr(wd, "send_resume", self._send)
        return self

    def _send(self, session, agent, message):
        self.resumes.append({"session": session, "msg": message})
        self.panes[session] += "› %s\n" % message
        return True


CAPTAIN_MSGS = []


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_STEPCAP_MARKERS", raising=False)
    (tmp_path / "jht.config.json").write_text(
        json.dumps({"active_provider": "openai"}), encoding="utf-8")
    wd._MODULE_CACHE.clear()
    monkeypatch.setattr(wd, "_host_agent_cap", lambda: None)
    monkeypatch.setattr(wd, "produced_count", lambda agent: None)
    monkeypatch.setattr(wd, "notify_captain",
                        lambda msg: CAPTAIN_MSGS.append(msg) or True)
    CAPTAIN_MSGS.clear()
    monkeypatch.setattr(wd, "HEARTBEAT_SEC", 10 ** 9)
    # Solo per accorciare il test: la soglia vera non si tocca (15 giri).
    monkeypatch.setattr(wd, "IDLE_STALL_ROUNDS", ROUNDS)
    return tmp_path


def events(kind):
    path = wd.event_log_path()
    if not path.exists():
        return []
    return [rec for rec in map(json.loads, path.read_text().splitlines())
            if rec.get("event") == kind]


def test_a_still_codex_worker_gets_woken_up(home, monkeypatch):
    fake = FakeTmux({"SCOUT-1": CODEX_IDLE}).install(monkeypatch)
    for i in range(ROUNDS):
        wd.tick(now=T0 + i * 60)
    assert events("detected") == [], "scattato prima della soglia"

    t = T0 + ROUNDS * 60
    wd.tick(now=t)
    detected = events("detected")
    assert len(detected) == 1 and detected[0]["agent"] == "scout-1"
    assert "unchanged" in detected[0]["marker"]

    sec = events("throttled")[0]["throttle_sec"]
    wd.tick(now=t + sec)
    assert len(fake.resumes) == 1
    assert fake.resumes[0]["msg"].startswith("[FROM @SYSTEM TO @SCOUT-1]")

    wd.tick(now=t + sec + 60)
    assert events("resume_failed") == []


def test_a_working_codex_worker_is_left_alone(home, monkeypatch):
    """Turno lungo senza output nuovo: solo il timer di `Working` avanza, e basta
    quello a dire che non è fermo."""
    fake = FakeTmux({"SCOUT-1": codex_working(0)}).install(monkeypatch)
    for i in range(ROUNDS * 3):
        fake.panes["SCOUT-1"] = codex_working(i * 60)
        wd.tick(now=T0 + i * 60)
    assert events("detected") == []
    assert fake.resumes == []


def test_codex_quota_wall_is_recognised(home):
    tail = wd.pane_tail(CODEX_QUOTA)
    line = wd.find_usage_limit(tail)
    assert line is not None and "hit your usage limit" in line
    said = wd.describe_stall("no marker: pane unchanged for 15 cycles", 15, line)
    assert "usage quota" in said and "not moved" not in said


def test_a_codex_quota_wall_is_not_sent_to_the_captain_as_a_rabbit_hole(home, monkeypatch):
    """Al terzo stallo il Capitano viene avvisato: deve leggere «quota», non
    «inspect what is running»."""
    monkeypatch.setattr(wd, "throttle_for", lambda agent, consecutive: 60)
    fake = FakeTmux({"SCOUT-1": CODEX_QUOTA}).install(monkeypatch)
    # Una ripresa contro una quota vuota non produce niente: il pane torna
    # identico, ed è proprio lo stallo che si ripete.
    monkeypatch.setattr(fake, "_send", lambda *a: True)
    monkeypatch.setattr(wd, "send_resume", fake._send)
    t = T0
    for _ in range(40):
        wd.tick(now=t)
        t += 60
        if len(events("throttled")) >= wd.ESCALATE_AT - 1:
            break
    assert len(events("throttled")) == wd.ESCALATE_AT - 1
    assert CAPTAIN_MSGS, "il terzo stallo deve avvisare il Capitano"
    assert "usage quota" in CAPTAIN_MSGS[-1]
    assert "Inspect what is running" not in CAPTAIN_MSGS[-1]
