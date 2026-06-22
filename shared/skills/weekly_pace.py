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

# burn_mode (duale di early_lockout_h): in SOTTO-PACE e VICINO al reset, segnala di
# ACCELERARE per non sprecare il weekly (Kimi non fa carryover). Il gate sulle ore
# ATTIVE al reset distingue il caso urgente (Kimi ~26h) da reset lontani (Codex ~5gg,
# che hanno tempo di recuperare e NON devono correre).
WASTE_TOL_PCT = 15.0          # spreco minimo previsto per attivare burn_mode
NEAR_RESET_ACTIVE_H = 36.0    # "vicino al reset" in ore ATTIVE
# burst_transient (P3 2026-06-13): il vel_weekly e' una media a `window_h` (2h),
# quindi un picco PASSATO la tiene gonfia per ~2h anche se il rate ora e' basso.
# Confrontiamo il rate RECENTE con la media 2h per distinguere un burst che svanisce
# (recovery rapido OK) da un over-pace sostenuto (frena davvero).
RECENT_WINDOW_H = 0.5         # sotto-finestra "recente"
BURST_TRANSIENT_RATIO = 0.4   # rate recente < 40% della media 2h = burst in uscita


def weekly_pace_assessment(jsonl_path, now_ts, weekly_remaining_pct,
                           weekly_active_hours, window_h=2.0):
    """RATE weekly REALE (vel_weekly) su ~window_h vs sostenibile.

    Il weekly_usage e' integer-rounded e si muove ~+1%/tick → su pochi minuti e'
    rumore; serve una finestra lunga (default 2h) per vedere il ritmo. weekly_usage
    NON resetta sui confini 5h, quindi si usa la storia intera (non la session
    corrente) di `jsonl_path` (sentinel-data.jsonl).

    Ritorna dict {vel_weekly_pct_h, sustainable_pct_h, ratio, hours_to_exhaust,
    reset_in_active_h, early_lockout_h, kind, projected_final_pct, wasted_pct,
    burn_mode} oppure None se dati insufficienti.
    kind: SOPRA-PACE (ratio>1.2) | SOTTO-PACE (<0.8) | ALLINEATO | ND.
    burn_mode: True se SOTTO-PACE + spreco previsto >= WASTE_TOL_PCT + reset vicino
    (ore attive <= NEAR_RESET_ACTIVE_H) → il team deve ACCELERARE/saturare.
    """
    if (not isinstance(weekly_remaining_pct, (int, float))
            or not isinstance(weekly_active_hours, (int, float))
            or weekly_active_hours <= 0):
        return None
    if jsonl_path is None or not os.path.exists(str(jsonl_path)):
        return None
    since = now_ts - window_h * 3600.0
    recent_since = now_ts - RECENT_WINDOW_H * 3600.0
    oldest = newest = recent = None
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
                if recent is None and t >= recent_since:
                    recent = (t, float(w))
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
    # burn_mode: proietta dove atterri al reset al ritmo attuale e quanto weekly
    # sprecheresti. Duale di early_lockout (li' freni perche' bruci troppo; qui
    # acceleri perche' lasceresti budget sul tavolo poco prima del reset).
    weekly_used_pct = 100.0 - weekly_remaining_pct
    projected_final = weekly_used_pct + vel_weekly * weekly_active_hours
    wasted_pct = max(0.0, 100.0 - projected_final)
    burn_mode = bool(kind == "SOTTO-PACE"
                     and wasted_pct >= WASTE_TOL_PCT
                     and weekly_active_hours <= NEAR_RESET_ACTIVE_H)
    # burst_transient: il rate RECENTE (ultima RECENT_WINDOW_H) e' molto piu' basso
    # della media 2h → il SOPRA-PACE sta gia' svanendo (es. picco passato). Segnala
    # ai prompt che si puo' recuperare in fretta, senza freeze duro su un burst finito.
    burst_transient = False
    if recent is not None and recent[0] < newest[0]:
        dt_recent = (newest[0] - recent[0]) / 3600.0
        if dt_recent >= 0.1:
            vel_recent = (newest[1] - recent[1]) / dt_recent
            if (vel_weekly > sustainable
                    and vel_recent < BURST_TRANSIENT_RATIO * vel_weekly):
                burst_transient = True
    res = {
        "vel_weekly_pct_h": round(vel_weekly, 2),
        "sustainable_pct_h": round(sustainable, 2),
        "ratio": round(ratio, 2) if ratio is not None else None,
        "hours_to_exhaust": round(hte, 1) if hte is not None else None,
        "reset_in_active_h": round(weekly_active_hours, 1),
        "early_lockout_h": (round(early, 1)
                            if early is not None and early > 0 else None),
        "kind": kind,
        "projected_final_pct": round(projected_final),
        "wasted_pct": round(wasted_pct, 1),
        "burn_mode": burn_mode,
        "burst_transient": burst_transient,
    }
    res["binding"] = is_weekly_binding(res)
    return res


def is_weekly_binding(assessment) -> bool:
    """True quando il weekly è il vincolo che DEVE frenare il team.

    Segnale active-hours-aware (NON il proj_weekly naive di compute_metrics, che
    sovra-proietta sulle notti idle ed è hard-coded a binding=False by design):
    il weekly è binding quando il team brucia SOPRA il ritmo sostenibile
    (kind SOPRA-PACE, ratio>1.2) E al ritmo attuale esaurirebbe il budget PRIMA
    del reset (early_lockout_h presente) E non è un picco già in esaurimento
    (burst_transient). Questo è esattamente il front-load: chiude il buco
    "Sentinella cieca al weekly" (status SOTTOUTILIZZO mentre il weekly va a
    fuoco) senza introdurre coast prematuro su un provider in pari — un team
    allineato/sotto-pace o senza lockout anticipato NON è binding.
    """
    if not isinstance(assessment, dict):
        return False
    return bool(
        assessment.get("kind") == "SOPRA-PACE"
        and assessment.get("early_lockout_h") is not None
        and not assessment.get("burst_transient")
    )
