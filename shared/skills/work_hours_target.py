#!/usr/bin/env python3
"""
work_hours_target.py — distribuzione del budget settimanale sulle ore attive.

Estende `working_hours.py` (gate ON/OFF) con il calcolo del **target di
consumo** per la finestra rate-limit 5h corrente, dato:

  - la `working_hours` config dell'utente (jht.config.json team.working_hours)
  - i boundary della finestra 5h (dal sentinel-bridge: reset_at_unix)
  - il `window_cap_pct_of_weekly` del provider (seed + EMA da
    window_ratio_meter.py, oppure None per provider weekly-unlimited tipo Kimi)

Output principale: `compute_target(now, win_start, win_end, ratio, cfg)` →
dict con `work_phase`, `current_window_target_pct` (= replacement del
TARGET_BAND_CENTER fisso 92% nel pacing-bridge), e metadata per la UI.

Provider-agnostic: ratio=None → fallback al target_band classico (Kimi);
ratio>0 → distribuzione proporzionale alle ore ON del weekly cap (Codex,
Claude). Vedi docs/internal/architecture/2026-05-25-work-hours-design.md.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Reuso il loader config + il gate ON/OFF già esistenti.
_THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_THIS_DIR))
import working_hours as _wh  # type: ignore  # noqa: E402

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore


_WEEKDAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
_DEFAULT_TARGET_BAND_PCT = 92.0

# Durata nominale della finestra rate-limit rolling (5h dei provider).
# Usata per il framing esplicito "il weekly residuo diviso in finestre da 5h".
# NB: il calcolo NON assume che il team sia partito a inizio finestra/settimana
# (sarebbe ipotetico): usa SEMPRE il residuo reale [now → reset] sia per le ore
# che per il budget, così il target per-finestra si auto-calibra sulla
# situazione di partenza effettiva.
WINDOW_HOURS = 5.0


def _resolve_tz(cfg: dict):
    wh = (cfg.get("team") or {}).get("working_hours") if isinstance(cfg, dict) else None
    name = ((wh or {}).get("timezone") or "UTC").strip() or "UTC"
    if not ZoneInfo:
        return timezone.utc
    try:
        return ZoneInfo(name)
    except Exception:
        return timezone.utc


def _build_intervals(
    cfg: dict,
    range_start_utc: datetime,
    range_end_utc: datetime,
) -> list[tuple[datetime, datetime]]:
    """Intervalli ON (UTC) clippati a [range_start, range_end], merge-overlap.

    24/7 (config assente o windows vuoto) → un singolo intervallo = il range.
    """
    if range_end_utc <= range_start_utc:
        return []
    wh = (cfg.get("team") or {}).get("working_hours") if isinstance(cfg, dict) else None
    windows = (wh or {}).get("windows") or [] if isinstance(wh, dict) else []
    if not windows:
        return [(range_start_utc, range_end_utc)]  # 24/7

    tz = _resolve_tz(cfg)
    local_start = range_start_utc.astimezone(tz)
    local_end = range_end_utc.astimezone(tz)

    # Inizia un giorno prima per catturare wrap-around mezzanotte che
    # finiscono dentro al range.
    day = (local_start - timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    stop = local_end + timedelta(days=1)

    intervals: list[tuple[datetime, datetime]] = []
    while day < stop:
        weekday_name = _WEEKDAY_NAMES[day.weekday()]
        for w in windows:
            if not isinstance(w, dict):
                continue
            days = w.get("days") or []
            if weekday_name not in days:
                continue
            try:
                sh, sm = map(int, str(w["start"]).split(":"))
                eh, em = map(int, str(w["end"]).split(":"))
            except Exception:
                continue
            start_local = day.replace(hour=sh, minute=sm)
            wraps = (eh, em) <= (sh, sm)
            end_local = (
                (day + timedelta(days=1)).replace(hour=eh, minute=em)
                if wraps
                else day.replace(hour=eh, minute=em)
            )
            s_utc = max(start_local.astimezone(timezone.utc), range_start_utc)
            e_utc = min(end_local.astimezone(timezone.utc), range_end_utc)
            if s_utc < e_utc:
                intervals.append((s_utc, e_utc))
        day = day + timedelta(days=1)

    intervals.sort(key=lambda r: r[0])
    merged: list[tuple[datetime, datetime]] = []
    for s, e in intervals:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


def active_hours_in_range(
    range_start_utc: datetime,
    range_end_utc: datetime,
    config: dict | None = None,
) -> float:
    cfg = config if config is not None else _wh._load_config()
    intervals = _build_intervals(cfg, range_start_utc, range_end_utc)
    return sum((e - s).total_seconds() for s, e in intervals) / 3600.0


def weekly_active_hours(
    now_utc: datetime | None = None,
    config: dict | None = None,
) -> float:
    """Ore ON in una settimana rolling da `now_utc`."""
    n = now_utc or datetime.now(timezone.utc)
    return active_hours_in_range(n, n + timedelta(days=7), config)


def next_phase_transition(
    now_utc: datetime,
    config: dict | None = None,
    horizon_days: int = 14,
) -> tuple[str, datetime | None]:
    """Ritorna (phase_corrente, prossima_transizione_UTC_o_None).

    horizon=14 giorni: copre schedule molto sparsi (es. solo 1 giorno/sett).
    """
    cfg = config if config is not None else _wh._load_config()
    inside = _wh.is_within_working_hours(now_utc, cfg)
    horizon = now_utc + timedelta(days=horizon_days)
    intervals = _build_intervals(cfg, now_utc, horizon)
    if inside:
        for s, e in intervals:
            if s <= now_utc < e:
                return ("ON", e)
        return ("ON", None)
    if intervals:
        return ("OFF", intervals[0][0])
    return ("OFF", None)


def compute_target(
    now_utc: datetime,
    window_start_utc: datetime,
    window_end_utc: datetime,
    window_cap_pct_of_weekly: float | None = None,
    config: dict | None = None,
    default_target_band_pct: float = _DEFAULT_TARGET_BAND_PCT,
    weekly_pct_total: float = 100.0,
    weekly_used_pct: float | None = None,
    weekly_reset_at_utc: datetime | None = None,
) -> dict:
    """Calcola il target di consumo per la finestra 5h corrente.

    Parametri:
      now_utc                    — ora corrente UTC (timezone-aware)
      window_start_utc           — inizio finestra 5h (es. reset_at_unix - 5h)
      window_end_utc             — fine finestra 5h (reset_at_unix)
      window_cap_pct_of_weekly   — % del weekly cap che vale una finestra 5h
                                   piena. Da window_ratio_meter (seed + EMA).
                                   None / 0 → provider weekly-unlimited
                                   (Kimi) o ratio sconosciuto → fallback al
                                   default_target_band_pct.
      config                     — dict jht.config.json (None → load da disco)
      default_target_band_pct    — fallback per finestre ON quando ratio
                                   indisponibile. Default 92 (centro band
                                   storico Sentinella).
      weekly_pct_total           — totale weekly budget % da distribuire
                                   (default 100). Utile per A/B (es. 90 per
                                   tenere 10% di buffer di sicurezza).
      weekly_used_pct            — % del weekly cap già consumata (osservata
                                   dal sentinel-bridge `weekly_usage`). Se
                                   fornita, la distribuzione usa il residuo
                                   `max(0, weekly_pct_total - weekly_used_pct)`
                                   invece del totale, prevenendo l'esaurimento
                                   precoce del weekly cap in scenari 24/7
                                   (bug [PACING-WEEKLY-EXHAUSTION]). None →
                                   comportamento legacy (assume 0% speso).
      weekly_reset_at_utc        — quando si resetta il weekly cap (da
                                   sentinel-bridge `weekly_reset_at_unix`).
                                   Se fornita, `h_weekly` (ore ON nel periodo
                                   di distribuzione) viene calcolata sul
                                   residuo `[now → reset]` invece di 7 giorni
                                   pieni in avanti. None → comportamento
                                   legacy (assume 7 giorni davanti).

    Output:
      work_phase                 — "ON" se now è in finestra, "OFF" altrimenti
      current_window_target_pct  — % del cap 5h da puntare al reset. Replace
                                   diretto del TARGET_BAND_CENTER fisso.
                                   OFF → 0.0 (team idle, sentinella throttla).
      target_pct_of_weekly       — % del weekly cap attesa nella finestra
                                   (utile per UI / debug)
      active_hours_in_window     — ore ON che ricadono nei 5h correnti
      weekly_active_hours        — ore ON nel periodo di distribuzione
                                   (residuo a reset se forniti i parametri
                                   weekly-aware, altrimenti 168h forward)
      weekly_remaining_pct       — % weekly disponibile per la distribuzione
                                   (= weekly_pct_total - weekly_used_pct, o
                                   weekly_pct_total se used non fornito)
      window_cap_pct_of_weekly   — eco del ratio usato (None = fallback)
      next_phase_transition_at   — ISO string del prossimo ON→OFF / OFF→ON
      reason                     — diagnostica testuale per i log
    """
    cfg = config if config is not None else _wh._load_config()
    inside = _wh.is_within_working_hours(now_utc, cfg)
    phase = "ON" if inside else "OFF"

    h_in_window = active_hours_in_range(
        window_start_utc, window_end_utc, cfg
    )

    # Periodo di distribuzione weekly: residuo [now → reset] se conosciuto,
    # altrimenti 7 giorni in avanti dal bordo finestra (comportamento legacy).
    if weekly_reset_at_utc is not None and weekly_reset_at_utc > now_utc:
        h_weekly = active_hours_in_range(now_utc, weekly_reset_at_utc, cfg)
        weekly_window_source = "residual_to_reset"
    else:
        h_weekly = active_hours_in_range(
            window_start_utc, window_start_utc + timedelta(days=7), cfg
        )
        weekly_window_source = "rolling_7d"

    # Budget weekly residuo: totale meno quello già speso (clamp ≥ 0).
    if isinstance(weekly_used_pct, (int, float)):
        weekly_remaining_pct = max(0.0, weekly_pct_total - float(weekly_used_pct))
    else:
        weekly_remaining_pct = weekly_pct_total

    _, next_at = next_phase_transition(now_utc, cfg)

    if h_weekly <= 0 or h_in_window <= 0 or weekly_remaining_pct <= 0:
        # Niente ore attive nella settimana, fuori finestra, o weekly cap
        # già esaurito → OFF totale. Sentinella tradurrà target=0 in
        # pausa/idle.
        target_of_weekly = 0.0
        target_of_window_cap = 0.0
    else:
        target_of_weekly = weekly_remaining_pct * (h_in_window / h_weekly)
        if window_cap_pct_of_weekly is None or window_cap_pct_of_weekly <= 0:
            # Weekly-unlimited (Kimi) o ratio sconosciuto: fallback al band
            # center classico durante le ore ON. Il throttle Sentinella si
            # comporta come oggi.
            target_of_window_cap = default_target_band_pct
        else:
            # Converti "% weekly" → "% 5h cap" usando il ratio del provider.
            # Es. Codex Pro: target_weekly=11.1% / ratio=14.7% × 100 = 75.5%
            target_of_window_cap = (
                target_of_weekly / window_cap_pct_of_weekly * 100.0
            )

        # Sommiamo all'usage_now per riferirci al target assoluto a fine
        # finestra (Sentinella confronta con `usage` corrente). Il ratio
        # weekly è incrementale (% residua nella finestra) — vedi callsite
        # pacing-bridge dove vel_target = (target_pct - usage_now)/h_to_reset.
        # Non addizioniamo usage primary qui per non rompere semantica
        # legacy del bridge (target_pct è già "%5h cap da raggiungere").

    # Safety clamp: la Sentinella non può atterrare oltre il 100% del cap 5h
    # (sarebbe overflow) né sotto 0. Se l'algoritmo produce >100, vuol dire
    # che il weekly budget richiesto eccede il cap della finestra → tetto.
    target_of_window_cap = max(0.0, min(100.0, target_of_window_cap))

    # ── Framing esplicito "finestre da 5h" (auto-calibrante sul RESIDUO) ────
    # Tutto basato sul residuo reale, non su un ipotetico start-of-window:
    #   - even_pace_pct_per_active_hour = budget_residuo / ore_attive_a_reset
    #       → il %/h attivo costante per atterrare a 100% all'ultimo minuto.
    #   - windows_remaining_to_reset = ore_attive_a_reset / 5
    #       → quante finestre 5h-attive restano prima del reset weekly.
    #   - target_per_remaining_window_pct_of_weekly = residuo / finestre_residue
    #       → il target (in % del weekly) per una finestra 5h PIENA da qui in
    #         avanti. Si auto-calibra: se la finestra precedente ha speso meno
    #         del target il residuo è più alto → le successive salgono, e
    #         viceversa. `target_pct_of_weekly` sopra è la quota di QUESTA
    #         finestra, già pesata sulle sue ore attive effettive (h_in_window).
    even_pace_pct_per_active_hour = (
        weekly_remaining_pct / h_weekly if h_weekly > 0 else 0.0
    )
    windows_remaining_to_reset = (
        h_weekly / WINDOW_HOURS if h_weekly > 0 else 0.0
    )
    target_per_remaining_window_pct_of_weekly = (
        weekly_remaining_pct / windows_remaining_to_reset
        if windows_remaining_to_reset > 0
        else 0.0
    )

    ratio_tag = (
        "unlimited"
        if window_cap_pct_of_weekly in (None, 0)
        else "ratio"
    )
    weekly_tag = (
        "weekly-aware"
        if weekly_used_pct is not None or weekly_reset_at_utc is not None
        else "weekly-legacy"
    )
    reason = (
        f"phase={phase} mode={ratio_tag} {weekly_tag} "
        f"h_in_window={h_in_window:.2f} h_weekly={h_weekly:.2f} "
        f"weekly_rem={weekly_remaining_pct:.1f}"
    )

    return {
        "work_phase": phase,
        "current_window_target_pct": round(target_of_window_cap, 2),
        "target_pct_of_weekly": round(target_of_weekly, 3),
        "active_hours_in_window": round(h_in_window, 3),
        "weekly_active_hours": round(h_weekly, 3),
        "weekly_remaining_pct": round(weekly_remaining_pct, 3),
        "weekly_window_source": weekly_window_source,
        "even_pace_pct_per_active_hour": round(even_pace_pct_per_active_hour, 4),
        "windows_remaining_to_reset": round(windows_remaining_to_reset, 2),
        "target_per_remaining_window_pct_of_weekly": round(
            target_per_remaining_window_pct_of_weekly, 3
        ),
        "window_cap_pct_of_weekly": window_cap_pct_of_weekly,
        "next_phase_transition_at": (
            next_at.isoformat() if next_at else None
        ),
        "reason": reason,
    }


# ─── Test inline ────────────────────────────────────────────────────────
# Eseguibile via:  python3 shared/skills/work_hours_target.py --self-test

def _self_test() -> int:
    import json
    failures = 0
    ok = lambda label, cond: print(  # noqa: E731
        f"  {'✓' if cond else '✗'} {label}"
    ) or (0 if cond else 1)

    OFFICE = {
        "team": {
            "working_hours": {
                "timezone": "UTC",
                "windows": [{
                    "days": ["mon", "tue", "wed", "thu", "fri"],
                    "start": "09:00",
                    "end": "18:00",
                }],
            }
        }
    }
    ALWAYS = {}
    WEEKEND = {
        "team": {
            "working_hours": {
                "timezone": "UTC",
                "windows": [{
                    "days": ["sat", "sun"],
                    "start": "09:00",
                    "end": "18:00",
                }],
            }
        }
    }
    NIGHT_WRAP = {
        "team": {
            "working_hours": {
                "timezone": "UTC",
                "windows": [{
                    "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                    "start": "22:00",
                    "end": "06:00",
                }],
            }
        }
    }

    # Lunedì 2026-05-25 10:00 UTC (dentro office)
    mon10 = datetime(2026, 5, 25, 10, 0, tzinfo=timezone.utc)
    win_start = datetime(2026, 5, 25, 9, 0, tzinfo=timezone.utc)
    win_end = datetime(2026, 5, 25, 14, 0, tzinfo=timezone.utc)

    print("─ test 1: 24/7 baseline")
    r = compute_target(mon10, win_start, win_end, None, ALWAYS)
    failures += ok("phase ON", r["work_phase"] == "ON")
    failures += ok(
        "weekly hours = 168", abs(r["weekly_active_hours"] - 168.0) < 0.01
    )
    failures += ok(
        "ratio None → fallback 92", r["current_window_target_pct"] == 92.0
    )

    print("─ test 2: office hours + Codex Pro ratio 14.7")
    r = compute_target(mon10, win_start, win_end, 14.7, OFFICE)
    failures += ok("phase ON", r["work_phase"] == "ON")
    failures += ok(
        "weekly active 45h", abs(r["weekly_active_hours"] - 45.0) < 0.01
    )
    failures += ok(
        "active in W1 = 5h", abs(r["active_hours_in_window"] - 5.0) < 0.01
    )
    # target_weekly = 100 × 5/45 = 11.11%
    failures += ok(
        "target_weekly ≈ 11.11", abs(r["target_pct_of_weekly"] - 11.111) < 0.01
    )
    # target_cap = 11.11 / 14.7 × 100 ≈ 75.6%
    failures += ok(
        "target_cap ≈ 75.6", abs(r["current_window_target_pct"] - 75.59) < 0.1
    )

    print("─ test 3: office W2 19:00-00:00 → 0h, target = 0")
    win_w3_start = datetime(2026, 5, 25, 19, 0, tzinfo=timezone.utc)
    win_w3_end = datetime(2026, 5, 26, 0, 0, tzinfo=timezone.utc)
    # now = 20:00 (fuori office)
    mon20 = datetime(2026, 5, 25, 20, 0, tzinfo=timezone.utc)
    r = compute_target(mon20, win_w3_start, win_w3_end, 14.7, OFFICE)
    failures += ok("phase OFF", r["work_phase"] == "OFF")
    failures += ok(
        "target_cap = 0", r["current_window_target_pct"] == 0.0
    )
    failures += ok(
        "active_in_window = 0", r["active_hours_in_window"] == 0.0
    )

    print("─ test 4: office W2 14:00-19:00 → 4 active hours (clip at 18:00)")
    w2s = datetime(2026, 5, 25, 14, 0, tzinfo=timezone.utc)
    w2e = datetime(2026, 5, 25, 19, 0, tzinfo=timezone.utc)
    r = compute_target(
        datetime(2026, 5, 25, 15, 0, tzinfo=timezone.utc),
        w2s, w2e, 14.7, OFFICE,
    )
    failures += ok(
        "active in W2 = 4h", abs(r["active_hours_in_window"] - 4.0) < 0.01
    )
    # target_weekly = 100 × 4/45 = 8.89%; target_cap = 8.89/14.7×100 ≈ 60.5
    failures += ok(
        "target_cap ≈ 60.5", abs(r["current_window_target_pct"] - 60.47) < 0.1
    )

    print("─ test 5: weekend (Sat 10:00) — Kimi ratio None → fallback 92")
    sat = datetime(2026, 5, 30, 10, 0, tzinfo=timezone.utc)
    sat_ws = datetime(2026, 5, 30, 9, 0, tzinfo=timezone.utc)
    sat_we = datetime(2026, 5, 30, 14, 0, tzinfo=timezone.utc)
    r = compute_target(sat, sat_ws, sat_we, None, WEEKEND)
    failures += ok("phase ON", r["work_phase"] == "ON")
    failures += ok(
        "weekly_active = 18h", abs(r["weekly_active_hours"] - 18.0) < 0.01
    )
    failures += ok(
        "target_cap fallback 92", r["current_window_target_pct"] == 92.0
    )

    print("─ test 6: night wrap-around (mon 23:00→tue 06:00)")
    # Mon 23:30 UTC, finestra 5h 21:00-02:00 (cross-midnight)
    mon2330 = datetime(2026, 5, 25, 23, 30, tzinfo=timezone.utc)
    ws = datetime(2026, 5, 25, 21, 0, tzinfo=timezone.utc)
    we = datetime(2026, 5, 26, 2, 0, tzinfo=timezone.utc)
    r = compute_target(mon2330, ws, we, 14.7, NIGHT_WRAP)
    failures += ok("phase ON (night)", r["work_phase"] == "ON")
    # Finestra 21:00-02:00 attiva: 22:00 mon → 02:00 tue = 4h
    failures += ok(
        "active in night-win = 4h",
        abs(r["active_hours_in_window"] - 4.0) < 0.01,
    )

    print("─ test 7: next_phase_transition")
    # Office, ora venerdì 17:00 → prossima transizione ON→OFF a 18:00
    fri17 = datetime(2026, 5, 29, 17, 0, tzinfo=timezone.utc)
    phase, at = next_phase_transition(fri17, OFFICE)
    failures += ok("fri 17:00 → ON", phase == "ON")
    failures += ok(
        "transition at fri 18:00 UTC",
        at == datetime(2026, 5, 29, 18, 0, tzinfo=timezone.utc),
    )
    # Sabato 10:00 (OFF) → prossima ON lunedì 09:00
    sat10 = datetime(2026, 5, 30, 10, 0, tzinfo=timezone.utc)
    phase, at = next_phase_transition(sat10, OFFICE)
    failures += ok("sat 10:00 → OFF", phase == "OFF")
    failures += ok(
        "next ON mon 09:00 UTC",
        at == datetime(2026, 6, 1, 9, 0, tzinfo=timezone.utc),
    )

    print("─ test 8a: 24/7 weekly 60% spent with 72h to reset → aggressive throttle")
    # Scenario PACING-WEEKLY-EXHAUSTION: VPS 24/7, team ha già bruciato
    # 60% weekly e mancano 72h al reset. Senza weekly-aware il target
    # continua a essere 100/168×5/14.7×100 ≈ 20.3% per finestra.
    # Con weekly-aware: rimangono 40% su 72h ON → per finestra 5h:
    #   target_weekly = 40 × 5/72 = 2.78%
    #   target_cap    = 2.78 / 14.7 × 100 ≈ 18.89%
    # Più basso del baseline → throttle più aggressivo per non sforare.
    reset_at = mon10 + timedelta(hours=72)
    r_base = compute_target(mon10, win_start, win_end, 14.7, ALWAYS)
    r_aware = compute_target(
        mon10, win_start, win_end, 14.7, ALWAYS,
        weekly_used_pct=60.0, weekly_reset_at_utc=reset_at,
    )
    failures += ok(
        "baseline 24/7 target_cap ≈ 20.3",
        abs(r_base["current_window_target_pct"] - 20.3) < 0.2,
    )
    failures += ok(
        "weekly-aware target_cap ≈ 18.9 (< baseline)",
        abs(r_aware["current_window_target_pct"] - 18.9) < 0.3,
    )
    failures += ok(
        "weekly_remaining_pct = 40",
        abs(r_aware["weekly_remaining_pct"] - 40.0) < 0.01,
    )
    failures += ok(
        "h_weekly = 72 (residuo, non 168)",
        abs(r_aware["weekly_active_hours"] - 72.0) < 0.01,
    )
    failures += ok(
        "source = residual_to_reset",
        r_aware["weekly_window_source"] == "residual_to_reset",
    )

    print("─ test 8b: weekly cap exhausted (≥ 100%) → target 0")
    r_exhausted = compute_target(
        mon10, win_start, win_end, 14.7, ALWAYS,
        weekly_used_pct=100.0, weekly_reset_at_utc=reset_at,
    )
    failures += ok(
        "weekly esaurito → target_cap 0",
        r_exhausted["current_window_target_pct"] == 0.0,
    )
    failures += ok(
        "weekly esaurito → remaining 0",
        r_exhausted["weekly_remaining_pct"] == 0.0,
    )

    print("─ test 8c: weekly-aware office hours (45h/week, 30h left, 50% spent)")
    # Office hours: 30h ON nelle prossime 72h (3 giorni Mer-Ven 9-18 = 27h
    # + parziali). 50% weekly residuo. Calcolo: target_weekly = 50 × 5/h_remaining_on.
    # Verifichiamo che il source sia residual e che il valore sia coerente.
    r_office_aware = compute_target(
        mon10, win_start, win_end, 14.7, OFFICE,
        weekly_used_pct=50.0, weekly_reset_at_utc=reset_at,
    )
    failures += ok(
        "office weekly-aware phase ON",
        r_office_aware["work_phase"] == "ON",
    )
    failures += ok(
        "office weekly-aware remaining 50",
        abs(r_office_aware["weekly_remaining_pct"] - 50.0) < 0.01,
    )
    failures += ok(
        "office weekly-aware source residual",
        r_office_aware["weekly_window_source"] == "residual_to_reset",
    )

    print("─ test 8d: weekly-aware backward-compat (no params → legacy path)")
    r_legacy = compute_target(mon10, win_start, win_end, 14.7, ALWAYS)
    failures += ok(
        "legacy source = rolling_7d",
        r_legacy["weekly_window_source"] == "rolling_7d",
    )
    failures += ok(
        "legacy h_weekly = 168",
        abs(r_legacy["weekly_active_hours"] - 168.0) < 0.01,
    )
    failures += ok(
        "legacy remaining = 100",
        r_legacy["weekly_remaining_pct"] == 100.0,
    )

    print("─ test 9: Europe/Rome timezone — local office hours 9-18")
    rome_cfg = {
        "team": {
            "working_hours": {
                "timezone": "Europe/Rome",
                "windows": [{
                    "days": ["mon", "tue", "wed", "thu", "fri"],
                    "start": "09:00",
                    "end": "18:00",
                }],
            }
        }
    }
    # 2026-05-25 = lunedì, Roma è UTC+2 (CEST) → 09:00 locale = 07:00 UTC
    mon07_utc = datetime(2026, 5, 25, 7, 30, tzinfo=timezone.utc)
    r = compute_target(
        mon07_utc,
        datetime(2026, 5, 25, 7, 0, tzinfo=timezone.utc),
        datetime(2026, 5, 25, 12, 0, tzinfo=timezone.utc),
        14.7, rome_cfg,
    )
    failures += ok("Roma mon 09:30 locale → ON", r["work_phase"] == "ON")
    failures += ok(
        "Roma weekly = 45h",
        abs(r["weekly_active_hours"] - 45.0) < 0.01,
    )

    print("─ test 10: 7/7 08-20, starting MID-WEEK (residual-based)")
    SEVEN_SEVEN = {
        "team": {
            "working_hours": {
                "timezone": "UTC",
                "windows": [{
                    "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                    "start": "08:00",
                    "end": "20:00",
                }],
            }
        }
    }
    # now = lun 2026-06-01 12:00 UTC; reset weekly = ven 2026-06-05 12:00 UTC.
    # Ore attive nel residuo [lun12 → ven12]: lun 8 + mar/mer/gio 12×3 + ven 4 = 48h.
    now10 = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    reset10 = datetime(2026, 6, 5, 12, 0, tzinfo=timezone.utc)
    full_win_s = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    full_win_e = datetime(2026, 6, 1, 17, 0, tzinfo=timezone.utc)  # 5h tutte ON
    r = compute_target(
        now10, full_win_s, full_win_e, 14.7, SEVEN_SEVEN,
        weekly_used_pct=20.0, weekly_reset_at_utc=reset10,
    )
    failures += ok("source residual_to_reset", r["weekly_window_source"] == "residual_to_reset")
    failures += ok("remaining h_weekly = 48h (not 84)", abs(r["weekly_active_hours"] - 48.0) < 0.05)
    failures += ok("even_pace ≈ 1.667%/h (80/48)", abs(r["even_pace_pct_per_active_hour"] - 1.6667) < 0.01)
    failures += ok("windows_remaining = 9.6 (48/5)", abs(r["windows_remaining_to_reset"] - 9.6) < 0.01)
    failures += ok("target/remaining window ≈ 8.333% (80/9.6)", abs(r["target_per_remaining_window_pct_of_weekly"] - 8.333) < 0.01)
    # Finestra piena → la quota di QUESTA finestra coincide col target/finestra.
    failures += ok("full window: target_pct_of_weekly ≈ 8.333", abs(r["target_pct_of_weekly"] - 8.333) < 0.01)

    # Auto-calibrazione: stesso istante ma budget più speso (40%) → target più basso.
    r_cal = compute_target(
        now10, full_win_s, full_win_e, 14.7, SEVEN_SEVEN,
        weekly_used_pct=40.0, weekly_reset_at_utc=reset10,
    )
    failures += ok("auto-calibrates down: 40% spent → 6.25% (60/9.6)", abs(r_cal["target_per_remaining_window_pct_of_weekly"] - 6.25) < 0.01)
    failures += ok("auto-calibration: lower target than the 20% case", r_cal["target_per_remaining_window_pct_of_weekly"] < r["target_per_remaining_window_pct_of_weekly"])

    # Finestra che scavalla le 20:00 → solo le ore attive contano (la quota cala,
    # MA il riferimento per-finestra-piena resta 8.333).
    strad_s = datetime(2026, 6, 1, 18, 0, tzinfo=timezone.utc)
    strad_e = datetime(2026, 6, 1, 23, 0, tzinfo=timezone.utc)  # solo 18-20 = 2h ON
    r_str = compute_target(
        now10, strad_s, strad_e, 14.7, SEVEN_SEVEN,
        weekly_used_pct=20.0, weekly_reset_at_utc=reset10,
    )
    failures += ok("window crossing 20:00: 2 active hours", abs(r_str["active_hours_in_window"] - 2.0) < 0.05)
    failures += ok("partial-window share ≈ 3.333% (80×2/48)", abs(r_str["target_pct_of_weekly"] - 3.333) < 0.05)

    print()
    if failures:
        print(f"✗ {failures} tests failed")
        return 1
    print("✓ all tests passed")
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(_self_test())
    # Default: dump esempio di compute_target con la config attiva.
    # #10 — fetch il ratio REALE da provider_capacity (come fa il daemon
    # pacing-bridge) invece di passare None: senza, lo standalone cadeva sul
    # fallback `mode=unlimited weekly-legacy` / target 92%, che NON è quello
    # che il daemon applica (~40% col ratio) → diagnosi errata "team al 92%".
    import json
    try:
        import provider_capacity as _pcap
        _ratio = _pcap.get_window_cap_pct_of_weekly()
    except Exception:
        _ratio = None
    now = datetime.now(timezone.utc)
    win_start = now.replace(minute=0, second=0, microsecond=0)
    win_end = win_start + timedelta(hours=5)
    out = compute_target(now, win_start, win_end, _ratio)
    out["_note"] = (
        "ratio da provider_capacity; per il target LIVE reale leggi "
        "pacing-bridge-state.json (current_window_target_pct/target_source)"
    )
    print(json.dumps(out, indent=2, default=str))
