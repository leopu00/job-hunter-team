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

# Banda target di consumo: sopra → ATTENZIONE, dentro → STEADY (zona G-spot
# 90-95%), sotto → SOTTOUTILIZZO.
# Nota: lo stato "STEADY" qui è single-tick (proj nella fascia in QUESTO
# sample). La conferma "stabile nel G-spot" richiede 3 tick consecutivi:
# è la Sentinella che la fa, contando tick_steady_count nella sua memoria
# e mandando MANTIENI solo quando count >= 3.
# G-spot più stretto a 90-95% (era 85-95%): impostato dopo aver visto
# che il sistema riesce a mantenere precisione fine al confine (target
# più aggressivo per usare meglio il budget).
PROJ_HIGH = 95
PROJ_STEADY_LOW = 90   # entrata zona G-spot (alzato da 85)
PROJ_STEADY_HIGH = 95  # uscita zona G-spot (= PROJ_HIGH)
PROJ_LOW = 90          # sotto = sottoutilizzo (alzato da 85)
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

# Cold-start: sotto questa soglia di velocità smussata trattiamo il sample
# come "fermi". Senza dati di consumo reale il modello first-order non ha
# senso (assumerebbe rientro a velocity_ideal = useremo tutto il budget).
# Meglio una proiezione naive = usage attuale, che dice "se continui così
# resti dove sei". Soglia 0.5%/h è ~ rumore di quantizzazione del provider.
EPSILON_VEL = 0.5

# Anti-spike: solo veri burst (sample <30s) sono noise di quantizzazione
# che gonfiano fittiziamente la velocità. A 30s+ il dato è realistico
# anche se viene da un check ad-hoc del Capitano/Sentinella, e va
# usato come info aggiuntiva per i calcoli, non scartato.
# Inoltre c'è effective_vel in compute_metrics che corregge l'EMA se
# diverge troppo da last_hour_delta (= seconda linea di difesa).
MIN_DT_MIN_FOR_VELOCITY = 0.5


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
    elif last and session_gap_min < MIN_DT_MIN_FOR_VELOCITY:
        # Anti-spike: sample troppo ravvicinato → l'EMA non viene
        # aggiornata, ereditiamo la velocity_smooth precedente. Il
        # delta tra usage cambia di 1 punto in 30s genera velocità
        # 120%/h che è rumore, non segnale.
        velocity = 0.0
        velocity_smooth = (last or {}).get("velocity_smooth") or 0.0
    else:
        vs_prev = (last or {}).get("velocity_smooth") or 0.0
        velocity_smooth = EMA_ALPHA * velocity + (1 - EMA_ALPHA) * vs_prev

    # ── Reset event: il provider ha azzerato la finestra ──
    reset_event = bool(last and usage < (last.get("usage") or 0) - RESET_DROP)

    # ── Session ID: identifica univocamente la finestra rate-limit ──
    # Calcolato qui presto perché serve sotto per session-avg projection.
    if last is None or session_discontinuity or reset_event:
        session_id = now.strftime("%Y%m%dT%H%M%SZ")
    else:
        session_id = last.get("session_id") or now.strftime("%Y%m%dT%H%M%SZ")

    # ── Projection: velocità media DALLA NASCITA della sessione ──
    #
    # Strategia (sostituisce EMA + last_hour_delta che oscillavano troppo
    # con tick rapido + dati quantizzati interi):
    #
    #   effective_vel = (usage_now - usage_first_session) / elapsed_h_session
    #
    # Stabilizza naturalmente: i primi tick possono oscillare ma dopo
    # 10 minuti la metrica è praticamente piatta perché il denominatore
    # cresce in modo continuo. Reset automatico su cambio session_id
    # (drop usage > 30 punti = nuova finestra rate-limit del provider).
    #
    # Manteniamo velocity_smooth (EMA) per indicatori tecnici / debug,
    # ma il proj usa la session_avg.
    hours_to_reset = hours_until(parsed.get("reset_at"))
    velocity_ideal = None
    projection = None
    projection_naive = None
    last_hour_delta = cumulative_delta_last_hour(
        history + [{"ts": ts, "delta": delta}], now
    ) if history is not None else 0.0

    if hours_to_reset and hours_to_reset > 0:
        velocity_ideal = max(0.0, (SAFE_TARGET - usage) / hours_to_reset)
        projection_naive = usage + velocity_smooth * hours_to_reset

        cold_start = (
            last is None
            or session_discontinuity
            or reset_event
        )
        if cold_start:
            # Sessione nuova: niente media disponibile, vel=0
            effective_vel = 0.0
        else:
            # Trova il primo sample della sessione corrente (stesso
            # session_id). La sessione cambia su drop>30 / gap>20min,
            # quindi è automaticamente "scoped" alla finestra corrente.
            session_first = None
            for h in history or []:
                if h.get("session_id") == session_id and h.get("provider") == provider:
                    session_first = h
                    break
            if session_first is None:
                # Niente storia in sessione → fallback EMA (caso raro:
                # storia esiste ma session_id appena cambiato)
                effective_vel = velocity_smooth
            else:
                first_ts = _parse_iso(session_first.get("ts"))
                if first_ts:
                    elapsed_h = (now - first_ts).total_seconds() / 3600
                else:
                    elapsed_h = 0
                first_usage = session_first.get("usage")
                if elapsed_h > 0.05 and isinstance(first_usage, (int, float)):
                    # vel media reale dalla nascita della sessione:
                    # robusta a oscillazioni di 1 punto, si stabilizza
                    # in ~10 min, niente parser/EMA fragile.
                    effective_vel = (usage - first_usage) / elapsed_h
                else:
                    # < 3 minuti dall'inizio sessione: dato troppo grezzo,
                    # vel=0 finché abbiamo abbastanza tempo per misurare
                    effective_vel = 0.0
        projection = usage + effective_vel * hours_to_reset

    # ── Dead-band: velocity in calo? ──
    vs_prev = (last or {}).get("velocity_smooth")
    if isinstance(vs_prev, (int, float)) and abs(vs_prev) > 1e-3:
        velocity_decreasing = velocity_smooth < vs_prev - 0.5
    else:
        velocity_decreasing = False

    # session_id già calcolato sopra (serviva per il blocco projection).

    # ── Status / throttle (solo informativi: il vero throttle lo
    # decide il Capitano consultando questi numeri) ──
    # Stato STEADY = "G-spot" 80-95%: zona target dove il team consuma
    # bene il budget senza sforare. La Sentinella lo legge per dire al
    # Capitano "MANTIENI".
    if reset_event:
        status, throttle = "RESET", 0
    elif projection is not None and projection > PROJ_HIGH:
        status, throttle = "ATTENZIONE", 1
    elif projection is not None and PROJ_STEADY_LOW <= projection <= PROJ_STEADY_HIGH:
        status, throttle = "STEADY", 0
    elif projection is not None and projection < PROJ_LOW:
        status, throttle = "SOTTOUTILIZZO", 0
    else:
        status, throttle = "OK", 0

    return {
        "ts": ts,
        "provider": provider,
        "session_id": session_id,
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
