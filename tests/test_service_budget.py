"""The service roles (Dottore, Mantenitore, Mentor) take at most a share of the budget: the money goes to finding and scoring.

Measured on a run of 47 minutes with a budget of 3 $ for 24 hours: the three roles spent 0.85 $ of 1.97 $ (43 %) and the budget
was over before the six new positions were scored. Here: the decision (service_budget.py), where it is taken (the schedule of the
Dottore and of the Mantenitore, the Mentor gate of the watchdog and of start-agent.sh) and the notice to the person, in their
language, once a day. Synthetic sessions in the shape pi writes, round numbers, no model, no tmux.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
sys.path.insert(0, str(ROOT / "shared"))
import service_budget as sb  # noqa: E402

NOW = datetime(2026, 11, 18, 9, 0, 0, tzinfo=timezone.utc).timestamp()
STARTS = NOW - 3 * 3600


def _stamp(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _calls(home: Path, agent: str, calls: list[tuple[float, float]]) -> None:
    """calls: (epoch second, cost in dollars) of one agent, in the file pi writes."""
    folder = home / ".pi" / "agent" / "sessions" / f"--jht_home-agents-{agent}--"
    folder.mkdir(parents=True, exist_ok=True)
    rows = [{"type": "session", "version": 3, "id": agent, "cwd": f"/jht_home/agents/{agent}"}]
    for ts, cost in calls:
        rows.append({"type": "message", "timestamp": _stamp(ts), "message": {"role": "assistant", "usage": {
            "input": 0, "output": 10, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0,
            "cost": {"total": cost, "totalFromProvider": False}}}})
    path = folder / f"{agent}.jsonl"
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    last = max(ts for ts, _cost in calls)
    os.utime(path, (last, last))


def _config(home: Path, budget: dict | None = None) -> None:
    team = {"budget": budget} if budget else {}
    (home / "jht.config.json").write_text(json.dumps({"active_provider": "claude", "team": team}), encoding="utf-8")


BUDGET = {"usd": 3, "starts_at": _stamp(STARTS).replace(".000Z", "+00:00"), "ends_at": _stamp(STARTS + 86400).replace(".000Z", "+00:00")}


@pytest.fixture
def home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_SERVICE_BUDGET_SHARE", raising=False)
    return tmp_path


# ── the decision ─────────────────────────────────────────────────────────────────────────────────────────────────

def test_no_budget_no_limit(home: Path) -> None:
    _config(home)
    _calls(home, "dottore", [(NOW - 600, 5.0)])
    assert sb.verdict("dottore", NOW, home)["allowed"] is True


def test_the_limit_is_fifteen_percent_of_the_budget(home: Path) -> None:
    _config(home, BUDGET)
    result = sb.verdict("dottore", NOW, home)
    assert result["limit"] == 0.45 and result["budget"] == 3.0 and result["share"] == 0.15 and result["allowed"] is True


def test_below_the_share_a_round_may_start_and_at_it_it_may_not(home: Path) -> None:
    _config(home, BUDGET)
    _calls(home, "dottore", [(NOW - 900, 0.20)])
    _calls(home, "mentor", [(NOW - 800, 0.20)])
    assert sb.verdict("mantenitore", NOW, home)["allowed"] is True     # 0.40 of 0.45
    _calls(home, "mantenitore", [(NOW - 700, 0.06)])
    result = sb.verdict("mantenitore", NOW, home)                       # 0.46
    assert result["allowed"] is False and result["spent"] == pytest.approx(0.46)


def test_the_three_service_roles_share_one_limit(home: Path) -> None:
    _config(home, BUDGET)
    _calls(home, "mentor", [(NOW - 100, 0.50)])
    for role in sb.SERVICE_ROLES:
        assert sb.verdict(role, NOW, home)["allowed"] is False, role


def test_the_search_roles_do_not_count_and_do_not_wait(home: Path) -> None:
    _config(home, BUDGET)
    _calls(home, "scout-1", [(NOW - 100, 2.0)])
    _calls(home, "capitano", [(NOW - 100, 0.5)])
    assert sb.verdict("dottore", NOW, home)["spent"] == 0
    assert sb.verdict("dottore", NOW, home)["allowed"] is True


def test_what_was_spent_before_the_budget_counts_from_is_not_counted(home: Path) -> None:
    _config(home, BUDGET)
    _calls(home, "dottore", [(STARTS - 3600, 4.0), (NOW - 100, 0.05)])
    assert sb.verdict("dottore", NOW, home)["spent"] == pytest.approx(0.05)


def test_the_instances_of_a_role_are_of_that_role(home: Path) -> None:
    _config(home, BUDGET)
    _calls(home, "mantenitore", [(NOW - 100, 0.2)])
    _calls(home, "mentor", [(NOW - 100, 0.3)])
    assert sb.verdict("dottore", NOW, home)["allowed"] is False


@pytest.mark.parametrize("text", ["{not json", "[]", ""])
def test_an_unreadable_configuration_is_no_limit(home: Path, text: str) -> None:
    (home / "jht.config.json").write_text(text, encoding="utf-8")
    assert sb.verdict("dottore", NOW, home)["allowed"] is True


def test_the_share_can_be_moved_for_a_run(home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _config(home, BUDGET)
    _calls(home, "dottore", [(NOW - 100, 0.5)])
    assert sb.verdict("dottore", NOW, home)["allowed"] is False
    monkeypatch.setenv("JHT_SERVICE_BUDGET_SHARE", "0.5")
    assert sb.verdict("dottore", NOW, home)["allowed"] is True
    monkeypatch.setenv("JHT_SERVICE_BUDGET_SHARE", "banana")   # not a number: the default stands
    assert sb.verdict("dottore", NOW, home)["share"] == 0.15


# ── the person is told once a day, in their language ─────────────────────────────────────────────────────────────

def _over(home: Path) -> None:
    _config(home, BUDGET)
    _calls(home, "dottore", [(NOW - 100, 0.5)])


def test_the_person_is_told_once_a_day(home: Path) -> None:
    _over(home)
    sent: list[tuple[str, str]] = []
    sb.allow("dottore", NOW, home, notify=lambda text, source: sent.append((text, source)))
    sb.allow("mentor", NOW + 600, home, notify=lambda text, source: sent.append((text, source)))
    assert len(sent) == 1 and sent[0][1] == "service-budget-2026-11-18"
    sb.allow("dottore", NOW + 86400, home, notify=lambda text, source: sent.append((text, source)))
    assert len(sent) == 2


def test_a_notice_that_does_not_go_is_tried_again_and_the_round_is_skipped_all_the_same(home: Path) -> None:
    _over(home)

    def down(text: str, source: str) -> None:
        raise RuntimeError("jht-notify-user is unavailable")

    assert sb.allow("dottore", NOW, home, notify=down)["allowed"] is False
    sent: list[str] = []
    sb.allow("dottore", NOW, home, notify=lambda text, source: sent.append(text))
    assert len(sent) == 1


def test_an_allowed_round_tells_nobody(home: Path) -> None:
    _config(home, BUDGET)
    sent: list[str] = []
    assert sb.allow("dottore", NOW, home, notify=lambda text, source: sent.append(text))["allowed"] is True
    assert sent == []


@pytest.mark.parametrize("lang", ["en", "it", "hu", "es", "de", "fr", "pt"])
def test_the_text_is_in_the_language_of_the_person_and_carries_the_numbers(home: Path, lang: str) -> None:
    import i18n

    _over(home)
    (home / "i18n-prefs.json").write_text(json.dumps({"locale": lang}), encoding="utf-8")
    i18n._resolve_lang_for.cache_clear()
    try:
        result = sb.verdict("dottore", NOW, home)
        text = sb.notice_text(result)
    finally:
        i18n._resolve_lang_for.cache_clear()
    assert "service_budget" not in text, "the key came back: the catalog of this language lacks the text"
    assert "Dottore" in text and "0.5 USD" in text and "3 USD" in text and "15%" in text
    english = json.loads((ROOT / "shared" / "locales" / "en.json").read_text(encoding="utf-8"))["service_budget.skipped"]
    if lang != "en":
        assert text != english.replace("%s", "x")


def test_every_language_has_the_text_with_the_same_four_slots() -> None:
    for lang in ("en", "it", "hu", "es", "de", "fr", "pt"):
        value = json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))["service_budget.skipped"]
        assert value.count("%s") == 4, lang


# ── the command ──────────────────────────────────────────────────────────────────────────────────────────────────

def _run(home: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "JHT_HOME": str(home), "PATH": os.environ.get("PATH", "")}
    return subprocess.run([sys.executable, "-I", str(SKILLS / "service_budget.py"), *args], capture_output=True, text=True, env=env, check=False)


def test_the_command_exits_0_when_allowed_and_3_when_skipped(home: Path) -> None:
    _config(home, BUDGET)
    assert _run(home, "allow", "mentor").returncode == 0
    _calls(home, "mentor", [(time.time() - 60, 0.5)])
    # the budget of the fixture is the one of NOW: bring it to the real clock
    now = time.time()
    _config(home, {"usd": 3, "starts_at": datetime.fromtimestamp(now - 3600, timezone.utc).isoformat(),
                   "ends_at": datetime.fromtimestamp(now + 86400, timezone.utc).isoformat()})
    done = _run(home, "allow", "mentor")
    assert done.returncode == sb.SKIPPED == 3, done.stdout + done.stderr
    assert json.loads(done.stdout.splitlines()[-1])["allowed"] is False


@pytest.mark.parametrize("args", [(), ("allow",), ("allow", "scout"), ("deny", "mentor")])
def test_the_command_refuses_what_it_does_not_know(home: Path, args: tuple[str, ...]) -> None:
    assert _run(home, *args).returncode == 2


# ── where the round is not started ───────────────────────────────────────────────────────────────────────────────

def _schedule(home: Path, monkeypatch: pytest.MonkeyPatch):
    spec = importlib.util.spec_from_file_location("doctor_schedule_service_budget", SKILLS / "doctor_schedule.py")
    ds = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ds)
    start = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=7)
    monkeypatch.setattr(ds, "JHT_HOME", home)
    monkeypatch.setattr(ds, "STATE_FILE", home / "logs" / "doctor-schedule-state.json")
    monkeypatch.setattr(ds, "_bounds_now", lambda: (start, start + timedelta(hours=12), datetime.now(timezone.utc)))
    monkeypatch.setattr(ds, "_today_local", lambda: "2026-11-18")
    monkeypatch.setattr(ds, "is_within_working_hours", lambda: True)
    return ds


def _over_now(home: Path) -> None:
    now = time.time()
    _config(home, {"usd": 3, "starts_at": datetime.fromtimestamp(now - 3600 * 5, timezone.utc).isoformat(),
                   "ends_at": datetime.fromtimestamp(now + 86400, timezone.utc).isoformat()})
    _calls(home, "dottore", [(now - 600, 0.5)])


def test_the_dottore_slot_is_not_claimed_over_the_share_and_comes_back_under_it(home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ds = _schedule(home, monkeypatch)
    monkeypatch.setattr(sb, "_notify_user", lambda text, source: None)
    _over_now(home)
    assert ds.claim() == "WAIT"
    state = json.loads((home / "logs" / "doctor-schedule-state.json").read_text(encoding="utf-8")) if (home / "logs" / "doctor-schedule-state.json").exists() else {}
    assert not state.get("claimed_t30") and not state.get("claimed_mid"), "a skipped round is not claimed"
    monkeypatch.setenv("JHT_SERVICE_BUDGET_SHARE", "0.9")   # a new budget, or a larger share: the same slot is due again
    assert ds.claim() in ("T30", "MID")


def test_the_dottore_fallback_slot_is_not_claimed_over_the_share(home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ds = _schedule(home, monkeypatch)
    monkeypatch.setattr(sb, "_notify_user", lambda text, source: None)
    monkeypatch.setattr(ds, "_bounds_now", lambda: None)
    _over_now(home)
    assert ds.claim() == "WAIT"
    monkeypatch.setenv("JHT_SERVICE_BUDGET_SHARE", "0.9")
    assert ds.claim() == "FALLBACK"


def test_the_mantenitore_is_not_due_over_the_share(home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ds = _schedule(home, monkeypatch)
    monkeypatch.setattr(sb, "_notify_user", lambda text, source: None)
    _over_now(home)
    assert ds.check_maintainer() == "WAIT"
    monkeypatch.setenv("JHT_SERVICE_BUDGET_SHARE", "0.9")
    assert ds.check_maintainer() == "MAINT"


def test_with_no_budget_the_schedule_is_as_it_was(home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ds = _schedule(home, monkeypatch)
    _config(home)
    _calls(home, "dottore", [(time.time() - 600, 50.0)])
    assert ds.check_maintainer() == "MAINT"
    assert ds.claim() in ("T30", "MID")


def test_a_failing_service_budget_does_not_stop_the_schedule(home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ds = _schedule(home, monkeypatch)

    def broken(role: str) -> bool:
        raise RuntimeError("boom")

    monkeypatch.setattr(sb, "blocked", broken)
    assert ds.check_maintainer() == "MAINT"


def test_the_mentor_is_held_by_the_watchdog_and_by_start_agent() -> None:
    watchdog = (ROOT / ".launcher" / "agent-watchdog.sh").read_text(encoding="utf-8")
    block = watchdog[watchdog.index("mentor_due() {"):watchdog.index("captain_due()")]
    assert "service_budget.py allow mentor" in block and '"$rc" -ne 3' in block
    start = (ROOT / ".launcher" / "start-agent.sh").read_text(encoding="utf-8")
    gate = start[start.index("# --- cancello del Mentor"):start.index("# --- fine cancello del Mentor")]
    assert "service_budget.py allow mentor" in gate and '"$_mentor_rc" -eq 3' in gate and "exit 75" in gate
    assert 'JHT_MENTOR_NOW:-}" != "1"' in gate, "the operator who wants the Mentor now still gets it"
