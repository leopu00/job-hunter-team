"""«Troppo presto per una proiezione»: a inizio finestra la Sentinella non proietta a fine settimana da poche ore di dati.

Caso misurato su un team reale (finestra unica settimanale azzerata il 04/11 06:35Z, reset successivo l'11/11 06:35Z): dalle
21:55Z del 04/11 il tick diceva ATTENZIONE con proiezioni fra 124 e 185 % (usage 2-10 %, i punti salivano di uno ogni ora o
due), per nove ore, mentre il consumo vero era ~0,4 %/h dal reset (69 % a fine settimana). Il 05/11 alle 06:50Z il vecchio
calcolo dava 10 + (2 punti in 2,5 h = 0,8 %/h) x 143,8 h = 125,0 esatto. Il codice di prima (ritmo su 1-8 h, limite basso)
dava ancora ATTENZIONE 464 alla settimana precedente con 7 punti: il ritmo di poche ore moltiplicato per 150 ore al reset.

Regola (pace_rate.py, regola 7): la proiezione a fine finestra esce solo se le ore misurate dall'inizio della finestra sono
almeno (ore al reset) / 7,5 e, su una finestra lunga, i punti guadagnati almeno 5 (o e' passato un giorno). Sotto: «troppo
presto», status OK, nessun throttle. Sopra: ritmo dall'inizio / ore trascorse, ATTENZIONE solo se il limite basso, sia del ritmo
dall'inizio sia di quello delle ultime ore, supera 95 (un burn finito non frena piu', uno in corso si').

Le serie sono ricostruite dai passi del contatore (ore dal reset), non sono i campioni del team; il file vero, quando sta
accanto al repo (fuori da git), e' provato a parte (skip se manca).
"""
import importlib.util
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "shared" / "skills"))
import bridge_message  # noqa: E402
import compute_metrics as cm  # noqa: E402
import pace_reference  # noqa: E402
import pace_rate as pr  # noqa: E402
import weekly_pace  # noqa: E402

UTC = timezone.utc
START = datetime(2026, 11, 4, 6, 40, tzinfo=UTC)          # il primo campione della finestra (dopo il reset)
RESET = (START + timedelta(hours=168) - timedelta(minutes=4, seconds=5)).timestamp()   # 11/11 06:35:55Z
REAL_FILES = sorted((REPO.parent / "piani").glob("dati-*-pacing-*/sentinel-data-0411-0511.jsonl"))

# I passi del contatore intero nelle prime 24 ore di quella finestra: ore dal reset -> valore.
STEPS = [(0.0, 0), (14.42, 1), (15.25, 2), (15.92, 3), (16.83, 4), (18.17, 5), (19.5, 6), (20.42, 7), (21.25, 8),
         (22.08, 9), (23.17, 10)]


def _level(steps, hours):
    value = 0
    for h, v in steps:
        if h <= hours:
            value = v
    return value


class _Clock:
    def __init__(self, now):
        self.now = now

    def __enter__(self):
        self._real = cm.datetime
        outer, now = self._real, self.now

        class Fixed(outer):
            @classmethod
            def now(cls, tz=None):
                return now if tz is None else now.astimezone(tz)
        cm.datetime = Fixed
        return self

    def __exit__(self, *a):
        cm.datetime = self._real


def _replay(levels, reset_unix, history_h=50.0):
    """Come il bridge: un tick ogni 5 minuti, la storia e' quella scritta dai tick di prima (ultime `history_h` ore)."""
    written, last, out = [], None, []
    for when, usage in levels:
        history = [e for e in written if datetime.fromisoformat(e["ts"]) >= when - timedelta(hours=history_h)]
        parsed = {"provider": "openai", "usage": usage, "weekly_usage": usage, "reset_at_unix": reset_unix,
                  "weekly_reset_at_unix": reset_unix, "usage_is_weekly": True}
        with _Clock(when):
            entry = cm.compute_metrics(parsed, last, history=history if last is not None else [])
        written.append(entry)
        last = entry
        out.append(entry)
    return out


def _interp(knots, hour):
    """Il contatore che sale linearmente fra i nodi (ora, valore) e poi resta fermo all'ultimo valore."""
    for (h0, v0), (h1, v1) in zip(knots, knots[1:]):
        if h0 <= hour <= h1:
            return v0 + (v1 - v0) * (hour - h0) / (h1 - h0)
    return knots[-1][1]


def _levels(steps, hours, start=START):
    n = int(hours * 12)
    return [(start + timedelta(minutes=5 * i), _level(steps, i / 12.0)) for i in range(n + 1)]


# ── il caso misurato ─────────────────────────────────────────────────────────────────────────────────────

def test_the_measured_week_start_never_says_attenzione_and_never_a_throttle():
    ticks = _replay(_levels(STEPS, 26.2), RESET)
    assert [e["status"] for e in ticks if e["status"] == "ATTENZIONE"] == []
    assert all(e["throttle"] == 0 and e["suggested_throttle_s"] == 0 for e in ticks)
    early = [e for e in ticks if e["projection_state"] == "too_early"]
    assert early and all(e["projection"] is None and e["status"] in ("OK", "RESET") for e in early)
    # i primi ticks sono troppo presto per forza: 0 ore misurate; l'ultimo tick ha misurato 26 ore
    assert ticks[1]["projection_state"] == "too_early" and ticks[1]["projection_need_h"] > 19


def test_once_enough_hours_are_measured_the_projection_is_the_real_one_and_not_attenzione():
    ticks = _replay(_levels(STEPS, 26.2), RESET)
    last = ticks[-1]
    assert last["projection_state"] == "ok" and last["projection_span_h"] >= last["projection_need_h"]
    # 10 punti in 26 h: 0,4 %/h x 142 h al reset = ~66 %, nell'intervallo che l'arrotondamento lascia
    assert 55 <= last["projection"] <= 80 and last["status"] != "ATTENZIONE"


def test_the_old_formula_gave_125_and_the_new_rule_says_too_early_with_the_same_last_two_and_a_half_hours():
    hours_to_reset = (RESET - (START + timedelta(hours=24.2)).timestamp()) / 3600.0
    assert round(10 + 2 / 2.5 * hours_to_reset, 1) == 125.0      # 2 punti nelle ultime 30 righe x ore al reset
    # la nuova regola con la sola storia di 2,5 h: 2,5 ore misurate su 19,2 che servono
    now = START + timedelta(hours=24.2)
    levels = [(now - timedelta(minutes=5 * (30 - i)), 8 if i < 15 else 10) for i in range(31)]
    ticks = _replay(levels, RESET)
    assert ticks[-1]["projection_state"] == "too_early" and ticks[-1]["status"] == "OK"
    assert ticks[-1]["projection"] is None and ticks[-1]["suggested_throttle_s"] == 0


def test_a_real_burn_is_still_attenzione_once_the_minimum_is_measured():
    # 17 punti in 20,3 h (0,84 %/h) con 148 h al reset: un burn voluto (29/10, un team reale): il verdetto resta
    steps = [(h, round(0.84 * h)) for h in range(0, 24)]
    ticks = _replay(_levels(steps, 21.0), RESET)
    first_ok = next(e for e in ticks if e["projection_state"] == "ok")
    assert first_ok["status"] == "ATTENZIONE" and first_ok["projection"] > 100 and first_ok["suggested_throttle_s"] > 0
    assert all(e["status"] != "ATTENZIONE" for e in ticks if e["projection_state"] == "too_early")


def _replay_rows(rows):
    """Le righe vere (ts, usage, reset) rigiocate tick per tick: [(quando, status, throttle suggerito, entry)]."""
    written, last, out = [], None, []
    for r in rows:
        when = datetime.fromisoformat(r["ts"])
        history = [e for e in written if datetime.fromisoformat(e["ts"]) >= when - timedelta(hours=50)]
        parsed = {"provider": "openai", "usage": r["usage"], "weekly_usage": r["usage"], "reset_at_unix": r["reset_at_unix"],
                  "weekly_reset_at_unix": r["reset_at_unix"], "usage_is_weekly": True}
        with _Clock(when):
            entry = cm.compute_metrics(parsed, last, history=history if last is not None else [])
        written.append(entry)
        last = entry
        out.append((when, entry["status"], entry["suggested_throttle_s"], entry))
    return out


def _real_rows(name):
    files = sorted((REPO.parent / "piani").glob(f"dati-*-pacing-*/{name}"))
    if not files:
        pytest.skip("i campioni veri stanno accanto al repo, fuori da git")
    return [json.loads(line) for line in files[0].read_text(encoding="utf-8").splitlines() if line.strip()]


def test_the_real_rows_have_no_attenzione_in_the_window():
    ticks = _replay_rows(_real_rows("sentinel-data-0411-0511.jsonl"))
    window = [t for t in ticks if t[0] >= datetime(2026, 11, 4, 23, 0, tzinfo=UTC)]
    assert window and not [t for t in window if t[1] == "ATTENZIONE" or t[2]]
    assert not [t for t in ticks if t[1] == "ATTENZIONE"]


def test_the_real_rows_of_a_finished_burn_stop_the_attenzione_and_a_burn_in_progress_keeps_it():
    # settimana precedente (reset 28/10 06:40Z): il burn voluto va dalle 23:55Z del 28/10 alle 11:01Z del 29/10
    rows = [r for r in _real_rows("sentinel-data-2810-0311.jsonl") if "2026-10-28T06:40" <= r["ts"] < "2026-10-30T00:00"]
    ticks = _replay_rows(rows)
    at = {t[0].strftime("%d %H:%M"): t for t in ticks}
    assert at["29 15:45"][1] != "ATTENZIONE" and at["29 15:45"][2] == 0         # il burn e' finito da 4 h, usage ferma
    assert at["29 15:45"][3]["projection_recent"] < at["29 15:45"][3]["projection"]   # il ritmo recente e' piu' basso
    assert at["29 08:00"][1] == "ATTENZIONE" and at["29 08:00"][2] > 0           # in corso: frena
    assert at["28 21:00"][1] != "ATTENZIONE"                                      # e a inizio finestra niente


def test_a_finished_burn_stops_the_attenzione_and_a_burn_in_progress_keeps_it_synthetic():
    # il burn: 29 punti in 28 h dall'inizio (ritmo ~1 %/h dalla 12a ora), poi il contatore fermo a 29
    knots = [(0.0, 0), (12.0, 4), (17.3, 10), (20.0, 16), (23.0, 21), (26.0, 25), (28.3, 29)]
    steps = [(h / 12.0, round(_interp(knots, h / 12.0))) for h in range(0, int(36 * 12) + 1)]
    ticks = _replay(_levels(steps, 36.0), RESET)
    by_hour = {round((datetime.fromisoformat(e["ts"]) - START).total_seconds() / 3600.0, 2): e for e in ticks}
    during = by_hour[26.0]
    assert during["status"] == "ATTENZIONE" and during["suggested_throttle_s"] > 0
    after = by_hour[33.08]                                                         # 4,8 h con il contatore fermo
    assert after["status"] != "ATTENZIONE" and after["suggested_throttle_s"] == 0 and after["phase"] == 1
    # la media dall'inizio dice ancora «alto» (e si vede), il ritmo recente no: il freno vuole alti entrambi
    assert after["projection"] > 95 > after["projection_recent"]


# ── le regole di pace_rate.projection_rate ───────────────────────────────────────────────────────────────

def _flat(hours, value=0.0, steps=(), start=0.0):
    """[(epoch, valore)] ogni 5 minuti per `hours` ore; `steps` = [(ora, valore)]."""
    out = []
    for i in range(int(hours * 12) + 1):
        h = i / 12.0
        out.append((start + h * 3600.0, float(_level([(0.0, value)] + list(steps), h))))
    return out


def test_the_minimum_is_the_hours_to_reset_over_seven_and_a_half():
    now = 24 * 3600.0
    hours = 143.76
    need = hours / 7.5
    for span, state in ((need - 0.1, "too_early"), (need + 0.1, "ok")):
        pts = [(now - span * 3600.0 + k * 300.0, float(round(0.5 * (k * 300.0) / 3600.0 + 6))) for k in range(int(span * 12) + 1)]
        res = pr.projection_rate(pts, pts[-1][0], hours)
        assert res["state"] == state, (span, res)
        assert res["need_h"] == pytest.approx(need)
        if state == "ok":
            assert res["lo"] < res["rate"] < res["hi"]


def test_a_long_window_with_few_points_waits_for_five_points_or_a_day():
    hours = 143.0                                                   # need = 19,07 h
    few_22 = _flat(22.0, steps=[(6.0, 1), (8.0, 2), (10.0, 3), (12.0, 4)])                           # 4 punti in 22 h
    assert pr.projection_rate(few_22, few_22[-1][0], hours)["state"] == "too_early"
    five_22 = _flat(22.0, steps=[(6.0, 1), (8.0, 2), (10.0, 3), (12.0, 4), (14.0, 5)])
    assert pr.projection_rate(five_22, five_22[-1][0], hours)["state"] == "ok"
    few_25 = _flat(25.0, steps=[(6.0, 1), (8.0, 2), (10.0, 3), (12.0, 4)])                           # un giorno passato: un team fermo non resta «presto»
    res = pr.projection_rate(few_25, few_25[-1][0], hours)
    assert res["state"] == "ok" and res["hi"] * hours < 90         # e l'intervallo sta sotto: «sotto ritmo» e' legittimo


def test_a_short_window_needs_hours_and_not_points():
    # la finestra da 5 h: a 4 h dal reset servono max(1 h, 4/7,5) = 1 h; un contatore fermo da 2 h e' un dato
    flat = _flat(2.0, value=77.0)
    res = pr.projection_rate(flat, flat[-1][0], 4.0)
    assert res["state"] == "ok" and res["rate"] == 0.0 and res["need_h"] == 1.0
    assert pr.projection_rate(_flat(0.5, value=77.0), 1800.0, 4.0)["state"] == "too_early"


def test_without_hours_to_reset_there_is_nothing_to_project():
    flat = _flat(30.0, value=10.0)
    for bad in (None, 0, -3.0, True):
        res = pr.projection_rate(flat, flat[-1][0], bad)
        assert res["state"] == "too_early" and res["need_h"] is None and res["rate"] is None


def test_a_drop_restarts_the_hours_and_only_the_last_48_hours_count():
    series = _flat(30.0, value=40.0)
    series += [(30 * 3600.0 + k * 300.0, 2.0) for k in range(1, 13)]           # cala da 40 a 2 senza reset
    res = pr.projection_rate(series, series[-1][0], 100.0)
    assert res["state"] == "too_early" and res["rebaselined"] and res["span_h"] == pytest.approx(55 / 60)
    old = _flat(60.0, steps=[(1.0, 3), (50.0, 12)])
    res = pr.projection_rate(old, old[-1][0], 100.0)
    assert res["span_h"] == pytest.approx(48.0)


# ── weekly_pace: stessa cura ─────────────────────────────────────────────────────────────────────────────

def _weekly(series, hours_to_reset=143.0, remaining=None, active=60.0, total=70.0, burn=False):
    used = series[-1][1]
    return weekly_pace.weekly_pace_assessment(
        None, series[-1][0], 100.0 - used if remaining is None else remaining, active,
        weekly_total_active_hours=total, burn_intent_on=burn, samples=series, hours_to_reset=hours_to_reset)


def test_weekly_pace_is_too_early_and_silent_on_the_rate_in_the_first_hours():
    series = _flat(12.0, steps=[(2.0, 1), (4.0, 3), (6.0, 5), (9.0, 7), (11.0, 8)])
    res = _weekly(series)
    assert res["too_early"] is True and res["kind"] == "ND" and res["binding"] is False
    assert res["lockout_risk"] is False and res["projected_final_pct"] is None and res["burn_mode"] is False
    assert res["too_early_need_h"] == pytest.approx(143.0 / 7.5, abs=0.01) and res["too_early_span_h"] == pytest.approx(12.0)
    # senza il parametro e' come prima (il ritmo di 8 ore dice SOPRA o ALLINEATO, e proietta)
    before = _weekly(series, hours_to_reset=None)
    assert before["too_early"] is False and before["kind"] != "ND" and before["projected_final_pct"] is not None


def test_weekly_pace_is_back_with_a_verdict_when_the_hours_are_measured():
    series = _flat(24.0, steps=[(2.0, 1), (6.0, 3), (10.0, 5), (14.0, 7), (18.0, 9), (22.0, 10)])
    res = _weekly(series)
    assert res["too_early"] is False and res["kind"] in ("SOTTO-PACE", "ALLINEATO", "SOPRA-PACE") and res["projected_final_pct"] is not None


def test_too_early_keeps_only_the_debt_on_the_line_a_level_that_a_rounded_counter_does_not_move():
    # 30 punti nelle prime 5 ore su una retta che a 5 ore attive di 70 e' al 7 %: debito 23 punti, il livello frena
    ahead = _flat(5.0, steps=[(1.0, 8), (2.0, 15), (3.0, 22), (4.0, 27), (5.0, 30)])
    res = _weekly(ahead, remaining=70.0, active=65.0, total=70.0)
    assert res["too_early"] is True and res["debt_pct"] >= weekly_pace.DEBT_BIND_PCT and res["binding"] is True
    assert res["kind"] == "ND" and res["lockout_risk"] is False
    # lo stesso sotto deroga di spesa: il debito e' informazione, nessun freno
    assert _weekly(ahead, remaining=70.0, active=65.0, total=70.0, burn=True)["binding"] is False


def test_the_verdict_too_early_brakes_when_ahead_of_the_line_and_never_says_behind():
    series = _flat(12.0, steps=[(2.0, 1), (6.0, 3), (11.0, 5)])
    behind = _weekly(series, remaining=95.0, active=65.0, total=70.0)
    v = pace_reference.verdict(behind, usage_pct=5.0)
    assert behind["too_early"] and v["verdict"] != "INDIETRO" and not v["brake"] and v["steps"] == 0
    assert v["ideal_pct"] is not None and v["reason"] == "too_early"              # la retta si vede ancora
    ahead = _weekly(_flat(5.0, steps=[(1.0, 8), (3.0, 22), (5.0, 30)]), remaining=70.0, active=65.0, total=70.0)
    v = pace_reference.verdict(ahead, usage_pct=30.0)
    assert v["verdict"] == "AVANTI" and v["brake"] is True


# ── il messaggio, il log, la storia del bridge ───────────────────────────────────────────────────────────

def test_the_tick_says_too_early_instead_of_a_projection():
    text = bridge_message.render({"ts_now": "07:00", "provider": "openai", "work_phase": "ON", "daily": None,
                                  "weekly": None, "extras": {}, "fivehh": {
                                      "usage": 4, "proj": None, "target": 100, "status": "OK", "reset_str": "x",
                                      "single_weekly": True, "proj_state": "too_early", "proj_span_h": 12.0,
                                      "proj_need_h": 19.2}})
    assert "too early for a projection — measured 12 h of the 19.2 h it needs" in text and "proj None" not in text


def _bridge(monkeypatch, tmp_path):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    spec = importlib.util.spec_from_file_location("sentinel_bridge_early", str(REPO / ".launcher" / "sentinel-bridge.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_bridge_reads_fifty_hours_of_history_whatever_the_cadence_and_logs_too_early(monkeypatch, tmp_path):
    bridge = _bridge(monkeypatch, tmp_path)
    now = datetime.now(UTC)
    rows = [{"ts": (now - timedelta(minutes=m)).isoformat(), "usage": 1} for m in range(0, 60 * 60, 1)]   # una al minuto, 60 h
    path = tmp_path / "sentinel-data.jsonl"
    path.write_text("".join(json.dumps(r) + "\n" for r in rows[::-1]), encoding="utf-8")
    monkeypatch.setitem(bridge._PATHS, "DATA_JSONL", path)
    got = bridge.load_recent_samples(6000, since_h=50)
    assert len(got) == 50 * 60 + 1 or len(got) == 50 * 60
    assert bridge.load_recent_samples(100) and len(bridge.load_recent_samples(100)) == 100
    assert bridge._proj_text({"projection_state": "too_early", "projection_span_h": 3.0, "projection_need_h": 19.2}) == "too-early(3.0h/19.2h)"
    assert bridge._proj_text({"projection": 97.3}) == "97.3%" and bridge._proj_text({}) == "-"
