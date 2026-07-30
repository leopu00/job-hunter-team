#!/usr/bin/env python3
"""
window_ratio_meter.py — calibrazione auto del rapporto cap-5h / cap-weekly.

Concetto: ogni piano provider (Codex Pro, Claude Max, ecc.) ha un
rapporto deterministico tra il cap della finestra rate-limit 5h e il
cap weekly. È **non documentato dai provider** e diverso per ogni tier.

Il design doc lockato 2026-05-25 prescrive seed table + EMA blendata
osservando l'effettivo rapporto Δweekly/Δ5h dai sample del bridge:

    sample paired (t1, t2):
      Δ5h_pct      = usage(t2) − usage(t1)           [0..100% del cap 5h]
      Δweekly_pct  = weekly(t2) − weekly(t1)         [0..100% del cap weekly]
      ratio_inst   = Δweekly_pct / Δ5h_pct           [% weekly per 1% di 5h]

    EMA con half_life_days = 7
    confidence = min(1, days_observed / 4)

Output: `~/.jht/logs/window-ratio-state.json` — letto da
`provider_capacity.py` che blenda seed + ema in base alla confidence.

Letto SOLO da provider_capacity quando il provider ha weekly cap
(non Kimi, che è weekly-unlimited).

Esegui:
  python3 shared/skills/window_ratio_meter.py            # one-shot
  python3 shared/skills/window_ratio_meter.py --watch    # daemon (tick 5m)
  python3 shared/skills/window_ratio_meter.py --self-test
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht")))
LOGS_DIR = JHT_HOME / "logs"
SENTINEL_JSONL = LOGS_DIR / "sentinel-data.jsonl"
STATE_FILE = LOGS_DIR / "window-ratio-state.json"
CONFIG_FILE = JHT_HOME / "jht.config.json"
# Lockfile del singleton del DAEMON (--watch), file dedicato. Due daemon vivi
# aggiornerebbero la stessa EMA due volte per tick, cioè una calibrazione
# falsata ([BRIDGE-SINGLETON-PARTIAL]). Il one-shot non lo prende: è
# diagnostica e non deve uscire in silenzio se il daemon è su.
LOCK_FILE = LOGS_DIR / "window-ratio-meter.lock"

# Soglie:
#   MIN_DELTA_5H_ACCUM_PCT — `usage` e `weekly_usage` dal bridge sono INTERI
#       (usage=int(round(...))). Calcolare il ratio per-tick su Δ interi piccoli
#       (es. +1/+1) dà rapporti assurdi (100%, 50%) → EMA avvelenata. Quindi NON
#       si calcola tick-per-tick: si accumulano Δu/Δw finché Δu_cum ≥ questa
#       soglia, poi UN solo ratio sul denominatore grande (errore di
#       quantizzazione < ~10%). 10pp ≈ mezza finestra 5h a regime.
#   MAX_GAP_MIN — se due sample consecutivi sono più distanti, scarta l'accumulo
#       (probabilmente reset session o pausa lunga).
#   RATIO_SANE_* — clamp di sanità: un ratio finestra→weekly fuori da questa
#       banda è quasi certamente rumore residuo → si scarta (non aggiorna l'EMA).
MIN_DELTA_5H_ACCUM_PCT = 10.0
MAX_GAP_MIN = 30.0
RATIO_SANE_MIN_PCT = 2.0
RATIO_SANE_MAX_PCT = 60.0

# EMA half-life giorni: il rapporto è fisso per piano, quindi calibratura
# può essere lenta. 7gg = molto smooth, resiste a rumore di un tick.
EMA_HALF_LIFE_DAYS = 7.0

# Confidence cresce linearmente con i giorni osservati, satura a 1 a
# OBSERVED_TRUST_DAYS. Stesso valore usato in provider_capacity.py per
# il blend seed+ema → tienili allineati.
OBSERVED_TRUST_DAYS = 4.0

# Tick daemon (5 min: equivalente al tick del sentinel-bridge in g-spot).
WATCH_TICK_SEC = 300


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _iso_to_ts(s) -> float | None:
    if not isinstance(s, str):
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _read_active_provider() -> str:
    try:
        with CONFIG_FILE.open(encoding="utf-8") as f:
            return (json.load(f).get("active_provider") or "openai").lower()
    except (OSError, json.JSONDecodeError):
        return "openai"


def _read_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        with STATE_FILE.open(encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def _write_state(state: dict) -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(f".json.tmp.{os.getpid()}")
    tmp.write_text(json.dumps(state, indent=2, default=str), encoding="utf-8")
    os.replace(tmp, STATE_FILE)


def _iter_samples(since_ts: float | None = None):
    """Yield (ts, usage_pct, weekly_pct, session_id) da sentinel-data.jsonl.

    Skippa entry senza i campi necessari. Ordinato già per arrivo (append-only).
    """
    if not SENTINEL_JSONL.exists():
        return
    with SENTINEL_JSONL.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            ts = _iso_to_ts(e.get("ts"))
            if ts is None:
                continue
            if since_ts is not None and ts <= since_ts:
                continue
            usage = e.get("usage")
            weekly = e.get("weekly_usage")
            if not isinstance(usage, (int, float)):
                continue
            if not isinstance(weekly, (int, float)):
                # Provider senza weekly metric (Kimi) → skip ratio calc.
                continue
            yield ts, float(usage), float(weekly), e.get("session_id")


def _ema_alpha_from_halflife(dt_days: float) -> float:
    """Coefficiente α dell'EMA per uno step di `dt_days` con half-life fissa.

    Formula: half-life t½ ⇒ α = 1 − 0.5^(dt/t½).
    Usata invece di α fisso così l'EMA è invariante al tick rate.
    """
    if dt_days <= 0:
        return 0.0
    return 1.0 - math.pow(0.5, dt_days / EMA_HALF_LIFE_DAYS)


def update_ratio(state: dict, provider: str) -> dict:
    """Processa nuovi sample da sentinel-data.jsonl, aggiorna EMA e ritorna
    lo state aggiornato. Idempotente: lo stato include `last_processed_ts`."""
    prev_provider = (state.get("provider") or "").lower()
    if prev_provider and prev_provider != provider:
        # Provider cambiato (es. l'utente è passato da Codex a Claude):
        # reset EMA, ricalibrazione da zero.
        state = {}

    ema = state.get("ema_ratio_pct")
    last_ts = state.get("last_processed_ts") or 0.0
    samples_count = int(state.get("samples_count") or 0)
    first_sample_ts = state.get("first_sample_ts")
    last_inst_ratio = state.get("last_instantaneous_ratio_pct")

    # Accumulatore Δu/Δw + ultimo sample visto, PERSISTITI nello state: un
    # singolo run del daemon (tick 5min) può non raggiungere la soglia di
    # accumulo, quindi continuiamo a sommare attraverso i run.
    pending_du = float(state.get("pending_du") or 0.0)
    pending_dw = float(state.get("pending_dw") or 0.0)
    pending_dt_days = float(state.get("pending_dt_days") or 0.0)
    prev_ts = state.get("cont_ts")
    prev_u = state.get("cont_u")
    prev_w = state.get("cont_w")
    prev_session = state.get("cont_session")

    def _reset_accum():
        nonlocal pending_du, pending_dw, pending_dt_days
        pending_du = 0.0
        pending_dw = 0.0
        pending_dt_days = 0.0

    new_last_ts = last_ts

    for ts, u, w, sess in _iter_samples(since_ts=last_ts):
        if first_sample_ts is None:
            first_sample_ts = ts
        if prev_ts is not None:
            gap_min = (ts - prev_ts) / 60.0
            same_session = (
                prev_session is not None
                and sess is not None
                and prev_session == sess
            )
            if gap_min <= MAX_GAP_MIN and same_session:
                du = u - prev_u
                dw = w - prev_w
                if du < 0 or dw < 0:
                    # Reset finestra primary (usage cala) o reset weekly:
                    # l'accumulo non può attraversare un reset → scarta il
                    # parziale e riparte dal prossimo Δ valido.
                    _reset_accum()
                else:
                    pending_du += du
                    pending_dw += dw
                    pending_dt_days += (ts - prev_ts) / 86400.0
                    if pending_du >= MIN_DELTA_5H_ACCUM_PCT:
                        ratio_inst = pending_dw / pending_du * 100.0
                        if RATIO_SANE_MIN_PCT <= ratio_inst <= RATIO_SANE_MAX_PCT:
                            last_inst_ratio = round(ratio_inst, 3)
                            samples_count += 1
                            if ema is None:
                                ema = ratio_inst
                            else:
                                # Cold-start fix: in warmup usa alpha = 1/n
                                # (media corrente sui primi sample) così l'EMA
                                # CONVERGE al ratio vero invece di restare
                                # incollata al primo sample (half-life 7gg lo
                                # renderebbe quasi immobile). Quando 1/n scende
                                # sotto l'alpha dell'half-life, subentra lo
                                # smoothing lento normale.
                                a = max(
                                    _ema_alpha_from_halflife(pending_dt_days),
                                    1.0 / samples_count,
                                )
                                ema = a * ratio_inst + (1.0 - a) * ema
                        # emesso (o scartato perché fuori banda): azzera comunque
                        _reset_accum()
            else:
                # Cambio sessione o gap troppo grande → scarta l'accumulo.
                _reset_accum()
        prev_ts, prev_u, prev_w, prev_session = ts, u, w, sess
        new_last_ts = ts

    days_observed = (
        ((_now_utc().timestamp() - first_sample_ts) / 86400.0)
        if first_sample_ts
        else 0.0
    )
    confidence = max(0.0, min(1.0, days_observed / OBSERVED_TRUST_DAYS))

    return {
        "version": 1,
        "provider": provider,
        "ema_ratio_pct": (round(ema, 3) if ema is not None else None),
        "last_instantaneous_ratio_pct": last_inst_ratio,
        "samples_count": samples_count,
        "first_sample_ts": first_sample_ts,
        "last_processed_ts": new_last_ts,
        "days_observed": round(days_observed, 2),
        "confidence_0_1": round(confidence, 3),
        # Stato accumulatore (continuità cross-run).
        "pending_du": round(pending_du, 4),
        "pending_dw": round(pending_dw, 4),
        "pending_dt_days": round(pending_dt_days, 6),
        "cont_ts": prev_ts,
        "cont_u": prev_u,
        "cont_w": prev_w,
        "cont_session": prev_session,
        "updated_at": _now_utc().isoformat(),
    }


def run_once(verbose: bool = False) -> dict:
    provider = _read_active_provider()
    state = _read_state()
    new_state = update_ratio(state, provider)
    _write_state(new_state)
    if verbose:
        print(json.dumps(new_state, indent=2, default=str))
    return new_state


def _acquire_singleton() -> None:
    """Uno solo di me. Modulo non caricabile → si prosegue senza lock: meglio
    un daemon senza lock che nessuna calibrazione."""
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from singleton_lock import acquire_singleton
        acquire_singleton(LOCK_FILE, label="window-ratio-meter")
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"[window-ratio-meter] WARN singleton_lock non caricabile ({e}) "
              f"— proseguo senza lock", flush=True)


def run_watch(tick_sec: int = WATCH_TICK_SEC) -> None:
    _acquire_singleton()
    print(
        f"[window-ratio-meter] up — tick={tick_sec}s jht_home={JHT_HOME}",
        flush=True,
    )
    while True:
        try:
            s = run_once()
            print(
                f"[window-ratio-meter] ema={s.get('ema_ratio_pct')} "
                f"samples={s.get('samples_count')} "
                f"conf={s.get('confidence_0_1')}",
                flush=True,
            )
        except Exception as e:
            print(
                f"[window-ratio-meter] ERROR {e!r}",
                file=sys.stderr,
                flush=True,
            )
        time.sleep(tick_sec)


# ─── Self-test ─────────────────────────────────────────────────────────

def _self_test() -> int:
    import tempfile
    import textwrap

    global LOGS_DIR, SENTINEL_JSONL, STATE_FILE, CONFIG_FILE
    tmp = Path(tempfile.mkdtemp(prefix="wrm_test_"))
    LOGS_DIR = tmp / "logs"
    LOGS_DIR.mkdir(parents=True)
    SENTINEL_JSONL = LOGS_DIR / "sentinel-data.jsonl"
    STATE_FILE = LOGS_DIR / "window-ratio-state.json"
    CONFIG_FILE = tmp / "jht.config.json"
    CONFIG_FILE.write_text(json.dumps({"active_provider": "openai"}))

    # Sintetico Codex Pro: ratio "vero" = 14.7% (1% di 5h cap = 0.147% weekly).
    # Generiamo 60 sample, spaziati 5 min, in stessa session. Aggiungiamo
    # del rumore ±5% sul ratio per simulare quantizzazione dei provider.
    import random
    random.seed(42)
    base_ts = datetime(2026, 5, 25, 9, 0, tzinfo=timezone.utc).timestamp()
    usage = 0.0
    weekly = 50.0  # mid-week, partiamo da 50%
    with SENTINEL_JSONL.open("w", encoding="utf-8") as f:
        for i in range(60):
            ts = base_ts + i * 300  # ogni 5 min
            du = 0.8 + random.uniform(-0.1, 0.1)  # ~9.6%/h sul 5h cap
            usage += du
            # Ratio vero 14.7% con rumore ±5%
            dw = du * 0.147 * random.uniform(0.95, 1.05)
            weekly += dw
            entry = {
                "ts": datetime.fromtimestamp(ts, timezone.utc).isoformat(),
                "usage": round(usage, 3),
                "weekly_usage": round(weekly, 3),
                "session_id": "S1",
            }
            f.write(json.dumps(entry) + "\n")

    state = run_once()
    fails = 0
    def ok(label, cond):
        nonlocal fails
        print(f"  {'OK' if cond else 'FAIL'} {label}")
        if not cond:
            fails += 1

    ok("provider rilevato", state["provider"] == "openai")
    # Con l'accumulo Δu≥10pp si emette ~1 ratio ogni ~12 tick → molti meno
    # sample del per-tick, ma molto meno rumorosi.
    ok(f"samples_count accumulati >= 3 (got {state['samples_count']})",
       state["samples_count"] >= 3)
    ok(
        f"ema vicino a 14.7 (got {state['ema_ratio_pct']})",
        abs(state["ema_ratio_pct"] - 14.7) < 1.5,
    )

    # Re-run: dev'essere idempotente, nessun nuovo sample
    before_count = state["samples_count"]
    state2 = run_once()
    ok("idempotente (no nuovi sample)", state2["samples_count"] == before_count)

    # ── Test QUANTIZZAZIONE (il bug reale) ───────────────────────────────
    # Bridge reale: usage=int(round(...)) e weekly interi. Ratio vero 15%.
    # Per-tick i Δ interi (+1/+1=100%, +1/0=0%) avvelenavano l'EMA a 25-100%.
    # Con l'accumulo (Δu≥10pp) l'EMA resta vicina al 15% vero.
    tmp2 = Path(tempfile.mkdtemp(prefix="wrm_quant_"))
    LOGS_DIR = tmp2 / "logs"
    LOGS_DIR.mkdir(parents=True)
    SENTINEL_JSONL = LOGS_DIR / "sentinel-data.jsonl"
    STATE_FILE = LOGS_DIR / "window-ratio-state.json"
    CONFIG_FILE = tmp2 / "jht.config.json"
    CONFIG_FILE.write_text(json.dumps({"active_provider": "openai"}))
    base2 = datetime(2026, 5, 26, 9, 0, tzinfo=timezone.utc).timestamp()
    with SENTINEL_JSONL.open("w", encoding="utf-8") as f:
        for i in range(120):
            ts = base2 + i * 300
            usage_i = i + 1  # intero, +1/tick
            weekly_i = 50 + round(usage_i * 0.15)  # intero, ratio vero 15%
            f.write(json.dumps({
                "ts": datetime.fromtimestamp(ts, timezone.utc).isoformat(),
                "usage": usage_i,
                "weekly_usage": weekly_i,
                "session_id": "Q1",
            }) + "\n")
    qstate = run_once()
    qema = qstate["ema_ratio_pct"]
    ok(f"quantizz: ema ~15 vero (got {qema})",
       qema is not None and 11.0 <= qema <= 19.0)
    ok(f"quantizz: NIENTE overshoot >40 (col bug era 25-100, got {qema})",
       qema is not None and qema < 40.0)

    # Provider change: reset
    CONFIG_FILE.write_text(json.dumps({"active_provider": "claude"}))
    state3 = run_once()
    ok("provider change → reset", state3["provider"] == "claude")
    ok(
        "ema rebuilt nuovo provider",
        state3["samples_count"] > 0,
    )

    return 0 if fails == 0 else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--watch", action="store_true", help="daemon mode")
    ap.add_argument("--tick", type=int, default=WATCH_TICK_SEC,
                    help=f"daemon tick (default {WATCH_TICK_SEC}s)")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        sys.exit(_self_test())
    if args.watch:
        run_watch(args.tick)
    else:
        s = run_once(verbose=args.verbose or True)


if __name__ == "__main__":
    main()
