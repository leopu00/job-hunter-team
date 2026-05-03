#!/usr/bin/env python3
"""token-by-agent-series.py — serie temporale aggregata per la UI web.

Stessa logica di estrazione di token-by-agent-plot.py / -rate.py (Kimi
wire.jsonl, mapping session→agente via state.json), ma:
  • output JSON su stdout (consumato da /api/tokens/by-agent)
  • parametri --since-min e --bucket-sec da CLI
  • niente matplotlib (no dipendenze pesanti per la route web)

Schema output:
{
  "ok": true,
  "now": "2026-05-02T12:34:56+00:00",
  "since": "2026-05-02T09:34:56+00:00",
  "bucket_sec": 60,
  "agents": ["capitano", "scout-1", ...],
  "totals_kt": {"capitano": 125.1, ...},
  "events": {"capitano": 24, ...},
  "series": [
    {"ts": "2026-05-02T09:34:00+00:00", "capitano": 0, "scout-1": 12.3, ...},
    ...
  ]
}

`series` è cumulativa per agente (curva crescente). Adatta a line chart
con una traccia per agente. Il bucketing è uniforme nel range richiesto,
così il frontend non deve interpolare.
"""
import argparse
import json
import math
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Pesi token per il RATE LIMIT Kimi K2 — derivati EMPIRICAMENTE dai nostri
# log, NON dalla doc piattaforma.
#
# Test: per ogni segmento tra step bridge consecutivi (Δusage>=1) abbiamo
# misurato cumul_token / Δusage usando vari modelli. Risultati su 28
# segmenti / 6h di sessione team Kimi K2:
#
#   modello                 CoV (Δu>=1)   CoV (Δu>=10)   drift macro
#   ----------------------  -----------   ------------   -----------
#   input + output                   52%           15%       0.96x
#   output da solo                   46%           19%       0.84x
#   call count                       81%           30%       1.42x
#   ALL tokens (1.0 unif)           124%           39%       1.73x
#   cache_read incluso              127%           46%      diverging
#
# Il rate Kimi cresce in modo proporzionale a (input + output) reali, NON
# include cache_read (che pesa 0). La doc piattaforma dice altro, ma sui
# nostri dati il modello in+out e' nettamente piu' stabile (CoV 15% vs
# 39% di all-tokens, drift 0.96x vs 1.73x).
#
# Conseguenza pratica: 1% di rate budget Kimi ≈ ~40k token (input+output)
# stabile per tutta la sessione. Numero usabile per la tabella throttle.
W_INPUT = 1.0
W_OUTPUT = 1.0
CACHE_R_W = 0.0   # cache_read non contribuisce al rate (analisi empirica)
CACHE_C_W = 0.0   # cache_creation idem (e' sempre 0 nei dati Kimi)

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
KIMI_DIR = JHT_HOME / ".kimi" / "sessions"
# Claude: una directory per agente sotto ~/.claude/projects/, formato
# `-jht-home-agents-<agent>`. Ogni file `*.jsonl` è una sessione, schema
# diverso da Kimi (vedi `read_claude_events`).
CLAUDE_DIR = JHT_HOME / ".claude" / "projects"
CLAUDE_AGENT_PREFIX = "-jht-home-agents-"


def _extract_agent_from_text(text: str):
    """Applica i pattern noti di mapping su una stringa libera.
    Ritorna il nome agente o None.
      [@A -> @B] ...    → owner = B (l'ultimo @<name>, è il receiver)
      [@user -> @capitano] ... → owner = capitano
      [SENTINELLA] ...  → owner = sentinella (uppercase fallback)
    """
    if not text:
        return None
    cands = re.findall(r"@([a-zA-Z][\w-]*)", text)
    cands = [c.lower() for c in cands if c.lower() not in ("utente", "user")]
    if cands:
        return cands[-1]
    m = re.match(r"^\s*\[([A-Z][A-Z0-9_-]+)\]", text)
    if m:
        return m.group(1).lower().replace("_", "-")
    return None


def _first_user_input_text(wire_path: Path) -> str:
    """Legge il primo `user_input` dal wire.jsonl. Lo schema può essere
    str o list[{type,text}]. Ritorna stringa concatenata (max 500 char,
    bastano per riconoscere il pattern `[@x -> @y]`)."""
    try:
        with wire_path.open() as f:
            for line in f:
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                pl = (e.get("message") or {}).get("payload") or {}
                ui = pl.get("user_input")
                if ui is None:
                    continue
                if isinstance(ui, str):
                    return ui[:500]
                if isinstance(ui, list):
                    parts = []
                    for p in ui:
                        if isinstance(p, dict) and isinstance(p.get("text"), str):
                            parts.append(p["text"])
                    return " ".join(parts)[:500]
                return ""
    except OSError:
        return ""
    return ""


def session_to_agent(state_path: Path, wire_path: Path | None = None):
    """Estrae il nome agente da una sessione Kimi.

    Ordine dei tentativi:
      1. state.json `custom_title`  (caso normale)
      2. primo `user_input` nel wire.jsonl  (fallback per sessioni
         dove Kimi non ha ancora generato il titolo, vedi `title_generated:false`)
    """
    try:
        with state_path.open() as f:
            state = json.load(f)
    except (OSError, json.JSONDecodeError):
        state = {}
    title = state.get("custom_title") or ""
    agent = _extract_agent_from_text(title)
    if agent:
        return agent
    if wire_path and wire_path.exists():
        first_text = _first_user_input_text(wire_path)
        return _extract_agent_from_text(first_text)
    return None


def billing_weighted(token_usage: dict) -> float:
    """Costo weighted di una singola risposta API Kimi.

    Pesi derivati dal pricing ufficiale Kimi K2 standard.
    """
    return (
        token_usage.get("input_other", 0) * W_INPUT
        + token_usage.get("output", 0) * W_OUTPUT
        + token_usage.get("input_cache_read", 0) * CACHE_R_W
        + token_usage.get("input_cache_creation", 0) * CACHE_C_W
    )


def billing_weighted_claude(usage: dict) -> float:
    """Costo weighted di una singola risposta API Claude (Anthropic).

    Riusa gli stessi pesi del calcolo Kimi per coerenza visiva nel chart
    unificato (anche se Claude ha rapporti billing diversi). Se il team
    gira interamente su Claude, vale la pena introdurre pesi separati.
    """
    return (
        usage.get("input_tokens", 0) * W_INPUT
        + usage.get("output_tokens", 0) * W_OUTPUT
        + usage.get("cache_read_input_tokens", 0) * CACHE_R_W
        + usage.get("cache_creation_input_tokens", 0) * CACHE_C_W
    )


def _parse_iso_to_ts(s) -> float:
    """ISO string → epoch unix. Tollera 'Z' e timezone offset."""
    if not isinstance(s, str):
        return 0.0
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except (ValueError, TypeError):
        return 0.0


def _collect_kimi(by_agent: dict, since_ts: float) -> None:
    """Estende by_agent con eventi Kimi sotto ~/.kimi/sessions/.
    Mapping session→agent via state.json.custom_title (con fallback al
    primo user_input nel wire.jsonl). NB: alcune sessioni Kimi non hanno
    state.json (es. quelle dei worker scrittore/scorer): in quel caso
    `session_to_agent` fa direttamente fallback al wire."""
    if not KIMI_DIR.exists():
        return
    for hd in KIMI_DIR.iterdir():
        if not hd.is_dir():
            continue
        for sd in hd.iterdir():
            if not sd.is_dir():
                continue
            wire = sd / "wire.jsonl"
            state = sd / "state.json"
            if not wire.exists():
                continue
            agent = session_to_agent(state, wire) or "?unknown"
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
                        if not isinstance(ts, (int, float)) or ts < since_ts:
                            continue
                        msg = e.get("message") or {}
                        pl = msg.get("payload") or {}
                        tu = pl.get("token_usage")
                        if not isinstance(tu, dict):
                            continue
                        w = billing_weighted(tu)
                        if w <= 0:
                            continue
                        by_agent[agent].append((float(ts), float(w)))
            except OSError:
                continue


def _collect_claude(by_agent: dict, since_ts: float) -> None:
    """Estende by_agent con eventi Claude sotto ~/.claude/projects/.
    Le directory hanno nome `-jht-home-agents-<agent>` — mapping diretto.
    Schema evento: {timestamp: ISO, message: {usage: {input_tokens, ...}}}.
    """
    if not CLAUDE_DIR.exists():
        return
    for proj_dir in CLAUDE_DIR.iterdir():
        if not proj_dir.is_dir():
            continue
        name = proj_dir.name
        if not name.startswith(CLAUDE_AGENT_PREFIX):
            continue
        agent = name[len(CLAUDE_AGENT_PREFIX):]
        for jsonl_file in proj_dir.glob("*.jsonl"):
            try:
                with jsonl_file.open() as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            e = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        ts_raw = e.get("timestamp") or e.get("ts")
                        ts = _parse_iso_to_ts(ts_raw) if isinstance(ts_raw, str) else 0.0
                        if ts <= 0 or ts < since_ts:
                            continue
                        msg = e.get("message") or {}
                        usage = msg.get("usage") if isinstance(msg, dict) else None
                        if not isinstance(usage, dict):
                            continue
                        w = billing_weighted_claude(usage)
                        if w <= 0:
                            continue
                        by_agent[agent].append((ts, float(w)))
            except OSError:
                continue


def collect_events(since_ts: float):
    """Aggrega eventi token weighted per ogni agente da TUTTI i provider
    locali (Kimi wire.jsonl + Claude project jsonl). Ritorna dict[agent]
    -> list[(ts, weighted)] ordinato cronologicamente.
    """
    by_agent: dict = defaultdict(list)
    _collect_kimi(by_agent, since_ts)
    _collect_claude(by_agent, since_ts)
    for a in by_agent:
        by_agent[a].sort()
    return by_agent


def build_series(by_agent, since_ts: float, now_ts: float, bucket_sec: int):
    """Costruisce serie cumulativa per agente a bucket fissi nel range
    [since_ts, now_ts]. Per ogni agente, ad ogni bucket il valore è il
    totale weighted (in kT) accumulato fino a quel momento.

    Ritorna (agents_sorted, series_list) dove series_list è una lista di
    dict {ts: iso, <agent>: kt, ...}.
    """
    if bucket_sec <= 0:
        bucket_sec = 60
    # Allinea il primo bucket al multiplo inferiore di bucket_sec.
    start = int(since_ts) - (int(since_ts) % bucket_sec)
    end = int(now_ts)
    n_buckets = max(1, (end - start) // bucket_sec + 1)

    # Ordina agenti per totale decrescente — utile per UI (legenda
    # ordinata, primi sopra).
    totals = {a: sum(w for _, w in evs) for a, evs in by_agent.items()}
    agents = sorted(totals.keys(), key=lambda a: -totals[a])

    # Per ogni agente, pre-computa il cumulativo a ogni bucket.
    series = []
    cumul = {a: 0.0 for a in agents}
    # Indice corrente nelle liste eventi
    idx = {a: 0 for a in agents}

    for b in range(n_buckets):
        bucket_end = start + (b + 1) * bucket_sec
        for a in agents:
            evs = by_agent[a]
            i = idx[a]
            while i < len(evs) and evs[i][0] < bucket_end:
                cumul[a] += evs[i][1]
                i += 1
            idx[a] = i
        ts_iso = datetime.fromtimestamp(
            start + b * bucket_sec, tz=timezone.utc
        ).isoformat()
        row = {"ts": ts_iso}
        for a in agents:
            # In kT, arrotondato a 2 decimali per risparmiare bytes
            # nel payload JSON (in 3h con bucket 60s = 180 righe).
            row[a] = round(cumul[a] / 1000.0, 2)
        series.append(row)

    return agents, series


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since-min", type=float, default=180.0,
                    help="finestra in minuti (default 180 = 3h)")
    ap.add_argument("--bucket-sec", type=int, default=60,
                    help="dimensione bucket in secondi (default 60)")
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    since = now - timedelta(minutes=args.since_min)
    now_ts = now.timestamp()
    since_ts = since.timestamp()

    by_agent = collect_events(since_ts)
    agents, series = build_series(by_agent, since_ts, now_ts, args.bucket_sec)

    totals_kt = {
        a: round(sum(w for _, w in by_agent[a]) / 1000.0, 2)
        for a in agents
    }
    events = {a: len(by_agent[a]) for a in agents}

    out = {
        "ok": True,
        "now": now.isoformat(),
        "since": since.isoformat(),
        "bucket_sec": args.bucket_sec,
        "agents": agents,
        "totals_kt": totals_kt,
        "events": events,
        "series": series,
    }
    json.dump(out, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
