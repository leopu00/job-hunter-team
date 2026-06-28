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
# A bassi rate il weekly_usage intero non si muove in 0.5h (es. 0.88%/h → 0.44
# punti attesi → spesso 0), quindi un "rate recente = 0" e' RUMORE, non un picco
# in esaurimento. Fidati di burst_transient solo se il rate medio e' alto abbastanza
# da PRODURRE movimento intero nella finestra recente (evita falsi positivi che
# veterebbero il binding su un over-pace reale ma lento — bug front-load 2026-06-28).
BURST_MIN_SIGNAL_PTS = 1.5    # punti interi attesi nella finestra recente per fidarsi
# Finestra ADATTIVA per vel_weekly (2026-06-28): il weekly_usage e' un intero
# (~+1%/tick), quindi su una finestra fissa di 2h il delta e' spesso 1 SOLO punto
# → errore di quantizzazione ±0.5%/h, grande quanto il sostenibile (~0.5%/h) →
# il ratio diventa rumore e il falso "ALLINEATO 1.07x" maschera un over-pace
# reale (bug front-load: 28% in 18h dichiarato allineato). Fix: allarga la
# finestra all'indietro finche' il delta intero e' >= MIN_DELTA_PCT, scegliendo
# la finestra PIU' CORTA che lo soddisfa (resta reattiva); cap a MAX_WINDOW_H.
MAX_WINDOW_H = 8.0            # lookback massimo per de-rumore (oltre = troppo stale)
MIN_DELTA_PCT = 3.0          # punti interi minimi per un rate affidabile (err quant <33%)
# Debito cumulativo (2026-06-28): oltre al RATE istantaneo serve il SALDO — quanto
# hai speso vs dove DOVRESTI essere (retta ideale active-hours). Il rate puo' dire
# "ora sei in pari" mentre il serbatoio e' gia' stato intaccato troppo presto. In
# debito, la tolleranza sul ratio scende da 1.2x a 1.0x: anche il pareggio scava.
DEBT_BIND_PCT = 8.0          # punti-% di over-spend cumulativo oltre cui il debito binda


def weekly_pace_assessment(jsonl_path, now_ts, weekly_remaining_pct,
                           weekly_active_hours, window_h=2.0,
                           weekly_total_active_hours=None):
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
    # Lookback ampio: la finestra del rate e' ADATTIVA (sotto), non fissa a
    # window_h, per battere il rumore di quantizzazione del weekly_usage (intero).
    lookback_h = max(window_h, MAX_WINDOW_H)
    since = now_ts - lookback_h * 3600.0
    recent_since = now_ts - RECENT_WINDOW_H * 3600.0
    samples = []
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
                samples.append((t, float(w)))
    except OSError:
        return None
    if len(samples) < 2:
        return None
    samples.sort()
    newest = samples[-1]
    # Finestra ADATTIVA: dalla piu' recente all'indietro, il PRIMO campione con
    # delta intero >= MIN_DELTA_PCT da' la finestra piu' corta affidabile (cattura
    # anche un burst veloce); se nessuno la raggiunge, usa tutto il lookback (rate
    # genuinamente basso → massima affidabilita'). Cosi' un delta di 1 punto su 2h
    # (rumore di quantizzazione) non viene piu' letto come "ALLINEATO".
    oldest = samples[0]
    for s in reversed(samples[:-1]):
        if (newest[1] - s[1]) >= MIN_DELTA_PCT:
            oldest = s
            break
    # `recent` = primo campione dentro l'ultima RECENT_WINDOW_H (per burst_transient).
    recent = None
    for t, w in samples:
        if t >= recent_since:
            recent = (t, w)
            break
    dt_h = (newest[0] - oldest[0]) / 3600.0
    dw = newest[1] - oldest[1]
    if dt_h < 0.1 or dw < 0:        # finestra troppo corta o reset weekly nel mezzo
        return None
    vel_weekly = dw / dt_h          # %/h (su finestra adattiva)
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
    # ── Debito cumulativo (active-hours-aware), 2026-06-28 ──
    # ideal_used = frazione di ore ATTIVE trascorse * 100 (la retta su cui
    # dovresti stare). debt = speso - ideale: >0 = hai bruciato troppo PRESTO
    # (front-load), il serbatoio e' gia' intaccato anche se il rate ORA e' calmo.
    # Richiede weekly_total_active_hours (ore attive dell'INTERO ciclo) dal bridge;
    # se assente (caller legacy) i campi restano None e il binding usa solo il rate.
    debt_pct = ideal_used_pct = sustainable_nominal = None
    if (isinstance(weekly_total_active_hours, (int, float))
            and weekly_total_active_hours > 0
            and 0 <= weekly_active_hours <= weekly_total_active_hours):
        elapsed_active_h = weekly_total_active_hours - weekly_active_hours
        ideal_used_pct = (elapsed_active_h / weekly_total_active_hours) * 100.0
        debt_pct = weekly_used_pct - ideal_used_pct
        sustainable_nominal = 100.0 / weekly_total_active_hours
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
        # expected = punti interi attesi nella finestra recente se il rate medio
        # continuasse. Sotto BURST_MIN_SIGNAL_PTS il dato recente e' nel rumore di
        # quantizzazione → NON concludere "burst in uscita" (sarebbe un falso veto).
        expected_recent = vel_weekly * dt_recent
        if dt_recent >= 0.1 and expected_recent >= BURST_MIN_SIGNAL_PTS:
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
        "debt_pct": round(debt_pct, 1) if debt_pct is not None else None,
        "ideal_used_pct": (round(ideal_used_pct, 1)
                           if ideal_used_pct is not None else None),
        "sustainable_nominal_pct_h": (round(sustainable_nominal, 3)
                                      if sustainable_nominal is not None else None),
        "rate_window_h": round(dt_h, 2),
    }
    res["binding"] = is_weekly_binding(res)
    return res


def is_weekly_binding(assessment) -> bool:
    """True quando il weekly è il vincolo che DEVE frenare il team.

    Segnale active-hours-aware (NON il proj_weekly naive di compute_metrics, che
    sovra-proietta sulle notti idle ed è hard-coded a binding=False by design):
    il weekly è binding in DUE casi (mai se burst_transient, = picco in uscita):
    1. CLASSICO: SOPRA-PACE (ratio>1.2) + lockout anticipato (early_lockout_h).
    2. DEBITO (2026-06-28): debito cumulativo >= DEBT_BIND_PCT punti E ratio>1.0
       (non stai recuperando). In debito la tolleranza scende da 1.2x a 1.0x:
       il margine è già stato speso nel front-load, quindi anche il pareggio
       scava. Il debito è CUMULATIVO → immune al rumore di quantizzazione del
       vel_weekly istantaneo (il falso "ALLINEATO 1.07x" del boot front-load).
    Un team allineato/sotto-pace e SENZA debito NON è binding (no coast prematuro).
    """
    if not isinstance(assessment, dict):
        return False
    if assessment.get("burst_transient"):
        return False  # picco in esaurimento: mai binding (over-brake), vale per entrambi i casi
    # Caso CLASSICO: SOPRA-PACE conclamato (ratio>1.2) + lockout anticipato.
    if (assessment.get("kind") == "SOPRA-PACE"
            and assessment.get("early_lockout_h") is not None):
        return True
    # Caso DEBITO (2026-06-28): sei gia' in debito cumulativo E NON stai
    # recuperando (ratio>1.0 = ancora sopra il sostenibile ridotto). La tolleranza
    # scende da 1.2x a 1.0x perche' in debito anche il pareggio scava (il margine
    # e' gia' stato speso nel front-load). Robusto al rumore di quantizzazione: il
    # debito e' CUMULATIVO, non a finestra → non dipende dal vel_weekly istantaneo.
    # Chiude il buco "rate dice ALLINEATO mentre il saldo affonda" (front-load boot).
    debt = assessment.get("debt_pct")
    ratio = assessment.get("ratio")
    return bool(
        isinstance(debt, (int, float)) and debt >= DEBT_BIND_PCT
        and isinstance(ratio, (int, float)) and ratio > 1.0
    )
