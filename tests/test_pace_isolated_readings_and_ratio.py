"""Letture isolate del contatore e kT per punto (un team reale, 28/10-03/11).

  1. «0/RESET» isolato: una lettura che crolla e alla lettura dopo torna al livello di prima non e' un reset. Prima apriva
     una serie nuova, accorciava la finestra del ritmo e lasciava la proiezione uguale al livello: «SOTTOUTILIZZO 77 %
     con il reset fra 22 h» (consiglio di spingere con il mercato esaurito).
  2. Senza un ritmo misurato non c'e' un verdetto «sotto»: la proiezione e' il livello, non un consumo.
  3. Il rapporto kT per punto del tick (una finestra corta, contatore intero) usciva a 930 contro i ~400 della settimana:
     una finestra vede 0, 1 o 2 passi, quelle senza passo sono scartate e il rapporto di quelle che restano e' rumore.
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "shared" / "skills"))
import compute_metrics as cm  # noqa: E402
import pace_rate as pr  # noqa: E402

UTC = timezone.utc
NOW = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)


def test_an_isolated_zero_is_dropped_and_a_real_reset_is_not():
    series = [(0, 77.0), (300, 0.0), (600, 77.0), (900, 78.0)]
    kept, dropped = pr.drop_isolated_readings(series)
    assert kept == [(0, 77.0), (600, 77.0), (900, 78.0)] and dropped == [(300, 0.0)]
    # un reset vero resta basso: nessuna lettura tolta, e adjust_series riparte dal calo come prima
    real = [(0, 77.0), (300, 0.0), (600, 1.0), (900, 2.0)]
    assert pr.drop_isolated_readings(real) == (real, [])
    assert pr.adjust_series(real)[1]["rebaselined_at"] == 300
    # due letture sbagliate di fila che tornano su sono la stessa cosa
    assert pr.drop_isolated_readings([(0, 77.0), (300, 0.0), (600, 0.0), (900, 77.0)])[1] == [(300, 0.0), (600, 0.0)]
    # un calo di 1-2 punti (lettura vecchia sostituita da una fresca) non e' un caso di questa regola
    assert pr.drop_isolated_readings([(0, 29.0), (300, 28.0), (600, 29.0)])[1] == []


def test_the_rate_is_the_same_with_or_without_the_isolated_zero():
    clean = [(NOW.timestamp() - 300 * k, 70.0 + (8 - k) * 0.25) for k in range(36, -1, -1)]
    clean = [(t, float(int(v))) for t, v in clean]
    glitched = list(clean)
    glitched[-10] = (glitched[-10][0], 0.0)
    a = pr.counter_rate(clean, NOW.timestamp())
    b = pr.counter_rate(glitched, NOW.timestamp())
    assert a is not None and b is not None
    assert (a["rate"], a["delta"], a["span_h"]) == (b["rate"], b["delta"], b["span_h"])


def _history(usage, hours, reset_unix=None):
    items = [{"ts": (NOW - timedelta(minutes=5 * k)).isoformat(), "usage": usage, "weekly_usage": usage,
              "provider": "codex", "reset_at_unix": reset_unix} for k in range(int(hours * 12), 0, -1)]
    return items[-1], items


def _parsed(usage, reset_unix):
    return {"provider": "codex", "usage": usage, "reset_at_unix": reset_unix, "weekly_usage": usage,
            "weekly_reset_at_unix": reset_unix, "usage_is_weekly": True}


class _Clock:
    """compute_metrics legge datetime.now(): lo si ferma a NOW."""
    def __enter__(self):
        self._real = cm.datetime
        outer = self._real

        class Fixed(outer):
            @classmethod
            def now(cls, tz=None):
                return NOW if tz is None else NOW.astimezone(tz)
        cm.datetime = Fixed
        return self

    def __exit__(self, *a):
        cm.datetime = self._real


def test_an_isolated_drop_with_the_window_open_keeps_the_level_and_says_so():
    reset = (NOW + timedelta(hours=22)).timestamp()
    last, history = _history(77.0, 3.0, reset)
    with _Clock():
        entry = cm.compute_metrics(_parsed(0.0, reset), last, history=history)
    assert entry["suspect_drop"] is True and entry["discarded_usage"] == 0.0
    assert entry["usage"] == 77.0 and entry["weekly_usage"] == 77.0
    assert entry["status"] != "RESET" and entry["delta"] == 0.0
    # la lettura dopo e' ancora in basso: e' un reset vero
    last2 = dict(entry, ts=NOW.isoformat())
    with _Clock():
        again = cm.compute_metrics(_parsed(1.0, reset), last2, history=history)
    assert again["suspect_drop"] is False and again["status"] == "RESET" and again["usage"] == 1.0


def test_a_drop_when_the_window_has_ended_is_the_reset_at_once():
    reset = (NOW + timedelta(minutes=10)).timestamp()
    last, history = _history(77.0, 3.0, reset)
    with _Clock():
        entry = cm.compute_metrics(_parsed(2.0, reset + 5 * 3600), last, history=history)
    assert entry["suspect_drop"] is False and entry["status"] == "RESET" and entry["usage"] == 2.0


def test_no_measured_rate_is_not_underuse():
    reset = (NOW + timedelta(hours=22)).timestamp()
    with _Clock():
        cold = cm.compute_metrics(_parsed(77.0, reset), None, history=[])
    assert cold["status"] != "SOTTOUTILIZZO"
    # fermo da un'ora soltanto: 0 punti in 1 h = «tra 0 e 2 punti/h», fino a 99 % alla chiusura: nessun verdetto
    last, history = _history(77.0, 1.2, reset)
    with _Clock():
        one_hour = cm.compute_metrics(_parsed(77.0, reset), last, history=history)
    assert one_hour["status"] != "SOTTOUTILIZZO"
    # fermo da quattro ore: l'intervallo sta tutto sotto il 90 %, il verdetto c'e'
    last, history = _history(77.0, 4.0, reset)
    with _Clock():
        four_hours = cm.compute_metrics(_parsed(77.0, reset), last, history=history)
    assert four_hours["status"] == "SOTTOUTILIZZO"


def _team_week(true_kt_per_point=400.0, points_per_5min=0.4, hours=30, refresh_every=1):
    """Contatore intero che segue un consumo di `points_per_5min` punti ogni 5 minuti, aggiornato dal provider ogni
    `refresh_every` campioni (a scatti se > 1); eventi kT proporzionali al consumo."""
    start = NOW.timestamp() - hours * 3600
    samples, events, cum, shown = [], [], 20.0, 20.0
    t, n = start, 0
    while t <= NOW.timestamp():
        if n % refresh_every == 0:
            shown = float(int(cum))
        samples.append((t, shown))
        events.append((t, points_per_5min * true_kt_per_point))
        cum += points_per_5min
        t += 300
        n += 1
    return samples, events


def test_kt_per_point_over_hours_finds_the_true_ratio():
    samples, events = _team_week(points_per_5min=0.05, hours=48)
    got = pr.kt_per_point(samples, events, NOW.timestamp())
    assert got is not None and abs(got["ratio"] - 400.0) < 60.0, got
    assert got["span_h"] >= pr.RATIO_MIN_SPAN_H and got["gain"] >= pr.RATIO_MIN_GAIN


def test_a_counter_refreshed_in_big_steps_does_not_inflate_the_ratio():
    # 6 punti/ora, il provider aggiorna ogni mezz'ora: passi da 3 punti fra due campioni da 5 minuti
    samples, events = _team_week(points_per_5min=0.5, hours=30, refresh_every=6)
    got = pr.kt_per_point(samples, events, NOW.timestamp())
    assert got is not None and abs(got["ratio"] - 400.0) < 40.0, got
    # il ritmo di adjust_series li toglie come «altro uso»: i kT restavano interi su meno punti
    removed = pr.adjust_series(samples)[1]["unattributed_pts"]
    assert removed > 0.5 * (samples[-1][1] - samples[0][1])
    kept_gain = (samples[-1][1] - samples[0][1]) - removed
    assert sum(w for _, w in events) / max(kept_gain, 1.0) > 1.8 * got["ratio"]


def test_kt_per_point_says_none_when_the_data_do_not_support_a_number():
    samples, events = _team_week(hours=3)
    assert pr.kt_per_point(samples, events, NOW.timestamp()) is None           # meno di sei ore
    flat = [(t, 50.0) for t, _ in _team_week()[0]]
    assert pr.kt_per_point(flat, _team_week()[1], NOW.timestamp()) is None      # il contatore non e' salito
    assert pr.kt_per_point(_team_week()[0], [], NOW.timestamp()) is None        # nessun consumo


def test_kt_per_point_ignores_isolated_zeros_and_resets():
    samples, events = _team_week(points_per_5min=0.05, hours=48)
    base = pr.kt_per_point(samples, events, NOW.timestamp())["ratio"]
    glitched = list(samples)
    glitched[300] = (glitched[300][0], 0.0)                                         # una lettura sbagliata
    assert abs(pr.kt_per_point(glitched, events, NOW.timestamp())["ratio"] - base) < 1e-6
    # un reset vero: il guadagno prima del reset non e' perso e il calo non e' guadagno negativo
    reset = [(t, v if i < 400 else v - 40.0) for i, (t, v) in enumerate(samples)]
    got = pr.kt_per_point(reset, events, NOW.timestamp())
    assert got is not None and got["gain"] > 0
