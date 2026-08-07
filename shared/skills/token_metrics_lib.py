#!/usr/bin/env python3
"""token_metrics_lib — funzioni pure per misurare i token consumati dai log
locali. Condivisa da token-meter (daemon), token-by-agent-plot, token-by-agent-rate.

Sola lettura: nessun side-effect su team o bridge. Niente plot qui, niente
daemon, niente scrittura di state file. Chi chiama si occupa di output.

Scope V1: solo Kimi (wire.jsonl). Claude/Codex hanno reader dedicati in
token-meter.py per ora, migreranno qui quando servirà per per-agent.

Pesi billing (CACHE_READ_WEIGHT 0.1, CACHE_CREATION_WEIGHT 1.25) sono in
sync con il PoC token-meter.py originale. Sono ipotesi di partenza: se il
ratio (weighted/bridge_pct) oscilla con team a velocità costante, vanno
fittati con una regressione su più punti.
"""
from __future__ import annotations

import json
import os
import re
from bisect import bisect_left
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ── Costanti billing ────────────────────────────────────────────────────

CACHE_READ_WEIGHT = 0.1       # cache hit costa ~10% del normale
CACHE_CREATION_WEIGHT = 1.25  # cache creation costa ~25% in più


def _jht_home() -> Path:
    """Risolve JHT_HOME al momento della chiamata (no caching a module level),
    così i test che impostano l'env post-import vedono il valore giusto."""
    return Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht")))


# ── Session → Agent mapping ─────────────────────────────────────────────

# Ruoli canonici degli agenti del team. Validano il fallback `[TAG]`: un tag
# maiuscolo che NON è un ruolo (es. `[RESUME]`, `[STATUS]`, `[MSG]`) NON deve
# diventare un "agente fantasma" nell'attribuzione token.
# (Costante duplicata in token-by-agent-series.py — tenerle in sync.)
VALID_AGENT_ROLES = frozenset({
    "capitano", "sentinella", "assistente", "mentor", "dottore",
    "mantenitore", "scout", "analista", "scorer", "scrittore",
    "critico", "tesoriere",
})


def _is_valid_agent(name: str) -> bool:
    """True se `name` è un ruolo canonico, anche con suffisso numerico
    (es. 'scout-2' → base 'scout')."""
    return re.sub(r"-\d+$", "", name) in VALID_AGENT_ROLES


def parse_session_to_agent(state_path: Path) -> str | None:
    """Estrai l'agente OWNER della sessione Kimi dal custom_title in
    `<session_dir>/state.json`.

    Pattern noti:
      "[@A -> @B] ..."             → owner = B (last @, receiver)
      "[@user -> @capitano] ..."   → owner = capitano
      "[SENTINELLA] [STATUS] ..."  → owner = sentinella  (broadcast)
      "[@assistente] ..."          → owner = assistente

    Il fallback `[TAG]` è validato contro VALID_AGENT_ROLES: un tag che non
    è un ruolo (es. `[RESUME]`) ritorna None invece di un agente fantasma.
    Ritorna None se non riconosciuto.
    """
    try:
        with state_path.open() as f:
            state = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    title = state.get("custom_title", "") or ""
    cands = re.findall(r"@([a-zA-Z][\w-]*)", title)
    cands = [c.lower() for c in cands if c.lower() not in ("utente", "user")]
    if cands:
        return cands[-1]
    m = re.match(r"^\[([A-Z][A-Z0-9_-]+)\]", title)
    if m:
        name = m.group(1).lower().replace("_", "-")
        if _is_valid_agent(name):
            return name
    return None


# ── Billing weight ──────────────────────────────────────────────────────

def billing_weighted(tokens: dict, provider: str = "kimi") -> float:
    """Somma pesata dei token in funzione del provider.

    Kimi (default):
        input_other + output + input_cache_read*0.1 + input_cache_creation*1.25
    Claude:
        input_tokens + output_tokens + cache_read_input_tokens*0.1 + cache_creation_input_tokens*1.25
    Codex (openai):
        input_tokens + output_tokens + reasoning_output_tokens + cached_input_tokens*0.5
    """
    if provider in ("kimi", "moonshot"):
        return (
            tokens.get("input_other", 0)
            + tokens.get("output", 0)
            + tokens.get("input_cache_read", 0) * CACHE_READ_WEIGHT
            + tokens.get("input_cache_creation", 0) * CACHE_CREATION_WEIGHT
        )
    if provider in ("claude", "anthropic"):
        return (
            tokens.get("input_tokens", 0)
            + tokens.get("output_tokens", 0)
            + tokens.get("cache_read_input_tokens", 0) * CACHE_READ_WEIGHT
            + tokens.get("cache_creation_input_tokens", 0) * CACHE_CREATION_WEIGHT
        )
    if provider in ("openai", "codex"):
        return (
            tokens.get("input_tokens", 0)
            + tokens.get("output_tokens", 0)
            + tokens.get("reasoning_output_tokens", 0)
            + tokens.get("cached_input_tokens", 0) * 0.5
        )
    raise ValueError(f"billing_weighted: unknown provider {provider!r}")


# ── Kimi events reader ──────────────────────────────────────────────────

def read_kimi_events(
    window_start_ts: float | None = None,
    *,
    sessions_root: Path | None = None,
) -> list[dict[str, Any]]:
    """Legge tutti gli eventi token Kimi sotto `$JHT_HOME/.kimi/sessions/`.

    Ogni evento ritornato:
      {
        "ts": float (epoch sec),
        "session": str (hash della session dir),
        "agent": str | None,
        "tokens": {input_other, output, input_cache_read, input_cache_creation},
        "weighted": float,
      }

    Filtra eventi con ts < window_start_ts se passato. Skippa silenziosamente
    file/righe corrotti (best-effort: token-meter è osservativo, non deve
    crashare per uno wire.jsonl monco).
    """
    root = sessions_root or (_jht_home() / ".kimi" / "sessions")
    events: list[dict[str, Any]] = []
    if not root.exists():
        return events

    for hash_dir in root.iterdir():
        if not hash_dir.is_dir():
            continue
        for sub in hash_dir.iterdir():
            if not sub.is_dir():
                continue
            wire = sub / "wire.jsonl"
            state = sub / "state.json"
            if not wire.exists():
                continue
            agent = parse_session_to_agent(state) if state.exists() else None
            sess = sub.name
            try:
                with wire.open() as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            e = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        ts = e.get("timestamp")
                        if not isinstance(ts, (int, float)):
                            continue
                        if window_start_ts is not None and ts < window_start_ts:
                            continue
                        msg = e.get("message") or {}
                        pl = msg.get("payload") or {}
                        tu = pl.get("token_usage")
                        if not isinstance(tu, dict):
                            continue
                        tokens = {
                            "input_other": tu.get("input_other", 0) or 0,
                            "output": tu.get("output", 0) or 0,
                            "input_cache_read": tu.get("input_cache_read", 0) or 0,
                            "input_cache_creation": tu.get("input_cache_creation", 0) or 0,
                        }
                        w = billing_weighted(tokens, "kimi")
                        if w <= 0:
                            continue
                        events.append({
                            "ts": float(ts),
                            "session": sess,
                            "agent": agent,
                            "tokens": tokens,
                            "weighted": float(w),
                        })
            except OSError:
                continue

    events.sort(key=lambda e: e["ts"])
    return events


# ── Aggregation ─────────────────────────────────────────────────────────

def aggregate(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Sommatorie globali e per-agente da una lista di eventi (output di
    `read_kimi_events`).

    Ritorna:
      {
        "totals": {input_other, output, input_cache_read, input_cache_creation,
                   weighted, events, sessions},
        "by_agent": {<agent>: {weighted, events, last_ts}},
        "by_session": {<session>: weighted},
      }
    """
    totals = {
        "input_other": 0, "output": 0,
        "input_cache_read": 0, "input_cache_creation": 0,
        "weighted": 0.0, "events": 0,
    }
    by_agent: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"weighted": 0.0, "events": 0, "last_ts": None}
    )
    by_session: dict[str, float] = defaultdict(float)
    sessions: set[str] = set()

    for e in events:
        t = e["tokens"]
        totals["input_other"] += t["input_other"]
        totals["output"] += t["output"]
        totals["input_cache_read"] += t["input_cache_read"]
        totals["input_cache_creation"] += t["input_cache_creation"]
        totals["weighted"] += e["weighted"]
        totals["events"] += 1

        sess = e["session"]
        by_session[sess] += e["weighted"]
        sessions.add(sess)

        agent = e["agent"] or "?unknown"
        a = by_agent[agent]
        a["weighted"] += e["weighted"]
        a["events"] += 1
        if a["last_ts"] is None or e["ts"] > a["last_ts"]:
            a["last_ts"] = e["ts"]

    totals["sessions"] = len(sessions)
    return {
        "totals": totals,
        "by_agent": dict(by_agent),
        "by_session": dict(by_session),
    }


# ── Rolling rate ────────────────────────────────────────────────────────

def rolling_rate(
    events: list[tuple[float, float]] | list[dict[str, Any]],
    win_s: float,
) -> list[tuple[datetime, float]]:
    """Per ogni evento, somma weighted negli ultimi `win_s` secondi e ritorna
    rate in token/min.

    Accetta:
      • list[(ts, weighted)] (forma raw usata da token-by-agent-rate)
      • list[event-dict] da `read_kimi_events` (estrae ts/weighted)

    Ritorna list[(datetime UTC, rate_tokens_per_min)] ordinata per ts.
    Il rate è in token/min (non kT/min — chi vuole kT divide per 1000).
    """
    if not events:
        return []

    if isinstance(events[0], dict):
        pairs = [(e["ts"], e["weighted"]) for e in events]
    else:
        pairs = list(events)  # type: ignore[arg-type]
    pairs.sort(key=lambda p: p[0])
    times = [p[0] for p in pairs]

    out: list[tuple[datetime, float]] = []
    for i, (t, _) in enumerate(pairs):
        cutoff = t - win_s
        j = bisect_left(times, cutoff)
        s = sum(pairs[k][1] for k in range(j, i + 1))
        rate_per_min = (s / win_s) * 60.0
        out.append((datetime.fromtimestamp(t, tz=timezone.utc), rate_per_min))
    return out


def rolling_rate_per_agent(
    events: list[dict[str, Any]],
    win_s: float,
    now_ts: float | None = None,
) -> dict[str, dict[str, Any]]:
    """Per ciascun agente, calcola il rate corrente negli ultimi `win_s`
    secondi (somma weighted / win_s, normalizzata a token/min).

    Argomento `now_ts` (default: ts dell'ultimo evento o time.time() se vuoto)
    è il punto temporale rispetto al quale si calcola "ultimi win_s sec".
    Usato dal token-meter daemon per esporre `rate_kt_per_min_60s` per-agent.

    Ritorna {agent: {"weighted_60s": float, "rate_tokens_per_min": float,
                     "last_event_at": float | None}}.
    """
    if now_ts is None:
        if events:
            now_ts = max(e["ts"] for e in events)
        else:
            import time as _time
            now_ts = _time.time()
    cutoff = now_ts - win_s

    by_agent: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"weighted_60s": 0.0, "rate_tokens_per_min": 0.0, "last_event_at": None}
    )
    for e in events:
        agent = e["agent"] or "?unknown"
        a = by_agent[agent]
        if a["last_event_at"] is None or e["ts"] > a["last_event_at"]:
            a["last_event_at"] = e["ts"]
        if e["ts"] < cutoff:
            continue
        a["weighted_60s"] += e["weighted"]

    for a in by_agent.values():
        a["rate_tokens_per_min"] = (a["weighted_60s"] / win_s) * 60.0

    return dict(by_agent)


# ── Writer + Critic aggregation ─────────────────────────────────────────

# Pattern: il Critico è spawnato dallo Scrittore N e ha session `CRITICO-S<N>`
# (vedi agents/_skills/critic-loop/SKILL.md). Lowercase keys: scrittore-N
# parent di critico-sN. La singola sessione `CRITICO` (senza suffisso, raro
# fallback senza scaling) viene attribuita per convenzione allo scrittore-1
# se presente, altrimenti rimane standalone.
_WRITER_KEY_RE = re.compile(r"^scrittore-(\d+)$")
_CRITIC_KEY_RE = re.compile(r"^critico-s(\d+)$")


def aggregate_writer_critic_rates(
    per_agent: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Aggrega rate Scrittore + Critico spawnato in 1 unità per le decisioni
    di throttling del Capitano.

    Background: il Critico (`CRITICO-S<N>`) è child task atomico dello
    Scrittore N (CV review loop a 3 round). Non è throttlabile a livello
    Critico (task atomica: read CV+JD, write critique). L'unica leva è
    rallentare lo Scrittore "padre" PRIMA dello spawn round successivo.
    Quindi per il Capitano il rate vero della unit "scrittore" è
    `own + critic_associato`. Vedi BACKLOG [JHT-TOKEN-MONITOR-WRITER-CRITIC].

    Input: `per_agent` dict come prodotto da `rolling_rate_per_agent()`,
    con chiavi lowercase tipo `scrittore-1`, `critico-s1`, `scout-1`, etc.
    Le chiavi non-scrittore/non-critico vengono ignorate qui (esposte
    invariate in `per_agent`).

    Output: `{scrittore-N: {own_rate_kt_per_min, critic_rate_kt_per_min,
                            combined_rate_kt_per_min, own_weighted,
                            critic_weighted, combined_weighted,
                            critic_session}}`.
    Se Scrittore N esiste ma Critico associato no (nessuna review in corso),
    critic_rate=0, combined_rate=own_rate. Critic orphan (senza writer
    parent vivo nel dict, raro post-respawn) viene comunque attributo allo
    `scrittore-N` con own_rate=0 — il Capitano vede il consumo e capisce
    che c'è una review in coda.
    """
    out: dict[str, dict[str, Any]] = {}

    writers: dict[str, dict[str, Any]] = {}
    critics: dict[str, dict[str, Any]] = {}
    for key, info in per_agent.items():
        wm = _WRITER_KEY_RE.match(key)
        if wm:
            writers[wm.group(1)] = info
            continue
        cm = _CRITIC_KEY_RE.match(key)
        if cm:
            critics[cm.group(1)] = info

    all_n = set(writers.keys()) | set(critics.keys())
    for n in sorted(all_n, key=int):
        w = writers.get(n, {})
        c = critics.get(n, {})
        own_rate = float(w.get("rate_kt_per_min_60s", 0.0) or 0.0)
        critic_rate = float(c.get("rate_kt_per_min_60s", 0.0) or 0.0)
        own_weighted = float(w.get("weighted_60s", 0.0) or 0.0)
        critic_weighted = float(c.get("weighted_60s", 0.0) or 0.0)
        out[f"scrittore-{n}"] = {
            "own_rate_kt_per_min": own_rate,
            "critic_rate_kt_per_min": critic_rate,
            "combined_rate_kt_per_min": own_rate + critic_rate,
            "own_weighted_60s": own_weighted,
            "critic_weighted_60s": critic_weighted,
            "combined_weighted_60s": own_weighted + critic_weighted,
            "critic_session": f"critico-s{n}" if c else None,
            "writer_session_alive": bool(w),
        }

    return out
