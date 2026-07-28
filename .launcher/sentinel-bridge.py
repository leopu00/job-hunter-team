#!/usr/bin/env python3
"""
Sentinel Bridge V5 — orologio + fetch + tick alla Sentinella (SENSORE usage).

── ROLE-MAP dei bridge deterministici (vedi docs/internal/architecture/bridges.md) ──
  sentinel-bridge.py  → QUESTO: SENSORE usage — fetch provider ~2-10min (adattivo),
                        scrive sentinel-data.jsonl, ticka la SENTINELLA ([BRIDGE TICK]).
  pacing-bridge.py    → report pacing ogni 15min alla SENTINELLA ([BRIDGE PACING]).
  heartbeat-bridge.py → nudge orario al CAPITANO ([HEARTBEAT]); off-hours tace.

Architettura V5 (post-incident 2026-04-25):
  • ogni 5 min: fetch del provider attivo (codex JSONL / kimi HTTP / claude HTTP)
  • se OK: scrive sample con source=bridge nel JSONL (via skill compute_metrics
    + usage_record, source-aware), poi manda [BRIDGE TICK] alla SENTINELLA col
    dato fresco (usage/proj/status/reset).
  • se FAIL: manda [BRIDGE FAILURE] alla SENTINELLA che fa fallback (rate_budget
    live → check_usage). Al 3° fail consecutivo alert al Capitano.

Tutta la logica decisionale (throttle, ordine, freeze) è nella SENTINELLA LLM,
secondo il pattern Pasqua: ad ogni tick lei calcola velocità smussata, decide
stato, ordina al Capitano. Vedi agents/sentinella/sentinella.md.

Niente più nel bridge:
  ✗ escalation L1/L2/L3 (era V1, abbandonato)
  ✗ sentinel_health auto-restart (causava restart loop, V4 bug)
  ✗ filtro silenzioso "TACE è il default" (V4, fragile)
  ✗ τ-aware projection inline (calcolata dalla skill compute_metrics)

Le funzioni di fetch (fetch_kimi_api, fetch_claude_api, fetch_codex_rollout)
+ helper restano esposte come libreria importabile dalle skill (rate_budget,
usage_record, check_usage).

Config:
  active_provider in $JHT_HOME/jht.config.json — kimi / openai / claude
  JHT_TARGET_SESSION                              — capitano (default CAPITANO)
  JHT_HOME                                        — dir config (default ~/.jht)
"""

import fcntl
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path


# ── Costanti modulo ─────────────────────────────────────────────────────

CAPITANO_SESSION = os.environ.get("JHT_TARGET_SESSION", "CAPITANO")
SENTINELLA_SESSION = "SENTINELLA"
# Off-hours hard-stop (2026-06-29): ogni quanti secondi RI-mandare il
# work_phase=OFF al Capitano se il team brucia ancora fuori orario (oltre la
# transizione ON→OFF). Evita lo spam ma re-asserisce se il primo OFF non ha preso.
OFFHOURS_REASSERT_SEC = int(os.environ.get("JHT_OFFHOURS_REASSERT_SEC", "1800"))

JHT_HOME = Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht")))
CONFIG_PATH = JHT_HOME / "jht.config.json"
LOGS_DIR = JHT_HOME / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# ── Vitals RAM/CPU (2026-06-18) ─────────────────────────────────────────
# Il bridge campiona i vitals di sistema a OGNI tick su un FILE DEDICATO
# (vitals.jsonl), NON nel tick della Sentinella: la Sentinella NON è avvisata
# del consumo PC nel suo flusso decisionale di quota. Sveglia la Sentinella SOLO
# se RAM o CPU superano la soglia (emergenza risorse, non quota), rate-limited.
# Il Mantenitore legge vitals.jsonl 1×/giorno e mette i picchi in croce con la
# diagnosi infra. Logica di lettura in shared/skills/host_vitals.py.
VITALS_SKILL = str(Path(__file__).resolve().parent.parent / "shared" / "skills" / "host_vitals.py")
VITALS_FILE = LOGS_DIR / "vitals.jsonl"
VITALS_ALERT_PCT = 95.0
VITALS_ALERT_COOLDOWN_MIN = 30.0
_LAST_VITALS_ALERT_AT = 0.0
DATA_JSONL = LOGS_DIR / "sentinel-data.jsonl"
LOG_TXT = LOGS_DIR / "sentinel-log.txt"
PID_FILE = LOGS_DIR / "sentinel-bridge.pid"
# Lockfile del singleton (flock). File DEDICATO e mai cancellato da nessuno:
# il PID file lo rimuovono bridge-control.sh e pid1 (cleanupStaleBridgeState),
# e cancellare un file flockato ne rompe la mutua esclusione (il prossimo
# processo crea un inode nuovo e prende un lock diverso).
LOCK_FILE = LOGS_DIR / "sentinel-bridge.lock"
# State pubblico letto dall'UI web (web/app/api/bridge/status/route.ts).
# Source-of-truth del prossimo tick: il bridge calcola e pubblica qui;
# la UI legge senza ricostruire la logica (che cambierebbe ogni V*).
STATE_FILE = LOGS_DIR / "sentinel-bridge-state.json"
# Daily hard-stop (#2): flag CONDIVISO. Quando il consumo di oggi sfora il cap
# giornaliero, questo bridge lo crea e mette il team in standby; pacing-bridge e
# heartbeat-bridge lo leggono e tacciono. Rimosso da questo stesso bridge quando il
# budget rientra (inizio finestra di lavoro del giorno dopo / reset weekly).
DAILY_HALT_FLAG = LOGS_DIR / "daily-halt.flag"
STATE_VERSION = 7

DEFAULT_TICK_MINUTES = 5               # default se config mancante
MIN_TICK_SECONDS = 15                  # safety floor: <15s spammerebbe il provider
FETCH_FAIL_THRESHOLD = 3               # alert capitano dopo N fail consecutivi

# ── V6 Adaptive tick (state machine) ────────────────────────────────────
# Il bridge fa MONITORING. Notifica la Sentinella solo quando serve.
# Cadenza in funzione della stabilità della proiezione attorno al G-spot.
#
# G-spot = banda obiettivo: proj ∈ [80%, 105%]. Più ampio dello STEADY
# stretto (90-95%) calcolato da compute_metrics, perché in g-spot vogliamo
# anticipare sia l'uscita verso ATTENZIONE sia il drift verso SOTTOUTILIZZO
# senza bruciare LLM.
#
# Stati del tick interval:
#   DEFAULT        3 min   bootstrap o proj fuori g-spot (critico/sotto)
#   GSPOT_FAST     2 min   appena entrato nel g-spot, monitoring reattivo
#   GSPOT_STABLE   5 min   3 tick consecutivi nel g-spot
#   GSPOT_CALM    10 min   3 tick consecutivi a GSPOT_STABLE nel g-spot
#
# Quando proj esce dal g-spot → torna a DEFAULT (3 min) e reset counters.
DEFAULT_TICK_MIN = 3.0
GSPOT_FAST_TICK_MIN = 2.0
GSPOT_STABLE_TICK_MIN = 5.0
GSPOT_CALM_TICK_MIN = 10.0

# ── Lean-comms (2026-06-15): tick ANCORATO + wake ai quarti ───────────────
# Il tick non è più adattivo (FAST/CALM): è ANCORATO all'orologio ogni
# ANCHOR_TICK_MIN minuti (x:00/05/10/...). Prevedibile e phase-locked
# (sopravvive a restart/istanze multiple senza drift). La Sentinella viene
# svegliata SOLO ai quarti (x:00/15/30/45) — un sottoinsieme dei tick — e
# solo su edge azionabile dentro l'orario lavorativo. Le costanti GSPOT_*
# sopra restano per il solo state-file UI (tick_phase informativo).
ANCHOR_TICK_MIN = 5.0

# NB 2026-06-20: l'auto-pass di promozione tassonomia (role_registry.run_pass a
# stringhe, ~1h) è stato RIMOSSO dal bridge. La promozione delle famiglie role_family
# è ora BRAIN-DRIVEN: la fanno gli analisti col giudizio (role_registry.py promote/merge,
# grappoli da 'Other') + l'arbitrato del Capitano, al momento dell'analisi — non un
# trigger periodico. Lo string-pass frammentava ("VC Investing" vs "VC / Growth") → 0
# promozioni → tutto fermo in 'Other' (rootcause betaA). Vedi role_registry.py docstring.

GSPOT_LOWER = 80.0    # proj < 80% → sotto g-spot (sottoutilizzo)
GSPOT_UPPER = 105.0   # proj > 105% → sopra g-spot (critico)
GSPOT_PROMOTION_TICKS = 3  # tick consecutivi nel g-spot per promuovere stato

# Banda g-spot attorno al target dinamico work-hours-aware. Il g-spot
# "vero" è centrato sul target del bridge (92% in modalità classica,
# oppure 75% in office hours su Codex Pro, ecc.). Mantengo la stessa
# semi-ampiezza storica (80-105 → ±13 attorno a 92 ≈ -12/+13).
GSPOT_BAND_BELOW = 12.0  # target − 12 = floor g-spot
GSPOT_BAND_ABOVE = 13.0  # target + 13 = ceiling g-spot

# Phase 1 migrazione weekly (pacing-migration-plan-2026-06-05): la cadenza tick
# e il wake della Sentinella si ancorano al segnale STABILE vel_team vs vel_target
# (dal pacing-bridge) invece che a `proj` (volatile: oscilla ±400pt tick-to-tick).
# On-pace = il team NON sta bruciando sopra il target di velocità. L'under-utilizzo
# NON è un allarme per la Sentinella (lo gestisce il Capitano spawnando; il pipeline
# stall ha già il path PIPELINE STALLED dedicato nel pacing-bridge).
PACE_OVER_TOL = 1.0  # %/h sopra vel_target oltre cui il team "sta bruciando" → alert
# Path dello state file del pacing-bridge: contiene current_window_target_pct
# scritto a ogni tick. Letto lazy nel _is_in_gspot. Se manca → fallback
# alle costanti statiche (back-compat completa).
PACING_STATE_FILE = LOGS_DIR / "pacing-bridge-state.json"

# ── Notifica Sentinella ──────────────────────────────────────────────────
# La Sentinella è SVEGLIATA solo quando la proj è fuori dal g-spot.
# Per evitare il loop autoindotto (Sentinella+Capitano consumano token →
# proj sale → Sentinella di nuovo svegliata), una volta notificata il bridge
# attende SENTINELLA_COOLDOWN_MIN prima di rinotificarla, anche se ancora
# critico. Quando proj rientra nel g-spot, il cooldown si resetta.
SENTINELLA_COOLDOWN_MIN = 15.0

# Tick leggero (2026-06-28): durante un episodio attuabile PROLUNGATO e a
# REGIME INVARIATO (stesso `status`), re-confermare la Sentinella ogni quarto
# è quasi sempre ridondante (l'ordine/throttle è già applicato) — è il caso
# osservato su VPS betaD (sforo/sottoutilizzo stabile per ore → ~40 wake/g).
# Quando il regime non cambia, posticipiamo la re-conferma fino a questo cap
# di sicurezza (la svegliamo comunque, per ricalibrare, ma molto più di rado).
# Un cambio di `status` (regime) la sveglia SEMPRE, anche prima del cap.
SENTINELLA_RECONFIRM_MIN = 45.0

# ── Consiglio di pacing al Capitano (pace_guard) ─────────────────────────
# Il bridge campiona ogni ANCHOR_TICK_MIN (5 min): mandare il consiglio a ogni
# sample vorrebbe dire consumare un turno di modello del Capitano ogni 5 minuti
# per ripetergli una cosa che ha già letto — è esattamente il coordinator-burn.
# Un consiglio NUOVO (verdetto o valore diversi dall'ultimo mandato) parte
# subito, perché è un edge; lo STESSO consiglio si ripete al massimo ogni
# PACE_ADVICE_COOLDOWN_MIN. La ripetizione non è spam: ora che il bridge non
# applica più niente, è l'unico modo di recuperare una consegna fallita
# (jht-tmux-send rc≠0 col pane occupato) o un consiglio che il Capitano ha
# lasciato cadere.
PACE_ADVICE_COOLDOWN_MIN = 15.0
_pace_advice_state = {"ts": 0.0, "throttle_s": None, "verdict": None}


# ── Config + tmux helpers (libreria per le skill) ───────────────────────

def read_config():
    """Ritorna (tick_override, provider). tick_override è il valore esplicito
    di sentinella_tick_minutes nel config (float, es. 0.5 = 30s) o None se
    non settato. Quando None, il bridge usa il tick adattivo in base allo
    stato dell'ultimo sample (vedi _choose_tick_interval)."""
    try:
        with CONFIG_PATH.open(encoding="utf-8") as f:
            cfg = json.load(f)
        provider = cfg.get("active_provider") or "openai"
        raw_tick = cfg.get("sentinella_tick_minutes")
        tick_override = float(raw_tick) if isinstance(raw_tick, (int, float)) and raw_tick > 0 else None
        return tick_override, provider
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None, "openai"


def _read_dynamic_target():
    """Legge il target dinamico dal pacing-bridge-state.json se presente.

    Ritorna (target_pct, work_phase) o (None, None) se file mancante /
    illeggibile / campo assente. Failsafe completo: qualsiasi errore →
    None, e i chiamanti tornano alle costanti statiche.

    Nota: leggiamo questo file ad ogni tick (~ogni 3-10 min). Costo I/O
    trascurabile, evita di dover gestire file watching.
    """
    try:
        if not PACING_STATE_FILE.exists():
            return None, None
        with PACING_STATE_FILE.open(encoding="utf-8") as f:
            st = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None, None
    tgt = st.get("current_window_target_pct")
    phase = st.get("work_phase")
    if not isinstance(tgt, (int, float)) or tgt <= 0:
        return None, phase if isinstance(phase, str) else None
    return float(tgt), (phase if isinstance(phase, str) else None)


def _gspot_bounds(target_pct=None):
    """Ritorna (lower, upper) della banda g-spot.

    Se `target_pct` è fornito → banda dinamica centrata sul target
    (target-12 .. target+13). Altrimenti → costanti storiche 80-105.
    """
    if isinstance(target_pct, (int, float)) and target_pct > 0:
        return (
            max(0.0, target_pct - GSPOT_BAND_BELOW),
            target_pct + GSPOT_BAND_ABOVE,
        )
    return GSPOT_LOWER, GSPOT_UPPER


def _is_in_gspot(proj, target_pct=None):
    """True se proj è nella banda g-spot. Banda dinamica quando il
    pacing-bridge espone un target work-hours-aware, altrimenti banda
    statica 80-105 (back-compat)."""
    if not isinstance(proj, (int, float)):
        return False
    lo, hi = _gspot_bounds(target_pct)
    return lo <= proj <= hi


def _read_pacing_pace():
    """Legge vel_team/vel_target dall'ultimo report del pacing-bridge.
    Segnale STABILE (la velocità misurata vs quella necessaria al reset),
    a differenza di proj che è l'estrapolazione volatile a fine finestra.
    Ritorna (vel_team, vel_target) o (None, None) se assenti/illeggibili."""
    try:
        if not PACING_STATE_FILE.exists():
            return None, None
        with PACING_STATE_FILE.open(encoding="utf-8") as f:
            st = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None, None
    r = st.get("last_report") or {}
    vt = r.get("vel_team")
    vtg = r.get("vel_target")
    return (
        vt if isinstance(vt, (int, float)) else None,
        vtg if isinstance(vtg, (int, float)) else None,
    )


def _is_on_pace(vel_team, vel_target, proj, target_pct=None):
    """True se il team è 'on-pace' (zona calma → cadenza lenta, niente wake).

    Phase 1: ancorato a vel_team vs vel_target (stabile). On-pace = il team NON
    sta bruciando oltre `vel_target + PACE_OVER_TOL`. L'under-pace (vel sotto
    target) NON è un allarme per la Sentinella. Quando vel non è disponibile →
    fallback alla banda g-spot proj-based (back-compat)."""
    if isinstance(vel_team, (int, float)) and isinstance(vel_target, (int, float)):
        return vel_team <= vel_target + PACE_OVER_TOL
    return _is_in_gspot(proj, target_pct)


def _choose_tick_interval(state, override_min=None):
    """Decide il prossimo tick interval in minuti basandosi sulla state
    machine del bridge V6.

    state è un dict con:
      tick_phase             — "DEFAULT" | "GSPOT_FAST" | "GSPOT_STABLE" | "GSPOT_CALM"
      gspot_consecutive      — n. tick consecutivi nel g-spot

    Override esplicito (config sentinella_tick_minutes) vince sempre.
    """
    if override_min is not None:
        return override_min
    phase = state.get("tick_phase", "DEFAULT")
    return {
        "DEFAULT": DEFAULT_TICK_MIN,
        "GSPOT_FAST": GSPOT_FAST_TICK_MIN,
        "GSPOT_STABLE": GSPOT_STABLE_TICK_MIN,
        "GSPOT_CALM": GSPOT_CALM_TICK_MIN,
    }.get(phase, DEFAULT_TICK_MIN)


def _advance_tick_phase(state, in_gspot):
    """Aggiorna state["tick_phase"] e state["gspot_consecutive"] in
    funzione del nuovo sample (in_gspot=bool).

    Promotion: 3 tick consecutivi in g-spot promuovono di livello.
    Demotion: appena un tick esce dal g-spot → reset a DEFAULT.
    """
    if not in_gspot:
        state["tick_phase"] = "DEFAULT"
        state["gspot_consecutive"] = 0
        return

    state["gspot_consecutive"] = state.get("gspot_consecutive", 0) + 1
    n = state["gspot_consecutive"]
    phase = state.get("tick_phase", "DEFAULT")

    if phase == "DEFAULT":
        # Appena entriamo nel g-spot, passiamo subito a FAST (2 min) per
        # confermare che non sia rumore.
        state["tick_phase"] = "GSPOT_FAST"
    elif phase == "GSPOT_FAST" and n >= GSPOT_PROMOTION_TICKS:
        state["tick_phase"] = "GSPOT_STABLE"
        state["gspot_consecutive"] = 0  # ricomincia a contare per CALM
    elif phase == "GSPOT_STABLE" and n >= GSPOT_PROMOTION_TICKS:
        state["tick_phase"] = "GSPOT_CALM"
        state["gspot_consecutive"] = 0  # nessuna ulteriore promozione, ma resta pulito


def _within_working_hours(work_phase):
    """Gate orario ASSOLUTO (lean-comms 2026-06-15): fuori dalla finestra
    lavorativa NESSUNA LLM va svegliata (né Sentinella né Capitano). Il bridge
    continua a campionare lo stato (Python), ma tace verso le LLM.

    `work_phase` arriva dal pacing-bridge (`ON`/`OFF`). None = nessuno schedule
    configurato → 24/7 (back-compat: si notifica sempre). Fail-safe: se il dato
    manca trattiamo come ON (meglio una sveglia di troppo che perdere un edge)."""
    if work_phase is None:
        return True
    # Sopprime SOLO su OFF esplicito: qualunque altro valore (ON, o un token
    # inatteso) → notifica. Fail-safe: andare sempre-muti su un valore imprevisto
    # perderebbe OGNI edge — peggio di una sveglia di troppo. work_hours_target
    # produce solo "ON"/"OFF", quindi nei casi reali è equivalente a == "ON".
    return str(work_phase).strip().upper() != "OFF"


def _is_quarter(now_dt):
    """True ai quarti d'orologio (x:00/15/30/45). Col tick ancorato a
    ANCHOR_TICK_MIN (5min) i tick cadono su 0/5/10/... → i quarti sono esatti.
    La Sentinella si sveglia (per condizioni in corso) solo ai quarti."""
    return now_dt.minute % 15 == 0


def _next_tick_sleep_sec(now_dt, override_min=None):
    """Secondi di sleep fino al PROSSIMO tick.

    - override esplicito (config `sentinella_tick_minutes`) → quel valore
      (testing/casi speciali), col floor MIN_TICK_SECONDS.
    - default → ANCORATO al prossimo confine di ANCHOR_TICK_MIN sull'orologio
      (x:00/05/10/...): cadenza prevedibile e phase-locked (i quarti 0/15/30/45
      sono un sottoinsieme → wake Sentinella ai quarti). Se il confine è troppo
      vicino (< floor) salta a quello successivo per non spammare il provider.
    """
    if override_min is not None:
        return max(MIN_TICK_SECONDS, override_min * 60)
    anchor_s = ANCHOR_TICK_MIN * 60
    secs_into_hour = now_dt.minute * 60 + now_dt.second + now_dt.microsecond / 1e6
    to_next = anchor_s - (secs_into_hour % anchor_s)
    if to_next < MIN_TICK_SECONDS:
        to_next += anchor_s
    return to_next


def _should_notify_sentinella(on_pace, state, now_ts, is_quarter, status=None):
    """Decide se SVEGLIARE la Sentinella (gate deterministico, edge-driven).

    Lean-comms (2026-06-15): il bridge decide il "silenzio" in codice PRIMA di
    invocare l'LLM. Regole:
      • on_pace (calmo) → silenzio, reset del cooldown.
      • primo tick attuabile dell'episodio (transizione calma→attuabile) →
        notifica SUBITO (è un edge reale, anche fuori dai quarti).
      • episodio attuabile IN CORSO → re-conferma SOLO ai quarti (x:00/15/30/45)
        e non più spesso di SENTINELLA_COOLDOWN_MIN. Elimina il re-wake
        "HOLD già attivo" ad ogni tick 5min — la causa del coordinator-burn
        osservato (la Sentinella ragionava verbosamente per ridire "silenzio").

    Tick leggero (2026-06-28): durante un episodio in corso, se il REGIME
    (`status`) è INVARIATO rispetto all'ultima notifica, la re-conferma ai
    quarti è ridondante (l'ordine è già applicato) → la posticipiamo fino al
    cap SENTINELLA_RECONFIRM_MIN. Un cambio di `status` la sveglia subito (al
    quarto utile). `status=None` → comportamento legacy (re-conferma al
    cooldown), per non sorprendere eventuali chiamatori senza regime.

    Il gate orario (fuori finestra → mai svegliare) è applicato a monte dal
    chiamante (vedi `_within_working_hours`), non qui.

    state è un dict con:
      last_sent_ts            — timestamp Unix dell'ultima notifica (None se reset)
      last_sent_status        — `status` (regime) all'ultima notifica (None se reset)
    """
    if on_pace:
        # Calmo: nessun bisogno di Sentinella. Reset del cooldown così il
        # prossimo episodio attuabile è notificato immediatamente.
        state["last_sent_ts"] = None
        state["last_sent_status"] = None
        return False

    last_ts = state.get("last_sent_ts")
    if last_ts is None:
        # Transizione calma→attuabile: edge → notifica (anche fuori quarto).
        return True
    # Episodio attuabile in corso: re-conferma solo ai quarti, col cooldown.
    if not is_quarter:
        return False
    elapsed_min = (now_ts - last_ts) / 60.0
    if elapsed_min < SENTINELLA_COOLDOWN_MIN:
        return False
    if status is None:
        # Legacy: senza regime, re-conferma appena scaduto il cooldown.
        return True
    # Tick leggero: regime cambiato → sveglia; regime invariato → aspetta il cap.
    if status != state.get("last_sent_status"):
        return True
    return elapsed_min >= SENTINELLA_RECONFIRM_MIN


def _write_state_file(state, last_tick_at, next_tick_at, tick_interval_min,
                      last_status=None, last_projection=None, last_usage=None,
                      last_reset_at=None, last_reset_at_unix=None,
                      last_provider=None):
    """Pubblica lo stato corrente del bridge in un JSON atomico letto dalla
    UI web (`/api/bridge/status`). Sostituisce la replica della logica
    `_choose_tick_interval` lato TS, che era fragile rispetto a cambi del
    bridge (V5→V6 aveva costanti diverse e il timer mostrato era sballato).

    Atomic write: scriviamo in `<file>.tmp` e poi `os.replace` per evitare
    letture parziali se il fetcher web colpisce a metà write.

    last_reset_at è la stringa HH:MM del reset della finestra rate-limit del
    provider (5h Kimi/Claude/Codex). Esposto per il token-meter V1 che lo usa
    per ancorare la finestra di aggregazione (window_start = reset_at - 5h);
    altrimenti dovrebbe ricostruire la window dal `now`, divergendo dal bridge.
    """
    payload = {
        "version": STATE_VERSION,
        "pid": os.getpid(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "last_tick_at": last_tick_at,
        "next_tick_at": next_tick_at,
        "tick_phase": state.get("tick_phase"),
        "tick_interval_min": tick_interval_min,
        "gspot_consecutive": state.get("gspot_consecutive", 0),
        "last_sentinella_notify_at": (
            datetime.fromtimestamp(state["last_sent_ts"], tz=timezone.utc).isoformat()
            if state.get("last_sent_ts") else None
        ),
        "last_status": last_status,
        "last_projection": last_projection,
        "last_usage": last_usage,
        "last_reset_at": last_reset_at,
        "last_reset_at_unix": last_reset_at_unix,
        "last_provider": last_provider,
        "g_spot": {"lower": GSPOT_LOWER, "upper": GSPOT_UPPER},
        "sentinella_cooldown_min": SENTINELLA_COOLDOWN_MIN,
    }
    tmp = STATE_FILE.with_suffix(".json.tmp")
    try:
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        os.replace(tmp, STATE_FILE)
    except OSError as e:
        print(f"[bridge V6] WARN write state: {e}", file=sys.stderr)


def session_exists(s):
    return subprocess.run(["tmux", "has-session", "-t", s], capture_output=True).returncode == 0


def jht_tmux_send(session, text):
    # Difesa: un tmux-send che si blocca (pane occupato) NON deve mai abbattere il
    # bridge. Senza questa guardia, TimeoutExpired propagava fuori dal while-loop di
    # main() (l'unico handler esterno è KeyboardInterrupt) → bridge morto in silenzio,
    # zero auto-recovery (setsid detached, fuori dal respawn di pid1). Vedi postmortem
    # docs/internal/postmortems/2026-06-27-betaC-sentinel-bridge-crash.md. Degrada a "tick saltato".
    try:
        return subprocess.run(["jht-tmux-send", session, text], capture_output=True, timeout=15).returncode == 0
    except (subprocess.TimeoutExpired, OSError) as e:
        print(f"[bridge V6] WARN jht_tmux_send({session}): {e}", file=sys.stderr)
        return False


def _daily_halt_active():
    """True se il team è in standby per sforo del cap giornaliero (#2)."""
    return DAILY_HALT_FLAG.exists()


def _daily_hardstop_disabled():
    """True se il cap giornaliero è stato disattivato con JHT_DAILY_HARDSTOP=0.

    Il cap giornaliero (`weekly_rimanente / finestre_rimaste`) esiste per non
    bruciare il weekly in due sedute. Durante un **burst dimostrativo** però è
    proprio quello che si vuole: saturare la finestra 5h invece di spalmarla.
    Stessa forma di JHT_PACE_GUARD, ma con l'effetto opposto — e attenzione,
    questo toglie l'ultima rete AUTOMATICA sul tetto: la velocità resta in mano
    al Capitano (il `pace_guard` gli manda il consiglio, non frena da sé), e il
    solo freno che scattava senza di lui era questo. Da tenere acceso per una
    finestra, non per sempre.
    """
    return os.environ.get("JHT_DAILY_HARDSTOP", "1").strip() in ("0", "false", "no")


def _esc_all_sessions():
    """Manda un ESC a ogni sessione tmux: interrompe il turno in corso senza
    uccidere il processo — una pausa pulita, non un kill. Best-effort: qualunque
    errore degrada a 'sessione non messa in pausa', mai un'eccezione che abbatte
    il bridge. Ritorna l'elenco delle sessioni a cui l'ESC è stato inviato."""
    try:
        out = subprocess.run(["tmux", "ls", "-F", "#{session_name}"],
                             capture_output=True, text=True, timeout=10).stdout
    except (subprocess.SubprocessError, OSError):
        return []
    paused = []
    for s in (l.strip() for l in out.splitlines() if l.strip()):
        try:
            subprocess.run(["tmux", "send-keys", "-t", s, "Escape"],
                           capture_output=True, timeout=10)
            paused.append(s)
        except (subprocess.SubprocessError, OSError):
            pass
    return paused


def _sample_vitals_and_maybe_alert():
    """Campiona RAM/CPU → vitals.jsonl (file dedicato, NON il tick Sentinella).

    Sveglia la Sentinella SOLO se RAM o CPU >= VITALS_ALERT_PCT (pressione risorse
    REALE, distinta dalla quota token), con cooldown anti-spam. Isolato: qualsiasi
    errore qui NON tocca il tick di quota. Il Mantenitore correla vitals.jsonl 1×/dì.
    """
    global _LAST_VITALS_ALERT_AT
    try:
        r = subprocess.run([sys.executable, VITALS_SKILL, "sample"],
                           capture_output=True, text=True, timeout=10)
        if r.returncode != 0 or not r.stdout.strip():
            return
        v = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        return
    cpu = (v.get("cpu") or {}).get("pct")
    mem = (v.get("mem") or {}).get("pct")
    over = []
    if isinstance(cpu, (int, float)) and cpu >= VITALS_ALERT_PCT:
        over.append(f"CPU {cpu}%")
    if isinstance(mem, (int, float)) and mem >= VITALS_ALERT_PCT:
        over.append(f"RAM {mem}%")
    if not over:
        return
    now = time.time()
    if now - _LAST_VITALS_ALERT_AT < VITALS_ALERT_COOLDOWN_MIN * 60:
        return
    _LAST_VITALS_ALERT_AT = now
    jht_tmux_send(
        SENTINELLA_SESSION,
        f"[BRIDGE VITALS ALERT] Risorse container sopra soglia: {', '.join(over)} "
        f"(>={VITALS_ALERT_PCT:.0f}%). Pressione risorse REALE (rischio OOM/saturazione), "
        f"distinta dalla quota token. Valuta escalation al Capitano: ridurre roster / "
        f"kill 1 worker. Storico per la diagnosi: {VITALS_FILE} (Mantenitore 1×/giorno).",
    )


# ── Codex: lettura rollout JSONL ────────────────────────────────────────

CODEX_SESSIONS_DIR = JHT_HOME / ".codex" / "sessions"


def fetch_codex_rollout():
    """Legge il rollout JSONL più recente sotto ~/.codex/sessions/ e
    estrae rate_limits.primary.used_percent + resets_at."""
    try:
        if not CODEX_SESSIONS_DIR.exists():
            return None
        candidates = []
        for p in CODEX_SESSIONS_DIR.rglob("rollout-*.jsonl"):
            try:
                st = p.stat()
                if st.st_size >= 512:
                    candidates.append((st.st_mtime, p))
            except OSError:
                continue
        if not candidates:
            return None
        candidates.sort(reverse=True)
        candidates = candidates[:10]

        # Con N sessioni codex parallele i rate_limits.primary.used_percent
        # letti dai rispettivi rollout sono discordanti (es. 14/20/20% nello
        # stesso 4s window) per quantizzazione e race lato server. La vecchia
        # logica prendeva il primo file per mtime e fermava → valore casuale
        # che oscilla. mtime si aggiorna anche per eventi tool_use/shell, non
        # solo per nuove risposte API: mtime fresco ≠ rate_limits fresco.
        # Fix: scorri tutti i candidati, raccogli i rate_limits più recenti,
        # filtra entro 60s dal più fresco per timestamp evento, prendi il MAX
        # di used_percent (safer per un budget rate-limit).
        all_rls = []
        for _, p in candidates:
            try:
                with p.open("rb") as f:
                    f.seek(0, os.SEEK_END)
                    size = f.tell()
                    f.seek(max(0, size - 200_000))
                    tail = f.read().decode("utf-8", errors="replace")
            except OSError:
                continue
            for line in reversed(tail.splitlines()[-300:]):
                if '"rate_limits"' not in line:
                    continue
                try:
                    evt = json.loads(line)
                except json.JSONDecodeError:
                    continue
                pl = evt.get("payload") or {}
                rl = pl.get("rate_limits") or ((pl.get("info") or {}).get("rate_limits"))
                if not rl:
                    continue
                primary = rl.get("primary")
                if not (primary and primary.get("used_percent") is not None):
                    continue
                all_rls.append((evt.get("timestamp") or "", rl))
                break

        if not all_rls:
            return None

        def _parse_iso(s):
            try:
                return datetime.fromisoformat(s.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                return None

        all_rls.sort(key=lambda x: x[0], reverse=True)
        newest_dt = _parse_iso(all_rls[0][0])
        if newest_dt is None:
            recent = all_rls[:1]
        else:
            recent = [
                (ts, rl) for ts, rl in all_rls
                if (dt := _parse_iso(ts)) is not None
                and (newest_dt - dt).total_seconds() <= 60
            ] or all_rls[:1]
        best_rl = max(
            recent,
            key=lambda x: float((x[1].get("primary") or {}).get("used_percent") or 0),
        )[1]
        primary = best_rl.get("primary") or {}
        # FLAG dev3 (P7): il weekly va letto dalla sessione PIÙ FRESCA, non da
        # best_rl (scelto per max primary used_percent). Al rinnovo del ciclo
        # convivono per qualche secondo letture di sessioni diverse: scegliendo
        # per primary si può agganciare un weekly/ reset STALE → era la causa
        # dell'oscillazione reset 7giu↔11giu. recent[0] è la lettura più recente
        # (all_rls ordinato desc per timestamp).
        freshest_rl = recent[0][1]
        secondary = freshest_rl.get("secondary") or {}
        try:
            usage = int(round(float(primary.get("used_percent", 0))))
            weekly = (
                int(round(float(secondary.get("used_percent", 0))))
                if secondary.get("used_percent") is not None else None
            )
        except (TypeError, ValueError):
            return None
        reset_at = None
        reset_at_unix = None
        resets_unix = primary.get("resets_at")
        if isinstance(resets_unix, (int, float)):
            reset_at = _fmt_reset(resets_unix)  # DATA completa, mai ora-nuda
            reset_at_unix = float(resets_unix)
        # Weekly window reset (bug #19A): se il rate-limit secondary espone
        # un proprio resets_at (rolling-7d Codex), lo registriamo. Capitano
        # e Sentinella possono così rispondere "quanto manca al reset settimanale?"
        # senza grep nei sorgenti.
        weekly_reset_at = None
        weekly_reset_at_unix = None
        weekly_resets_unix = secondary.get("resets_at")
        if isinstance(weekly_resets_unix, (int, float)):
            weekly_reset_at = _fmt_reset(weekly_resets_unix)  # DATA completa
            weekly_reset_at_unix = float(weekly_resets_unix)
        return {
            "usage": usage,
            "reset_at": reset_at,
            "reset_at_unix": reset_at_unix,
            "weekly_usage": weekly,
            "weekly_reset_at": weekly_reset_at,
            "weekly_reset_at_unix": weekly_reset_at_unix,
        }
    except (OSError, json.JSONDecodeError):
        return None


# ── Claude: HTTP API + 429 cooldown ─────────────────────────────────────

CLAUDE_CREDENTIALS = JHT_HOME / ".claude" / ".credentials.json"
CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
CLAUDE_429_COOLDOWN_FILE = LOGS_DIR / "claude-429-cooldown"
CLAUDE_429_COOLDOWN_S = 300


def _read_claude_token():
    try:
        with CLAUDE_CREDENTIALS.open(encoding="utf-8") as f:
            creds = json.load(f)
        return (creds.get("claudeAiOauth") or {}).get("accessToken")
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _load_claude_429_cooldown():
    try:
        return float(CLAUDE_429_COOLDOWN_FILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return 0.0


def _save_claude_429_cooldown(until_epoch):
    try:
        CLAUDE_429_COOLDOWN_FILE.write_text(f"{until_epoch:.0f}", encoding="utf-8")
    except OSError:
        pass


_claude_429_until = _load_claude_429_cooldown()

# ── Weekly reset STICKY (il team deve sempre conoscere gli orari finestre) ──
# Il reset weekly cambia solo ~settimanalmente e SOLO l'HTTP /oauth/usage lo
# espone (la primaria claude è il worker TUI, che porta usage% ma NON il weekly
# reset). Lo memorizziamo in un file: se un fetch ce l'ha lo salviamo; se manca,
# lo riempiamo dalla cache (finché il reset è nel futuro). Così il pacing usa
# sempre `residual_to_reset` ancorato al reset reale invece del fallback
# `rolling_7d`. Idempotente, fail-open.
WEEKLY_RESET_CACHE_FILE = LOGS_DIR / "weekly-reset-cache.json"


def _save_weekly_reset_cache(at, at_unix):
    try:
        WEEKLY_RESET_CACHE_FILE.write_text(
            json.dumps({"weekly_reset_at": at, "weekly_reset_at_unix": at_unix}),
            encoding="utf-8",
        )
    except OSError:
        pass


def _load_weekly_reset_cache():
    try:
        return json.loads(WEEKLY_RESET_CACHE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _apply_sticky_weekly_reset(parsed):
    """Garantisce che `parsed` porti il weekly reset (vedi nota sopra)."""
    if not isinstance(parsed, dict):
        return parsed
    pu = parsed.get("weekly_reset_at_unix")
    if isinstance(pu, (int, float)) and pu > time.time():
        _save_weekly_reset_cache(parsed.get("weekly_reset_at"), pu)
        return parsed
    cache = _load_weekly_reset_cache()
    cu = cache.get("weekly_reset_at_unix")
    # Cache vuota/scaduta → un fetch HTTP mirato per seedarla (rispetta il 429).
    if not (isinstance(cu, (int, float)) and cu > time.time()):
        http = fetch_claude_api()
        if isinstance(http, dict) and isinstance(http.get("weekly_reset_at_unix"), (int, float)):
            _save_weekly_reset_cache(http.get("weekly_reset_at"), http["weekly_reset_at_unix"])
            cache = _load_weekly_reset_cache()
            cu = cache.get("weekly_reset_at_unix")
    if isinstance(cu, (int, float)) and cu > time.time():
        parsed["weekly_reset_at"] = cache.get("weekly_reset_at")
        parsed["weekly_reset_at_unix"] = cu
    return parsed


def _ensure_reset_unix(parsed):
    """Garantisce che la finestra 5h porti `reset_at_unix` (epoch), non solo
    `reset_at` HH:MM.

    Il path worker della TUI claude (`_try_claude_tui_parser`) estrae solo
    l'HH:MM del reset 5h e lascia `reset_at_unix=None`: il tick mostrava quindi
    il reset 5h come orario nudo, senza la DATA (ambiguo a cavallo di mezzanotte
    e indistinguibile da uno slittamento di giorno). Quando l'unix manca lo
    ricostruiamo dall'HH:MM come PROSSIMA occorrenza entro le ~5h del ciclo
    (oggi se l'orario è ancora futuro, domani altrimenti). Idempotente,
    fail-open. Mirror di `_apply_sticky_weekly_reset` per la finestra primaria.
    """
    if not isinstance(parsed, dict):
        return parsed
    ru = parsed.get("reset_at_unix")
    if isinstance(ru, (int, float)) and ru > time.time():
        return parsed
    hhmm = parsed.get("reset_at")
    if not (isinstance(hhmm, str) and ":" in hhmm):
        return parsed
    try:
        hh, mm = (int(x) for x in hhmm.split(":", 1))
    except (ValueError, TypeError):
        return parsed
    now = datetime.now().astimezone()
    cand = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if cand <= now:
        cand += timedelta(days=1)
    parsed["reset_at_unix"] = cand.timestamp()
    return parsed


def fetch_claude_api():
    """Ritorna dict {usage, reset_at, weekly_usage}, None, o 'RATE_LIMIT'."""
    global _claude_429_until
    if time.time() < _claude_429_until:
        return "RATE_LIMIT"
    token = _read_claude_token()
    if not token:
        return None
    req = urllib.request.Request(
        CLAUDE_USAGE_URL,
        headers={"Authorization": f"Bearer {token}", "anthropic-beta": "oauth-2025-04-20"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 429:
            _claude_429_until = time.time() + CLAUDE_429_COOLDOWN_S
            _save_claude_429_cooldown(_claude_429_until)
            return "RATE_LIMIT"
        return None
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError, OSError):
        return None

    five_h = data.get("five_hour") or {}
    seven_d = data.get("seven_day") or {}
    try:
        usage_5h = int(round(float(five_h.get("utilization", 0))))
        weekly = int(round(float(seven_d.get("utilization", 0)))) if seven_d.get("utilization") is not None else None
    except (TypeError, ValueError):
        return None
    return {
        "usage": usage_5h,
        # DATA completa dall'epoch (fallback HH:MM solo se l'ISO manca).
        "reset_at": _fmt_reset(_iso_to_unix(five_h.get("resets_at")),
                               _iso_to_hhmm(five_h.get("resets_at"))),
        "reset_at_unix": _iso_to_unix(five_h.get("resets_at")),
        "weekly_usage": weekly,
        # Weekly reset (bug #19A): /oauth/usage espone seven_day.resets_at
        # come ISO timestamp del prossimo reset weekly. Era già nei dati,
        # mancava solo la riesposizione downstream.
        "weekly_reset_at": _fmt_reset(_iso_to_unix(seven_d.get("resets_at")),
                                      _iso_to_hhmm(seven_d.get("resets_at"))),
        "weekly_reset_at_unix": _iso_to_unix(seven_d.get("resets_at")),
    }


# ── Kimi: HTTP API ──────────────────────────────────────────────────────

KIMI_CREDENTIALS = JHT_HOME / ".kimi" / "credentials" / "kimi-code.json"
KIMI_USAGES_URL = "https://api.kimi.com/coding/v1/usages"


def _read_kimi_token():
    try:
        with KIMI_CREDENTIALS.open(encoding="utf-8") as f:
            return json.load(f).get("access_token")
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _iso_to_hhmm(ts):
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.astimezone().strftime("%H:%M")
    except (ValueError, TypeError):
        return None


def _iso_to_unix(ts):
    """ISO string → epoch UTC float, o None se non parsabile.

    Esposto come reset_at_unix nello state file per il token-meter: HH:MM da
    solo è ambiguo su mezzanotte e su rolling window con drift, l'epoch no.
    """
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return None


# ── Reset → DATA+ORA completa (mai ora-nuda) ────────────────────────────
# Regola del progetto: ogni reset/scadenza esposto a Capitano/Sentinella/UI
# porta la DATA di calendario completa, ancorata all'epoch (_unix). Loader
# della skill sorella format_time.py; fallback inline (data UTC) se assente.
def _load_format_time_mod():
    for cand in (Path("/app/shared/skills/format_time.py"),
                 Path(__file__).resolve().parent.parent / "shared" / "skills" / "format_time.py"):
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


_FT_MOD = _load_format_time_mod()


def _fmt_reset(unix_ts, fallback=None):
    """Epoch → 'YYYY-MM-DD HH:MM TZ' (mai ora-nuda). fallback se non derivabile."""
    if isinstance(unix_ts, (int, float)) and not isinstance(unix_ts, bool):
        if _FT_MOD is not None:
            out = _FT_MOD.fmt_reset(unix_ts)
            if out:
                return out
        try:
            return datetime.fromtimestamp(
                float(unix_ts), timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        except (OverflowError, OSError, ValueError):
            pass
    return fallback


# ── Messaggio UNICO del tick: renderer condiviso (bridge_message) ────────
# Stesso testo per SENTINELLA (push) e skill rate-budget del CAPITANO (pull).
def _load_bridge_message_mod():
    for cand in (Path("/app/shared/skills/bridge_message.py"),
                 Path(__file__).resolve().parent.parent / "shared" / "skills" / "bridge_message.py"):
        try:
            if not cand.exists():
                continue
            spec = importlib.util.spec_from_file_location("bridge_message", cand)
            m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(m)
            return m
        except (OSError, ImportError, AttributeError):
            continue
    return None


_BM_MOD = _load_bridge_message_mod()
LAST_TICK_FILE = LOGS_DIR / "last-tick.txt"


def _humanize_dur(hours):
    """Ore (float) → 'Xg Yh' / 'Xh Ymm' / 'Xm'. None se non valido."""
    if not isinstance(hours, (int, float)) or hours < 0:
        return None
    total_min = int(round(hours * 60))
    d, rem = divmod(total_min, 1440)
    h, m = divmod(rem, 60)
    if d > 0:
        return f"{d}g {h}h"
    if h > 0:
        return f"{h}h {m:02d}m"
    return f"{m}m"


def _write_last_tick(msg):
    """Persiste l'ultimo tick renderizzato → la skill rate-budget lo rilegge."""
    try:
        LAST_TICK_FILE.write_text(msg, encoding="utf-8")
    except OSError:
        pass


def _build_tick_message(entry, parsed, status, proj, usage, reset_str, dyn_target,
                        work_phase, weekly_pace, weekly_locked, now_h, now_ts):
    """Costruisce il dict-valori 3-sezioni (5h/oggi/settimana) + extras e lo
    renderizza via bridge_message.render. Velocità = media cumulativa
    (usage/tempo) vs target (quanto manca / tempo che resta)."""
    target5 = float(dyn_target) if isinstance(dyn_target, (int, float)) and dyn_target else 92.0
    reset_unix = entry.get("reset_at_unix")
    vel_now5 = vel_tgt5 = reset_in5 = None
    if isinstance(reset_unix, (int, float)):
        elapsed_h = (now_ts - (reset_unix - 5 * 3600)) / 3600.0   # finestra 5h
        if elapsed_h > 0 and isinstance(usage, (int, float)):
            vel_now5 = round(usage / elapsed_h, 1)
        rem_h = (reset_unix - now_ts) / 3600.0
        if rem_h > 0:
            base_u = usage if isinstance(usage, (int, float)) else 0
            vel_tgt5 = round(max(0.0, target5 - base_u) / rem_h, 1)
            reset_in5 = _humanize_dur(rem_h)
    fivehh = {
        "usage": usage,
        "proj": round(proj) if isinstance(proj, (int, float)) else proj,
        "target": round(target5),
        "status": status,
        "reset_str": reset_str if (reset_str and reset_str != "?") else (entry.get("reset_at") or "?"),
        "reset_in": reset_in5, "vel_now": vel_now5, "vel_target": vel_tgt5,
    }
    now_dt = datetime.fromtimestamp(now_ts, tz=timezone.utc)
    daily = None
    if not weekly_locked:
        d = _daily_pacing_via_skill(entry, now_dt, now_ts)
        if isinstance(d, dict) and d.get("budget") is not None:
            cap = round(d["budget"] + 5.0, 1)
            cons = d.get("consumed")
            daily = {
                "consumed": cons, "budget": d.get("budget"), "cap": cap,
                "over": isinstance(cons, (int, float)) and cons > cap,
                "vel_now": d.get("vel_now"), "vel_target": d.get("vel_target"),
            }
    weekly = None
    wk_usage = entry.get("weekly_usage")
    if isinstance(wk_usage, (int, float)):
        wp = weekly_pace if isinstance(weekly_pace, dict) else {}
        wru = entry.get("weekly_reset_at_unix")
        kind = wp.get("kind")
        weekly = {
            "used": wk_usage, "remaining": entry.get("weekly_remaining_pct"),
            "reset_str": _fmt_reset(wru, entry.get("weekly_reset_at")),
            "reset_in": _humanize_dur((wru - now_ts) / 3600.0) if isinstance(wru, (int, float)) else None,
            "vel_now": wp.get("vel_weekly_pct_h"), "sustainable": wp.get("sustainable_pct_h"),
            "ratio": wp.get("ratio"), "kind": kind if kind not in (None, "ND") else None,
            "debt": wp.get("debt_pct"), "early_lockout": wp.get("early_lockout_h"),
            "burn_mode": bool(wp.get("burn_mode")),
            # Verdetto imperativo Passo A (RALLENTA ~X%/ACCELERA-SATURA/...): la
            # CONCLUSIONE pronta per un modello debole (Kimi), non solo i numeri.
            # Il renderer lo mostra come headline della sezione SETTIMANA.
            "verdict": (_pace_verdict_line(
                wp, entry.get("weekly_remaining_pct")) or "").strip() or None,
        }
    extras = {}
    mrp = parsed.get("monthly_remaining_pct") if isinstance(parsed, dict) else None
    if isinstance(mrp, (int, float)):
        extras["monthly_rem"] = mrp
    try:
        th_path = DATA_JSONL.parent / "tools-health.json"
        if th_path.exists():
            th = json.loads(th_path.read_text(encoding="utf-8"))
            if th.get("any_broken") and th.get("broken"):
                extras["tools_broken"] = th["broken"]
    except (OSError, ValueError):
        pass
    v = {"ts_now": now_h, "provider": entry.get("provider"),
         "work_phase": work_phase or "ON", "fivehh": fivehh, "daily": daily,
         "weekly": weekly, "extras": extras}
    if _BM_MOD is not None:
        try:
            return _BM_MOD.render(v)
        except Exception:
            pass
    # Fallback monoriga se il renderer non è caricabile.
    return (f"[BRIDGE TICK] ts={now_h} usage={usage}% proj={proj}% status={status} "
            f"reset={fivehh['reset_str']} weekly={wk_usage}% src=bridge.")


def fetch_kimi_api():
    token = _read_kimi_token()
    if not token:
        return None
    req = urllib.request.Request(KIMI_USAGES_URL, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError, OSError):
        return None
    weekly = data.get("usage") or {}
    limits = data.get("limits") or []
    five_h = (limits[0] or {}).get("detail") if limits else None
    if not five_h:
        return None
    try:
        usage_5h = int(five_h.get("used", 0))
        # Weekly: l'API espone `used` SOLO quando >0. A settimana fresca
        # (account appena resettato/switchato) data.usage ha solo
        # `limit`+`remaining` e OMETTE `used` → il vecchio codice leggeva
        # None e il pacing restava weekly-cieco fino al primo 1% speso.
        # Deriva used = limit - remaining (= 0 a inizio settimana).
        wk_used = weekly.get("used")
        if wk_used is not None:
            weekly_used = int(wk_used)
        elif weekly.get("remaining") is not None and weekly.get("limit") is not None:
            weekly_used = max(0, int(weekly["limit"]) - int(weekly["remaining"]))
        else:
            weekly_used = None
    except (TypeError, ValueError):
        return None
    # Weekly reset (bug #19A): la rotta /coding/v1/usages espone data.usage
    # come la finestra settimanale. Kimi mette qui un resetTime ISO per il
    # rolling weekly. Se Moonshot in futuro lo rinomina (es. resets_at), la
    # get-with-fallback resta safe (None se assente).
    weekly_reset_iso = weekly.get("resetTime") or weekly.get("resets_at")
    # P5 (2026-06-13): totalQuota = tetto MENSILE del pacchetto Kimi (condiviso con
    # la membership). NON resetta come 5h/weekly: a esaurimento CONGELA Kimi Code
    # finche' non si ricarica/upgrade. Oggi monitoriamo solo 5h + weekly e siamo
    # ciechi a questo. Lo esponiamo come monthly_remaining_pct (None se assente).
    total_q = data.get("totalQuota") or {}
    try:
        monthly_remaining = (int(total_q.get("remaining"))
                             if total_q.get("remaining") is not None else None)
    except (TypeError, ValueError):
        monthly_remaining = None
    return {
        "usage": usage_5h,
        # DATA completa dall'epoch (fallback HH:MM solo se l'ISO manca).
        "reset_at": _fmt_reset(_iso_to_unix(five_h.get("resetTime")),
                               _iso_to_hhmm(five_h.get("resetTime"))),
        "reset_at_unix": _iso_to_unix(five_h.get("resetTime")),
        "weekly_usage": weekly_used,
        "weekly_reset_at": _fmt_reset(_iso_to_unix(weekly_reset_iso),
                                      _iso_to_hhmm(weekly_reset_iso)),
        "weekly_reset_at_unix": _iso_to_unix(weekly_reset_iso),
        "monthly_remaining_pct": monthly_remaining,
    }


# ── Storage I/O ─────────────────────────────────────────────────────────

def load_last_sample(source=None):
    """Ultimo sample dal JSONL, opzionalmente filtrato per source.
    Quando il bridge calcola velocità deve usare solo i propri sample
    (source='bridge'), altrimenti i sample ad-hoc del Capitano
    (rate_budget live) si infilano tra tick e fanno scattare anti-spike."""
    if not DATA_JSONL.exists():
        return None
    try:
        raw = DATA_JSONL.read_text(encoding="utf-8").strip().splitlines()
        if source is None:
            return json.loads(raw[-1]) if raw else None
        # Filtra per source: cerca dall'ultimo verso il primo
        for line in reversed(raw):
            try:
                s = json.loads(line)
            except json.JSONDecodeError:
                continue
            if s.get("source") == source:
                return s
        return None
    except (OSError, json.JSONDecodeError, IndexError):
        return None


def load_recent_samples(n=30, source=None):
    """Ultimi N sample dal JSONL, opzionalmente filtrati per source."""
    if not DATA_JSONL.exists():
        return []
    try:
        raw = DATA_JSONL.read_text(encoding="utf-8").strip().splitlines()
        out = []
        for line in raw:
            try:
                s = json.loads(line)
            except json.JSONDecodeError:
                continue
            if source is not None and s.get("source") != source:
                continue
            out.append(s)
        return out[-n:]
    except OSError:
        return []


def write_jsonl(entry):
    with DATA_JSONL.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def _load_skill_module(name, filename):
    """Importa una skill Python per path (container prima, repo come fallback)."""
    for cand in (Path("/app/shared/skills") / filename,
                 Path(__file__).resolve().parent.parent / "shared" / "skills" / filename):
        if not cand.exists():
            continue
        try:
            spec = importlib.util.spec_from_file_location(name, cand)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except (OSError, ImportError, AttributeError, SyntaxError):
            continue
    return None


def _should_advise_captain(result, state, now_ts):
    """Gate del consiglio di pacing (lean-comms, stessa forma del gate Sentinella).

    Vero quando c'è qualcosa da decidere e non lo si è appena detto:
      • consiglio == throttle attuale → niente da fare, silenzio;
      • verdetto o valore diversi dall'ultimo mandato → edge, si parla subito;
      • consiglio identico → si ripete solo dopo PACE_ADVICE_COOLDOWN_MIN.
    """
    if not result.get("recommends_change"):
        return False
    if (state.get("verdict") != result.get("verdict")
            or state.get("throttle_s") != result.get("throttle_recommended_s")):
        return True
    return (now_ts - (state.get("ts") or 0.0)) >= PACE_ADVICE_COOLDOWN_MIN * 60


def _pace_guard_step(entry):
    """Consiglio di pacing sulla curva della finestra (shared/skills/pace_guard.py).

    Il bridge MISURA e RACCOMANDA, non tocca il throttle: scrive nel pane del
    Capitano una riga con verdetto, valore consigliato e comando pronto, e lì
    si ferma. È il Capitano a decidere se e come applicarlo, perché la velocità
    è distribuzione di lavoro fra agenti (chi sta facendo cosa, quale collo di
    bottiglia è aperto) e non una divisione da delegare a uno script — fino al
    2026-07-28 questa funzione scriveva il throttle da sé e si contendeva il
    volante con il Capitano, che aggiustava a sua volta.

    Le reti di sicurezza NON passano di qui e restano automatiche: il
    WORKER_FLOOR di 5 minuti (applicato da throttle-config.py a ogni lettura) e
    il daily hard-stop più sotto in main(). Frenare per stare sulla curva è
    pacing; impedire il disastro è un'altra cosa.

    Fail-safe per costruzione: qualunque errore lascia il bridge intatto e il
    throttle dov'era. Disattivabile con JHT_PACE_GUARD=0.
    """
    if os.environ.get("JHT_PACE_GUARD", "1").strip() in ("0", "false", "no"):
        return
    try:
        mod = _load_skill_module("pace_guard", "pace_guard.py")
        if mod is None:
            return
        workers = mod.active_workers()
        if not workers:
            return
        current = mod.current_worker_throttle(workers)
        now_ts = time.time()
        result = mod.evaluate(entry, now_ts, current_throttle_s=current)
        if not result.get("ok"):
            return
        result["ts"] = entry.get("ts")
        result["workers"] = workers
        # Invariante esplicita nel log: il bridge non ha scritto niente.
        result["applied"] = False
        result["advice"] = mod.advice_line(
            result, workers, mod.advisable_workers(workers))
        if _should_advise_captain(result, _pace_advice_state, now_ts):
            result["advised"] = True
            result["delivered_via_tmux"] = _notify_captain_pace_guard(result)
            _pace_advice_state.update({
                "ts": now_ts,
                "throttle_s": result.get("throttle_recommended_s"),
                "verdict": result.get("verdict"),
            })
        else:
            result["advised"] = False
            if not result.get("recommends_change"):
                # Rientrati in pari (spesso perché il Capitano ha applicato):
                # si dimentica l'ultimo consiglio, così la prossima deriva
                # riparte come edge invece che come ripetizione.
                _pace_advice_state.update(
                    {"ts": 0.0, "throttle_s": None, "verdict": None})
        with (LOGS_DIR / "pace-guard.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(result) + "\n")
    except Exception:  # noqa: BLE001 — il bridge non muore per il guard
        pass


def _notify_captain_pace_guard(result):
    """Consegna il consiglio al Capitano. Ritorna True se il tmux-send è andato.

    Doppio canale, come per i verdetti del pacing-bridge: il pane (immediato) e
    la mailbox JSONL (recuperabile con `bridge_mailbox.py drain` a inizio turno).
    Il secondo esiste perché `jht-tmux-send` fallisce quando il Capitano è in
    turno lungo, e da oggi un consiglio perso significa nessuna correzione —
    prima il freno era già stato applicato e il messaggio era solo un'informativa.
    """
    advice = result.get("advice") or ""
    delivered = jht_tmux_send(CAPITANO_SESSION, advice) if advice else False
    try:
        with (LOGS_DIR / "bridge-mailbox.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({
                "ts": datetime.now(timezone.utc).isoformat(),
                "kind": "pace-guard",
                "delivered_via_tmux": delivered,
                "msg": advice,
            }, separators=(",", ":")) + "\n")
    except OSError as e:
        print(f"[bridge V6] WARN append mailbox pace-guard: {e}", file=sys.stderr)
    return delivered


def write_log(entry):
    line = (
        f"[{entry['ts']}] provider={entry['provider']} "
        f"usage={entry['usage']}% "
        f"vel_smooth={entry.get('velocity_smooth', '-')}/h "
        f"proj={entry.get('projection', '-')}% "
        f"status={entry.get('status', '-')} src={entry.get('source', '-')}"
    )
    with LOG_TXT.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


# ── Singleton lock ──────────────────────────────────────────────────────

# Il file handle del lock resta aperto per TUTTA la vita del processo: è il
# possesso del fd a tenere il flock. Se il modulo lo lasciasse andare, il GC
# chiuderebbe il fd e il lock cadrebbe.
_LOCK_FH = None


def acquire_singleton_lock():
    """Singleton ATOMICO via flock. Esci se un altro bridge è già vivo.

    Prima era un check-then-write sul PID file: fra `PID_FILE.exists()` e
    `write_text()` c'è una finestra in cui due bridge lanciati insieme si
    vedono entrambi soli e partono entrambi → doppio [BRIDGE TICK], doppio
    consumo di quota. Non è teorico: i due entry point (agent-watchdog.sh →
    start-agent.sh bridge, e team-commands-poller.js → bridge-control.sh)
    possono partire in parallelo.

    flock(LOCK_EX|LOCK_NB) è atomico a livello di kernel e si rilascia da solo
    quando il processo muore (anche di SIGKILL), quindi non lascia lock stale
    da ripulire — a differenza del PID file, che sopravvive ai crash.

    Il PID file continua a essere scritto: lo leggono la UI
    (web/app/api/bridge/status/route.ts) e pid1.
    """
    global _LOCK_FH
    try:
        fh = open(LOCK_FILE, "a+", encoding="utf-8")
    except OSError as e:
        # Filesystem non scrivibile: meglio un bridge senza lock che nessun
        # bridge (il kill-by-marker dello spawner resta come rete).
        print(f"[bridge V5] WARN lockfile non apribile ({e}) — proseguo senza lock")
        return
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        try:
            fh.seek(0)
            other = fh.read().strip() or "?"
        except OSError:
            other = "?"
        fh.close()
        print(f"[bridge V5] altra istanza viva (pid={other}), exit")
        sys.exit(0)
    _LOCK_FH = fh
    try:
        fh.seek(0)
        fh.truncate()
        fh.write(str(os.getpid()))
        fh.flush()
    except OSError:
        pass
    try:
        PID_FILE.write_text(str(os.getpid()), encoding="utf-8")
    except OSError:
        pass


# ── Helper: chiama compute_metrics skill per scrivere sample ────────────

def _compute_metrics_via_skill(parsed, last, history, weekly_axis=None):
    """Path-import della skill compute_metrics per centralizzare il calcolo
    delle metriche derivate (velocity_smooth, projection τ-aware, status).
    `weekly_axis` (verdetto weekly_pace, opzionale) compone lo status bi-dim.
    Se la skill non esiste (config rotta), fallback a sample minimale."""
    skill_path = Path("/app/shared/skills/compute_metrics.py")
    if not skill_path.exists():
        skill_path = Path(__file__).resolve().parent.parent / "shared" / "skills" / "compute_metrics.py"
    if not skill_path.exists():
        # Fallback: sample minimale senza metriche derivate
        return {
            "ts": datetime.now(timezone.utc).isoformat(),
            "provider": parsed.get("provider"),
            "usage": parsed.get("usage"),
            # Data-completa anche nel fallback (skill non caricabile).
            "reset_at": _fmt_reset(parsed.get("reset_at_unix"), parsed.get("reset_at")),
            "reset_at_unix": parsed.get("reset_at_unix"),
            "weekly_usage": parsed.get("weekly_usage"),
            "weekly_reset_at": _fmt_reset(
                parsed.get("weekly_reset_at_unix"), parsed.get("weekly_reset_at")),
            "weekly_reset_at_unix": parsed.get("weekly_reset_at_unix"),
            "status": "OK",
        }
    spec = importlib.util.spec_from_file_location("compute_metrics", skill_path)
    cm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cm)
    return cm.compute_metrics(parsed, last, history=history, weekly_axis=weekly_axis)


def _weekly_pace_via_skill(entry, now_dt, now_ts):
    """weekly_pace (rate weekly REALE 2h vs sostenibile + lockout anticipato) via
    la pure-function condivisa shared/skills/weekly_pace.py. weekly_active_hours
    da work_hours_target (ore ON da now al weekly_reset). Ritorna dict o None.

    Parte 2/3 redesign usage-monitoring (2026-06-13): il dato grezzo va nel
    [BRIDGE TICK] alla Sentinella → S-07 lo elabora e CONSIGLIA il Capitano (C-09),
    invece di farlo arrivare al Capitano che bypasserebbe l'analisi (= il bug
    dell'indagine: status SOTTOUTILIZZO 89% mentre il weekly andava a 100%).
    UN solo calcolo del pace (lezione fix#4): la stessa funzione shared."""
    try:
        wrem = entry.get("weekly_remaining_pct")
        wreset_unix = entry.get("weekly_reset_at_unix")
        if (not isinstance(wrem, (int, float))
                or not isinstance(wreset_unix, (int, float))):
            return None

        def _imp(name):
            p = Path("/app/shared/skills") / f"{name}.py"
            if not p.exists():
                p = (Path(__file__).resolve().parent.parent
                     / "shared" / "skills" / f"{name}.py")
            spec = importlib.util.spec_from_file_location(name, p)
            m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(m)
            return m

        wht = _imp("work_hours_target")
        wp = _imp("weekly_pace")
        try:
            with CONFIG_PATH.open(encoding="utf-8") as f:
                cfg = json.load(f)
        except (OSError, json.JSONDecodeError):
            cfg = None
        wreset_dt = datetime.fromtimestamp(wreset_unix, tz=timezone.utc)
        wah = wht.active_hours_in_range(now_dt, wreset_dt, cfg)
        # Ore attive dell'INTERO ciclo (per il debito cumulativo, 2026-06-28):
        # il ciclo weekly e' di 7 giorni che terminano al reset → start = reset-7d.
        # Cosi' weekly_pace puo' calcolare ideal_used e debt_pct (saldo vs retta).
        wtot = wht.active_hours_in_range(wreset_dt - timedelta(days=7), wreset_dt, cfg)
        return wp.weekly_pace_assessment(str(DATA_JSONL), now_ts, wrem, wah,
                                         weekly_total_active_hours=wtot)
    except Exception:
        return None


# Riserva serale (2026-06-26): frazione del budget giornaliero tenuta da parte
# di giorno e RILASCIATA/bruciata nelle ultime ore della finestra → l'utente la
# usa per la chat col team, o si brucia sul lavoro (niente budget sprecato).
# Spalma il consumo invece del front-load mattutino tipico di Kimi.
_RESERVE_FRAC = 0.15          # 15% del budget di oggi tenuto da parte
_RESERVE_RELEASE_H = 2.0      # rilasciato nelle ultime ~2h della finestra


def _evening_release(now_dt):
    """True se siamo nelle ultime ~2h della finestra di lavoro corrente (la
    riserva serale va RILASCIATA/bruciata); False altrimenti (riserva TENUTA).
    Robusta: qualunque errore o fase OFF → False (conservativo: tieni la riserva)."""
    try:
        p = Path("/app/shared/skills") / "work_hours_target.py"
        if not p.exists():
            p = (Path(__file__).resolve().parent.parent
                 / "shared" / "skills" / "work_hours_target.py")
        spec = importlib.util.spec_from_file_location("work_hours_target", p)
        wht = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(wht)
        try:
            with CONFIG_PATH.open(encoding="utf-8") as f:
                cfg = json.load(f)
        except (OSError, json.JSONDecodeError):
            cfg = None
        nph = wht.next_phase_transition(now_dt, cfg)
        if nph and nph[0] == "ON" and nph[1] is not None:
            h_to_end = (nph[1] - now_dt).total_seconds() / 3600.0
            return 0.0 <= h_to_end <= _RESERVE_RELEASE_H
    except Exception:
        pass
    return False


def _pace_verdict_line(weekly_pace, wk_remaining_pct):
    """VERDETTO imperativo del weekly-pace per la Sentinella (Passo A, 2026-06-28).

    Visione utente: dare alla Sentinella la CONCLUSIONE pronta, non solo i numeri
    grezzi (`vel_weekly`/`ratio`/`debt`...). Un segnale imperativo ("RALLENTA ~X%")
    è molto più eseguibile in autonomia da un modello debole (i Kimi, poco
    manovrabili) di "ratio 1.07x ALLINEATO". La DECISIONE resta la divisione
    forward `sustainable = budget_residuo / ore_lavoro_residue` (campo
    `sustainable_pct_h`, già calcolato da weekly_pace.py): si auto-corregge da sola
    (uno schizzo di un agente abbassa il residuo → la velocità richiesta cala →
    qui esce "RALLENTA" al tick dopo). Il `vel_weekly` (media 2h) serve SOLO a
    quantificare di quanto tagliare, NON a decidere.

    Ritorna la stringa-prefisso (es. ` WEEKLY-PACE→RALLENTA ~42%: ...`) o "" se i
    dati non bastano. I token grezzi restano APPESI dopo (contratto S-07 intatto);
    il Passo B (gated) li toglierà insieme al riallineo del prompt.
    """
    if not isinstance(weekly_pace, dict):
        return ""
    kind = weekly_pace.get("kind")
    if kind in (None, "ND"):
        return ""
    sust = weekly_pace.get("sustainable_pct_h")        # v* = velocità richiesta ORA
    vel = weekly_pace.get("vel_weekly_pct_h")           # rate misurato (diagnostico)
    binding = bool(weekly_pace.get("binding"))
    burst = bool(weekly_pace.get("burst_transient"))
    burn = bool(weekly_pace.get("burn_mode"))
    early = weekly_pace.get("early_lockout_h")
    proj = weekly_pace.get("projected_final_pct")
    wasted = weekly_pace.get("wasted_pct")
    reset_h = weekly_pace.get("reset_in_active_h")
    # Contesto "resta X% in Yh-lavoro" (il guinzaglio weekly, leggibile).
    leash = ""
    if isinstance(wk_remaining_pct, (int, float)) and isinstance(reset_h, (int, float)):
        leash = f" (resta {wk_remaining_pct:.0f}% in {reset_h:.0f}h-lavoro)"
    # Priorità: burst in uscita > frena (binding/sopra-pace) > accelera (burn) > mantieni.
    if burst:
        return " WEEKLY-PACE→RIPRESA-CONTROLLATA: picco in uscita, NON frenare duro"
    if binding or kind == "SOPRA-PACE":
        cut = None
        if isinstance(vel, (int, float)) and vel > 0 and isinstance(sust, (int, float)):
            cut = max(0.0, (vel - sust) / vel * 100.0)
        head = (f" WEEKLY-PACE→RALLENTA ~{cut:.0f}%" if cut is not None
                else " WEEKLY-PACE→RALLENTA")
        goal = (f": vai a ~{sust:.2f}%/h (ora {vel:.2f})"
                if isinstance(sust, (int, float)) and isinstance(vel, (int, float))
                else "")
        trend = (f" → altrimenti ESAURISCI ~{early:.0f}h-lavoro PRIMA del reset"
                 if isinstance(early, (int, float)) and early > 0 else "")
        return head + goal + leash + trend
    if burn:
        return (f" WEEKLY-PACE→ACCELERA-SATURA: a ritmo attuale chiudi ~{proj:.0f}%,"
                f" spreco ~{wasted:.0f}% del weekly prima del reset"
                if isinstance(proj, (int, float)) and isinstance(wasted, (int, float))
                else " WEEKLY-PACE→ACCELERA-SATURA: budget a rischio spreco")
    goal = (f" (~{sust:.2f}%/h)" if isinstance(sust, (int, float)) else "")
    return f" WEEKLY-PACE→MANTIENI{goal}{leash}"


def _maybe_offhours_stop(state, now_ts, vel_team):
    """Off-hours hard-stop: il 'silenzio' del gate NON ferma gli agenti — i worker
    self-loopano e, senza un work_phase=OFF esplicito, il Capitano continua ad
    assegnare → burn oltre la chiusura (caso reale 2026-06-29: betaC +4h, b3, betaB).

    Manda al Capitano UN work_phase=OFF alla transizione ON→OFF; lo RI-manda
    (cooldown OFFHOURS_REASSERT_SEC) se il team brucia ancora fuori orario (bridge
    riavviato / Capitano in turno lungo che ha mancato il primo OFF). Il Capitano
    applica la regola 11 (stop spawn/assegnazioni, niente 'Continua' → i worker
    finiscono il task e vanno IDLE). Il RESUME è la via esistente (tick in-orario
    con work_phase=ON alla riapertura) — qui aggiungiamo solo la metà mancante.
    Unica deroga al lean-comms: 1 messaggio al confine. Idempotente."""
    transition = state.get("last_within_hours") is True
    burning = isinstance(vel_team, (int, float)) and vel_team > 0
    last_dir = state.get("offhours_stop_ts") or 0
    if not (transition or (burning and (now_ts - last_dir) > OFFHOURS_REASSERT_SEC)):
        return
    if not session_exists(CAPITANO_SESSION):
        return
    msg = (
        "[BRIDGE] work_phase=OFF — fuori orario di lavoro. Applica la regola 11: "
        "NON spawnare nuovi agenti, NON dare nuove assegnazioni, NON rilanciare i "
        "worker (niente 'Continua'). I worker in corso finiscono il task corrente e "
        "poi restano IDLE. Le risposte Telegram all'utente restano attive. Riprendi "
        "normalmente all'apertura della finestra (prossimo tick con work_phase=ON)."
    )
    if jht_tmux_send(CAPITANO_SESSION, msg):
        state["offhours_stop_ts"] = now_ts
        print(f"[bridge V6] off-hours STOP -> CAPITANO (transition={transition} "
              f"burning={burning})")


def _daily_pacing_via_skill(entry, now_dt, now_ts):
    """Budget GIORNALIERO adattivo + consumo nella finestra di lavoro corrente
    (regole S-09/C-19). Tutto in % del WEEKLY: budget = weekly_remaining /
    finestre-lavoro residue (se sfori oggi i giorni dopo calano da soli);
    consumato_oggi = weekly_usage_now - weekly_usage a inizio finestra di lavoro
    corrente (durante le ore OFF il weekly è piatto → baseline). La Sentinella lo
    riceve nel [BRIDGE TICK] (S-09), ANALIZZA e ordina il coast al Capitano (C-19)
    — NON va al Capitano diretto (stesso principio di _weekly_pace_via_skill).
    Ritorna dict {budget, consumed, vel_now, vel_target} (valori None se non
    calcolabili). vel_now = consumato / ore-attive-trascorse; vel_target =
    budget / ore-attive-del-giorno (media cumulativa, stessa unità %/h)."""
    try:
        wrem = entry.get("weekly_remaining_pct")
        wreset_unix = entry.get("weekly_reset_at_unix")
        wusage = entry.get("weekly_usage")
        if (not isinstance(wrem, (int, float))
                or not isinstance(wreset_unix, (int, float))):
            return (None, None)

        def _imp(name):
            p = Path("/app/shared/skills") / f"{name}.py"
            if not p.exists():
                p = (Path(__file__).resolve().parent.parent
                     / "shared" / "skills" / f"{name}.py")
            spec = importlib.util.spec_from_file_location(name, p)
            m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(m)
            return m

        wht = _imp("work_hours_target")
        try:
            with CONFIG_PATH.open(encoding="utf-8") as f:
                cfg = json.load(f)
        except (OSError, json.JSONDecodeError):
            cfg = None
        wreset_dt = datetime.fromtimestamp(wreset_unix, tz=timezone.utc)
        wah = wht.active_hours_in_range(now_dt, wreset_dt, cfg)
        if not isinstance(wah, (int, float)) or wah <= 0:
            return (None, None)
        daily_active_h = wht.active_hours_in_range(
            now_dt, now_dt + timedelta(days=1), cfg)
        if not isinstance(daily_active_h, (int, float)) or daily_active_h <= 0:
            daily_active_h = 12.0
        windows_left = max(1.0, wah / daily_active_h)
        budget = wrem / windows_left
        consumed = None
        elapsed_active = None
        try:
            ints = wht._build_intervals(
                cfg, now_dt - timedelta(days=1), now_dt + timedelta(minutes=1))
            ws = None
            for s, e in ints:
                if s <= now_dt <= e:
                    ws = s
                    break
            if ws is None and ints:
                ws = ints[-1][0]
            if ws is not None:
                # Ore ATTIVE trascorse da inizio finestra di lavoro di oggi →
                # denominatore della velocità giornaliera (consumato / tempo).
                ea = wht.active_hours_in_range(ws, now_dt, cfg)
                if isinstance(ea, (int, float)) and ea > 0:
                    elapsed_active = ea
            if ws is not None and isinstance(wusage, (int, float)):
                ws_ts = ws.timestamp()
                base = None
                with open(DATA_JSONL, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            ev = json.loads(line)
                        except Exception:
                            continue
                        wt = ev.get("weekly_usage")
                        ts = ev.get("ts")
                        if (not isinstance(wt, (int, float))
                                or not isinstance(ts, str)):
                            continue
                        try:
                            t = datetime.fromisoformat(
                                ts.replace("Z", "+00:00")).timestamp()
                        except Exception:
                            continue
                        if t >= ws_ts:
                            base = wt
                            break
                if base is not None:
                    consumed = max(0.0, wusage - base)
        except Exception:
            consumed = None
        # Velocità giornaliera (media cumulativa): attuale = consumato / ore-attive
        # trascorse; target = budget / ore-attive del giorno. Stessa unità %/h.
        vel_now = (round(consumed / elapsed_active, 2)
                   if (consumed is not None and elapsed_active) else None)
        vel_target = (round(budget / daily_active_h, 2)
                      if daily_active_h else None)
        return {
            "budget": round(budget, 1),
            "consumed": round(consumed, 1) if consumed is not None else None,
            "vel_now": vel_now,
            "vel_target": vel_target,
        }
    except Exception:
        return {"budget": None, "consumed": None, "vel_now": None, "vel_target": None}


# ── Claude TUI parser (libreria importata da check_usage) ──────────────

WORKER_SESSION = "SENTINELLA-WORKER"
START_AGENT_SH = "/app/.launcher/start-agent.sh"

# Mitigazioni anti-stale TUI Claude:
#   • restart periodico worker per igiene (sessione TUI può "scadere"
#     dopo ore: cache locale corrotta, token oauth scaduto, modal in
#     loop "Loading usage data…")
#   • cross-check con HTTP ogni N tick per detectare divergenze
#   • detect "Loading…" → return None → cascata su HTTP, e respawn
#     worker prima del prossimo tick
WORKER_RESTART_INTERVAL_MIN = 20     # restart worker ogni 20 min (igiene proattiva)
HTTP_CROSSCHECK_EVERY_N_TICKS = 5    # confronto TUI vs HTTP ogni 5 tick
TUI_HTTP_DIVERGENCE_THRESHOLD = 5    # se diff > 5 punti = stale TUI

# State module-level per il TUI parser (mantenuto tra chiamate)
_worker_last_restart_ts = None
_tui_tick_counter = 0


def _kill_worker():
    """Killa SENTINELLA-WORKER in modo non bloccante."""
    try:
        subprocess.run(
            ["tmux", "kill-session", "-t", WORKER_SESSION],
            capture_output=True, timeout=5,
        )
    except (subprocess.TimeoutExpired, OSError):
        pass


def _try_claude_tui_parser():
    """Primario per Claude: capture-pane SENTINELLA-WORKER + parse.

    Mitigazioni applicate:
      1. Restart periodico worker ogni WORKER_RESTART_INTERVAL_MIN (60 min)
         per evitare che la sessione TUI vada in stato stale.
      2. Cross-check con HTTP ogni HTTP_CROSSCHECK_EVERY_N_TICKS (5)
         per detectare TUI che mostra dati cached.
      3. Detect "Loading usage data…" nel parser → return None →
         cade su HTTP, respawn worker prima del prossimo tick.

    Ritorna parsed dict {usage, reset_at, weekly_usage} o None se fail.
    """
    global _worker_last_restart_ts, _tui_tick_counter

    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "check_usage", "/app/shared/skills/check_usage.py"
        )
        if spec is None or spec.loader is None:
            return None
        cu = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cu)
    except (OSError, ImportError):
        return None

    now = time.time()

    # ── 1. Restart periodico per igiene ──
    if _worker_last_restart_ts is None:
        # Primo boot: marca solo
        _worker_last_restart_ts = now
    elif (now - _worker_last_restart_ts) > WORKER_RESTART_INTERVAL_MIN * 60:
        print(f"[bridge V5] worker restart periodico (>{WORKER_RESTART_INTERVAL_MIN} min)")
        _kill_worker()
        _worker_last_restart_ts = now
        _tui_tick_counter = 0
        # Non blocco con sleep qui: il check sotto rispawnerà se serve
        # e per QUESTO tick fallisce → cade su HTTP

    # Worker deve essere attivo. Se non lo è, spawn + 18s wait.
    if not cu.tmux_has_session(WORKER_SESSION):
        try:
            subprocess.run(
                ["bash", START_AGENT_SH, "worker"],
                capture_output=True, timeout=10,
            )
            time.sleep(cu.WORKER_BOOT_WAIT_S)
        except (subprocess.TimeoutExpired, OSError):
            return None
        if not cu.tmux_has_session(WORKER_SESSION):
            return None

    # Query il worker
    buf = cu.query_claude_worker()
    parsed = cu.parse_claude_usage(buf)

    # ── 3. Detect "Loading…" failure: parsed=None + Loading nel buf ──
    if parsed is None:
        if buf and "Loading usage data" in buf:
            print("[bridge V5] TUI in 'Loading...' loop, kill+respawn worker")
            _kill_worker()
            _worker_last_restart_ts = now  # forza re-spawn dopo
        return None

    _tui_tick_counter += 1

    # Schema: check_usage {usage, reset_hhmm_utc, weekly}
    # → bridge {usage, reset_at, weekly_usage}
    tui_result = {
        "usage": parsed["usage"],
        "reset_at": parsed.get("reset_hhmm_utc"),
        "weekly_usage": parsed.get("weekly"),
    }

    # ── 2. Cross-check HTTP ogni N tick ──
    if _tui_tick_counter % HTTP_CROSSCHECK_EVERY_N_TICKS == 0:
        http = fetch_claude_api()
        if isinstance(http, dict) and isinstance(http.get("usage"), (int, float)):
            tui_u = tui_result["usage"]
            http_u = http["usage"]
            diff = abs(tui_u - http_u)
            if diff > TUI_HTTP_DIVERGENCE_THRESHOLD:
                print(f"[bridge V5] TUI/HTTP divergono: TUI={tui_u}% HTTP={http_u}% (Δ{diff}>5), uso HTTP + kill worker")
                _kill_worker()
                _worker_last_restart_ts = now
                return http  # USA HTTP per questo tick

    return tui_result


# ── Main loop V5 ────────────────────────────────────────────────────────

def _do_fetch(provider):
    """Cascata di fallback provider-aware. Ritorna (parsed, fail_reason).

    Per Claude:  TUI parser → HTTP /oauth/usage → fail (Sentinella prende il rilievo).
    Per Kimi:    HTTP /coding/v1/usages → fail.
    Per Codex:   JSONL rollout file → fail.

    Per kimi/codex la sorgente primaria è già stabile (no rate-limit),
    quindi non serve cascata interna. Per Claude invece la cascata è
    importante perché /oauth/usage rate-limita aggressivamente con tick
    rapido.
    """
    if provider in ("kimi", "moonshot"):
        p = fetch_kimi_api()
        return (p, None) if p else (None, "kimi_api_none")

    if provider in ("anthropic", "claude"):
        # 1. PRIMARIO: TUI parser (no rate-limit, fragile a cambi modal)
        p = _try_claude_tui_parser()
        if p:
            return p, None
        # 2. FALLBACK: HTTP /oauth/usage (rate-limit possibile)
        r = fetch_claude_api()
        if r == "RATE_LIMIT":
            return None, "claude_tui_fail+claude_429"
        if r is None:
            return None, "claude_tui_fail+claude_api_none"
        return r, None

    if provider in ("openai", "codex"):
        p = fetch_codex_rollout()
        return (p, None) if p else (None, "codex_rollout_none")

    return None, f"unsupported:{provider}"


def main():
    """Bridge V5: fetch usage + invia a Sentinella.

    Cascata di fetch:
      1. PRIMARIO: TUI parser (capture-pane SENTINELLA-WORKER persistente)
      2. FALLBACK: HTTP /oauth/usage (Claude) o equivalente
      3. Se entrambi falliscono → manda [BRIDGE FAILURE] alla Sentinella
         che farà fallback manuale con skill TUI worker.

    Il bridge scrive il sample (con compute_metrics) nel JSONL e manda
    [BRIDGE TICK] ricco con dati alla Sentinella, che decide se mandare
    ordini al Capitano.

    Anti-stale TUI: worker restart periodico (20 min), cross-check HTTP
    ogni 5 tick, detect "Loading…" → restart.
    """
    acquire_singleton_lock()
    override_min, _ = read_config()
    print(f"[bridge V6] pid={os.getpid()} sentinella={SENTINELLA_SESSION} capitano={CAPITANO_SESSION}")
    if override_min is not None:
        print(f"[bridge V7] tick interval: {override_min} min (override da config)")
    else:
        print(
            f"[bridge V7] tick ANCORATO all'orologio ogni {ANCHOR_TICK_MIN}min "
            f"(x:00/05/10/...); Sentinella svegliata ai quarti (x:00/15/30/45) "
            f"solo su edge azionabile + GATE ORARIO (no wake fuori finestra)"
        )
        print(
            f"[bridge V7] sentinella cooldown={SENTINELLA_COOLDOWN_MIN}min, "
            f"edge-driven (lean-comms 2026-06-15)"
        )

    fail_streak = 0
    capitano_alerted = False   # alert al capitano già mandato per questo episodio?
    is_first_tick = True        # cold-start forzato al primo tick post-boot
    # State machine V6: tick_phase ∈ DEFAULT/GSPOT_FAST/GSPOT_STABLE/GSPOT_CALM,
    # gspot_consecutive = tick consecutivi nel g-spot, last_sent_ts = ts ultima
    # notifica critica alla Sentinella (None se reset).
    state = {
        "tick_phase": "DEFAULT",
        "gspot_consecutive": 0,
        "last_sent_ts": None,
        "last_sent_status": None,   # regime all'ultima notifica (tick leggero)
    }

    while True:
        now_h = datetime.now().strftime("%H:%M:%S")
        override_min, provider = read_config()

        parsed, fail_reason = _do_fetch(provider)

        # Gate orario assoluto (lean-comms): calcolato qui — copre sia il path
        # successo sia quello di fallimento. work_phase dal pacing-bridge.
        dyn_target, work_phase = _read_dynamic_target()
        within_hours = _within_working_hours(work_phase)

        if parsed:
            # ── Path successo: scrivi sample, tick alla Sentinella ────
            parsed["provider"] = provider
            # Claude: la primaria (worker TUI) non porta il weekly reset → lo
            # iniettiamo dalla cache sticky (seedata via HTTP) così il team
            # conosce sempre l'orario del reset settimanale e il pacing usa
            # residual_to_reset invece del fallback rolling_7d.
            if provider in ("anthropic", "claude"):
                parsed = _apply_sticky_weekly_reset(parsed)
                # …e analogamente la finestra 5h: il worker TUI dà solo l'HH:MM,
                # ricostruiamo l'epoch così il tick mostra DATA+ORARIO anche per
                # la primaria (non solo per il weekly).
                parsed = _ensure_reset_unix(parsed)
            if is_first_tick:
                last = None
                history = []
                is_first_tick = False
            else:
                last = load_last_sample()
                if last and last.get("provider") != provider:
                    last = None
                    history = []
                else:
                    history = load_recent_samples(30)
            # Verdetto weekly (rate active-hours) PRIMA del compute, così lo
            # status persistito è già composto bi-dimensionale (2026-06-29).
            # weekly_pace legge la storia dal JSONL (≤ tick precedente) + il
            # weekly_remaining corrente: il sample odierno non serve per il rate.
            _wk_axis = None
            _wu = parsed.get("weekly_usage")
            if (isinstance(_wu, (int, float))
                    and isinstance(parsed.get("weekly_reset_at_unix"), (int, float))):
                _nts = time.time()
                _ndt = datetime.fromtimestamp(_nts, tz=timezone.utc)
                _pre = {
                    "weekly_remaining_pct": max(0.0, 100.0 - _wu),
                    "weekly_reset_at_unix": parsed.get("weekly_reset_at_unix"),
                }
                _wk_axis = _weekly_pace_via_skill(_pre, _ndt, _nts)
            entry = _compute_metrics_via_skill(parsed, last, history, weekly_axis=_wk_axis)
            entry["source"] = "bridge"
            write_jsonl(entry)
            write_log(entry)
            _pace_guard_step(entry)

            # Vitals RAM/CPU (2026-06-18): campiona a OGNI tick su vitals.jsonl
            # (file dedicato — NON nel tick Sentinella, che resta sul flusso quota).
            # Sveglia la Sentinella SOLO se RAM/CPU >95% (rate-limited). FUORI dal
            # gate orario sotto: una pressione risorse è emergenza infra, non quota.
            _sample_vitals_and_maybe_alert()

            usage = entry.get("usage")
            proj = entry.get("projection")
            status = entry.get("status")
            # A2 lockout-resilience (2026-06-14): quando il weekly è ESAURITO
            # (remaining<=0) il team è hard-locked (403 access_terminated). Lo status
            # calcolato sull'arco-5h resta SOTTOUTILIZZO ("lavora di più") → il Capitano
            # continua a spawnare worker → 403-spam multi-agente. Forziamo status=LOCKED
            # così la Sentinella/Capitano FERMANO gli spawn = spenta la SORGENTE dei 403.
            # Resta il check-cardine "weekly<100%" (sotto, fuori da ogni gate) per il
            # risveglio automatico al reset: LOCKED non significa MAI congelare il polling.
            wk_remaining_now = entry.get("weekly_remaining_pct")
            weekly_locked = (
                isinstance(wk_remaining_now, (int, float)) and wk_remaining_now <= 0
            )
            if weekly_locked:
                status = "LOCKED"
            # Reset 5h: DATA+ORA completa da reset_at_unix (HH:MM nudo è ambiguo
            # a cavallo di mezzanotte e non distingue lo slittamento di giorno);
            # fallback alla stringa reset_at (già data-completa dal choke point).
            reset = _fmt_reset(entry.get("reset_at_unix"), entry.get("reset_at")) or "?"

            # V6: aggiorna state machine del tick interval e decide se
            # svegliare la Sentinella. Il bridge scrive SEMPRE il sample
            # nel JSONL (monitoring puro), ma manda [BRIDGE TICK] alla
            # Sentinella solo quando proj è fuori dal g-spot e il cooldown
            # è scaduto. In g-spot la Sentinella resta in standby.
            #
            # Target dinamico work-hours-aware (V8): il g-spot si centra
            # sul target scritto dal pacing-bridge invece che sul 92% fisso.
            # Quando schedule + ratio mancano → fallback alla banda storica.
            # (dyn_target/work_phase ora calcolati a monte, fuori dal branch.)
            # Phase 1 (pacing-migration-plan-2026-06-05): cadenza tick e wake della
            # Sentinella ancorati al segnale STABILE vel_team vs vel_target (dal
            # pacing-bridge), NON a `proj` (volatile, ±400pt tick-to-tick).
            #   on_pace=True  → zona calma: cadenza lenta, niente wake.
            #   on_pace=False → il team brucia sopra vel_target → wake + cadenza veloce.
            # Fallback a proj-band quando vel non è disponibile (pre-primo-tick).
            # Il vecchio gate P3 (proj>target & usage<=target → no-wake) è rimosso:
            # con vel, una velocità alta è ESATTAMENTE ciò che vogliamo intercettare
            # presto (l'under-utilizzo invece non sveglia — lo gestisce il Capitano).
            vel_team_s, vel_target_s = _read_pacing_pace()
            on_pace = _is_on_pace(vel_team_s, vel_target_s, proj, dyn_target)
            # Fix #4 (runaway-scaling 2026-06-07): il vincolo weekly è binding
            # anche quando il 5h è on-pace. Lo trattiamo come condizione NON
            # calma → sveglia la Sentinella (ATTENZIONE WEEKLY in Phase 1) e
            # accelera la cadenza, rispettando comunque il cooldown anti-spam.
            # Senza questo, a weekly 92% on-pace la Sentinella non veniva MAI
            # svegliata e il freno non scattava (status SOTTOUTILIZZO decorativo).
            now_ts = time.time()
            now_local = datetime.now().astimezone()
            is_quarter = _is_quarter(now_local)
            weekly_binding = bool(entry.get("weekly_binding"))
            # compute_metrics tiene weekly_binding=False by-design: il proj_weekly
            # naive sovra-proietta sulle notti idle, quindi non è un trigger
            # affidabile. Il binding VERO arriva dal pace active-hours-aware
            # (weekly_pace): se il rate weekly REALE è SOPRA-PACE e proietta lockout
            # PRIMA del reset (e non è un burst in esaurimento), il weekly È binding
            # → sveglia la Sentinella anche col 5h on-pace. Chiude il buco storico
            # "Sentinella cieca al weekly" (status SOTTOUTILIZZO mentre il weekly va
            # a fuoco = front-load). Un team in pari/sotto-pace NON è binding (no
            # coast prematuro). Calcolato UNA volta qui e riusato nel tick sotto;
            # solo in-orario e non-locked (fuori finestra nessuno viene svegliato).
            weekly_pace = None
            if within_hours and not weekly_locked:
                weekly_pace = _weekly_pace_via_skill(
                    entry, datetime.fromtimestamp(now_ts, tz=timezone.utc), now_ts)
                if isinstance(weekly_pace, dict) and weekly_pace.get("binding"):
                    weekly_binding = True

            # ── Daily hard-stop (#2): enforcement fisico del cap giornaliero ──
            # Lo sforo del cap (oggi > budget+5%) non resta un avviso: ferma il
            # team. Valutato QUI, prima e a prescindere da `should_notify`, perché
            # in pausa il team è on-pace (should_notify=False) e non rivedremmo mai
            # il rientro. Una skill-call in più al tick: costo trascurabile.
            daily_halted = False
            # _daily_pacing_via_skill ritorna un dict {budget, consumed, ...}
            # (o (None, None) nei path non calcolabili). NON spacchettare a tupla:
            # su dict a >2 chiavi Python solleva "too many values to unpack" e il
            # loop va in FATAL→restart ogni 5s (crash-loop). Estrai per chiave.
            _dp = _daily_pacing_via_skill(
                entry, datetime.fromtimestamp(now_ts, tz=timezone.utc), now_ts)
            _hb = _dp.get("budget") if isinstance(_dp, dict) else None
            _hc = _dp.get("consumed") if isinstance(_dp, dict) else None
            if _daily_hardstop_disabled():
                # Deroga esplicita (JHT_DAILY_HARDSTOP=0): il cap giornaliero
                # protegge il WEEKLY spalmandolo sulle finestre; durante un burst
                # dimostrativo si accetta di sforarlo per saturare la finestra 5h.
                # Il pace_guard continua a misurare e a consigliare il Capitano:
                # la velocità resta governata (da lui), è solo l'interruttore
                # generale a non scattare.
                # Se un halt era già attivo lo si rimuove, altrimenti il team
                # resterebbe in standby con il freno tolto e nessuno a liberarlo.
                if _daily_halt_active():
                    try:
                        DAILY_HALT_FLAG.unlink()
                    except OSError:
                        pass
                    print(f"[bridge V6] {now_h} DAILY-HARDSTOP disabilitato → flag rimosso")
            elif isinstance(_hb, (int, float)) and isinstance(_hc, (int, float)):
                _hcap = _hb + 5.0
                _over_cap = _hc > _hcap
                if _daily_halt_active():
                    # Già in standby: si esce SOLO quando oggi rientra sotto il cap
                    # — accade da sé all'inizio della finestra di lavoro del giorno
                    # dopo (baseline del consumo azzerata) o al reset weekly.
                    if not _over_cap:
                        try:
                            DAILY_HALT_FLAG.unlink()
                        except OSError:
                            pass
                        if within_hours:
                            for _s in (SENTINELLA_SESSION, CAPITANO_SESSION):
                                if session_exists(_s):
                                    jht_tmux_send(_s, f"[BRIDGE INFO] ▶️ Budget giornaliero rientrato (oggi={_hc:.1f}% ≤ cap={_hcap:.1f}%): team riattivabile, riprendo i tick.")
                        print(f"[bridge V6] {now_h} DAILY-HALT rientrato (oggi={_hc:.1f}% ≤ cap={_hcap:.1f}%)")
                    else:
                        daily_halted = True  # resta in pausa → questo tick non sveglia nessuno
                elif within_hours and _over_cap:
                    # Primo sforo: ultimo messaggio ai coordinatori, 30s per
                    # elaborarlo, poi ESC a tutte le sessioni (standby, NO kill).
                    daily_halted = True
                    _alert = (f"⛔ DAILY-CAP SFORATO: oggi={_hc:.1f}% > cap={_hcap:.1f}% "
                              f"(budget={_hb:.1f}%). ULTIMO messaggio prima dello stop: "
                              f"METTO IL TEAM IN STANDBY tra 30s — ESC a tutte le sessioni, "
                              f"NESSUN kill. Riprendo alla finestra di lavoro del giorno dopo.")
                    for _s in (SENTINELLA_SESSION, CAPITANO_SESSION):
                        if session_exists(_s):
                            jht_tmux_send(_s, f"[BRIDGE ALERT] {_alert}")
                    print(f"[bridge V6] {now_h} DAILY-CAP HIT oggi={_hc:.1f}% cap={_hcap:.1f}% → ESC a tutto il team tra 30s")
                    time.sleep(30)
                    _paused = _esc_all_sessions()
                    try:
                        DAILY_HALT_FLAG.write_text(json.dumps({
                            "halted_at": datetime.now(timezone.utc).isoformat(),
                            "consumed_pct": _hc, "cap_pct": _hcap, "budget_pct": _hb,
                            "sessions": _paused,
                        }), encoding="utf-8")
                    except OSError:
                        pass
                    print(f"[bridge V6] {now_h} DAILY-HALT attivo: ESC a {len(_paused)} sessioni; bridge in silenzio fino al giorno dopo")

            if not within_hours:
                # GATE ORARIO ASSOLUTO (lean-comms): fuori finestra NESSUNA LLM
                # svegliata. Il bridge ha già scritto il sample (monitoring puro)
                # ma tace. Reset cooldown + last_status così alla ripresa il 1°
                # tick in-orario ri-valuta da zero (edge/LOCKED ri-notificati 1 volta).
                effective_on_pace = True
                _advance_tick_phase(state, effective_on_pace)
                state["last_sent_ts"] = None
                state["last_status"] = None
                should_notify = False
                # Off-hours hard-stop: manda al Capitano work_phase=OFF (regola 11)
                # alla transizione / se brucia ancora. Il 'silenzio' da solo non
                # ferma i worker che self-loopano.
                _maybe_offhours_stop(state, now_ts, vel_team_s)
            elif weekly_locked:
                # A2 lockout-resilience: a weekly esaurito NON ha senso pacare-veloce
                # né spammare la Sentinella. Cadenza CALMA (effective_on_pace=True) + UN
                # solo avviso sulla TRANSIZIONE a LOCKED (layer-2: 1 notice, poi silenzio).
                # Il polling continua comunque (calm, mai stop) → il check weekly<100% al
                # prossimo tick fa ripartire il team da solo al reset (resurrection-check).
                # FIX lean-comms: last_status ora è tracciato in-memory (prima non veniva
                # MAI settato nel dict → il gate notificava ad OGNI tick, non 1 volta).
                effective_on_pace = True
                _advance_tick_phase(state, effective_on_pace)
                should_notify = state.get("last_status") != "LOCKED"
                state["last_status"] = status
            else:
                effective_on_pace = on_pace and not weekly_binding
                _advance_tick_phase(state, effective_on_pace)
                should_notify = _should_notify_sentinella(
                    effective_on_pace, state, now_ts, is_quarter, status=status
                )
                state["last_status"] = status

            # Traccia within_hours per la transizione off-hours (sopra); al rientro
            # in finestra resetta il cooldown così la prossima chiusura ri-avvisa.
            if within_hours:
                state["offhours_stop_ts"] = 0
            state["last_within_hours"] = within_hours

            target_dbg = f"target={dyn_target:.0f}%" if dyn_target else "target=band"
            phase_dbg = f" phase={work_phase}" if work_phase else ""
            vel_dbg = (
                f" vel={vel_team_s:.2f}/{vel_target_s:.2f}"
                if isinstance(vel_team_s, (int, float)) and isinstance(vel_target_s, (int, float))
                else ""
            )
            print(
                f"[bridge V6] {now_h} OK usage={usage}% proj={proj} status={status} "
                f"phase={state['tick_phase']} on_pace={on_pace}{vel_dbg} {target_dbg}{phase_dbg} "
                f"notify={should_notify}"
            )

            # ── Messaggio UNICO del tick (renderer condiviso) ──────────────
            # Costruito ad OGNI tick in-orario e scritto su last-tick.txt (il
            # Capitano lo rilegge on-demand via skill rate-budget); INVIATO alla
            # Sentinella solo su edge azionabile (should_notify).
            if weekly_pace is None and not weekly_locked:
                weekly_pace = _weekly_pace_via_skill(
                    entry, datetime.fromtimestamp(now_ts, tz=timezone.utc), now_ts)
            tick_msg = _build_tick_message(
                entry, parsed, status, proj, usage, reset, dyn_target,
                work_phase, weekly_pace, weekly_locked, now_h, now_ts)
            _write_last_tick(tick_msg)
            # `not daily_halted` preserva il daily hard-stop (dev1): a cap
            # giornaliero sforato il tick NON sveglia la Sentinella (la cache
            # last-tick resta scritta, è solo pull-on-demand del Capitano).
            if should_notify and not daily_halted and session_exists(SENTINELLA_SESSION):
                jht_tmux_send(SENTINELLA_SESSION, tick_msg)
                state["last_sent_ts"] = now_ts
                state["last_sent_status"] = status   # regime notificato (tick leggero)

            # Recovery se eravamo in failure streak (gate orario: zitto fuori finestra)
            if fail_streak >= FETCH_FAIL_THRESHOLD or capitano_alerted:
                if within_hours and session_exists(CAPITANO_SESSION):
                    jht_tmux_send(
                        CAPITANO_SESSION,
                        "[BRIDGE INFO] sorgente usage tornata responsiva, monitoraggio normale."
                    )
                capitano_alerted = False
            fail_streak = 0

        else:
            # ── Path fallimento ────────────────────────────────────────
            fail_streak += 1
            print(f"[bridge V6] {now_h} FAIL #{fail_streak} reason={fail_reason}")

            # Notifica Sentinella al primo fail dell'episodio (gate orario)
            if fail_streak == 1 and within_hours and session_exists(SENTINELLA_SESSION):
                jht_tmux_send(
                    SENTINELLA_SESSION,
                    f"[BRIDGE FAILURE] ts={now_h} fetch fallito (reason={fail_reason}). Esegui fallback come da prompt."
                )

            # Alert al Capitano al N° fail consecutivo (gate orario)
            if fail_streak == FETCH_FAIL_THRESHOLD and not capitano_alerted:
                if within_hours and session_exists(CAPITANO_SESSION):
                    eff_min = ANCHOR_TICK_MIN if override_min is None else override_min
                    jht_tmux_send(
                        CAPITANO_SESSION,
                        f"[BRIDGE ALERT] sorgente usage degraded da {FETCH_FAIL_THRESHOLD} tick "
                        f"(~{FETCH_FAIL_THRESHOLD * eff_min:.0f} min, reason={fail_reason}). "
                        "La Sentinella sta coprendo con fallback. Opera prudente."
                    )
                capitano_alerted = True

        # Tick ANCORATO all'orologio (lean-comms): prossimo confine di
        # ANCHOR_TICK_MIN (x:00/05/10/...) → cadenza prevedibile e phase-locked
        # (i quarti 0/15/30/45 sono un sottoinsieme → wake Sentinella ai quarti).
        # Override esplicito (config) vince. Le fasi adattive FAST/CALM non
        # guidano più lo sleep (restano solo info per lo state-file UI).
        sleep_sec = _next_tick_sleep_sec(datetime.now().astimezone(), override_min)
        next_tick_min = sleep_sec / 60.0

        # Pubblica lo stato corrente per la UI web (atomic write).
        # last_tick_at = inizio iterazione corrente; next_tick_at = quando
        # ci risveglieremo dallo sleep. Su path fallimento usiamo gli ultimi
        # valori conosciuti (parsed=None → status/proj/usage non aggiornati).
        last_tick_iso = datetime.now(timezone.utc).isoformat()
        next_tick_iso = (datetime.now(timezone.utc) + timedelta(seconds=sleep_sec)).isoformat()
        if parsed:
            _write_state_file(
                state, last_tick_iso, next_tick_iso, next_tick_min,
                last_status=status, last_projection=proj, last_usage=usage,
                last_reset_at=entry.get("reset_at"),
                last_reset_at_unix=parsed.get("reset_at_unix"),
                last_provider=provider,
            )
        else:
            _write_state_file(
                state, last_tick_iso, next_tick_iso, next_tick_min,
                last_provider=provider,
            )

        time.sleep(sleep_sec)


if __name__ == "__main__":
    # Supervisore in-process (difesa in profondità): una QUALSIASI eccezione non
    # gestita nel loop di main() NON deve uccidere il bridge. Era il bug del
    # 2026-06-27: TimeoutExpired su jht_tmux_send propagava fuori dal while-loop
    # → processo morto e ZERO recovery (setsid detached, fuori dal respawn di
    # pid1). Qui la cattura, logga e RI-ENTRA in main(). Layer complementari:
    # (a) la guardia in jht_tmux_send degrada il caso noto a "tick saltato";
    # (b) l'agent-watchdog (maybe_respawn_bridges) respawna il processo se muore
    # del tutto (OOM/kill); (c) il Mantenitore fa il canary completo 1×/dì.
    # Vedi docs/internal/postmortems/2026-06-27-betaC-sentinel-bridge-crash.md.
    import time as _time
    import traceback as _tb
    while True:
        try:
            main()
            break  # uscita normale (main() è un loop infinito → non dovrebbe capitare)
        except KeyboardInterrupt:
            print("\n[bridge V6] interrotto.")
            break
        except Exception as _e:  # noqa: BLE001 — catch-all VOLUTO: niente morte silenziosa
            print(f"[bridge V6] FATAL nel loop: {_e} — riavvio in 5s", file=sys.stderr)
            _tb.print_exc()
            _time.sleep(5)
