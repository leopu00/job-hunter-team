#!/usr/bin/env python3
"""
compute_metrics — funzione pura per derivare metriche di rate-limit.

Estratta dal bridge originario (sentinel-bridge.py:compute_metrics) per
essere riusabile da chiunque debba scrivere un sample nel JSONL: bridge,
usage_record (skill chiamata da Capitano/Sentinella), futuri provider.

Input:
    parsed   = {usage, reset_at, provider, weekly_usage?}  (dato fresco)
    last     = ultimo sample dello stesso provider, o None
    history  = lista degli ultimi N sample (per burst filter)

Output: dict con campi del JSONL pronto da scrivere:
    ts, provider, usage, delta, velocity, velocity_smooth, velocity_ideal,
    projection, projection_naive, velocity_decreasing,
    status, throttle, reset_at, weekly_usage

Niente I/O qui (file system, network, tmux): la skill resta una funzione
pura, testabile, idempotente. Chi la chiama si occupa di leggere history
e scrivere il sample finale.
"""

import math
from datetime import datetime, timezone, timedelta


# ─── Costanti modello (in sync col bridge) ─────────────────────────────

# Banda target di consumo: sopra → ATTENZIONE, sotto → SOTTOUTILIZZO.
PROJ_HIGH = 95
PROJ_LOW = 85
SAFE_TARGET = 95

# Costante di tempo del rientro (modello first-order):
# dopo un throttle gli agenti impiegano ~5 min a rallentare davvero
# (sleep allungati, completamento turni in corso). τ permette alla
# projection di prevedere il rientro invece di estrapolare la velocity
# istantanea — senza, oscillazione tipica RALLENTA-SOTTO-RALLENTA.
TAU_HOURS = 5.0 / 60.0

# EMA velocity: alpha=0.2 → finestra effettiva ~10 sample. Burst di 30s
# pesa ~20% e decade in pochi tick.
EMA_ALPHA = 0.2

# Session discontinuity: se il bridge è stato fermo > 20 min, l'EMA
# ereditata dal vecchio sample non è più rappresentativa. Cold-start.
SESSION_GAP_MIN = 20

# Burst filter: se la crescita REALE dell'ultima ora è < 8% cumulativo,
# scartiamo proiezioni alte basate su spike singoli e usiamo la media
# oraria reale come fallback.
BURST_FILTER_THRESHOLD = 8.0

# Reset event: un calo di > 30 punti percentuali = il provider ha
# resettato la finestra. Trattiamo come start sessione nuova.
RESET_DROP = 30


def hours_until(reset_hhmm):
    """HH:MM (UTC) → ore float mancanti; se passato, assume domani."""
    if not reset_hhmm:
        return None
    try:
        h, m = map(int, reset_hhmm.split(":"))
    except (ValueError, AttributeError):
        return None
    now = datetime.now(timezone.utc)
    target = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds() / 3600


def _parse_iso(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except (TypeError, ValueError):
        return None


def cumulative_delta_last_hour(history, now=None):
    """Somma dei delta degli ultimi 60 min. Usato dal burst filter."""
    if not history:
        return 0.0
    if now is None:
        now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=1)
    total = 0.0
    for entry in history:
        ts = _parse_iso(entry.get("ts"))
        if ts and ts >= cutoff:
            d = entry.get("delta")
            if isinstance(d, (int, float)):
                total += d
    return total


def compute_metrics(parsed, last, history=None):
    """Deriva tutte le metriche da un dato fresco + storia.

    Vedi modulo doc per il contratto. Output dict pronto per JSONL.
    """
    usage = parsed["usage"]
    provider = parsed.get("provider", "openai")
    now = datetime.now(timezone.utc)
    ts = now.isoformat()
    history = history or []

    # ── Delta + velocity istantanea ──
    delta = 0.0
    velocity = 0.0
    session_gap_min = 0.0
    if last and isinstance(last.get("usage"), (int, float)):
        last_ts = _parse_iso(last.get("ts"))
        if last_ts:
            session_gap_min = (now - last_ts).total_seconds() / 60.0
            dt_h = max(0.01, (now - last_ts).total_seconds() / 3600)
            delta = usage - last["usage"]
            velocity = delta / dt_h

    # ── Cold-start: gap troppo grande, EMA invalidata ──
    session_discontinuity = session_gap_min > SESSION_GAP_MIN
    if session_discontinuity:
        velocity = 0.0
        velocity_smooth = 0.0
    else:
        vs_prev = (last or {}).get("velocity_smooth") or 0.0
        velocity_smooth = EMA_ALPHA * velocity + (1 - EMA_ALPHA) * vs_prev

    # ── Projection τ-aware ──
    hours_to_reset = hours_until(parsed.get("reset_at"))
    velocity_ideal = None
    projection = None
    projection_naive = None
    if hours_to_reset and hours_to_reset > 0:
        velocity_ideal = max(0.0, (SAFE_TARGET - usage) / hours_to_reset)
        projection_naive = usage + velocity_smooth * hours_to_reset
        # Modello first-order: v(t)=v_ideal + (v_now-v_ideal)·exp(-t/τ)
        # ∫v dt = v_ideal·h + (v_now-v_ideal)·τ·(1-exp(-h/τ))
        delta_v = velocity_smooth - velocity_ideal
        decay = math.exp(-hours_to_reset / TAU_HOURS) if TAU_HOURS > 0 else 0.0
        adapted_increase = velocity_ideal * hours_to_reset + delta_v * TAU_HOURS * (1 - decay)
        projection = usage + adapted_increase

    # ── Dead-band: velocity in calo? ──
    vs_prev = (last or {}).get("velocity_smooth")
    if isinstance(vs_prev, (int, float)) and abs(vs_prev) > 1e-3:
        velocity_decreasing = velocity_smooth < vs_prev - 0.5
    else:
        velocity_decreasing = False

    # ── Reset event: provider ha azzerato la finestra ──
    reset_event = bool(last and usage < (last.get("usage") or 0) - RESET_DROP)

    # ── Burst filter ──
    last_hour_delta = cumulative_delta_last_hour(
        history + [{"ts": ts, "delta": delta}], now
    )
    is_burst_artifact = (
        projection is not None and projection > 100
        and last_hour_delta < BURST_FILTER_THRESHOLD
        and hours_to_reset and hours_to_reset > 0
    )
    if is_burst_artifact:
        realistic_vel = last_hour_delta
        projection = usage + max(realistic_vel, velocity_ideal or 0) * hours_to_reset

    # ── Status / throttle (solo informativi: il vero throttle lo
    # decide il Capitano consultando questi numeri) ──
    if reset_event:
        status, throttle = "RESET", 0
    elif projection is not None and projection > PROJ_HIGH:
        status, throttle = "ATTENZIONE", 1
    elif projection is not None and projection < PROJ_LOW:
        status, throttle = "SOTTOUTILIZZO", 0
    else:
        status, throttle = "OK", 0

    return {
        "ts": ts,
        "provider": provider,
        "usage": usage,
        "delta": round(delta, 2),
        "velocity": round(velocity, 2),
        "velocity_smooth": round(velocity_smooth, 2),
        "velocity_ideal": round(velocity_ideal, 2) if velocity_ideal is not None else None,
        "projection": round(projection, 2) if projection is not None else None,
        "projection_naive": round(projection_naive, 2) if projection_naive is not None else None,
        "velocity_decreasing": velocity_decreasing,
        "status": status,
        "throttle": throttle,
        "reset_at": parsed.get("reset_at"),
        "weekly_usage": parsed.get("weekly_usage"),
    }


# ── CLI per uso manuale (debug / one-shot) ─────────────────────────────

def main():
    """CLI: --usage X --reset-at HH:MM [--provider P] [--last-jsonl PATH]
    Ritorna il dict JSON sui stdout. Utile per testing manuale."""
    import argparse
    import json
    import sys
    from pathlib import Path

    ap = argparse.ArgumentParser()
    ap.add_argument("--usage", type=float, required=True)
    ap.add_argument("--reset-at", required=True, help="HH:MM UTC")
    ap.add_argument("--provider", default="openai")
    ap.add_argument("--weekly", type=int, default=None)
    ap.add_argument("--last-jsonl", default=None,
                    help="legge gli ultimi sample da questo path per history")
    args = ap.parse_args()

    parsed = {
        "usage": args.usage,
        "reset_at": args.reset_at,
        "provider": args.provider,
        "weekly_usage": args.weekly,
    }

    last = None
    history = []
    if args.last_jsonl:
        try:
            with open(args.last_jsonl, encoding="utf-8") as f:
                samples = [json.loads(line) for line in f if line.strip()]
            same_provider = [s for s in samples if s.get("provider") == args.provider]
            if same_provider:
                last = same_provider[-1]
            history = same_provider[-30:]
        except (OSError, json.JSONDecodeError) as e:
            print(f"warn: impossibile leggere history: {e}", file=sys.stderr)

    out = compute_metrics(parsed, last, history)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
