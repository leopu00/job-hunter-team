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
import importlib.util
from datetime import datetime, timezone, timedelta
from pathlib import Path


# ─── format_time (helper sorella) — fmt_reset: data+ora completa ───────
# Carica la skill sorella format_time.py per fmt_reset(). Il reset non deve
# MAI essere esposto come ora-nuda: la stringa human (reset_at/weekly_reset_at)
# va sempre derivata dall'epoch (_unix) con la DATA di calendario completa.
# Loader fail-open: se format_time non è caricabile, fallback inline che
# almeno aggiunge la data (UTC) — meglio del solo HH:MM.
def _load_format_time():
    for cand in (Path("/app/shared/skills/format_time.py"),
                 Path(__file__).resolve().parent / "format_time.py"):
        try:
            if not cand.exists():
                continue
            spec = importlib.util.spec_from_file_location("format_time", cand)
            m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(m)
            return m
        except (OSError, ImportError, AttributeError):
            continue
    return None


_FT = _load_format_time()


def _fmt_reset(unix_ts, fallback=None):
    """Epoch → 'YYYY-MM-DD HH:MM TZ' (mai ora-nuda). fallback se non derivabile."""
    if isinstance(unix_ts, (int, float)) and not isinstance(unix_ts, bool):
        if _FT is not None:
            out = _FT.fmt_reset(unix_ts)
            if out:
                return out
        try:  # fallback inline: data completa in UTC, mai solo HH:MM
            return datetime.fromtimestamp(
                float(unix_ts), timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        except (OverflowError, OSError, ValueError):
            pass
    return fallback


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

# Negli ultimi 30 minuti la proiezione della finestra e' troppo sensibile per
# guidare azioni distruttive: resta visibile per audit, ma non deve cambiare
# status ne' generare throttle. Il reset reale (drop > RESET_DROP) continua a
# essere gestito separatamente.
RESET_EDGE_GUARD_HOURS = 0.5


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


def _hours_until_reset(parsed, now):
    """Ore al reset usando l'epoch quando disponibile.

    L'HH:MM da solo e' ambiguo subito dopo il confine: ``hours_until`` lo
    sposterebbe al giorno successivo. L'epoch e' il dato canonico e permette
    anche di riconoscere un reset appena scaduto senza riarmare i trigger.
    """
    reset_unix = parsed.get("reset_at_unix")
    if (isinstance(reset_unix, (int, float))
            and not isinstance(reset_unix, bool)
            and math.isfinite(reset_unix)):
        return (float(reset_unix) - now.timestamp()) / 3600.0
    fallback_hours = hours_until(parsed.get("reset_at"))
    # ``hours_until`` interpreta un HH:MM appena passato come "domani". Per
    # una finestra primaria (5h) un valore oltre 23.5h e' invece il minuto
    # appena scaduto: manteniamolo nel grace period del reset edge.
    if fallback_hours is not None and fallback_hours > 23.5:
        return fallback_hours - 24.0
    return fallback_hours


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


def compute_metrics(parsed, last, history=None, weekly_axis=None):
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
    hours_to_reset = _hours_until_reset(parsed, now)
    reset_edge_guard = (
        hours_to_reset is not None
        and -RESET_EDGE_GUARD_HOURS <= hours_to_reset <= RESET_EDGE_GUARD_HOURS
    )
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
    elif reset_edge_guard:
        # La projection resta nel sample per diagnosi, ma al confine non e'
        # actionable: nessun ATTENZIONE/throttle da un numero volatile.
        status, throttle = "OK", 0
    elif projection is not None and projection > PROJ_HIGH:
        status, throttle = "ATTENZIONE", 1
    elif projection is not None and PROJ_STEADY_LOW <= projection <= PROJ_STEADY_HIGH:
        status, throttle = "STEADY", 0
    elif projection is not None and projection < PROJ_LOW:
        status, throttle = "SOTTOUTILIZZO", 0
    else:
        status, throttle = "OK", 0

    # ── Weekly cap binding (fix #4 runaway-scaling 2026-06-07) ──────────────
    # Codex/subscription tier ha un SECONDO cap settimanale, parallelo al 5h.
    # AWARENESS-ONLY (correzione design fix#4, feedback utente 2026-06-13):
    # esponiamo weekly_remaining_pct / proj_weekly / proj_binding come INFO per
    # Sentinella/Capitano (via tmux), ma NON forziamo più lo status su una
    # SOGLIA ASSOLUTA. L'obiettivo è saturare ~100% del weekly ENTRO il reset
    # (non bruciarlo a metà settimana né sprecarlo): un halt a weekly>=75%
    # incaglia il budget e contraddice il design documentato
    # (DIAGNOSI-pacing-weekly L20, migration-plan L84: "atterraggio ~100% al
    # reset, NESSUN HALT anticipato"). Il freno weekly è UNO solo e time-aware:
    # vel_team vs vel_target nel pacing-bridge (active-hours-aware). Qui niente
    # pace-logic, solo campi di awareness.
    weekly_usage = parsed.get("weekly_usage")
    weekly_remaining_pct = None
    proj_weekly = None
    weekly_binding = False
    proj_binding = projection
    if isinstance(weekly_usage, (int, float)):
        weekly_remaining_pct = round(max(0.0, 100.0 - weekly_usage), 1)
        # Velocità weekly: rate lineare sul sample di storia più VECCHIO che
        # porta il weekly. Il weekly NON si resetta sui confini 5h, quindi
        # usiamo l'intera finestra di storia disponibile (non il session_id).
        hours_to_weekly_reset = None
        wru = parsed.get("weekly_reset_at_unix")
        if isinstance(wru, (int, float)):
            hours_to_weekly_reset = (wru - now.timestamp()) / 3600.0
        wk_vel = 0.0
        oldest_wk = None
        for h in (history or []):
            if isinstance(h.get("weekly_usage"), (int, float)):
                oldest_wk = h
                break
        if oldest_wk is not None:
            owk_ts = _parse_iso(oldest_wk.get("ts"))
            if owk_ts:
                wk_elapsed_h = (now - owk_ts).total_seconds() / 3600.0
                if wk_elapsed_h > 0.05:
                    wk_vel = max(
                        0.0,
                        (weekly_usage - oldest_wk["weekly_usage"]) / wk_elapsed_h,
                    )
        if hours_to_weekly_reset and hours_to_weekly_reset > 0:
            # proj_weekly = awareness grezza (INFO). NON guida lo status: è
            # calcolato su ore di CALENDARIO (include le notti idle) → su un team
            # a working-hours sovra-proietta. La proiezione weekly pace-aware
            # vera è vel_target nel pacing-bridge (active-hours). Un solo calcolo,
            # nessun doppione (chiude anche il debito omonimia weekly_remaining).
            proj_weekly = round(weekly_usage + wk_vel * hours_to_weekly_reset, 2)
        # NESSUN binding su soglia assoluta e NESSUN override di status: il
        # vincolo weekly passa SOLO per vel_team vs vel_target nel pacing.
        # weekly_binding resta False e proj_binding = proj primary (init sopra).

    # ── Bug #24: fase Sentinella/Capitano + scala throttle continua ──
    #
    # Fase 1 (normale): proj < 100% e time-to-reset > 30 min → Sentinella
    #                   solo INFO, Capitano modula throttle in autonomia.
    # Fase 2 (critico): proj > 100% fuori dal reset edge
    #                   → Sentinella suggerisce throttle scala continua.
    # Fase 3 (chiusura): time-to-reset ≤ 30 min → guard reset-edge.
    #                   La projection resta osservabile ma non azionabile:
    #                   nessun throttle/freeze basato su una stima volatile.
    #
    # `suggested_throttle_s` è scala continua (vs i 3 valori discreti
    # {0, 300, 600} del passato). Mappatura dalla doc bug #24, estesa fino a
    # 3600s (runaway-scaling postmortem 2026-06-07, fix #1: il vecchio soffitto
    # 600s rendeva il throttle un nudge omeopatico su un worker che sforava):
    #   100 < proj ≤ 110 → 120s
    #   110 < proj ≤ 130 → 240s
    #   130 < proj ≤ 150 → 360s
    #   150 < proj ≤ 200 → 600s
    #   200 < proj ≤ 300 → 1200s
    #   300 < proj ≤ 400 → 1800s
    #   proj > 400       → 3600s (max, = jht-throttle.py MAX_SLEEP)
    # NB: questo è il throttle PER-WORKER. Il freeze dell'INTERO team resta una
    # decisione separata della Sentinella (EMERGENZA su proj>200 o >150 per ≥3
    # tick, regola S-05) via freeze_team.py — non più codificata qui come -1.
    # Quando un singolo worker resta sopra vel_target dopo un throttle 1800-3600s
    # per ≥2 tick, la leva giusta è il KILL (C-12), non alzare ancora il throttle.
    if reset_edge_guard:
        phase = 3
    elif projection is not None and projection > 100:
        phase = 2
    else:
        phase = 1

    suggested_throttle_s = 0
    if projection is not None and not reset_edge_guard:
        p = projection
        if p > 400:
            suggested_throttle_s = 3600  # max (= jht-throttle.py MAX_SLEEP)
        elif p > 300:
            suggested_throttle_s = 1800
        elif p > 200:
            suggested_throttle_s = 1200
        elif p > 150:
            suggested_throttle_s = 600
        elif p > 130:
            suggested_throttle_s = 360
        elif p > 110:
            suggested_throttle_s = 240
        elif p > 100:
            suggested_throttle_s = 120
        elif p > PROJ_HIGH:  # 95-100 zona ATTENZIONE soft
            suggested_throttle_s = 60

    # ── Composizione bi-dimensionale dello status (2026-06-29) ──────────────
    # Lo `status` calcolato sopra è SOLO l'asse rate-limit 5h. Quando l'asse
    # WEEKLY (rate active-hours, da weekly_pace.py — già de-rumorato e
    # time-aware) è il vincolo PIÙ STRETTO, lo status deve rifletterlo: altrimenti
    # un "SOTTOUTILIZZO 5h" invita il Capitano a SCALARE mentre il weekly corre
    # (front-loading → lockout pre-reset). NON è un halt a soglia (design
    # awareness-only 2026-06-13 invariato): è il segnale rate-based weekly già
    # calcolato dal bridge, portato dentro il SINGOLO status team-facing invece
    # di restare scollegato. NON usa `proj_weekly` (calendario, sovra-proietta):
    # usa `weekly_axis` = dict da weekly_pace_assessment ({kind: SOPRA-PACE |
    # SOTTO-PACE | ALLINEATO | ND, ratio, ...}) o None (→ comportamento invariato).
    status_5h = status
    binding_axis = "5h"
    weekly_pace_kind = None
    weekly_pace_ratio = None
    if isinstance(weekly_axis, dict):
        weekly_pace_kind = weekly_axis.get("kind")
        _r = weekly_axis.get("ratio")
        weekly_pace_ratio = round(_r, 2) if isinstance(_r, (int, float)) else None
        # L'asse weekly "vince" (bind) solo quando è più stretto del 5h, e solo
        # fuori dagli stati 5h già allertati (ATTENZIONE) o transitori (RESET).
        if weekly_pace_kind == "SOPRA-PACE" and status not in ("ATTENZIONE", "RESET"):
            # weekly sopra il sostenibile → FRENA, non scalare (anche se 5h è basso)
            status = "SOPRA-PACE-WEEKLY"
            binding_axis = "weekly"
        elif weekly_pace_kind == "ALLINEATO" and status == "SOTTOUTILIZZO":
            # 5h sotto ma weekly in pari → NON è vero sotto-utilizzo da saturare:
            # il Capitano non deve scalare "per riempire" un weekly già a target.
            status = "STEADY"
            binding_axis = "weekly"

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
        # Composizione bi-dimensionale (2026-06-29): status_5h = l'asse 5h grezzo
        # (per trasparenza/audit); binding_axis = quale asse vincola ("5h"|"weekly");
        # weekly_pace_kind/ratio = verdetto weekly active-hours usato per comporre.
        "status_5h": status_5h,
        "binding_axis": binding_axis,
        "weekly_pace_kind": weekly_pace_kind,
        "weekly_pace_ratio": weekly_pace_ratio,
        "throttle": throttle,
        # Bug #24: scala throttle continua + fase (1/2/3). Sentinella e
        # Capitano leggono questi due campi per separare le responsabilità
        # in Fase 1 (Capitano modula in autonomia) vs Fase 2/3 (Sentinella
        # comanda). Vedi sentinella.md S-04/S-05 + capitano.md C-07.
        "phase": phase,
        "suggested_throttle_s": suggested_throttle_s,
        # True negli ultimi 30 min (e fino a 30 min dopo un epoch appena
        # scaduto): i consumer devono ignorare i trigger projection-only.
        "reset_edge_guard": reset_edge_guard,
        # CHOKE POINT data-completa (2026-06-30): reset_at/weekly_reset_at sono
        # le stringhe human che leggono Capitano/Sentinella/UI. Le derivo SEMPRE
        # dall'epoch (_unix) con la DATA di calendario completa — un solo punto
        # per TUTTI i provider (Codex/Claude/Kimi convergono qui). Mai ora-nuda:
        # "03:00" è ambiguo su giorno e su mezzanotte (era il bug del rinnovo
        # ciclo settimanale). Fallback al valore grezzo solo se l'unix manca.
        "reset_at": _fmt_reset(parsed.get("reset_at_unix"), parsed.get("reset_at")),
        "reset_at_unix": parsed.get("reset_at_unix"),
        "weekly_usage": parsed.get("weekly_usage"),
        # Bug #19A: reset weekly disponibile per Capitano/Sentinella senza
        # grep nei sorgenti del bridge. None se il provider non lo espone.
        "weekly_reset_at": _fmt_reset(
            parsed.get("weekly_reset_at_unix"), parsed.get("weekly_reset_at")),
        "weekly_reset_at_unix": parsed.get("weekly_reset_at_unix"),
        # Fix #4 (runaway-scaling 2026-06-07) + correzione design 2026-06-13:
        # campi weekly esposti come AWARENESS (INFO) per C-09/C-12/S-06, NON
        # forzano lo status. Il freno weekly è vel_team vs vel_target nel
        # pacing-bridge. weekly_binding resta sempre False (no soglia assoluta).
        "proj_weekly": proj_weekly,
        "weekly_remaining_pct": weekly_remaining_pct,
        "weekly_binding": weekly_binding,
        "proj_binding": round(proj_binding, 2) if proj_binding is not None else None,
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
