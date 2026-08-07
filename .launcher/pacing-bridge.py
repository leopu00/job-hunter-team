#!/usr/bin/env python3
"""
pacing-bridge.py — tick di pacing alla SENTINELLA sul ritmo di consumo del team.

── ROLE-MAP dei bridge deterministici (vedi docs/internal/architecture/bridges.md) ──
  sentinel-bridge.py  → SENSORE usage: fetch provider ~2-10min, scrive
                        sentinel-data.jsonl, ticka la SENTINELLA ([BRIDGE TICK]).
  pacing-bridge.py    → QUESTO: report pacing ogni 15min alla SENTINELLA
                        ([BRIDGE PACING]). Il Capitano NON è pingato (pull on-demand).
  heartbeat-bridge.py → nudge orario al CAPITANO ([HEARTBEAT]); off-hours tace.

Ogni 15 minuti, allineato all'orologio (:00, :15, :30, :45 UTC), calcola:

  - Δusage del team nella finestra (dal sentinel-data.jsonl del bridge)
  - velocità del team in %/h
  - velocità ottimale per atterrare nel target band 90-95% al reset
  - per ogni agente attivo: kT consumati nei 15min, kT che vale 1% in
    questa finestra (ratio = team_kT / Δusage), divisione, %/h risultante
  - verdetto: SFORO (riduci) | MARGINE (puoi accelerare) | ALLINEATO

Tutti i calcoli riusano gli stessi moduli che alimentano la skill
agent-speed-table e la UI: nessuna formula duplicata. Pesi token Kimi
hardcoded (1, 1, 0, 0) ereditati da token-by-agent-series.

Output:
  - stdout (catturato da $JHT_HOME/logs/pacing-bridge.log)
  - tmux send alla SENTINELLA via jht-tmux-send (analista del pacing; il Capitano
    NON viene pingato — pull on-demand via rate-budget/agent-speed-table)

Non scrive su sentinel-data.jsonl (non e' un sensore, e' un report).
Singleton: kill processi pacing-bridge preesistenti gestito dallo
spawner in start-agent.sh.

Override env:
  JHT_HOME                 (default /jht_home)
  JHT_PACING_TARGET_PCT    (default 92.0 — centro del band 90-95)
  JHT_PACING_TARGET_SESSION (default SENTINELLA)
  JHT_PACING_TICK_MIN      (default 15)
  JHT_PACING_MIN_PCT_H     (default 0.20 — soglia rumore per agente)

Modi:
  python3 pacing-bridge.py            # loop infinito allineato all'orologio
  python3 pacing-bridge.py --once     # un solo tick, stampa, niente send
  python3 pacing-bridge.py --once --send  # un solo tick + send alla SENTINELLA
"""
import fcntl
import importlib.util
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path


JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
LOGS_DIR = JHT_HOME / "logs"
SENTINEL_JSONL = LOGS_DIR / "sentinel-data.jsonl"
PID_FILE = LOGS_DIR / "pacing-bridge.pid"
# Lockfile del singleton (flock), file dedicato mai cancellato: pid1 ripulisce
# il PID file al boot (cleanupStaleBridgeState) e cancellare un file flockato
# ne romperebbe la mutua esclusione. Vedi acquire_singleton_lock().
LOCK_FILE = LOGS_DIR / "pacing-bridge.lock"
# Stato pubblico del bridge, scritto atomicamente a ogni tick + al boot
# (stesso pattern del sentinel-bridge). Lo leggeva la route web
# `/api/team/pacing-bridge`, rimossa il 2026-07-25 con la dashboard locale:
# oggi il file e' consumato dall'app nativa (che lo legge via docker exec/SSH)
# e dalle skill di pacing.
STATE_FILE = LOGS_DIR / "pacing-bridge-state.json"
# Daily hard-stop (#2): flag scritto dal sentinel-bridge a cap giornaliero sforato.
# Lo leggiamo (sola lettura) per tacere come fuori orario finché il team è in standby.
DAILY_HALT_FLAG = LOGS_DIR / "daily-halt.flag"


def _daily_halt_active() -> bool:
    return DAILY_HALT_FLAG.exists()


# ── Intento di spesa dell'utente (shared/skills/burn_intent.py) ────────────
# Il flag `.burn-intent.flag` dice che l'utente ha chiesto di spingere. Va letto
# **prima** di tacere: un bridge muto è un bridge che ha già applicato l'halt.
# Il modulo viene cachato (l'import costa un exec), lo STATO no: `status()`
# rilegge il file a ogni chiamata, così una revoca vale entro un tick.
_BURN_INTENT_MOD = None


def _burn_intent():
    global _BURN_INTENT_MOD
    if _BURN_INTENT_MOD is None:
        try:
            _BURN_INTENT_MOD = _path_import(
                _shared_skills_dir() / "burn_intent.py", "_burn_intent")
        except Exception as e:  # noqa: BLE001 — fail-closed: il freno resta
            print(f"[pacing-bridge] WARN burn_intent.py not loadable: {e}",
                  file=sys.stderr, flush=True)
            return None
    return _BURN_INTENT_MOD


def _burn_intent_active() -> bool:
    """True se l'utente ha derogato agli automatismi di spesa, e la deroga non
    è scaduta. Qualunque errore → False (fail-closed, il freno resta)."""
    mod = _burn_intent()
    try:
        return bool(mod.is_active()) if mod else False
    except Exception:  # noqa: BLE001
        return False


# ── Standby a spesa zero ([TEAM-STANDBY-ZERO-SPEND]) ────────────────────────
# Col flag `.team-standby.flag` valido il pacing SOSPENDE del tutto l'invio dei
# tick: il team è fermo di proposito e ogni [BRIDGE PACING] costerebbe un turno
# di modello alla Sentinella per niente. NON derogato da BURN-INTENT: lo standby
# nasce a weekly esaurito (il muro 403), dove la deroga economica non compra
# niente — e il weekly-halt è già in NEVER_YIELDS della deroga stessa. La
# sveglia è del sentinel-bridge; qui solo silenzio. Stesso pattern del modulo
# burn_intent: cache del MODULO, mai dello stato (is_active rilegge il file).
_STANDBY_MOD = None


def _standby():
    global _STANDBY_MOD
    if _STANDBY_MOD is None:
        try:
            _STANDBY_MOD = _path_import(
                _shared_skills_dir() / "standby.py", "_standby")
        except Exception as e:  # noqa: BLE001 — fail-closed: si continua a parlare
            print(f"[pacing-bridge] WARN standby.py not loadable: {e}",
                  file=sys.stderr, flush=True)
            return None
    return _STANDBY_MOD


def _standby_active() -> bool:
    """True se il team è in standby a spesa zero (flag valido, non scaduto).
    Qualunque errore → False: la direzione sicura è NON restare muti per
    sempre (un team muto in eterno è l'incidente in forma peggiore)."""
    mod = _standby()
    try:
        return bool(mod.is_active()) if mod else False
    except Exception:  # noqa: BLE001
        return False
# Mailbox: ogni verdetto del bridge viene appeso qui, indipendentemente
# dal successo della consegna tmux a CAPITANO. Il capitano (e il dottore)
# leggono questo file per assicurarsi di non perdere verdetti quando
# tmux send fallisce con rc=3 (capitano in turno lungo, input non
# accettato). Vedi shared/skills/bridge_mailbox.py per il drain.
MAILBOX_FILE = LOGS_DIR / "bridge-mailbox.jsonl"
# Tabella temporale per-agente (consumo kT per bucket 5min, ultime 2h) che la
# Sentinella (S-07) legge per vedere i PATTERN (chi brucia, sbalzo vs deriva).
# Scritta a ogni tick dal pacing-bridge (ha gia' tba). Redesign 2026-06-13.
AGENT_TABLE_FILE = LOGS_DIR / "agent-usage-table.json"

# Sotto questo numero di minuti effettivi nella finestra (dopo aver
# isolato l'ultima session_id) il calcolo è troppo rumoroso. Salta tick.
MIN_EFFECTIVE_MIN = 5.0

# Target band center per-provider. Override globale via JHT_PACING_TARGET_PCT
# resta supportato per backward-compat (es. tuning manuale durante debug).
# Senza override: lookup dal provider attivo, fallback 92 se sconosciuto.
#
# Kimi 88% — variance osservata ±10-15% per finestra (vs Claude ±5%, Codex
# ±4%) → buffer più alto evita sforare il cap durante gli swing. Vedi
# [JHT-KIMI-OPTIMIZE] e docs/about/RESULTS.md case study #3.
# Codex/Claude 92% — default storico, calibrato dal case study Codex Pro
# (run 34.84h, proj mean 91%, observed in produzione 91-92%).
_PROVIDER_TARGET_BAND = {
    "openai":      92.0,
    "codex":       92.0,
    "codex-plus":  92.0,
    "claude":      92.0,
    "claude-max5": 92.0,
    "kimi":        88.0,
}


def _read_active_provider_for_target() -> str:
    """Provider attivo da $JHT_HOME/jht.config.json. 'openai' default su fail.

    Volutamente standalone (no import di provider_capacity) per evitare il
    cycle di dipendenze: il TARGET_BAND_CENTER viene risolto all'import-time
    del modulo, prima che _load_target_helpers() carichi pcap.
    """
    try:
        jht_home = Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))
        cfg_path = jht_home / "jht.config.json"
        with cfg_path.open(encoding="utf-8") as f:
            return (json.load(f).get("active_provider") or "openai").lower()
    except (OSError, json.JSONDecodeError):
        return "openai"


def _resolve_target_band_center() -> float:
    """Risolve il target band center applicando override env > provider map."""
    env_override = os.environ.get("JHT_PACING_TARGET_PCT")
    if env_override:
        try:
            return float(env_override)
        except ValueError:
            print(f"[pacing-bridge] WARN JHT_PACING_TARGET_PCT='{env_override}' "
                  f"non parsabile come float, uso provider map",
                  file=sys.stderr, flush=True)
    prov = _read_active_provider_for_target()
    return _PROVIDER_TARGET_BAND.get(prov, 92.0)


TARGET_BAND_CENTER = _resolve_target_band_center()
# Destinatario del [BRIDGE PACING]: la SENTINELLA (analista del pacing), NON il
# Capitano (2026-06-25, push→pull). Il Capitano non viene pingato ogni 15 min;
# riceve solo gli ordini filtrati della Sentinella e pulla on-demand (rate-budget
# / agent-speed-table) per verificare. Vedi
# docs/internal/architecture/2026-06-25-bridge-to-sentinella-pull-model.md.
TARGET_SESSION = os.environ.get("JHT_PACING_TARGET_SESSION", "SENTINELLA")
TICK_MIN = int(os.environ.get("JHT_PACING_TICK_MIN", "15"))
# Auto-recovery pipeline (2026-06-28): se il target (Sentinella) è irricettivo
# — jht-tmux-send rc=3 = "testo mai echeggiato + pane non occupato" = pane
# morta/wedged — per più tick di fila, i verdetti di pacing si perdono e la
# pipeline si ferma in SILENZIO (nessuno orchestra i worker → consumo ~0). Dopo
# questa soglia di tick consecutivi rc=3 si escala al CAPITANO (vivo), che
# applica C-08 (liveness-check Dottore → respawn). rc=4 (viva-ma-occupata) NON
# conta: turno lungo legittimo (anti-overspawn, capitano C-08bis). Caso reale
# 2026-06-28: Sentinella wedged ~1h, bridge la sapeva morta a ogni tick ma lo
# segnale moriva nel log → pipeline ferma e nessuno avvisato.
UNRECEPTIVE_ESCALATE_AFTER = int(
    os.environ.get("JHT_PACING_UNRECEPTIVE_ESCALATE_AFTER", "2"))
ESCALATION_SESSION = os.environ.get("JHT_PACING_ESCALATION_SESSION", "CAPITANO")
MIN_PCT_H = float(os.environ.get("JHT_PACING_MIN_PCT_H", "0.20"))

# Soglia in %/h sotto la quale "ALLINEATO" — evita oscillazioni stupide.
ALIGN_TOL = 0.20


def _throttle_target_for_sforo(delta_pct_h):
    """Throttle ASSOLUTO (secondi) gia' agganciato alla ladder (floor 5min),
    scalato con lo sforo %/h.

    BUG STORICO (fix 2026-06-26): gli increment vecchi (15/30/60/120) erano TUTTI
    sotto il floor 300s della ladder (THROTTLE_LADDER, 2026-06-21) → `quantize()`
    li collassava TUTTI a 300s. Risultato: il throttle NON scalava mai — un drift
    2%/h e un runaway 18%/h prendevano lo STESSO 5min. Il +120 suggerito non
    serviva a niente (sotto-floor) e la scalatura era una finzione.

    Ora ogni valore e' un GRADINO REALE della ladder: piu' sfori, piu' alto il
    gradino. La ladder governa comunque il cap a 1h. Il bridge emette il valore
    ASSOLUTO (`set <agent> N`), non un increment `+N`: `set` e' sempre assoluto
    (int('+120')==120) e il modello "increment per-tick" non ha mai funzionato."""
    d = abs(delta_pct_h or 0.0)
    if d <= 2:
        return 300    # 5 min  (floor)
    if d <= 5:
        return 600    # 10 min
    if d <= 10:
        return 900    # 15 min
    if d <= 20:
        return 1200   # 20 min
    return 1800       # 30 min


# ── Passo B SHADOW (2026-06-28): driver-in-token, LOG-ONLY ───────────────────
# Tesi utente: il vel_team su `delta_usage` (% INTERO, ±0.5%/h di quantizzazione)
# è rumore; i TOKEN sono lisci. Qui NON cambiamo il freno (resta su vel_team):
# logghiamo affianco cosa SAREBBE il throttle guidando dal rate-in-token, usando
# una `ratio` (kT per 1%) STABILE — EMA aggiornata SOLO sui tick con delta_usage
# affidabile (≥ soglia), così su un tick quantizzato (delta=1) il rate-token resta
# liscio invece di saltare. Confronto su N giorni → poi si decide il flip (slim).
# Completamente isolato: legge il dict già ritornato da compute_tick, scrive un
# jsonl a parte, mai tocca il verdetto/lo state. Vedi
# docs/internal/architecture/2026-06-28-weekly-pacing-redesign.md.
SHADOW_RATIO_MIN_DELTA = 2.0   # %-interi minimi per fidarsi del ratio del tick
SHADOW_EMA_ALPHA = 0.3         # peso del campione nuovo nell'EMA del ratio
_SHADOW_STATE = "pace-shadow-state.json"
_SHADOW_LOG = "pace-shadow.jsonl"


def _pace_shadow_log(d, now):
    """Logga (LOG-ONLY) il confronto throttle-su-%-quantizzato vs throttle-su-token.

    Mai solleva: ogni errore è ingoiato (lo shadow non deve mai disturbare il tick).
    """
    try:
        if not (isinstance(d, dict) and d.get("ok")):
            return
        delta_usage = d.get("delta_usage")
        team_kt = d.get("team_kt")
        ratio = d.get("ratio")
        vel_team = d.get("vel_team")
        vel_target = d.get("vel_target")
        window_h = (d.get("effective_window_min") or 0) / 60.0
        verdict = d.get("verdict") or {}
        if window_h <= 0 or not isinstance(team_kt, (int, float)):
            return
        state_path = LOGS_DIR / _SHADOW_STATE
        try:
            st = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            st = {}
        ratio_ema = st.get("ratio_ema")
        # Aggiorna l'EMA SOLO su campioni affidabili (delta_usage non quantizzato).
        if (isinstance(delta_usage, (int, float))
                and delta_usage >= SHADOW_RATIO_MIN_DELTA
                and isinstance(ratio, (int, float)) and ratio > 0):
            ratio_ema = (ratio if ratio_ema is None
                         else ratio_ema * (1 - SHADOW_EMA_ALPHA)
                         + ratio * SHADOW_EMA_ALPHA)
            st["ratio_ema"] = ratio_ema
            st["n"] = int(st.get("n", 0)) + 1
            try:
                state_path.write_text(json.dumps(st), encoding="utf-8")
            except OSError:
                pass
        rec = {
            "ts": now.isoformat(),
            "delta_usage_pct": delta_usage,
            "team_kt": round(team_kt, 2),
            "ratio_window_kt_per_pct": (round(ratio, 1)
                                        if isinstance(ratio, (int, float)) else None),
            "ratio_ema_kt_per_pct": (round(ratio_ema, 1)
                                     if isinstance(ratio_ema, (int, float)) else None),
            "vel_team_pct_h": (round(vel_team, 3)
                               if isinstance(vel_team, (int, float)) else None),
            "vel_target_pct_h": (round(vel_target, 3)
                                 if isinstance(vel_target, (int, float)) else None),
        }
        # Rate-in-token usando il ratio STABILE (EMA): liscio anche se delta_usage=1.
        if isinstance(ratio_ema, (int, float)) and ratio_ema > 0:
            vel_team_kt = (team_kt / window_h) / ratio_ema
            rec["vel_team_kt_pct_h"] = round(vel_team_kt, 3)
            if isinstance(vel_target, (int, float)):
                delta_kt = vel_team_kt - vel_target
                rec["delta_kt_pct_h"] = round(delta_kt, 3)
                # throttle "shadow" = solo in direzione SFORO (>0); altrimenti None.
                rec["thr_kt_s"] = (_throttle_target_for_sforo(delta_kt)
                                   if delta_kt > 0 else None)
        # throttle "attuale" come riferimento (sul delta del verdetto reale).
        vd = verdict.get("delta")
        rec["verdict_kind"] = verdict.get("kind")
        rec["thr_now_s"] = (_throttle_target_for_sforo(vd)
                            if isinstance(vd, (int, float)) and vd > 0 else None)
        with (LOGS_DIR / _SHADOW_LOG).open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, separators=(",", ":")) + "\n")
    except Exception as e:  # noqa: BLE001 — lo shadow non deve MAI rompere il tick
        print(f"[pacing-bridge] WARN shadow-log: {e}", file=sys.stderr, flush=True)


def _path_import(p: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, str(p))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _shared_skills_dir() -> Path:
    here = Path(__file__).resolve().parent
    candidates = [
        Path("/app/shared/skills"),
        here.parent / "shared" / "skills",
    ]
    p = next((c for c in candidates if c.exists()), None)
    if p is None:
        raise RuntimeError(
            f"shared/skills non trovata: ho provato {[str(c) for c in candidates]}"
        )
    return p


def _load_helpers():
    """Carica le formule dal monorepo. Funziona sia in container
    (/app/shared/skills) sia su host (<repo>/shared/skills)."""
    skills_dir = _shared_skills_dir()
    ast = _path_import(skills_dir / "agent-speed-table.py", "_ast")
    tba = _path_import(skills_dir / "token-by-agent-series.py", "_tba")
    rb = _path_import(skills_dir / "rate_budget.py", "_rb")
    return ast, tba, rb


def _load_working_hours():
    """Modulo gate working hours (decisione 2026-05-13 bot-telegram § 9).

    Caricato lazy con lo stesso pattern di _load_helpers cosi' un missing
    file → log warning ma il bridge continua a girare in modalita' 24/7
    (failsafe: meglio rumore in piu' che team fermo per gate rotto).
    """
    try:
        return _path_import(_shared_skills_dir() / "working_hours.py", "_wh")
    except Exception as e:
        print(f"[pacing-bridge] WARN working_hours.py not loadable: {e} — assuming 24/7",
              file=sys.stderr, flush=True)
        return None


def _load_target_helpers():
    """Modulo target dinamico (work_hours_target + provider_capacity).

    Sostituisce il TARGET_BAND_CENTER fisso 92% con un target che dipende
    da (a) ore ON dell'utente nella finestra 5h corrente, (b) ratio del
    provider (cap 5h / cap weekly). Vedi docs/internal/architecture/2026-05-25-work-hours-design.md.

    Failsafe: qualsiasi import error → ritorna (None, None) e il bridge
    continua col target band classico.
    """
    try:
        wht = _path_import(_shared_skills_dir() / "work_hours_target.py", "_wht")
        pcap = _path_import(_shared_skills_dir() / "provider_capacity.py", "_pcap")
        return wht, pcap
    except Exception as e:
        print(f"[pacing-bridge] WARN target helpers not loadable: {e} — using fixed target_band",
              file=sys.stderr, flush=True)
        return None, None


def _compute_dynamic_target(
    wht, pcap, now: datetime, h_to_reset: float | None,
    weekly_used_pct: float | None = None,
    weekly_reset_at_unix: float | None = None,
) -> dict:
    """Calcola il target % di finestra 5h da puntare per il tick corrente.

    Se l'algoritmo non è applicabile (helpers mancanti, h_to_reset None,
    o config 24/7 senza schedule) ritorna `current_window_target_pct =
    TARGET_BAND_CENTER` per backwards-compat completo.

    Parametri weekly-aware (fix [PACING-WEEKLY-EXHAUSTION]):
      weekly_used_pct        — % weekly cap già consumata (campo
                               `weekly_usage` del sample sentinel-bridge).
                               None → assume 0% (comportamento legacy che
                               causava il bug 24/7).
      weekly_reset_at_unix   — quando si resetta il weekly cap (campo
                               `weekly_reset_at_unix` del sample). None →
                               assume 7 giorni davanti (legacy).

    Quando ENTRAMBI presenti, `compute_target` distribuisce solo il budget
    weekly residuo sulle ore ON rimanenti fino al reset, prevenendo il
    burnout precoce visto sul VPS1 (60% weekly in 2 giorni invece di 7).

    Return dict pronto da merge nello state file:
      work_phase, current_window_target_pct, target_pct_of_weekly,
      active_hours_in_window, weekly_active_hours, weekly_remaining_pct,
      weekly_window_source, window_cap_pct_of_weekly,
      next_phase_transition_at
    """
    fallback = {
        "work_phase": "ON",
        "current_window_target_pct": TARGET_BAND_CENTER,
        "target_pct_of_weekly": None,
        "active_hours_in_window": None,
        "weekly_active_hours": None,
        "weekly_remaining_pct": None,
        "weekly_window_source": None,
        "window_cap_pct_of_weekly": None,
        "next_phase_transition_at": None,
        "target_source": "band_center",
    }
    if wht is None or pcap is None or h_to_reset is None or h_to_reset <= 0:
        return fallback
    try:
        window_end = now + timedelta(hours=h_to_reset)
        window_start = window_end - timedelta(hours=5)
        ratio = pcap.get_window_cap_pct_of_weekly()
        weekly_reset_at_utc = None
        if isinstance(weekly_reset_at_unix, (int, float)):
            try:
                weekly_reset_at_utc = datetime.fromtimestamp(
                    float(weekly_reset_at_unix), timezone.utc
                )
            except (OverflowError, OSError, ValueError):
                weekly_reset_at_utc = None
        out = wht.compute_target(
            now_utc=now,
            window_start_utc=window_start,
            window_end_utc=window_end,
            window_cap_pct_of_weekly=ratio,
            default_target_band_pct=TARGET_BAND_CENTER,
            weekly_used_pct=weekly_used_pct,
            weekly_reset_at_utc=weekly_reset_at_utc,
        )
        base = "schedule+ratio" if ratio is not None else "schedule+band"
        if out.get("weekly_window_source") == "residual_to_reset":
            base += "+weekly"
        out["target_source"] = base
        return out
    except Exception as e:
        print(f"[pacing-bridge] WARN compute_target failed: {e} — fallback band center",
              file=sys.stderr, flush=True)
        return fallback


def next_quarter(now: datetime | None = None) -> datetime:
    """Prossimo multiplo di TICK_MIN dopo `now` (UTC), allineato al minuto 0."""
    now = now or datetime.now(timezone.utc)
    minute_block = (now.minute // TICK_MIN + 1) * TICK_MIN
    if minute_block >= 60:
        return (now + timedelta(hours=1)).replace(
            minute=0, second=0, microsecond=0
        )
    return now.replace(minute=minute_block, second=0, microsecond=0)


def _read_window_samples(since_ts: float, now_ts: float):
    """Ritorna lista di (ts_unix, usage, session_id) ordinata per ts,
    SOLO quella relativa all'ULTIMA session_id presente nella finestra.

    Motivo: il bridge scrive un nuovo sample ad ogni provider tick, ma
    le sessioni Kimi (session_id) si rinnovano ogni 5h al reset → usage
    riparte da 0. Se la finestra di 15 min cattura il bordo di un reset
    (es. samples [usage=46, 0, 0, 2, 3]) calcolare Δusage = u_last - u_first
    dà valori negativi e ratio bagger. Soluzione: isoliamo solo gli
    eventi della sessione più recente vista nella finestra. Ritorna
    [] se file mancante o nessun sample.
    """
    if not SENTINEL_JSONL.exists():
        return []
    samples = []
    try:
        with SENTINEL_JSONL.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ts_iso = e.get("ts")
                if not isinstance(ts_iso, str):
                    continue
                try:
                    ts_dt = datetime.fromisoformat(
                        ts_iso.replace("Z", "+00:00")
                    )
                except ValueError:
                    continue
                if ts_dt.tzinfo is None:
                    ts_dt = ts_dt.replace(tzinfo=timezone.utc)
                ts = ts_dt.timestamp()
                if ts < since_ts or ts > now_ts:
                    continue
                u = e.get("usage")
                if not isinstance(u, (int, float)):
                    continue
                samples.append((ts, float(u), e.get("session_id")))
    except OSError:
        return []
    samples.sort(key=lambda r: r[0])
    if not samples:
        return []
    last_session = samples[-1][2]
    if last_session is None:
        # Nessun session_id (jsonl vecchio): usa tutto, accetta il rischio
        # che un reset finisca dentro la finestra una volta ogni 5h.
        return samples
    return [s for s in samples if s[2] == last_session]


def _read_throttle_events(since_ts: float, now_ts: float) -> dict[str, int]:
    """Conta gli eventi `throttle-events.jsonl` per agente nella finestra.

    Conta solo `event in {start, checkpoint}` perché ognuno corrisponde a
    UN checkpoint dell'agente:
      - `checkpoint` = arrivo a fine task con config=0 (heartbeat).
      - `start`      = arrivo a fine task con config>0 (pausa vera che parte).
      - `end`        = chiusura dello `start`, NON un nuovo checkpoint → escluso.

    La cadenza per agente (eventi/min nella finestra effettiva) è il dato
    che permette al Capitano di calibrare la durata in config:
        throttle_effettivo = cadenza_per_min × durata_config_sec / 60
    """
    path = LOGS_DIR / "throttle-events.jsonl"
    if not path.exists():
        return {}
    counts: dict[str, int] = {}
    try:
        with path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if e.get("event") not in ("start", "checkpoint"):
                    continue
                ts = e.get("ts_unix")
                if not isinstance(ts, (int, float)):
                    continue
                if ts < since_ts or ts > now_ts:
                    continue
                agent = e.get("agent")
                if not isinstance(agent, str):
                    continue
                counts[agent] = counts.get(agent, 0) + 1
    except OSError:
        return {}
    return counts


# Una finestra rate-limit PRIMARY (rolling 5h) non resetta mai a più di 5h di
# distanza: usato come clamp difensivo contro l'ambiguità di data del HH:MM.
PRIMARY_WINDOW_HOURS = 5.0


def hours_to_reset(
    reset_hhmm: str | None,
    now: datetime,
    reset_at_unix: float | None = None,
) -> float | None:
    """Ore (float) tra `now` e il prossimo reset della finestra PRIMARY 5h.

    Preferisce `reset_at_unix` (timestamp assoluto, NON ambiguo). Il fallback
    sulla stringa HH:MM è insidioso: ricostruendo la "prossima occorrenza" di
    HH:MM, subito dopo un reset `target <= now` aggiunge 1 giorno → ritorna
    ~24h invece di ~5h, gonfiando proiezioni e vel_target (bug P1: proj 421%).
    Per questo il risultato è SEMPRE clampato a [0, 5h].
    """
    # Path preferito: timestamp assoluto dal sample → nessuna ambiguità di data.
    if isinstance(reset_at_unix, (int, float)) and reset_at_unix > 0:
        hrs = (float(reset_at_unix) - now.timestamp()) / 3600.0
        return max(0.0, min(hrs, PRIMARY_WINDOW_HOURS))
    # Fallback HH:MM (ambiguo): ricostruisci la prossima occorrenza, poi clampa.
    if not reset_hhmm:
        return None
    try:
        h, m = map(int, reset_hhmm.split(":"))
    except (ValueError, AttributeError):
        return None
    target = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if target <= now:
        target = target + timedelta(days=1)
    hrs = (target - now).total_seconds() / 3600.0
    return max(0.0, min(hrs, PRIMARY_WINDOW_HOURS))


def compute_tick(ast, tba, rb, now: datetime,
                 wht=None, pcap=None) -> dict:
    """Calcola tutto il payload del tick. Ritorna dict con `ok` true/false.

    La finestra nominale è TICK_MIN minuti, ma se al suo interno cambia
    session_id Kimi (reset 5h) usiamo solo l'ultima session: questo da'
    Δusage monotona ma riduce la finestra effettiva. Se la finestra
    effettiva è < MIN_EFFECTIVE_MIN, saltiamo il tick (dati troppo
    rumorosi appena dopo un reset).
    """
    nominal_since = now - timedelta(minutes=TICK_MIN)
    now_ts = now.timestamp()
    nominal_since_ts = nominal_since.timestamp()

    # 1) Sample del bridge nella finestra, filtrati su ULTIMA session_id.
    window = _read_window_samples(nominal_since_ts, now_ts)
    if len(window) < 2:
        return {
            "ok": False,
            "now": now,
            "error": "insufficient_samples",
            "n_samples_window": len(window),
            "hint": "the bridge did not collect enough samples in the window "
                    "(or Kimi has just reset)",
        }

    effective_since_ts = window[0][0]
    effective_window_h = (now_ts - effective_since_ts) / 3600.0
    if effective_window_h * 60.0 < MIN_EFFECTIVE_MIN:
        return {
            "ok": False,
            "now": now,
            "error": "effective_window_too_short",
            "effective_min": effective_window_h * 60.0,
            "min_required": MIN_EFFECTIVE_MIN,
            "hint": "recent Kimi reset: wait for the next tick",
        }

    u_first = window[0][1]
    u_last = window[-1][1]
    n_samples = len(window)
    delta_usage = u_last - u_first

    # 2) Token per agente nella finestra EFFETTIVA (a partire da
    #    effective_since_ts, non nominal). Pesi rate-Kimi 1,1,0,0.
    by_agent = tba.collect_events(effective_since_ts)
    agent_kt = {}
    for name, evs in by_agent.items():
        kt = sum(
            w for ts, w in evs if effective_since_ts <= ts <= now_ts
        ) / 1000.0
        if kt > 0:
            agent_kt[name] = kt
    team_kt = sum(agent_kt.values())

    if delta_usage <= 0 or team_kt <= 0:
        # Carica sample sentinel anche nel path di skip — serve per
        # distinguere "team idle (PIPELINE STALLED)" da "team consuma ma
        # quantizzazione provider lo nasconde".
        sample = rb.load_last_sample() or {}
        proj = sample.get("projection")
        usage_now = sample.get("usage", u_last)
        # PIPELINE STALLED: team_kt veramente basso (workers fermi) AND
        # proiezione sotto target. In questo caso il bridge avvisa il
        # capitano di riaccendere la pipeline anche senza ratio valida —
        # senza questo escalation il sistema entra in deadlock (bridge
        # skippa, capitano non riceve nudge, team resta fermo).
        # Soglie: team_kt < 5 = "praticamente nessun consumo nel window";
        # proj < 70% = "stiamo sprecando >20% del budget alla chiusura".
        STALL_KT_THRESHOLD = 5.0
        STALL_PROJ_THRESHOLD = 70.0
        if (
            team_kt < STALL_KT_THRESHOLD
            and isinstance(proj, (int, float))
            and proj < STALL_PROJ_THRESHOLD
        ):
            # Fix #4 (STALLED weekly-aware, postmortem runaway-scaling 2026-06-07
            # Buco #1): il branch STALLED faceva return PRIMA di calcolare il
            # target weekly-aware → tick weekly-blind che diceva "spawna SCOUT"
            # anche con weekly quasi esaurito. Ora calcoliamo qui il budget
            # weekly residuo e decidiamo COAST vs riaccensione.
            h_to_reset_stall = hours_to_reset(
                sample.get("reset_at"), now, sample.get("reset_at_unix")
            )
            weekly_used = sample.get("weekly_usage")
            weekly_reset_unix = sample.get("weekly_reset_at_unix")
            ti = _compute_dynamic_target(
                wht, pcap, now, h_to_reset_stall,
                weekly_used_pct=weekly_used if isinstance(weekly_used, (int, float)) else None,
                weekly_reset_at_unix=weekly_reset_unix if isinstance(weekly_reset_unix, (int, float)) else None,
            )
            weekly_remaining_pct = ti.get("weekly_remaining_pct")
            weekly_active_hours = ti.get("weekly_active_hours")
            window_target_pct = ti.get("current_window_target_pct")
            sustainable_burn = (
                weekly_remaining_pct / weekly_active_hours
                if isinstance(weekly_remaining_pct, (int, float))
                and isinstance(weekly_active_hours, (int, float))
                and weekly_active_hours > 0
                else None
            )
            # COAST solo quando il target weekly-aware della finestra è già
            # raggiunto dall'usage corrente (budget weekly di QUESTA finestra già
            # speso — e solo se il target è davvero weekly-aware, non il fallback
            # band-center). In COAST una coda vuota NON è undershoot da riempire
            # con spawn: è coast (overspawn 2026-06-07).
            # Correzione design fix#4 (2026-06-13): RIMOSSO il floor assoluto
            # (weekly_remaining <= 8%). Obiettivo = saturare ~100% del weekly AL
            # reset, non frenare su un livello assoluto a metà/fine settimana
            # (incaglierebbe il budget). Il branch STALLED è under-pace per
            # definizione: trigger-1 (pace-aware via work_hours_target) basta.
            # Un solo freno weekly ovunque: vel_team vs vel_target.
            weekly_coast = bool(
                isinstance(window_target_pct, (int, float))
                and isinstance(usage_now, (int, float))
                and ti.get("target_source") not in (None, "band_center")
                and usage_now >= window_target_pct
            )
            return {
                "ok": False,
                "now": now,
                "error": "pipeline_stalled",
                "delta_usage": delta_usage,
                "team_kt": team_kt,
                "usage_now": usage_now,
                "proj": proj,
                "h_to_reset": h_to_reset_stall,
                "weekly_remaining_pct": weekly_remaining_pct,
                "weekly_active_hours": weekly_active_hours,
                "window_target_pct": window_target_pct,
                "sustainable_burn_pct_h": sustainable_burn,
                "weekly_coast": weekly_coast,
                "hint": (
                    "PIPELINE STALLED + WEEKLY-AWARE → COAST: the window's weekly "
                    "target is already reached and the queue is empty; do not spawn."
                    if weekly_coast else
                    "PIPELINE STALLED — few tokens consumed, projection below target, "
                    "and weekly budget available. Restart the pipeline upstream."
                ),
            }
        return {
            "ok": False,
            "now": now,
            "error": "non_positive_delta",
            "delta_usage": delta_usage,
            "team_kt": team_kt,
            "u_first": u_first,
            "u_last": u_last,
            "hint": "ratio unavailable — the team did not consume measurable "
                    "budget, or usage is flat",
        }

    ratio = team_kt / delta_usage              # kT per 1% di budget
    vel_team = delta_usage / effective_window_h  # %/h sulla finestra effettiva

    # 3) Sample fresco del bridge (proj/usage_now/reset_at).
    sample = rb.load_last_sample() or {}
    usage_now = sample.get("usage", u_last)
    proj = sample.get("projection")
    reset_at = sample.get("reset_at")
    h_to_reset = hours_to_reset(reset_at, now, sample.get("reset_at_unix"))

    # 4) Target dinamico per la finestra 5h corrente.
    #    Sostituisce il TARGET_BAND_CENTER fisso 92% con un target che
    #    dipende dalle ore ON dell'utente nella finestra e dal ratio
    #    cap-5h/cap-weekly del provider. Fallback automatico al 92% se
    #    schedule assente o ratio sconosciuto (Kimi unlimited).
    #
    #    Weekly-aware: leggi anche `weekly_usage` + `weekly_reset_at_unix`
    #    dal sample sentinel e passali al compute → la distribuzione usa
    #    il budget residuo invece di 100% pieno (fix
    #    [PACING-WEEKLY-EXHAUSTION]: senza questo, su VPS 24/7 il team
    #    bruciava 60% weekly in 2 giorni invece di spalmare su 7).
    weekly_used = sample.get("weekly_usage")
    weekly_reset_unix = sample.get("weekly_reset_at_unix")
    target_info = _compute_dynamic_target(
        wht, pcap, now, h_to_reset,
        weekly_used_pct=weekly_used if isinstance(weekly_used, (int, float)) else None,
        weekly_reset_at_unix=weekly_reset_unix if isinstance(weekly_reset_unix, (int, float)) else None,
    )
    target_pct = target_info["current_window_target_pct"]

    # 5) vel_target: (target_pct - usage_now) / hours_to_reset.
    #    Se reset_at o usage mancano, vel_target = None (verdetto N/D).
    if (
        h_to_reset is not None
        and h_to_reset > 0
        and isinstance(usage_now, (int, float))
    ):
        vel_target = max(0.0, (target_pct - usage_now) / h_to_reset)
    else:
        vel_target = None

    # 6) Per ogni agente: kT, kT/h, %/h, share, cadenza checkpoint/min.
    #    Filtra rumore < MIN_PCT_H.
    checkpoint_counts = _read_throttle_events(effective_since_ts, now_ts)
    eff_min = effective_window_h * 60.0
    agents = []
    skipped = []
    for name, kt in sorted(agent_kt.items(), key=lambda kv: -kv[1]):
        kt_per_h = kt / effective_window_h
        pct_per_h = kt_per_h / ratio
        if pct_per_h < MIN_PCT_H:
            skipped.append({"name": name, "pct_per_h": pct_per_h})
            continue
        share = (pct_per_h / vel_team) * 100.0 if vel_team > 0 else 0.0
        events = checkpoint_counts.get(name, 0)
        cadence_per_min = events / eff_min if eff_min > 0 else 0.0
        agents.append(
            {
                "name": name,
                "kt": kt,
                "kt_per_h": kt_per_h,
                "pct_per_h": pct_per_h,
                "share": share,
                "events": events,
                "cadence_per_min": cadence_per_min,
            }
        )

    # 7) Verdetto.
    if vel_target is None:
        verdict = {"kind": "ND", "delta": None, "frac_pct": None}
    else:
        delta_abs = vel_team - vel_target
        if delta_abs > ALIGN_TOL:
            frac_cut = (delta_abs / vel_team) * 100.0 if vel_team > 0 else 0.0
            verdict = {"kind": "SFORO", "delta": delta_abs, "frac_pct": frac_cut}
        elif delta_abs < -ALIGN_TOL:
            frac_grow = (
                (-delta_abs) / vel_team * 100.0 if vel_team > 0 else 0.0
            )
            verdict = {
                "kind": "MARGINE",
                "delta": -delta_abs,
                "frac_pct": frac_grow,
            }
        else:
            verdict = {"kind": "ALLINEATO", "delta": delta_abs, "frac_pct": 0.0}

    return {
        "ok": True,
        "now": now,
        "window_min": TICK_MIN,
        "effective_window_min": effective_window_h * 60.0,
        "n_samples": n_samples,
        "u_first": u_first,
        "u_last": u_last,
        "delta_usage": delta_usage,
        "team_kt": team_kt,
        "ratio": ratio,
        "vel_team": vel_team,
        "vel_target": vel_target,
        # target_band_center (92% storico) è SOLO il fallback per setup senza
        # working-hours: quando il driver è weekly-aware lo emettiamo a None per
        # non confondere (vale current_window_target_pct). I consumer web sono
        # ora nullable (route.ts/TeamOrgChart) e nessuno lo renderizza; il sentinel
        # usa current_window_target_pct. Vedi pacing-migration-plan-2026-06-05.md.
        "target_band_center": (
            None
            if target_info.get("target_source") not in (None, "band_center")
            else TARGET_BAND_CENTER
        ),
        # Target dinamico work-hours-aware (replacement di target_band_center).
        # Quando schedule e ratio sono disponibili → questo è il numero
        # effettivamente usato; altrimenti coincide con TARGET_BAND_CENTER.
        "target_pct": target_pct,
        "target_source": target_info.get("target_source"),
        "work_phase": target_info.get("work_phase"),
        "target_pct_of_weekly": target_info.get("target_pct_of_weekly"),
        "active_hours_in_window": target_info.get("active_hours_in_window"),
        "weekly_active_hours": target_info.get("weekly_active_hours"),
        "weekly_remaining_pct": target_info.get("weekly_remaining_pct"),
        "weekly_window_source": target_info.get("weekly_window_source"),
        "window_cap_pct_of_weekly": target_info.get("window_cap_pct_of_weekly"),
        "next_phase_transition_at": target_info.get("next_phase_transition_at"),
        "usage_now": usage_now,
        "proj": proj,
        "reset_at": reset_at,
        "h_to_reset": h_to_reset,
        "agents": agents,
        "skipped": skipped,
        "verdict": verdict,
    }


def format_message(d: dict) -> str:
    """Costruisce la riga unica da inviare al Capitano. Single-line per non
    rompere l'Enter delle TUI Ink (Kimi/Claude/Codex), parsabile dall'LLM."""
    if not d.get("ok"):
        why = d.get("error", "unknown")
        # PIPELINE STALLED: messaggio attivo (non solo "tick saltato") con
        # comando esplicito per il capitano. Triggerato quando team_kt < 5
        # e proj < 70% — vedi compute_projection.
        if why == "pipeline_stalled":
            usage_now = d.get("usage_now", "?")
            proj = d.get("proj", "?")
            proj_str = f"{proj:.0f}%" if isinstance(proj, (int, float)) else str(proj)
            h_to_reset = d.get("h_to_reset")
            h_str = f"{h_to_reset:.2f}h" if isinstance(h_to_reset, (int, float)) else "?"
            wrem = d.get("weekly_remaining_pct")
            wrem_str = f"{wrem:.0f}%" if isinstance(wrem, (int, float)) else "?"
            wah = d.get("weekly_active_hours")
            wah_str = f"{wah:.0f}h" if isinstance(wah, (int, float)) else "?"
            sb = d.get("sustainable_burn_pct_h")
            sb_str = f"{sb:.2f}%/h" if isinstance(sb, (int, float)) else "?"
            weekly_line = (
                f"weekly_remaining={wrem_str} weekly_active_hours={wah_str} "
                f"sustainable_burn={sb_str}"
            )
            # Fix #4: a coda vuota con weekly binding la mossa è COAST, non spawn
            # (overspawn 2026-06-07). Il verbo del nudge cambia in base al weekly.
            if d.get("weekly_coast"):
                return (
                    f"[BRIDGE PACING] PIPELINE STALLED + WEEKLY-BIND → COAST — "
                    f"usage={usage_now}% proj={proj_str} reset_in={h_str} "
                    f"team_kt={d.get('team_kt', 0):.1f} {weekly_line}. The queue is empty BUT "
                    f"the weekly budget is nearly exhausted: COAST instead of spawning. "
                    f"Do NOT spawn workers just to fill the queue; that repeats the 2026-06-07 "
                    f"overspawn. Let the current team drain the remaining queue and keep the "
                    f"throttle. If a worker is stuck at a rate-limit dialog, kill and respawn "
                    f"it (C-12), but do not add workers. Reopen the full pipeline only after "
                    f"the weekly reset or when weekly_remaining rises."
                )
            return (
                f"[BRIDGE PACING] PIPELINE STALLED — usage={usage_now}% "
                f"proj={proj_str} reset_in={h_str} team_kt={d.get('team_kt', 0):.1f} "
                f"{weekly_line} (almost no consumption in 15m; weekly budget is available). "
                f"Apply EMPTY PIPELINE + UNDERSHOOT NOW: (1) run db_query.py "
                f"next-for-scrittore for the residual queue and 40–49 promotions; (2) spawn "
                f"SCOUT when the range is empty; (3) run ANALISTA for unanalyzed companies; "
                f"(4) run SCORER for unscored positions; (5) run SCRITTORE when the scored>=50 "
                f"queue fills. Do NOT wait for the next valid tick: the bridge cannot calculate "
                f"a ratio without consumption, and you cannot wait without a pipeline."
            )
        extra = ""
        if "delta_usage" in d:
            extra = f" delta_usage={d['delta_usage']} team_kt={d.get('team_kt', '?')}"
        return f"[BRIDGE PACING] tick saltato reason={why}{extra}."

    ts = d["now"].strftime("%Y-%m-%d %H:%M UTC")
    usage_now = d["usage_now"]
    proj = d["proj"] if d["proj"] is not None else "?"
    reset_at = d["reset_at"] or "?"
    h_to_reset = d["h_to_reset"]
    h_str = f"{h_to_reset:.2f}h" if isinstance(h_to_reset, (int, float)) else "?"

    eff = d["effective_window_min"]
    eff_str = (
        f"{d['window_min']}m"
        if abs(eff - d["window_min"]) < 0.5
        else f"{d['window_min']}m ({eff:.1f}m effective, post-reset session)"
    )
    parts = [
        f"[BRIDGE PACING] {ts} window={eff_str} samples={d['n_samples']}",
        f"usage={usage_now}% reset_in={h_str} reset_at={reset_at} "
        f"(proj={proj}% — INFO, volatile secondary signal: do NOT use it "
        f"for decisions; compare vel_team with vel_target)",
        f"vel_team={d['vel_team']:.2f}%/h",
    ]

    if d["vel_target"] is not None:
        # Quando il target è work-hours-aware mostriamo il valore effettivo
        # invece del band center fisso: il Capitano sa che il bridge sta
        # puntando es. al 75% anziché al 92% perché l'utente lavora 9-18.
        target_pct = d.get("target_pct")
        if target_pct is None:
            target_pct = d.get("target_band_center") or TARGET_BAND_CENTER
        src = d.get("target_source") or "band_center"
        src_tag = (
            ""
            if src == "band_center"
            else f" [{src} phase={d.get('work_phase', '?')}]"
        )
        parts.append(
            f"vel_target={d['vel_target']:.2f}%/h "
            f"(to finish at {target_pct:.0f}% at reset){src_tag}"
        )
    else:
        parts.append("vel_target=N/D")

    # Vincolo WEEKLY parallelo alla finestra 5h (fix #4 — contratto C-09/S-06):
    # esponi weekly_remaining_pct e weekly_active_hours nel tick così Capitano e
    # Sentinella possono calcolare il burn sostenibile (%/h ATTIVO) e proj_weekly
    # senza inventarsi i numeri. Senza questo il primary 5h sembra ok mentre il
    # weekly brucia silenziosamente (scenario HALT-WEEKLY 2026-05-21 / 2026-06-07).
    wrem = d.get("weekly_remaining_pct")
    if isinstance(wrem, (int, float)):
        wah = d.get("weekly_active_hours")
        wah_str = f"{wah:.0f}h" if isinstance(wah, (int, float)) else "?"
        sb = (
            wrem / wah
            if isinstance(wah, (int, float)) and wah > 0
            else None
        )
        sb_str = f"{sb:.2f}%/active-hour" if isinstance(sb, (int, float)) else "?"
        parts.append(
            f"weekly_remaining={wrem:.0f}% weekly_active_hours={wah_str} "
            f"(sustainable burn {sb_str}) — parallel WEEKLY constraint, "
            f"binding in Phase 1 too (S-06/C-09)"
        )

    # NB: il dato weekly_pace (rate weekly reale vs sostenibile + lockout
    # anticipato) NON va in questo messaggio al CAPITANO: andrebbe a bypassare
    # il ruolo analitico della Sentinella (il bug stesso dell'indagine). Va nel
    # [BRIDGE TICK] alla Sentinella (S-07) che lo elabora e CONSIGLIA il Capitano.
    # Qui il pacing-tick resta sul primary 5h. Il campo `weekly_pace` e' comunque
    # nel tick-dict + stato (lo legge il sentinel-bridge per la Sentinella).

    parts.append(
        f"ratio={d['ratio']:.1f}kT/% "
        f"(team {d['team_kt']:.2f}kT / Δusage {d['delta_usage']:.2f}%)"
    )

    if d["agents"]:
        # Usa il minuti effettivi (= finestra di calcolo reale) nel
        # dettaglio per agente, così il Capitano vede la divisione esatta.
        eff_min_str = f"{int(round(eff))}m"
        agent_strs = []
        for a in d["agents"]:
            cad = a.get("cadence_per_min", 0.0)
            agent_strs.append(
                f"{a['name']}={a['pct_per_h']:.2f}%/h "
                f"[{a['kt']:.2f}kT/{eff_min_str} → {a['kt_per_h']:.1f}kT/h "
                f"÷ {d['ratio']:.1f}kT/% = {a['pct_per_h']:.2f}%/h, "
                f"share {a['share']:.0f}%, "
                f"cadence {cad:.2f}/min ({a.get('events', 0)} checks in {eff_min_str})]"
            )
        parts.append("agents: " + " ; ".join(agent_strs))
    else:
        parts.append("agents: none above threshold "
                     f"({MIN_PCT_H}%/h)")

    if d["skipped"]:
        skipped_names = ", ".join(s["name"] for s in d["skipped"])
        parts.append(f"below_threshold: {skipped_names}")

    v = d["verdict"]
    # Damping anti-oscillazione: il capitano risponde con interventi binari
    # (throttle 30s o reset 0s) → fract_pct grandi causano swing ±50% tra
    # tick adiacenti. Cap a 25% e suggerisci correzione GRADUALE solo sul
    # top consumer, mai tutto-il-team o reset globale. Identifica il
    # nome dell'agente con kt-share massima per nominalizzarlo nel verdict.
    cap_pct = min(25.0, float(v.get("frac_pct") or 0))
    # Top consumer per il throttle hint: escludi sempre gli agenti di
    # monitoring (sentinella, sentinella-worker) e l'?unknown — non sono
    # worker produttivi, throttllarli non serve a nulla. Caso 04:44:
    # share era 100% sentinella ma il vero problema era pipeline vuota.
    # Agenti NON throttle-target: monitoring (sentinella, sentinella-worker),
    # coordinator (capitano), meta (mentor), unattributed (?unknown).
    # Throttllare il capitano rallenta l'intera orchestrazione, throttllare
    # sentinella ferma il monitoring. I throttle vanno SEMPRE su worker
    # produttivi: scout, analista, scorer, scrittore, critico.
    NON_PRODUCTIVE = {
        "sentinella", "sentinella-worker", "capitano", "mentor", "?unknown",
    }
    top_consumer = None
    top_agent = None
    if d.get("agents"):
        productive = [a for a in d["agents"] if a.get("name") not in NON_PRODUCTIVE]
        # Se NON ci sono agenti produttivi, top_consumer resta None — il
        # verdict text userà il placeholder "<top-consumer-produttivo>".
        # Mai suggerire di throttle sentinella, anche come fallback: se solo
        # sentinella consuma, il problema vero è che non ci sono worker.
        if productive:
            sorted_agents = sorted(
                productive, key=lambda a: a.get("share", 0) or 0, reverse=True,
            )
            top_agent = sorted_agents[0]
            top_consumer = top_agent.get("name")
    top_hint = f" (top consumer: {top_consumer})" if top_consumer else ""
    # Burner NON produttivo: cadenza ~0 + share alto = brucia senza check utili
    # (es. Dottore one-shot liveness — 35%/0-check nell'incidente; scout a vuoto).
    # Throttllarlo NON serve (e' one-shot/non-loop): meglio kill+respawn (C-12).
    non_producing = (
        top_agent is not None
        and (top_agent.get("cadence_per_min") or 0) < 0.02
        and (top_agent.get("share") or 0) >= 25
    )
    if v["kind"] == "SFORO":
        thr = _throttle_target_for_sforo(v["delta"])
        if top_consumer and non_producing:
            # P4 (2026-06-13): cadenza~0 + share alto NON e' sempre "stuck" — puo'
            # essere UN task lungo/costoso in corso (es. enrichment di 1 posizione:
            # HTTP+JD+geocoding+salary, minuti senza checkpoint). NON KILLare al
            # primo rilevamento: KILL solo se persiste (ancora cadenza~0 al tick
            # successivo) = davvero stuck. Evita il falso positivo del KILL+respawn.
            cmd = (
                f"CHECK {top_consumer}: it consumes {top_agent.get('share', 0):.0f}% "
                f"with near-zero cadence. If it is handling ONE long enrichment task, let it "
                f"finish. If cadence is still near zero on the NEXT tick, it is stuck: "
                f"KILL and respawn it (C-12; throttling will not fix it)"
            )
        elif top_consumer:
            cmd = f"throttle-config.py set {top_consumer} {thr}"
        else:
            cmd = f"throttle-config.py set <top-consumer-produttivo> {thr}"
        parts.append(
            f"VERDICT: OVERSHOOT +{v['delta']:.2f}%/h → -{cap_pct:.0f}%"
            f"{top_hint} | CMD: {cmd} | NO global reset, NO throttle a tutti"
        )
    elif v["kind"] == "MARGINE":
        # Sotto-pace: TOGLI il freno (set 0). Il vecchio `-{thr}` era rotto:
        # `set` e' assoluto e rifiuta i negativi → il comando suggerito andava in
        # errore. Per scendere di UN gradino serve il valore corrente (che il
        # bridge non legge): la mossa onesta a coda lenta e' azzerare il throttle
        # del top consumer (o spawnare 1 agente). Decide il Capitano.
        cmd = (
            f"throttle-config.py set {top_consumer} 0"
            if top_consumer else
            "throttle-config.py set <top-consumer-produttivo> 0"
        )
        parts.append(
            f"VERDICT: HEADROOM -{v['delta']:.2f}%/h → +{cap_pct:.0f}%"
            f"{top_hint} | CMD: {cmd} (or spawn one agent) | "
            f"NO global reset"
        )
    elif v["kind"] == "ALLINEATO":
        parts.append(
            f"VERDICT: ALIGNED (Δ {v['delta']:+.2f}%/h, tolerance ±{ALIGN_TOL}). "
            f"Maintain the current pace."
        )
    else:
        parts.append(
            "VERDICT: N/A — reset_at or usage_now is missing from the bridge sample."
        )

    return " | ".join(parts)


_JHT_TMUX_SEND_FALLBACKS = [
    # Path canonico post-refactor 2026-05-13 (colocate sotto skill).
    "/app/agents/_skills/tmux-send/jht-tmux-send",
    str(
        Path(__file__).resolve().parent.parent
        / "agents" / "_skills" / "tmux-send" / "jht-tmux-send"
    ),
]


def _resolve_tmux_send() -> str | None:
    """Prima prova `jht-tmux-send` nel PATH, poi i path canonici. Restituisce
    il primo eseguibile esistente, o None. Senza questo lo spawn detached
    perdeva il PATH ereditato dal container e il send falliva silenziosamente."""
    for cand in ["jht-tmux-send", *_JHT_TMUX_SEND_FALLBACKS]:
        if "/" in cand:
            if Path(cand).is_file() and os.access(cand, os.X_OK):
                return cand
        else:
            # solo nome → cerca nel PATH
            for p in os.environ.get("PATH", "").split(os.pathsep):
                full = os.path.join(p, cand)
                if Path(full).is_file() and os.access(full, os.X_OK):
                    return full
    return None


def send_to_capitano(msg: str) -> int:
    """Invia il verdetto alla sessione target (TARGET_SESSION = Sentinella).

    Ritorna il returncode di jht-tmux-send così il loop può distinguere i casi:
      0  → consegnato
      3  → irricettiva (testo mai echeggiato, pane non occupato) = possibile morta/wedged
      4  → viva ma occupata (turno in corso) → NON è morta, NON escalare
      -1 → infra (binario assente / sparito / timeout)
    """
    cmd_path = _resolve_tmux_send()
    if cmd_path is None:
        print(
            "[pacing-bridge] jht-tmux-send not found in PATH or fallback locations "
            f"({_JHT_TMUX_SEND_FALLBACKS}); skipping send",
            file=sys.stderr,
        )
        return -1
    try:
        r = subprocess.run(
            [cmd_path, TARGET_SESSION, msg],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except FileNotFoundError:
        print(f"[pacing-bridge] {cmd_path} disappeared between resolution and execution",
              file=sys.stderr)
        return -1
    except subprocess.TimeoutExpired:
        print("[pacing-bridge] jht-tmux-send timed out after 30s", file=sys.stderr)
        return -1
    if r.returncode != 0:
        print(
            f"[pacing-bridge] jht-tmux-send rc={r.returncode} "
            f"stderr={r.stderr.strip()}",
            file=sys.stderr,
        )
    return r.returncode


def escalate_mute_to_capitano(streak: int) -> bool:
    """Notifica il CAPITANO che il target è "vivo ma muto" (rc=5) da `streak` tick.

    Diverso da rc=3 per DIAGNOSI e per CURA. rc=3 = pane irricettiva → può
    finire in respawn. rc=5 = la TUI accetta il testo e ignora l'Enter: il pane
    è vivo, ha solo una riga appesa nel composer. Respawnarlo butterebbe via un
    agente sano; la cura è sbloccarlo. Serve un canale separato perché rc=5 è
    uno stato PERSISTENTE — resta finché qualcuno non interviene — mentre rc=4
    (occupato) si risolve da solo a fine turno.
    """
    cmd_path = _resolve_tmux_send()
    if cmd_path is None:
        return False
    msg = (
        f"[BRIDGE] {TARGET_SESSION} has been ALIVE BUT SILENT for {streak} consecutive ticks "
        f"(jht-tmux-send rc=5: text entered in the composer, but Enter was never processed). "
        f"Pacing ticks are NOT reaching it and the condition will NOT clear itself. Do NOT "
        f"respawn it: the pane is alive and in-progress work would be lost. Inspect the pane "
        f"(tmux capture-pane -t {TARGET_SESSION} -p | tail -8), clear its prompt, and restart "
        f"the loop with a real message. Consider it resolved only after seeing "
        f"'esc to interrupt' in the pane. "
        f"Log: {LOGS_DIR}/pacing-bridge.log"
    )
    try:
        r = subprocess.run(
            [cmd_path, ESCALATION_SESSION, msg],
            capture_output=True, text=True, timeout=30,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    if r.returncode != 0:
        print(
            f"[pacing-bridge] SILENT escalation to {ESCALATION_SESSION} failed "
            f"rc={r.returncode} stderr={r.stderr.strip()}",
            file=sys.stderr,
        )
        return False
    print(
        f"[pacing-bridge] SILENT ESCALATION → {ESCALATION_SESSION}: "
        f"{TARGET_SESSION} silent for {streak} ticks",
        file=sys.stderr,
    )
    return True


def escalate_unreceptive_to_capitano(streak: int) -> bool:
    """Notifica il CAPITANO che il target pacing è irricettivo da `streak` tick.

    Inviata al CAPITANO (vivo, hardcoded ESCALATION_SESSION), NON al target
    morto. Il Capitano applica C-08: liveness-check via Dottore e, se confermata
    morta/wedged, respawn. Best-effort: un fallimento non rompe il loop.
    """
    cmd_path = _resolve_tmux_send()
    if cmd_path is None:
        return False
    msg = (
        f"[BRIDGE] {TARGET_SESSION} has rejected input for {streak} consecutive ticks "
        f"(jht-tmux-send rc=3: text was never echoed and the pane was not busy). Pacing ticks "
        f"are NOT reaching it, the pipeline is stopped, and no workers are being orchestrated. "
        f"Apply C-08: run a Dottore liveness check and, if it is dead or wedged, respawn it "
        f"(bash /app/.launcher/start-agent.sh {TARGET_SESSION.lower()}). This is not rc=4 "
        f"(alive and busy); the pane is not accepting input. Log: {LOGS_DIR}/pacing-bridge.log"
    )
    try:
        r = subprocess.run(
            [cmd_path, ESCALATION_SESSION, msg],
            capture_output=True, text=True, timeout=30,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    if r.returncode != 0:
        print(
            f"[pacing-bridge] escalation to {ESCALATION_SESSION} failed "
            f"rc={r.returncode} stderr={r.stderr.strip()}",
            file=sys.stderr,
        )
        return False
    print(
        f"[pacing-bridge] ESCALATION → {ESCALATION_SESSION}: {TARGET_SESSION} "
        f"unreceptive for {streak} ticks (liveness check and respawn requested)",
        flush=True,
    )
    return True


def append_to_mailbox(msg: str, delivered_via_tmux: bool, kind: str | None = None) -> None:
    """Appende il verdetto alla mailbox JSONL. Best-effort, non rompe il
    loop in caso di errore I/O. Schema:
        {"ts": ISO, "kind": "tick|stalled|skip", "delivered_via_tmux": bool,
         "msg": "...intera riga del verdetto..."}
    """
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "kind": kind or "tick",
            "delivered_via_tmux": delivered_via_tmux,
            "msg": msg,
        }
        with MAILBOX_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, separators=(",", ":")) + "\n")
    except OSError as e:
        print(f"[pacing-bridge] WARN append mailbox: {e}", file=sys.stderr)


# Il fd del lock resta aperto per tutta la vita del processo: è il possesso
# del fd a tenere il flock.
_LOCK_FH = None


def acquire_singleton_lock():
    """Singleton ATOMICO via flock + scrittura del PID file.

    Il PID file da solo non basta (e qui non veniva nemmeno riletto): due
    pacing-bridge lanciati in parallelo si sovrascrivevano il pid a vicenda e
    giravano entrambi, raddoppiando i [BRIDGE PACING] alla Sentinella. flock è
    atomico e si rilascia da solo alla morte del processo, anche su SIGKILL.
    """
    global _LOCK_FH
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        fh = open(LOCK_FILE, "a+", encoding="utf-8")
    except OSError as e:
        print(f"[pacing-bridge] WARN lockfile: {e} — continuing without a lock", file=sys.stderr)
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
        print(f"[pacing-bridge] altra istanza viva (pid={other}), exit")
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
        PID_FILE.write_text(str(os.getpid()))
    except OSError as e:
        print(f"[pacing-bridge] WARN write pid: {e}", file=sys.stderr)


def _serialize_report(d: dict) -> dict | None:
    """Trasforma il dict di compute_tick in un payload JSON-safe per la UI.
    Drop dei datetime e arrotondamento dei numeri per leggibilità nel popover."""
    if not d.get("ok"):
        return {
            "ok": False,
            "error": d.get("error"),
            "hint": d.get("hint"),
            "ts": d["now"].isoformat() if isinstance(d.get("now"), datetime) else None,
        }
    agents = [
        {
            "name": a["name"],
            "kt": round(a["kt"], 2),
            "kt_per_h": round(a["kt_per_h"], 1),
            "pct_per_h": round(a["pct_per_h"], 2),
            "share": round(a["share"], 1),
            "events": a.get("events", 0),
            "cadence_per_min": round(a.get("cadence_per_min", 0.0), 3),
        }
        for a in d["agents"]
    ]
    skipped = [s["name"] for s in d.get("skipped", [])]
    v = d["verdict"]
    verdict = {
        "kind": v["kind"],
        "delta": round(v["delta"], 2) if isinstance(v.get("delta"), (int, float)) else None,
        "frac_pct": round(v["frac_pct"], 1) if isinstance(v.get("frac_pct"), (int, float)) else None,
    }
    return {
        "ok": True,
        "ts": d["now"].isoformat(),
        "window_min": d["window_min"],
        "effective_window_min": round(d["effective_window_min"], 1),
        "n_samples": d["n_samples"],
        "usage_now": d["usage_now"],
        "proj": d["proj"],
        "reset_at": d["reset_at"],
        "h_to_reset": round(d["h_to_reset"], 2) if d["h_to_reset"] else None,
        "delta_usage": round(d["delta_usage"], 2),
        "team_kt": round(d["team_kt"], 2),
        "ratio_kt_per_pct": round(d["ratio"], 1),
        "vel_team": round(d["vel_team"], 2),
        "vel_target": round(d["vel_target"], 2) if d["vel_target"] else None,
        "target_band_center": d["target_band_center"],
        # Work-hours-aware fields (None = fallback al band center classico).
        "target_pct": d.get("target_pct"),
        "target_source": d.get("target_source"),
        "work_phase": d.get("work_phase"),
        "target_pct_of_weekly": (
            round(d["target_pct_of_weekly"], 2)
            if isinstance(d.get("target_pct_of_weekly"), (int, float))
            else None
        ),
        "active_hours_in_window": d.get("active_hours_in_window"),
        "weekly_active_hours": d.get("weekly_active_hours"),
        "weekly_remaining_pct": d.get("weekly_remaining_pct"),
        "weekly_window_source": d.get("weekly_window_source"),
        "window_cap_pct_of_weekly": d.get("window_cap_pct_of_weekly"),
        "next_phase_transition_at": d.get("next_phase_transition_at"),
        "agents": agents,
        "skipped": skipped,
        "verdict": verdict,
    }


def write_state(
    d: dict | None,
    next_tick_at: datetime,
    last_message: str | None,
    wht=None,
    pcap=None,
):
    """Scrive lo stato pubblico letto dall'API web. Atomico (tmp + rename).

    I campi work-hours-aware vengono SEMPRE popolati quando wht/pcap sono
    disponibili — non dipendono dal sample sentinel, sono pure funzioni di
    `now + schedule`. Così la UI vede phase/target/transition anche durante
    tick saltati (insufficient_samples, effective_window_too_short).
    """
    now = datetime.now(timezone.utc)
    work_phase = d.get("work_phase") if d else None
    target_pct = d.get("target_pct") if d else None
    target_source = d.get("target_source") if d else None
    next_trans = d.get("next_phase_transition_at") if d else None
    win_ratio = d.get("window_cap_pct_of_weekly") if d else None

    # Fallback: ricomputa standalone se mancano (es. tick saltato).
    if work_phase is None and wht is not None and pcap is not None:
        try:
            # Finestra placeholder allineata all'ora corrente. Buono per
            # i campi schedule-driven (phase, transition, ratio); il target
            # numerico dipende dalla finestra "vera" che qui non abbiamo
            # ancora — accettiamo il placeholder.
            ws = now.replace(minute=0, second=0, microsecond=0)
            we = ws + timedelta(hours=5)
            ratio = pcap.get_window_cap_pct_of_weekly()
            t = wht.compute_target(
                now_utc=now,
                window_start_utc=ws,
                window_end_utc=we,
                window_cap_pct_of_weekly=ratio,
                default_target_band_pct=TARGET_BAND_CENTER,
            )
            work_phase = t["work_phase"]
            target_pct = t["current_window_target_pct"]
            target_source = (
                "band_center" if ratio is None and t["weekly_active_hours"] >= 168.0
                else ("schedule+ratio" if ratio is not None else "schedule+band")
            )
            next_trans = t["next_phase_transition_at"]
            win_ratio = t["window_cap_pct_of_weekly"]
        except Exception as e:
            print(f"[pacing-bridge] WARN write_state target fallback: {e}",
                  file=sys.stderr)

    state = {
        "version": 1,
        "pid": os.getpid(),
        "updated_at": now.isoformat(),
        "next_tick_at": next_tick_at.isoformat(),
        "tick_interval_min": TICK_MIN,
        "target_band_center": TARGET_BAND_CENTER,
        "target_session": TARGET_SESSION,
        "last_tick_at": (
            d["now"].isoformat() if d and isinstance(d.get("now"), datetime) else None
        ),
        "last_report": _serialize_report(d) if d else None,
        "last_message": last_message,
        # Top-level mirror dei campi work-hours-aware (sempre popolati se
        # wht/pcap disponibili, anche durante tick saltati).
        "work_phase": work_phase,
        "current_window_target_pct": target_pct,
        "target_source": target_source,
        "next_phase_transition_at": next_trans,
        "window_cap_pct_of_weekly": win_ratio,
    }
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        # PID nel nome del tmp per evitare race se piu' istanze del bridge
        # girano in parallelo brevemente (es. dopo restart manuale prima
        # che il vecchio sia uscito). Senza il suffix PID due processi che
        # creano lo stesso .tmp e fanno os.replace possono perdersi il
        # rename → "No such file" sull'instance perdente.
        tmp = STATE_FILE.with_suffix(f".json.tmp.{os.getpid()}")
        tmp.write_text(json.dumps(state, default=str))
        os.replace(tmp, STATE_FILE)
    except OSError as e:
        print(f"[pacing-bridge] WARN write state: {e}", file=sys.stderr)


def loop():
    ast, tba, rb = _load_helpers()
    wh = _load_working_hours()
    wht, pcap = _load_target_helpers()
    acquire_singleton_lock()
    print(
        f"[pacing-bridge] up — target={TARGET_SESSION} tick={TICK_MIN}m "
        f"target_band_center={TARGET_BAND_CENTER}% min_pct_h={MIN_PCT_H} "
        f"jht_home={JHT_HOME}",
        flush=True,
    )
    # Stato iniziale al boot: la UI vede subito il countdown, anche prima
    # del primo tick reale.
    write_state(None, next_quarter(), None, wht=wht, pcap=pcap)

    # Tick consecutivi con target irricettivo (rc=3) → soglia → escalation.
    unreceptive_streak = 0
    # Tick consecutivi con target "vivo ma muto" (rc=5) → soglia → escalation
    # SEPARATA: stessa invisibilità, cura opposta (sbloccare, non respawnare).
    mute_streak = 0

    while True:
        nxt = next_quarter()
        sleep_s = (nxt - datetime.now(timezone.utc)).total_seconds()
        if sleep_s > 0:
            time.sleep(sleep_s)

        now = datetime.now(timezone.utc)
        # Standby a spesa zero: PRIMA di ogni altro gate, e senza deroghe.
        # Nemmeno si calcola il tick: non c'è nessuno che debba riceverlo,
        # e la sveglia è del sentinel-bridge (che continua a campionare).
        if _standby_active():
            print(f"[pacing-bridge] standby skip tick {now.isoformat()}", flush=True)
            write_state(None, next_quarter(now + timedelta(seconds=1)),
                        "standby (zero-spend team)", wht=wht, pcap=pcap)
            continue
        # Intento dell'utente letto UNA volta, in testa al tick: sotto, i due
        # gate di spesa lo consultano prima di decidere di tacere.
        burn_intent_on = _burn_intent_active()
        # Working hours gate: fuori finestra il Capitano resta dormiente
        # (no tick, no mailbox append). Decisione 2026-05-13: pausa = anche
        # niente notifiche. La UI vede l'off-hours dallo state file.
        # Il gate orario è un automatismo di SPESA (spalma il weekly sulle ore
        # attive), non un freno di sicurezza: con BURN-INTENT attivo l'utente ha
        # deciso di lavorare adesso, e il pacing continua a misurare e riferire.
        if wh is not None and not wh.is_within_working_hours(now) and not burn_intent_on:
            status = wh.describe_status(now)
            print(f"[pacing-bridge] off-hours skip tick {now.isoformat()} ({status})",
                  flush=True)
            write_state(None, next_quarter(now + timedelta(seconds=1)),
                        f"off-hours ({status})", wht=wht, pcap=pcap)
            continue
        # Daily hard-stop (#2): team in standby per sforo del cap giornaliero →
        # il pacing tace come fuori orario. Solo il sentinel-bridge toglie il flag.
        # BURN-INTENT: l'utente ha derogato al cap giornaliero → il pacing NON
        # tace. Tacere qui significherebbe lasciare il coordinatore senza la
        # misura proprio nell'ora in cui è l'unico responsabile del consumo.
        if _daily_halt_active() and not burn_intent_on:
            print(f"[pacing-bridge] daily-halt skip tick {now.isoformat()}", flush=True)
            write_state(None, next_quarter(now + timedelta(seconds=1)),
                        "daily-halt (daily cap exceeded)", wht=wht, pcap=pcap)
            continue
        if burn_intent_on and _daily_halt_active():
            print(f"[pacing-bridge] BURN-INTENT: daily-halt present but overridden "
                  f"by the user → regular tick {now.isoformat()}", flush=True)
        try:
            d = compute_tick(ast, tba, rb, now, wht=wht, pcap=pcap)
            msg = format_message(d)
            print(msg, flush=True)
            rc = send_to_capitano(msg)
            delivered = (rc == 0)
            # Mailbox SEMPRE: anche quando tmux send fallisce (rc=3 perche'
            # capitano in turno lungo) il verdetto resta consultabile dal
            # capitano via bridge_mailbox.py drain. Risolve il problema
            # osservato 7+ volte in 12h: bridge calcola, tenta delivery,
            # fallisce, verdetto perso → drift senza correzione.
            kind = "stalled" if (d and d.get("error") == "pipeline_stalled") \
                   else ("skip" if (d and not d.get("ok")) else "tick")
            append_to_mailbox(msg, delivered_via_tmux=delivered, kind=kind)
            # Aggiorna lo stato DOPO il send: la UI vede il tick appena
            # consegnato e il prossimo countdown già aggiornato.
            write_state(d, next_quarter(now + timedelta(seconds=1)), msg,
                        wht=wht, pcap=pcap)
            # Tabella temporale per-agente (2h/5min) per la Sentinella (S-07).
            write_agent_usage_table(tba, now)
            # Passo B SHADOW (log-only): confronto throttle %-quantizzato vs token.
            _pace_shadow_log(d, now)
            # Auto-recovery pipeline: target irricettivo (rc=3 = pane
            # morta/wedged) per ≥ soglia tick consecutivi → escala al CAPITANO
            # (vivo) per liveness-check + respawn. Solo rc=3 conta come "forse
            # morta": rc=0 (consegnato) e rc=4 (viva-occupata) azzerano lo streak
            # (anti-overspawn). Cooldown: azzero dopo l'escalation → ri-avviso
            # solo dopo altri N tick se ancora giù.
            if rc == 3 and TARGET_SESSION != ESCALATION_SESSION:
                unreceptive_streak += 1
                if unreceptive_streak >= UNRECEPTIVE_ESCALATE_AFTER:
                    escalate_unreceptive_to_capitano(unreceptive_streak)
                    unreceptive_streak = 0
            elif rc != 3:
                unreceptive_streak = 0
            # rc=5 ("vivo ma muto") ha uno streak SUO. Contarlo insieme a rc=0
            # e rc=4 — come faceva questo blocco prima — lo trattava come tick
            # consegnato: lo streak si azzerava, lo stato veniva riscritto col
            # countdown avanzato, e un target muto per ore restava invisibile
            # nei log. Non è rc=3 (che può portare a respawn) e non è rc=4
            # (che si risolve a fine turno): è persistente e va sbloccato.
            if rc == 5 and TARGET_SESSION != ESCALATION_SESSION:
                mute_streak += 1
                if mute_streak >= UNRECEPTIVE_ESCALATE_AFTER:
                    escalate_mute_to_capitano(mute_streak)
                    mute_streak = 0
            elif rc != 5:
                mute_streak = 0
        except Exception as e:
            # Non vogliamo che un errore di un tick affossi il loop.
            print(f"[pacing-bridge] tick error {now.isoformat()}: {e}",
                  file=sys.stderr, flush=True)
            try:
                write_state(None, next_quarter(now + timedelta(seconds=1)),
                            f"error: {e}", wht=wht, pcap=pcap)
            except Exception:
                pass


def once(do_send: bool):
    ast, tba, rb = _load_helpers()
    wht, pcap = _load_target_helpers()
    d = compute_tick(
        ast, tba, rb, datetime.now(timezone.utc), wht=wht, pcap=pcap
    )
    msg = format_message(d)
    print(msg)
    delivered = False
    if do_send:
        delivered = (send_to_capitano(msg) == 0)
    kind = "stalled" if (d and d.get("error") == "pipeline_stalled") \
           else ("skip" if (d and not d.get("ok")) else "tick")
    append_to_mailbox(msg, delivered_via_tmux=delivered, kind=kind)


def write_agent_usage_table(tba, now):
    """Scrive AGENT_TABLE_FILE: consumo kT per-agente per bucket 5min nelle ultime
    2h (DELTA per bucket, non cumulativo → la Sentinella vede direttamente chi
    brucia in ogni finestra: sbalzo isolato vs deriva). Parte 3/3 redesign
    usage-monitoring: dato grezzo che la Sentinella (S-07) elabora per i pattern,
    prima di consigliare il Capitano. Failsafe: un errore non affossa il tick."""
    try:
        now_ts = now.timestamp()
        since_ts = now_ts - 2 * 3600.0
        bucket = 300  # 5 min
        by_agent = tba.collect_events(since_ts)
        agents, series = tba.build_series(by_agent, since_ts, now_ts, bucket)
        deltas = []
        prev = {a: 0.0 for a in agents}
        for row in series:
            drow = {"ts": row.get("ts")}
            for a in agents:
                cur = row.get(a, 0.0) or 0.0
                drow[a] = round(cur - prev.get(a, 0.0), 1)
                prev[a] = cur
            deltas.append(drow)
        payload = {
            "generated_at": now.isoformat(),
            "bucket_sec": bucket,
            "window_h": 2,
            "agents": agents,
            "series_kt_per_bucket": deltas,
        }
        tmp = AGENT_TABLE_FILE.with_name(AGENT_TABLE_FILE.name + ".tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        tmp.replace(AGENT_TABLE_FILE)
    except Exception as e:
        print(f"[pacing-bridge] WARN agent-usage-table: {e}",
              file=sys.stderr, flush=True)


def main():
    args = sys.argv[1:]
    if "--once" in args:
        once(do_send="--send" in args)
        return
    loop()


if __name__ == "__main__":
    # Supervisore in-process (difesa in profondità, gemello del sentinel-bridge):
    # il loop ha già un try/except per-tick, ma un'eccezione FUORI dal tick (es.
    # next_quarter/sleep) ucciderebbe comunque il processo, senza recovery (setsid
    # detached). Qui qualsiasi eccezione → log + ri-entro in main(). Con --once
    # main() ritorna subito → break. Vedi 2026-06-27-betaC-sentinel-bridge-crash.md.
    import time as _time
    import traceback as _tb
    while True:
        try:
            main()
            break
        except KeyboardInterrupt:
            print("\n[pacing-bridge] interrupted.", file=sys.stderr)
            break
        except Exception as _e:  # noqa: BLE001 — catch-all VOLUTO
            print(f"[pacing-bridge] FATAL nel loop: {_e} — riavvio in 5s",
                  file=sys.stderr, flush=True)
            _tb.print_exc()
            _time.sleep(5)
