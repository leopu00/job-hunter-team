"""budget_view: the numbers of the app's Budget page, read from the team's own files, read only.

All data is synthetic. The weekly counter, the hours and the roles are written by the test into a home of its own.
What matters: it computes NOTHING of its own (the numbers are the ones the sentinel's bridge computes for the same
samples), the answer is a closed list with no sentence of the team's in it, a number the team lacks is null and never 0,
and a file the agents can write (a link, a pipe, a poisoned value) neither stalls the read nor reaches the page.
"""
from __future__ import annotations

import importlib.util
import json
import math
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
import budget_view  # noqa: E402
import burn_intent  # noqa: E402
import freeze_marker  # noqa: E402
import pace_guard  # noqa: E402

UTC = timezone.utc
NOW = datetime(2026, 11, 2, 22, 0, 0, tzinfo=UTC).timestamp()                 # Monday 23:00 in Rome: inside the night window
RESET = datetime(2026, 11, 5, 6, 35, 52, tzinfo=UTC).timestamp()
NIGHT = {"team": {"working_hours": {"timezone": "Europe/Rome", "windows": [
    {"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], "start": "22:00", "end": "08:00"}]}}}


def iso(ts):
    return datetime.fromtimestamp(ts, UTC).isoformat().replace("+00:00", "Z")


def series(rate, hours, end_pct, now=NOW, step=300.0, lead_in_h=4.0):
    """The counter at `rate` %/h over `hours`, after `lead_in_h` flat hours: a verdict on the rest of the window needs the
    hours measured since its start (pace_rate.projection_rate), and a team that has just started is «too early»."""
    out, t = [], now - (hours + lead_in_h) * 3600.0
    while t <= now:
        out.append((t, max(0, round(end_pct - rate * (now - t) / 3600.0))))
        t += step
    return out


def put_samples(home, rows, reset=RESET):
    (home / "logs").mkdir(parents=True, exist_ok=True)
    lines = [json.dumps({"ts": iso(t), "weekly_usage": u, "weekly_remaining_pct": 100.0 - u, "weekly_reset_at_unix": reset,
                         "provider": "codex"}) for t, u in rows]
    (home / "logs" / "sentinel-data.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")


def put_config(home, config=NIGHT):
    (home / "jht.config.json").write_text(json.dumps(config), encoding="utf-8")


@pytest.fixture()
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(pace_guard, "active_workers", lambda: [])
    (tmp_path / "logs").mkdir()
    put_config(tmp_path)
    return tmp_path


def walk(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)
    else:
        yield value


# ── nothing to read ──────────────────────────────────────────────────────────────────────────────────────────────

def test_a_team_with_no_reading_is_no_data_and_nothing_is_a_made_up_zero(home):
    out = budget_view.read(NOW, home)
    assert out["ok"] is True and out["week"] is None and out["rate"] is None
    assert out["verdict"] == {"code": "no_data", "brake": False, "steps": 0}
    assert out["sampleAt"] is None and out["sampleAgeMin"] is None and out["brakes"] == [] and out["pauseSec"] is None
    assert out["burn"]["state"] == "off" and out["burn"]["spentPts"] is None and out["roles"] is None


# ── the same numbers as the bridge ───────────────────────────────────────────────────────────────────────────────

def _bridge(monkeypatch, home):
    monkeypatch.setenv("JHT_HOME", str(home))
    spec = importlib.util.spec_from_file_location("sentinel_bridge_budget_view", str(ROOT / ".launcher" / "sentinel-bridge.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.parametrize("rate,end", [(2.7, 46), (7.0, 46), (0.4, 20), (3.5, 60)])
def test_the_numbers_are_the_ones_the_bridge_computes_for_the_same_samples(home, monkeypatch, rate, end):
    rows = series(rate, 7.0, end)
    put_samples(home, rows)
    bridge = _bridge(monkeypatch, home)
    entry = {"weekly_remaining_pct": 100.0 - rows[-1][1], "weekly_reset_at_unix": RESET}
    theirs = bridge._weekly_pace_via_skill(entry, datetime.fromtimestamp(NOW, UTC), NOW)
    assert theirs is not None
    ours = budget_view.read(NOW, home)
    assert ours["week"]["idealUsedPct"] == round(theirs["ideal_used_pct"], 1) if theirs["ideal_used_pct"] is not None else True
    assert ours["week"]["activeHoursToReset"] == round(theirs["reset_in_active_h"], 1)
    assert ours["rate"]["sustainablePctH"] == round(theirs["sustainable_pct_h"], 2)
    assert ours["rate"]["loPctH"] == round(theirs["vel_lo_pct_h"], 2) and ours["rate"]["hiPctH"] == round(theirs["vel_hi_pct_h"], 2)
    # «too early» (the first hours of the window): no landing point, on the page as in the bridge
    assert ours["rate"]["projectedFinalPct"] == (round(theirs["projected_final_pct"]) if theirs["projected_final_pct"] is not None else None)
    assert ours["rate"]["lockoutEarlyActiveH"] == (round(theirs["lockout_early_active_h"], 1) if theirs["lockout_early_active_h"] is not None else None)
    # and the verdict is the bridge's own: a brake in the tick (binding) is a brake on the page
    assert ours["verdict"]["brake"] == bool(theirs["binding"])


# ── what the page gets ───────────────────────────────────────────────────────────────────────────────────────────

def test_the_answer_is_a_closed_list_with_numbers_codes_and_timestamps_only(home):
    put_samples(home, series(2.7, 7.0, 46))
    (home / "logs" / "role-usage.json").write_text(json.dumps({
        "generated_at": iso(NOW - 120), "provider": "codex",
        "windows": {"week": {"total_kt": 900.0, "unattributed_kt": 90.0, "unattributed_pct": 10.0, "roles": {
            "scout": {"kt": 540.0, "share_pct": 60.0, "agents": ["scout-1", "scout-2"], "events": 400},
            "analista": {"kt": 270.0, "share_pct": 30.0, "agents": ["analista-1"], "events": 90}}}}}), encoding="utf-8")
    out = budget_view.read(NOW, home)
    assert sorted(out) == ["brakes", "burn", "generatedAt", "ok", "pauseSec", "rate", "roles", "sampleAgeMin", "sampleAt", "verdict", "week"]
    assert sorted(out["week"]) == ["activeHoursToReset", "deviationPts", "idealUsedPct", "line", "remainingPct", "resetAtUnix", "usedPct"]
    assert sorted(out["rate"]) == ["hiPctH", "loPctH", "lockoutEarlyActiveH", "marginActiveH", "nowPctH", "projectedFinalPct", "sustainablePctH", "wastedPct"]
    assert sorted(out["burn"]) == ["expiresAt", "grantedAt", "paceBeforePctH", "paceNowPctH", "remainingMin", "spentPts", "state"]
    assert sorted(out["roles"]) == ["ageMin", "roles", "totalKt", "unattributedPct", "window"]
    assert out["roles"]["roles"][0] == {"role": "scout", "sharePct": 60.0, "kt": 540.0, "agents": 2}
    assert out["roles"]["ageMin"] == 2 and out["roles"]["window"] == "week"
    allowed_text = re.compile(r"^(\d{4}-\d{2}-\d{2}T[\d:+Z.\-]+|ahead|on|behind|lockout_risk|on_pace|no_data|off|active|expired|unknown|"
                              r"pace_ahead|daily_cap_stop|recovering_after_freeze|pause_between_jobs|week|5h|[a-z]+)$")
    for leaf in walk(out):
        assert not isinstance(leaf, float) or math.isfinite(leaf)
        assert not isinstance(leaf, str) or allowed_text.match(leaf), leaf
    json.dumps(out, allow_nan=False)                           # strict JSON: no NaN, no Infinity


def test_a_stale_reading_says_how_old_it_is(home):
    put_samples(home, series(2.7, 7.0, 46, now=NOW - 3 * 3600), reset=RESET)
    out = budget_view.read(NOW, home)
    assert out["sampleAgeMin"] == 180 and out["week"]["usedPct"] == 46.0


# ── the line, the verdict, the brakes ────────────────────────────────────────────────────────────────────────────

def test_ahead_of_the_active_hours_line_without_a_burn_is_a_brake_with_its_code(home):
    put_samples(home, series(0.8, 7.0, 78))
    out = budget_view.read(NOW, home)
    assert out["week"]["line"] == "ahead" and out["verdict"]["code"] == "ahead" and out["verdict"]["brake"] is True
    assert "pace_ahead" in out["brakes"]


def test_the_same_ahead_under_the_spending_override_is_information_and_costs_are_shown(home):
    put_samples(home, series(0.8, 7.0, 78))
    burn_intent.grant(hours=5.0, reason="test", granted_by="user", now=datetime.fromtimestamp(NOW - 3600, UTC))
    out = budget_view.read(NOW, home)
    assert out["burn"]["state"] == "active" and out["burn"]["remainingMin"] in range(238, 242)
    assert out["week"]["line"] == "ahead"                                        # the line is the same...
    assert out["verdict"]["code"] == "on_pace" and out["verdict"]["brake"] is False   # ...and it brakes nothing
    assert "pace_ahead" not in out["brakes"]
    assert out["burn"]["spentPts"] == pytest.approx(0.8, abs=1.0)                # points spent since the grant, an hour ago
    assert out["burn"]["paceNowPctH"] is not None and out["burn"]["grantedAt"] is not None


def test_under_the_override_only_the_lockout_risk_brakes(home):
    put_samples(home, series(7.0, 7.0, 46))
    burn_intent.grant(hours=5.0, reason="test", granted_by="user", now=datetime.fromtimestamp(NOW - 3600, UTC))
    out = budget_view.read(NOW, home)
    assert out["verdict"]["code"] == "lockout_risk" and out["verdict"]["brake"] is True and out["verdict"]["steps"] >= 1
    assert out["brakes"][0] == "lockout_risk" and out["rate"]["lockoutEarlyActiveH"] > out["rate"]["marginActiveH"]


def test_the_cost_of_an_override_whose_grant_is_beyond_the_samples_is_not_known_and_not_zero(home):
    put_samples(home, series(2.7, 7.0, 46))
    burn_intent.grant(hours=5.0, reason="test", granted_by="user", now=datetime.fromtimestamp(NOW - 11 * 3600, UTC))
    assert burn_intent.status(datetime.fromtimestamp(NOW, UTC))["state"] == "expired"
    out = budget_view.read(NOW, home)
    assert out["burn"]["state"] == "expired" and out["burn"]["spentPts"] is None


def test_the_other_brakes_are_codes_from_the_flags_and_the_pause(home, monkeypatch):
    put_samples(home, series(0.4, 7.0, 20))
    (home / "logs" / "daily-halt.flag").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(freeze_marker, "seconds_since", lambda now=None: 600.0)
    monkeypatch.setattr(pace_guard, "active_workers", lambda: ["scout-1", "scorer-1"])
    monkeypatch.setattr(pace_guard, "current_worker_throttle", lambda workers: 900)
    out = budget_view.read(NOW, home)
    assert out["brakes"] == ["daily_cap_stop", "recovering_after_freeze", "pause_between_jobs"] and out["pauseSec"] == 900
    monkeypatch.setattr(freeze_marker, "seconds_since", lambda now=None: 3 * 3600.0)
    monkeypatch.setattr(pace_guard, "current_worker_throttle", lambda workers: pace_guard.WORKER_FLOOR)
    (home / "logs" / "daily-halt.flag").unlink()
    assert budget_view.read(NOW, home)["brakes"] == []


def test_without_a_config_the_team_works_all_week_like_the_bridge_says(home):
    (home / "jht.config.json").unlink()
    put_samples(home, series(0.4, 7.0, 20))
    out = budget_view.read(NOW, home)
    assert out["week"]["activeHoursToReset"] == pytest.approx((RESET - NOW) / 3600.0, abs=0.1)


# ── files the agents can write ───────────────────────────────────────────────────────────────────────────────────

def test_a_link_in_place_of_the_data_file_is_not_followed(home, tmp_path_factory):
    outside = tmp_path_factory.mktemp("elsewhere") / "x.jsonl"
    outside.write_text(json.dumps({"ts": iso(NOW), "weekly_usage": 50, "weekly_reset_at_unix": RESET}) + "\n", encoding="utf-8")
    os.symlink(outside, home / "logs" / "sentinel-data.jsonl")
    assert budget_view.read(NOW, home)["week"] is None


def test_a_pipe_in_place_of_a_file_does_not_hold_the_read(home):
    os.mkfifo(home / "logs" / "sentinel-data.jsonl")
    os.mkfifo(home / "logs" / "role-usage.json")
    result = subprocess.run([sys.executable, str(SKILLS / "budget_view.py"), "read"], env={**os.environ, "JHT_HOME": str(home)},
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0 and json.loads(result.stdout)["week"] is None


def test_poisoned_values_and_lines_are_dropped_and_never_reach_the_page(home):
    rows = series(2.7, 7.0, 46)
    put_samples(home, rows)
    with (home / "logs" / "sentinel-data.jsonl").open("a", encoding="utf-8") as f:
        f.write("not json\n[1,2]\n")
        f.write('{"ts": "2026-11-02T21:59:00Z", "weekly_usage": NaN, "weekly_reset_at_unix": 1}\n')
        f.write(json.dumps({"ts": "<script>", "weekly_usage": 99}) + "\n")
        f.write(json.dumps({"ts": iso(NOW - 10), "weekly_usage": "99"}) + "\n")
        f.write(json.dumps({"ts": iso(NOW - 5), "weekly_usage": 1e9}) + "\n")
    (home / "logs" / "role-usage.json").write_text(json.dumps({
        "generated_at": iso(NOW), "windows": {"week": {"unattributed_pct": 1e9, "total_kt": "x", "roles": {
            "<img src=x onerror=1>": {"kt": 5, "share_pct": 50, "agents": []},
            "scout": {"kt": 5, "share_pct": 500, "agents": []},
            "analista": {"kt": 5, "share_pct": 40.0, "agents": ["analista-1"], "note": "free text"}}}}}), encoding="utf-8")
    out = budget_view.read(NOW, home)
    assert out["week"]["usedPct"] == 46.0 and out["sampleAt"] == iso(NOW).replace("Z", "+00:00")[:19] + "+00:00"
    assert [r["role"] for r in out["roles"]["roles"]] == ["analista"]
    assert out["roles"]["unattributedPct"] is None and out["roles"]["totalKt"] is None
    assert "free text" not in json.dumps(out) and "script" not in json.dumps(out) and "img" not in json.dumps(out)


def test_a_huge_data_file_costs_a_tail_not_the_file(home):
    rows = series(2.7, 7.0, 46)
    put_samples(home, rows)
    path = home / "logs" / "sentinel-data.jsonl"
    body = path.read_bytes()
    path.write_bytes((b'{"ts": "2020-01-01T00:00:00Z", "weekly_usage": 1}\n' * 120_000) + body)       # ~5.5 MB of old rows
    assert path.stat().st_size > 5 * 1024 * 1024
    import time
    t0 = time.process_time()
    out = budget_view.read(NOW, home)
    assert time.process_time() - t0 < 2.0 and out["week"]["usedPct"] == 46.0


# ── the command ──────────────────────────────────────────────────────────────────────────────────────────────────

def test_the_command_prints_one_json_line_and_refuses_anything_else(home):
    put_samples(home, series(2.7, 7.0, 46, now=datetime.now(UTC).timestamp()), reset=datetime.now(UTC).timestamp() + 50 * 3600)
    env = {**os.environ, "JHT_HOME": str(home)}
    ok = subprocess.run([sys.executable, str(SKILLS / "budget_view.py"), "read"], env=env, capture_output=True, text=True, timeout=30)
    assert ok.returncode == 0 and ok.stderr == "" and len(ok.stdout.strip().splitlines()) == 1
    assert json.loads(ok.stdout)["ok"] is True
    for bad in (["write"], ["read", "--home", "/"], []):
        r = subprocess.run([sys.executable, str(SKILLS / "budget_view.py"), *bad], env=env, capture_output=True, text=True, timeout=30)
        assert r.returncode == 2 and r.stdout == ""


def test_the_skill_writes_nothing(home):
    put_samples(home, series(2.7, 7.0, 46))
    burn_intent.grant(hours=5.0, reason="test", granted_by="user", now=datetime.fromtimestamp(NOW - 3600, UTC))
    before = {p: p.read_bytes() for p in home.rglob("*") if p.is_file()}
    budget_view.read(NOW, home)
    after = {p: p.read_bytes() for p in home.rglob("*") if p.is_file()}
    assert before == after, "a read changes no file of the team"
    code = (SKILLS / "budget_view.py").read_text(encoding="utf-8")
    for forbidden in ("open(", "write_text", "write_bytes", "os.replace", "subprocess", "os.system", "eval(", "exec("):
        assert forbidden not in code, forbidden


# ── every file the read opens: a pipe or a link in its place neither holds the read nor is followed ──────────────

FILES_OF_THE_READ = [
    ("logs/sentinel-data.jsonl", "samples"),
    ("logs/role-usage.json", "roles"),
    ("jht.config.json", "config"),
    (".burn-intent.flag", "burn"),
    ("state/last-freeze.json", "freeze"),
    ("logs/daily-halt.flag", "halt"),
]


def _replace(home, relative, how):
    path = home / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        path.unlink()
    if how == "pipe":
        os.mkfifo(path)
    else:
        os.symlink("/dev/zero", path)


@pytest.mark.parametrize("how", ["pipe", "link to /dev/zero"])
@pytest.mark.parametrize("relative,what", FILES_OF_THE_READ)
def test_a_pipe_or_a_link_in_place_of_any_file_of_the_read_neither_holds_it_nor_is_followed(home, relative, what, how):
    put_samples(home, series(0.8, 7.0, 78, now=datetime.now(UTC).timestamp()), reset=datetime.now(UTC).timestamp() + 50 * 3600)
    (home / "state").mkdir(exist_ok=True)
    _replace(home, relative, how)
    result = subprocess.run([sys.executable, str(SKILLS / "budget_view.py"), "read"], env={**os.environ, "JHT_HOME": str(home)},
                            capture_output=True, text=True, timeout=30)       # a hang is a failed test, not a stuck suite
    assert result.returncode == 0, result.stderr
    out = json.loads(result.stdout)
    assert out["ok"] is True
    if what == "samples":
        assert out["week"] is None
    else:
        assert out["week"] is not None
    if what == "burn":
        assert out["burn"]["state"] == "off"
    if what == "freeze":
        assert "recovering_after_freeze" not in out["brakes"]
    if what == "halt":
        assert "daily_cap_stop" not in out["brakes"]
    if what == "roles":
        assert out["roles"] is None


@pytest.mark.parametrize("how", ["pipe", "link to /dev/zero"])
def test_the_flag_the_marker_and_the_notices_read_the_same_way_for_everyone_who_calls_them(home, how):
    # the bridge calls these too: the fix is in the modules, not only in the page's read
    code = ("import sys; sys.path.insert(0, %r); import burn_intent, freeze_marker; "
            "print(burn_intent.read(), burn_intent.status()['state'], burn_intent.is_active(), freeze_marker.seconds_since(), "
            "burn_intent._sent_notices({'granted_at': 'a', 'expires_at': 'b'}), burn_intent._team_zone())" % str(SKILLS))
    for relative in (".burn-intent.flag", "state/last-freeze.json", ".burn-intent-notices.json", "jht.config.json"):
        (home / "state").mkdir(exist_ok=True)
        _replace(home, relative, how)
    result = subprocess.run([sys.executable, "-c", code], env={**os.environ, "JHT_HOME": str(home)}, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "None off False None [] None"


def test_a_real_flag_a_real_marker_and_real_notices_are_still_read(home):
    burn_intent.grant(hours=2.0, reason="test", granted_by="user", now=datetime.fromtimestamp(NOW - 600, UTC))
    assert burn_intent.read() is not None and burn_intent.status(datetime.fromtimestamp(NOW, UTC))["state"] == "active"
    (home / "state").mkdir(exist_ok=True)
    (home / "state" / "last-freeze.json").write_text(json.dumps({"ts": NOW - 90, "kind": "test"}), encoding="utf-8")
    assert freeze_marker.seconds_since(NOW) == pytest.approx(90.0)
    big = home / ".burn-intent.flag"
    big.write_bytes(b" " * (burn_intent.FLAG_MAX_BYTES + 10))
    assert burn_intent.read() is None, "a flag larger than a flag is not ours"


# ── the seventh and the eighth file: what the pause between jobs is read from (with workers alive) ───────────────

@pytest.mark.parametrize("how", ["pipe", "link to /dev/zero"])
@pytest.mark.parametrize("relative", ["config/throttle.json", "config/throttle-floor-exempt.txt"])
def test_a_pipe_or_a_link_in_place_of_the_throttle_files_neither_holds_the_read_nor_is_followed(home, relative, how):
    put_samples(home, series(0.8, 7.0, 78, now=datetime.now(UTC).timestamp()), reset=datetime.now(UTC).timestamp() + 50 * 3600)
    (home / "config").mkdir(exist_ok=True)
    _replace(home, relative, how)
    # workers alive (the page asks tmux, which this suite does not have): simulated, as the pause is read only with them
    code = ("import sys, json; sys.path.insert(0, %r); import pace_guard, budget_view; "
            "pace_guard.active_workers = lambda: ['scout-1', 'scorer-1']; "
            "print(json.dumps(budget_view.read()))" % str(SKILLS))
    result = subprocess.run([sys.executable, "-c", code], env={**os.environ, "JHT_HOME": str(home)}, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    out = json.loads(result.stdout)
    assert out["week"] is not None
    # the pipe or the link reads as no file: the default config (no throttle) and no exemption, so the floor pause
    assert out["pauseSec"] == pace_guard.WORKER_FLOOR and "pause_between_jobs" not in out["brakes"]


def test_the_throttle_readers_read_a_real_config_and_a_real_exemption_as_before(home):
    (home / "config").mkdir(exist_ok=True)
    (home / "config" / "throttle.json").write_text(json.dumps({"default": 0, "scout-1": 900}), encoding="utf-8")
    (home / "config" / "throttle-floor-exempt.txt").write_text("# a measure\nscorer-1\n", encoding="utf-8")
    code = ("import sys, importlib.util; spec = importlib.util.spec_from_file_location('tc', %r); tc = importlib.util.module_from_spec(spec); "
            "spec.loader.exec_module(tc); print(tc.get_agent('scout-1'), tc._floor_exempt('scorer-1'), tc._floor_exempt('scout-1'), tc.load())"
            % str(SKILLS / "throttle-config.py"))
    result = subprocess.run([sys.executable, "-c", code], env={**os.environ, "JHT_HOME": str(home)}, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "780 True False {'default': 0, 'scout-1': 900}"
    (home / "config" / "throttle.json").write_text("{not json", encoding="utf-8")
    broken = subprocess.run([sys.executable, "-c", code], env={**os.environ, "JHT_HOME": str(home)}, capture_output=True, text=True, timeout=30)
    assert broken.returncode == 0 and broken.stdout.split()[0] == "300", "an unreadable config reads as the default, then the floor"
