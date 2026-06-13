#!/usr/bin/env python3
"""weekly_pace.py — assessment del RATE weekly REALE vs sostenibile.

Funzione PURA condivisa (estratta da pacing-bridge, redesign usage-monitoring
2026-06-13). Risponde a "perche' Capitano/Sentinella non si accorgono del burn
weekly" (smoking gun: status SOTTOUTILIZZO 89% storico MENTRE il weekly andava a
100% → lockout). Il buco era nella METRICA: il weekly era solo LIVELLO + proj-rotta
+ flag, mai un RATE-vs-sostenibile che guidasse.

UN solo punto di verita' del pace (lezione fix#4): la chiamano sia il sentinel-bridge
(che la espone nel [BRIDGE TICK] alla Sentinella → S-07 elabora → consiglia il
Capitano → C-09) sia eventualmente il pacing-bridge, senza duplicare la logica.
"""
from __future__ import annotations

import json
import os
from datetime import datetime


def weekly_pace_assessment(jsonl_path, now_ts, weekly_remaining_pct,
                           weekly_active_hours, window_h=2.0):
    """RATE weekly REALE (vel_weekly) su ~window_h vs sostenibile.

    Il weekly_usage e' integer-rounded e si muove ~+1%/tick → su pochi minuti e'
    rumore; serve una finestra lunga (default 2h) per vedere il ritmo. weekly_usage
    NON resetta sui confini 5h, quindi si usa la storia intera (non la session
    corrente) di `jsonl_path` (sentinel-data.jsonl).

    Ritorna dict {vel_weekly_pct_h, sustainable_pct_h, ratio, hours_to_exhaust,
    reset_in_active_h, early_lockout_h, kind} oppure None se dati insufficienti.
    kind: SOPRA-PACE (ratio>1.2) | SOTTO-PACE (<0.8) | ALLINEATO | ND.
    """
    if (not isinstance(weekly_remaining_pct, (int, float))
            or not isinstance(weekly_active_hours, (int, float))
            or weekly_active_hours <= 0):
        return None
    if jsonl_path is None or not os.path.exists(str(jsonl_path)):
        return None
    since = now_ts - window_h * 3600.0
    oldest = newest = None
    try:
        with open(str(jsonl_path), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                w = e.get("weekly_usage")
                ts_iso = e.get("ts")
                if not isinstance(w, (int, float)) or not isinstance(ts_iso, str):
                    continue
                try:
                    t = datetime.fromisoformat(
                        ts_iso.replace("Z", "+00:00")).timestamp()
                except ValueError:
                    continue
                if t < since or t > now_ts:
                    continue
                if oldest is None:
                    oldest = (t, float(w))
                newest = (t, float(w))
    except OSError:
        return None
    if oldest is None or newest is None:
        return None
    dt_h = (newest[0] - oldest[0]) / 3600.0
    dw = newest[1] - oldest[1]
    if dt_h < 0.3 or dw < 0:        # finestra troppo corta o reset weekly nel mezzo
        return None
    vel_weekly = dw / dt_h          # %/h
    sustainable = weekly_remaining_pct / weekly_active_hours
    ratio = (vel_weekly / sustainable) if sustainable > 0 else None
    hte = (weekly_remaining_pct / vel_weekly) if vel_weekly > 0 else None  # ore attive
    early = (weekly_active_hours - hte) if hte is not None else None
    kind = ("ND" if ratio is None
            else "SOPRA-PACE" if ratio > 1.2
            else "SOTTO-PACE" if ratio < 0.8
            else "ALLINEATO")
    return {
        "vel_weekly_pct_h": round(vel_weekly, 2),
        "sustainable_pct_h": round(sustainable, 2),
        "ratio": round(ratio, 2) if ratio is not None else None,
        "hours_to_exhaust": round(hte, 1) if hte is not None else None,
        "reset_in_active_h": round(weekly_active_hours, 1),
        "early_lockout_h": (round(early, 1)
                            if early is not None and early > 0 else None),
        "kind": kind,
    }
