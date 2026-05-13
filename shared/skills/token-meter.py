#!/usr/bin/env python3
"""token-meter.py — PoC: misura token consumati dai log locali e confronta col bridge.

Letture (sola lettura, NESSUN side-effect sul team / bridge):
  • $JHT_HOME/.kimi/sessions/*/*/wire.jsonl  → token_usage per messaggio
  • $JHT_HOME/.codex/sessions/.../rollout-*.jsonl  → total_token_usage per call
  • $JHT_HOME/.claude/projects/.../*.jsonl  → message.usage per response
  • $JHT_HOME/logs/sentinel-bridge-state.json  → last_usage% del bridge

Output:
  • stdout: 1 riga ogni INTERVAL_S secondi
  • $JHT_HOME/logs/token-meter.csv  → CSV append per post-analisi
  • $JHT_HOME/logs/token-meter.log  → mirror stdout (via tee, lato launcher)

Logica:
  1. window_start = now - WINDOW_HOURS (rate budget Kimi/Claude ~5h)
  2. somma token_usage di tutti gli eventi con ts >= window_start
  3. weighted = input_other + output + cache_read*0.1 + cache_creation*1.25
  4. legge bridge.last_usage% (autoritativo del provider)
  5. ratio = weighted / pct  → tokens equivalenti a 1% del rate budget
  6. proietta a granularità sub-tick

NOTA: i pesi cache (1/10, 5/4) sono ipotesi di partenza. Se il ratio oscilla
fra una calibrazione e l'altra (con team a velocità ~costante), i pesi vanno
fittati con una regressione su più punti.
"""
import json
import os
import sys
import time
from collections import deque
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import token_metrics_lib as tlib  # noqa: E402

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
KIMI_SESSIONS = JHT_HOME / ".kimi" / "sessions"
CODEX_SESSIONS = JHT_HOME / ".codex" / "sessions"
CLAUDE_PROJECTS = JHT_HOME / ".claude" / "projects"
BRIDGE_STATE = JHT_HOME / "logs" / "sentinel-bridge-state.json"
JSONL_DATA = JHT_HOME / "logs" / "sentinel-data.jsonl"
CSV_OUT = JHT_HOME / "logs" / "token-meter.csv"
STATE_OUT = JHT_HOME / "logs" / "token-meter-state.json"
CONFIG_PATH = JHT_HOME / "jht.config.json"

WINDOW_HOURS = 5.0
INTERVAL_S = 30

# Step 4: rolling window per il rate per-agente. 60s come da TODO Step 4.
# Stesso win usato in token-by-agent-rate.py (default 120s) ma più reattivo:
# qui ci interessa "chi sta tirando ADESSO", non il trend di 2 minuti.
PER_AGENT_ROLL_WIN_S = 60.0

# Calibration EMA (Step 3): il ratio weighted/pct varia con la quantizzazione
# del provider (kimi/codex/claude misurano usage_percent come int). Per dare
# un valore stabile usabile dalla UI dobbiamo aggregare più sample:
#   • buffer delle ultime N coppie (pct, weighted)
#   • ratio puntuale = Δweighted / Δpct, considerato SOLO quando |Δpct| ≥ 1
#     (sotto 1% siamo nel rumore di quantizzazione)
#   • EMA(α=0.3) smussa burst momentanei senza ritardare il rientro a regime
CALIB_BUFFER_MAX = 32                 # ~16 min a 30s/tick
CALIB_MIN_DELTA_PCT = 1.0             # soglia anti-quantizzazione
CALIB_EMA_ALPHA = 0.3                 # come da TODO Step 3
CALIB_MIN_DELTA_WEIGHTED = 100.0      # ignora pairs con Δw assurdamente piccolo


class RatioCalibrator:
    """Tiene il buffer (ts, pct, weighted) e calcola un ratio EMA stabile.

    Invariant: i sample sono inseriti monotonamente crescenti in ts. Il buffer
    è una deque con maxlen, quindi i sample vecchi cadono naturalmente.
    """

    def __init__(self, alpha=CALIB_EMA_ALPHA, min_delta_pct=CALIB_MIN_DELTA_PCT,
                 min_delta_weighted=CALIB_MIN_DELTA_WEIGHTED, maxlen=CALIB_BUFFER_MAX):
        self.alpha = alpha
        self.min_delta_pct = min_delta_pct
        self.min_delta_weighted = min_delta_weighted
        self.buffer: deque[tuple[float, float, float]] = deque(maxlen=maxlen)
        self.ema: float | None = None
        self.last_sample_ratio: float | None = None  # ratio puntuale ultimo confronto
        self.calibrations: int = 0                    # quante volte abbiamo updato l'EMA

    def observe(self, ts, pct, weighted):
        """Aggiunge un sample e, se possibile, aggiorna l'EMA.

        Ritorna dict con info diagnostiche: {ratio_instant, ratio_ema, calibrated_this_tick}.
        """
        out = {
            "ratio_instant": None,
            "ratio_ema": self.ema,
            "calibrated_this_tick": False,
        }

        # Reset detect: se il pct cala di > 30 punti rispetto all'ultimo
        # sample, il provider ha resettato la finestra. L'EMA precedente non
        # è più valida (Δw del prossimo step sarà negativo o sballato).
        if self.buffer:
            _, prev_pct, _ = self.buffer[-1]
            if pct < prev_pct - 30:
                self.buffer.clear()
                self.ema = None
                self.last_sample_ratio = None
                self.calibrations = 0

        # Cerca il sample più vecchio nel buffer con Δpct sufficiente.
        chosen = None
        for old_ts, old_pct, old_w in self.buffer:
            dp = pct - old_pct
            if dp >= self.min_delta_pct:
                chosen = (old_ts, old_pct, old_w, dp)
                break

        if chosen is not None and weighted is not None:
            _, _, old_w, dp = chosen
            dw = weighted - old_w
            if dw >= self.min_delta_weighted:
                ratio = dw / dp
                self.last_sample_ratio = ratio
                out["ratio_instant"] = ratio
                if self.ema is None:
                    self.ema = ratio
                else:
                    self.ema = self.alpha * ratio + (1.0 - self.alpha) * self.ema
                self.calibrations += 1
                out["ratio_ema"] = self.ema
                out["calibrated_this_tick"] = True

        self.buffer.append((float(ts), float(pct), float(weighted or 0)))
        return out


def write_state_atomic(path, payload):
    """Scrive `payload` come JSON in `path` con tmp + os.replace.

    Necessario perché il consumer (web/api/tokens/status) potrebbe leggere
    a metà write se non fossimo atomici. Step 5 amplierà il payload; qui
    introduciamo il file con i campi del Step 3.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, default=str), encoding="utf-8")
    os.replace(tmp, path)


def read_active_provider():
    """Leggi provider attivo dal config JHT (kimi / openai / claude)."""
    try:
        with CONFIG_PATH.open() as f:
            return (json.load(f).get("active_provider") or "openai").lower()
    except (OSError, json.JSONDecodeError):
        return "openai"


def read_bridge_state():
    try:
        with BRIDGE_STATE.open() as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


# Finestra rate-limit per provider (ore). Tutti i provider supportati hanno
# rolling window di 5h ma teniamo la mappa esplicita per provider futuri.
PROVIDER_WINDOW_HOURS = {
    "kimi": 5.0,
    "moonshot": 5.0,
    "claude": 5.0,
    "anthropic": 5.0,
    "openai": 5.0,
    "codex": 5.0,
}


def _parse_reset_hhmm(reset_str, now_local):
    """Converte "HH:MM" del bridge in datetime locale del prossimo reset.

    Il bridge formatta reset_at come HH:MM in local TZ (vedi _iso_to_hhmm in
    sentinel-bridge.py). Per disambiguare oggi vs domani, se l'orario è
    già passato lo proiettiamo al giorno successivo.

    Ritorna datetime aware in TZ locale, o None se la stringa non è valida.
    """
    if not isinstance(reset_str, str) or ":" not in reset_str:
        return None
    try:
        hh, mm = reset_str.split(":", 1)
        h, m = int(hh), int(mm)
        if not (0 <= h < 24 and 0 <= m < 60):
            return None
    except ValueError:
        return None
    candidate = now_local.replace(hour=h, minute=m, second=0, microsecond=0)
    if candidate < now_local:
        candidate += timedelta(days=1)
    return candidate


def compute_window_start_ts(provider, bridge_state, now=None):
    """Determina window_start come timestamp UNIX.

    Strategy:
      1. Se bridge_state ha `last_reset_at_unix` (epoch UTC), ancora la
         window a `reset_at - WINDOW_HOURS(provider)` — coerente col rolling
         window che il provider usa lato server. Epoch è preferito perché
         non ambiguo su mezzanotte / rolling drift.
      2. Fallback HH:MM: parse `last_reset_at` come "prossimo HH:MM nel
         futuro". Usato per backward-compat con bridge < V7 stato file.
      3. Fallback graceful finale: `now - WINDOW_HOURS` (comportamento PoC).

    Ritorna (window_start_ts, source) dove source ∈ {"reset_at_unix",
    "reset_at_hhmm", "now"} per logging/diagnostica.
    """
    if now is None:
        now = datetime.now().astimezone()
    win_h = PROVIDER_WINDOW_HOURS.get(provider, WINDOW_HOURS)

    if bridge_state:
        epoch = bridge_state.get("last_reset_at_unix")
        if isinstance(epoch, (int, float)) and epoch > 0:
            return epoch - win_h * 3600.0, "reset_at_unix"

        reset_dt = _parse_reset_hhmm(bridge_state.get("last_reset_at"), now)
        if reset_dt is not None:
            window_start = reset_dt - timedelta(hours=win_h)
            return window_start.timestamp(), "reset_at_hhmm"

    window_start = now - timedelta(hours=win_h)
    return window_start.timestamp(), "now"


# ── Provider readers ─────────────────────────────────────────────────────


def read_kimi_tokens(window_start_ts):
    """Thin wrapper su token_metrics_lib: legge eventi Kimi e aggrega.

    Ritorna (totals, by_session) per backward-compat con la firma originale.
    totals contiene anche `weighted` precalcolato e `events`/`sessions`.
    """
    events = tlib.read_kimi_events(window_start_ts, sessions_root=KIMI_SESSIONS)
    agg = tlib.aggregate(events)
    totals = dict(agg["totals"])
    return totals, agg["by_session"]


def read_claude_tokens(window_start_ts):
    """Somma usage da tutti i project jsonl di Claude Code nella finestra."""
    out = {
        "input_tokens": 0, "output_tokens": 0,
        "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0,
        "events": 0, "sessions": 0,
    }
    by_session = {}
    if not CLAUDE_PROJECTS.exists():
        return out, by_session

    window_dt = datetime.fromtimestamp(window_start_ts, tz=timezone.utc)
    for proj_jsonl in CLAUDE_PROJECTS.rglob("*.jsonl"):
        sess = proj_jsonl.stem
        try:
            with proj_jsonl.open() as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        e = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    ts_str = e.get("timestamp", "")
                    try:
                        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    except (ValueError, AttributeError):
                        continue
                    if ts < window_dt:
                        continue
                    usage = (e.get("message") or {}).get("usage")
                    if not isinstance(usage, dict):
                        continue
                    for k in out:
                        v = usage.get(k, 0)
                        if isinstance(v, (int, float)):
                            out[k] += v
                    out["events"] += 1
                    by_session.setdefault(sess, 0)
                    by_session[sess] += usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
        except OSError:
            continue
    out["sessions"] = len(by_session)
    return out, by_session


def read_codex_tokens(window_start_ts):
    """Somma last_token_usage da rollout-*.jsonl di Codex nella finestra."""
    out = {
        "input_tokens": 0, "output_tokens": 0,
        "cached_input_tokens": 0, "reasoning_output_tokens": 0,
        "total_tokens": 0, "events": 0, "sessions": 0,
    }
    by_session = {}
    if not CODEX_SESSIONS.exists():
        return out, by_session

    window_dt = datetime.fromtimestamp(window_start_ts, tz=timezone.utc)
    for rollout in CODEX_SESSIONS.rglob("rollout-*.jsonl"):
        sess = rollout.stem
        try:
            with rollout.open() as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        e = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    ts_str = e.get("timestamp", "")
                    try:
                        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    except (ValueError, AttributeError):
                        continue
                    if ts < window_dt:
                        continue
                    pl = e.get("payload") or {}
                    if pl.get("type") != "token_count":
                        continue
                    tu = (pl.get("info") or {}).get("last_token_usage") or {}
                    for k in ("input_tokens", "output_tokens", "cached_input_tokens",
                              "reasoning_output_tokens", "total_tokens"):
                        v = tu.get(k, 0)
                        if isinstance(v, (int, float)):
                            out[k] += v
                    out["events"] += 1
                    by_session.setdefault(sess, 0)
                    by_session[sess] += tu.get("total_tokens", 0)
        except OSError:
            continue
    out["sessions"] = len(by_session)
    return out, by_session


# ── Billing weighting ────────────────────────────────────────────────────
# Pesi e formule centralizzate in token_metrics_lib.billing_weighted.
# Mantenuti come thin alias per leggibilità del codice locale.

def kimi_weighted(t):
    return tlib.billing_weighted(t, "kimi")


def claude_weighted(t):
    return tlib.billing_weighted(t, "claude")


def codex_weighted(t):
    return tlib.billing_weighted(t, "openai")


# ── Main loop ────────────────────────────────────────────────────────────


def main():
    provider = read_active_provider()
    print(f"[token-meter] start provider={provider} interval={INTERVAL_S}s window={WINDOW_HOURS}h",
          flush=True)
    print(f"[token-meter] CSV={CSV_OUT}", flush=True)
    print(f"[token-meter] STATE={STATE_OUT}", flush=True)

    CSV_OUT.parent.mkdir(parents=True, exist_ok=True)
    if not CSV_OUT.exists():
        with CSV_OUT.open("w") as f:
            f.write("ts,provider,bridge_pct,bridge_proj,bridge_status,events,"
                    "in_raw,out_raw,cache_read_raw,cache_creation_raw,"
                    "weighted,ratio_tokens_per_pct,ratio_ema_tokens_per_pct,sessions\n")

    calibrator = RatioCalibrator()

    while True:
        now = datetime.now(timezone.utc)
        # Step 2: la finestra di aggregazione è ancorata al reset_at del bridge
        # quando disponibile, così il ratio cumulativo (weighted/bridge_pct)
        # è coerente con la stessa finestra che il provider sta misurando.
        # Senza reset_at, fallback graceful: now-5h come nel PoC.
        state = read_bridge_state() or {}
        window_start_ts, win_source = compute_window_start_ts(provider, state, now=datetime.now().astimezone())

        kimi_events: list = []
        if provider == "kimi":
            # Per il per-agent rolling rate ci servono gli events grezzi: li
            # leggiamo una volta sola e aggrego sopra.
            kimi_events = tlib.read_kimi_events(window_start_ts, sessions_root=KIMI_SESSIONS)
            agg = tlib.aggregate(kimi_events)
            totals = dict(agg["totals"])
            by_sess = agg["by_session"]
            weighted = totals["weighted"] if totals["events"] else 0
            in_raw, out_raw = totals["input_other"], totals["output"]
            cache_r, cache_c = totals["input_cache_read"], totals["input_cache_creation"]
        elif provider == "claude":
            totals, by_sess = read_claude_tokens(window_start_ts)
            weighted = claude_weighted(totals) if totals["events"] else 0
            in_raw, out_raw = totals["input_tokens"], totals["output_tokens"]
            cache_r, cache_c = totals["cache_read_input_tokens"], totals["cache_creation_input_tokens"]
        else:  # openai/codex
            totals, by_sess = read_codex_tokens(window_start_ts)
            weighted = codex_weighted(totals) if totals["events"] else 0
            in_raw, out_raw = totals["input_tokens"], totals["output_tokens"]
            cache_r, cache_c = totals["cached_input_tokens"], 0

        bridge_pct = state.get("last_usage")
        bridge_proj = state.get("last_projection")
        bridge_status = state.get("last_status") or ""
        bridge_tick = state.get("last_tick_at", "")[:19]
        bridge_reset = state.get("last_reset_at") or "?"

        ratio = (weighted / bridge_pct) if (bridge_pct and bridge_pct > 0 and weighted > 0) else None

        # Step 3: aggiorna l'EMA della calibrazione (incrementale, robusta
        # alla quantizzazione integer del bridge_pct).
        calib = (
            calibrator.observe(now.timestamp(), bridge_pct, weighted)
            if (isinstance(bridge_pct, (int, float)) and bridge_pct > 0)
            else {"ratio_instant": None, "ratio_ema": calibrator.ema, "calibrated_this_tick": False}
        )
        ratio_ema = calibrator.ema

        ratio_str = f"{ratio/1000:.2f}kT/1%" if ratio else "n/a"
        ema_str = f"{ratio_ema/1000:.2f}" if ratio_ema else "n/a"
        line = (
            f"[{now.strftime('%H:%M:%S')}] {provider:6} "
            f"bridge={str(bridge_pct):>3}% proj={str(bridge_proj):>6} ({bridge_status:>12}) "
            f"reset={bridge_reset} win={win_source} | "
            f"events={totals['events']:>3} sess={totals['sessions']} "
            f"in={in_raw:>7,} out={out_raw:>5,} "
            f"cache_r={cache_r:>9,} cache_w={cache_c:>5,} "
            f"weighted={int(weighted):>8,} | ratio={ratio_str} ema={ema_str}kT/1% "
            f"calib={calibrator.calibrations}"
        )
        print(line, flush=True)

        with CSV_OUT.open("a") as f:
            f.write(
                f"{now.isoformat()},{provider},{bridge_pct or ''},{bridge_proj or ''},"
                f"{bridge_status},{totals['events']},{in_raw},{out_raw},{cache_r},{cache_c},"
                f"{int(weighted)},{ratio or ''},{ratio_ema or ''},{totals['sessions']}\n"
            )

        # Step 4: per-agent rolling rate sugli ultimi 60s. Solo Kimi: per
        # claude/codex non abbiamo ancora un mapping session→agent affidabile.
        per_agent_out: dict = {}
        if provider == "kimi" and kimi_events:
            per_agent_raw = tlib.rolling_rate_per_agent(
                kimi_events, PER_AGENT_ROLL_WIN_S, now_ts=now.timestamp()
            )
            for agent, info in per_agent_raw.items():
                rate_tpm = info["rate_tokens_per_min"]
                last_evt = info["last_event_at"]
                per_agent_out[agent] = {
                    "rate_tokens_per_min_60s": rate_tpm,
                    "rate_kt_per_min_60s": rate_tpm / 1000.0,
                    "weighted_60s": info["weighted_60s"],
                    "last_event_at": (
                        datetime.fromtimestamp(last_evt, tz=timezone.utc).isoformat()
                        if last_evt else None
                    ),
                    "idle_seconds": (
                        (now.timestamp() - last_evt) if last_evt else None
                    ),
                }

        state_payload = {
            "version": 1,
            "updated_at": now.isoformat(),
            "provider": provider,
            "window_hours": PROVIDER_WINDOW_HOURS.get(provider, WINDOW_HOURS),
            "window_source": win_source,
            "bridge": {
                "usage_pct": bridge_pct,
                "projection": bridge_proj,
                "status": bridge_status,
                "reset_at": bridge_reset,
                "last_tick_at": state.get("last_tick_at"),
            },
            "tokens": {
                "events": totals["events"],
                "sessions": totals["sessions"],
                "input_raw": in_raw,
                "output_raw": out_raw,
                "cache_read_raw": cache_r,
                "cache_creation_raw": cache_c,
                "weighted_total": int(weighted),
            },
            "ratio": {
                "instant_tokens_per_pct": calib["ratio_instant"],
                "ema_tokens_per_pct": ratio_ema,
                "ema_kt_per_pct": (ratio_ema / 1000.0) if ratio_ema else None,
                "alpha": CALIB_EMA_ALPHA,
                "calibrations": calibrator.calibrations,
            },
            "per_agent": per_agent_out,
            "per_agent_rolling_window_s": PER_AGENT_ROLL_WIN_S,
        }
        write_state_atomic(STATE_OUT, state_payload)

        time.sleep(INTERVAL_S)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[token-meter] stop")
        sys.exit(0)
