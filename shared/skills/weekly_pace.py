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
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pace_rate  # noqa: E402  (il ritmo di un contatore intero: UN solo calcolo, vedi pace_rate.py)
import pace_reference  # noqa: E402  (il riferimento: ore attive, UNO per la Sentinella e per il PACE-GUARD)

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


def _samples_from_file(jsonl_path, since, now_ts):
    """[(epoch, weekly_usage)] of the rows of the sentinel's data file inside [since, now_ts]."""
    samples = []
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
                t = datetime.fromisoformat(ts_iso.replace("Z", "+00:00")).timestamp()
            except ValueError:
                continue
            if t < since or t > now_ts:
                continue
            samples.append((t, float(w)))
    return samples


def weekly_pace_assessment(jsonl_path, now_ts, weekly_remaining_pct,
                           weekly_active_hours, window_h=2.0,
                           weekly_total_active_hours=None, burn_intent_on=False, samples=None, hours_to_reset=None):
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

    `burn_intent_on` (la deroga a termine dell'utente): il livello, il debito e il rapporto col sostenibile restano
    INFORMAZIONE (campi `debt_pct`, `ratio`, `kind` invariati) e non frenano; `binding` diventa il solo `lockout_risk`
    (pace_reference.lockout_risk: il limite BASSO del ritmo esaurisce il residuo piu' di LOCKOUT_MARGIN_ACTIVE_H ore attive
    prima del reset). Senza deroga `binding` e' quello di sempre.

    `hours_to_reset` (ore di CALENDARIO al reset, se il chiamante le conosce): a inizio finestra il ritmo non basta per
    dire niente sul resto della settimana (pace_rate.projection_rate: ore misurate dall'inizio >= ore al reset / 7,5 e
    almeno PROJ_MIN_GAIN punti). Sotto quel minimo il verdetto e' «troppo presto»: kind ND, nessun lockout, nessun
    burn_mode, nessuna proiezione (`too_early` True, con le ore misurate e quelle che servono); resta solo il debito
    cumulativo sulla retta delle ore attive (e' un LIVELLO, non un ritmo: non dipende dal rumore del contatore).
    Senza `hours_to_reset` tutto e' come prima.
    """
    if (not isinstance(weekly_remaining_pct, (int, float))
            or not isinstance(weekly_active_hours, (int, float))
            or weekly_active_hours <= 0):
        return None
    if samples is None and (jsonl_path is None or not os.path.exists(str(jsonl_path))):
        return None
    # Lookback ampio: la finestra del rate e' ADATTIVA (sotto), non fissa a
    # window_h, per battere il rumore di quantizzazione del weekly_usage (intero).
    lookback_h = max(window_h, MAX_WINDOW_H)
    # il minimo di dati per un verdetto sul resto della finestra si misura dall'inizio della finestra (fino a 48 h)
    read_h = max(lookback_h, pace_rate.PROJ_MAX_SPAN_H if hours_to_reset is not None else 0.0)
    since = now_ts - read_h * 3600.0
    recent_since = now_ts - RECENT_WINDOW_H * 3600.0
    if samples is not None:
        # [(epoch, weekly_usage)] already read and checked by the caller (the app's read, budget_view.py)
        samples = [(float(t), float(w)) for t, w in samples
                   if isinstance(t, (int, float)) and isinstance(w, (int, float)) and since <= t <= now_ts]
    else:
        try:
            samples = _samples_from_file(jsonl_path, since, now_ts)
        except OSError:
            return None
    if len(samples) < 2:
        return None
    # Il ritmo e' di pace_rate.py: almeno un'ora, intervallo [lo, hi] sul contatore intero, salti non attribuibili
    # tolti, un calo senza reset = nuovo punto di partenza (prima: finestra adattiva da 3 punti, `dw < 0` -> None,
    # cioe' cieco per ore dopo ogni calo).
    proj_gate = (pace_rate.projection_rate(samples, now_ts, hours_to_reset)
                 if hours_to_reset is not None else None)
    rate = pace_rate.counter_rate(samples, now_ts, max_span_h=lookback_h)
    if rate is None:
        return None
    series = rate["samples"]
    newest = series[-1]
    # `recent` = primo campione dentro l'ultima RECENT_WINDOW_H (per burst_transient).
    recent = None
    for t, w in series:
        if t >= recent_since:
            recent = (t, w)
            break
    dt_h = rate["span_h"]
    vel_weekly = rate["rate"]       # %/h sulla finestra scelta
    sustainable = weekly_remaining_pct / weekly_active_hours
    ratio = (vel_weekly / sustainable) if sustainable > 0 else None
    hte = (weekly_remaining_pct / vel_weekly) if vel_weekly > 0 else None  # ore attive
    early = (weekly_active_hours - hte) if hte is not None else None
    # SOPRA solo se anche il limite BASSO dell'intervallo supera 1,2x; SOTTO solo se anche l'ALTO sta sotto 0,8x.
    kind = pace_rate.classify(rate, sustainable)
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
        # L'intervallo del ritmo (contatore intero) e cosa e' stato tolto dalla misura.
        "vel_lo_pct_h": round(rate["lo"], 2),
        "vel_hi_pct_h": round(rate["hi"], 2),
        "unattributed_pts": rate["unattributed_pts"],
        "rebaselined": rate["rebaselined"],
    }
    too_early = bool(proj_gate is not None and proj_gate["state"] != "ok")
    res["too_early"] = too_early
    if proj_gate is not None:
        res["too_early_span_h"] = round(proj_gate["span_h"], 2)
        res["too_early_need_h"] = round(proj_gate["need_h"], 2) if proj_gate["need_h"] is not None else None
    if too_early:
        # Il ritmo di poche ore non dice niente sul resto della settimana: nessun verdetto di ritmo, nessuna proiezione.
        res.update({"kind": "ND", "early_lockout_h": None, "burn_mode": False, "projected_final_pct": None,
                    "wasted_pct": None, "burst_transient": False})
        rate = dict(rate, lo=0.0)
    risk, early_lo = pace_reference.lockout_risk(weekly_remaining_pct, weekly_active_hours, rate["lo"])
    res["lockout_risk"] = risk
    res["lockout_early_active_h"] = early_lo
    res["lockout_margin_active_h"] = pace_reference.LOCKOUT_MARGIN_ACTIVE_H
    res["burn_intent"] = bool(burn_intent_on)
    if too_early:
        # Solo il livello: il debito sulla retta delle ore attive, senza il rapporto col ritmo (rumore a inizio finestra).
        debt = res.get("debt_pct")
        res["binding"] = bool(not burn_intent_on and isinstance(debt, (int, float)) and debt >= DEBT_BIND_PCT)
    elif burn_intent_on:
        res["binding"] = bool(risk and not burst_transient)
    else:
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
