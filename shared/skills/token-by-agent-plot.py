#!/usr/bin/env python3
"""token-by-agent-plot.py — consumo Kimi PER AGENTE nel tempo.

Mappa: session.dir → agent via state.json custom_title (regex @<name>).
Aggrega: per agente, cumulative weighted token nel tempo dal TEAM_START.
Output: PNG con
  • Pannello 1: cumulative kT per agente (1 linea per agente, emoji nel label)
  • Pannello 2: bar chart totale per agente
"""
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
KIMI = JHT_HOME / ".kimi" / "sessions"
OUT_PNG = Path(os.environ.get("OUT_PNG", "/jht_home/logs/token-by-agent.png"))

TEAM_START = datetime.fromisoformat(
    os.environ.get("TEAM_START", "2026-04-30T22:44:00+00:00")
)
TEAM_START_TS = TEAM_START.timestamp()

CACHE_R_W = 0.1
CACHE_C_W = 1.25

EMOJI = {
    "capitano":     "👑",
    "sentinella":   "🛡",
    "assistente":   "🤖",
    "scout-1":      "🕵1",
    "scout-2":      "🕵2",
    "analista-1":   "📊1",
    "analista-2":   "📊2",
    "scrittore-1":  "📝1",
    "scrittore-2":  "📝2",
    "scrittore-3":  "📝3",
    "scorer-1":     "⚖",
    "critico":      "🔎",
    "?unknown":     "❓",
}


def session_to_agent(state_path: Path):
    """Estrai l'agente OWNER della sessione dal custom_title.

    Pattern noti:
      "[@A -> @B] ..."             → owner = B (last @, receiver)
      "[@user -> @capitano] ..."   → owner = capitano
      "[SENTINELLA] [STATUS] ..."  → owner = sentinella  (broadcast)
      "[@assistente] ..."          → owner = assistente
    """
    try:
        with state_path.open() as f:
            state = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    title = state.get("custom_title", "") or ""
    # 1. Cerca @<name>: prendi l'ULTIMO match (receiver in "@A -> @B")
    cands = re.findall(r"@([a-zA-Z][\w-]*)", title)
    cands = [c.lower() for c in cands if c.lower() not in ("utente", "user")]
    if cands:
        return cands[-1]
    # 2. Fallback: nome agente in MAIUSCOLO tra parentesi quadre [SENTINELLA]
    m = re.match(r"^\[([A-Z][A-Z0-9_-]+)\]", title)
    if m:
        return m.group(1).lower().replace("_", "-")
    return None


def collect():
    """Ritorna dict[agent] -> list[(datetime, weighted_delta)]."""
    by_agent = defaultdict(list)
    if not KIMI.exists():
        return by_agent
    for hash_dir in KIMI.iterdir():
        if not hash_dir.is_dir():
            continue
        for sub in hash_dir.iterdir():
            if not sub.is_dir():
                continue
            wire = sub / "wire.jsonl"
            state = sub / "state.json"
            if not (wire.exists() and state.exists()):
                continue
            agent = session_to_agent(state) or "?unknown"
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
                        if not isinstance(ts, (int, float)) or ts < TEAM_START_TS:
                            continue
                        msg = e.get("message") or {}
                        pl = msg.get("payload") or {}
                        tu = pl.get("token_usage")
                        if not isinstance(tu, dict):
                            continue
                        w = (
                            tu.get("input_other", 0) + tu.get("output", 0)
                            + tu.get("input_cache_read", 0) * CACHE_R_W
                            + tu.get("input_cache_creation", 0) * CACHE_C_W
                        )
                        if w <= 0:
                            continue
                        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
                        by_agent[agent].append((dt, float(w)))
            except OSError:
                continue
    for a in by_agent:
        by_agent[a].sort()
    return by_agent


def main():
    print(f"[plot] team_start = {TEAM_START}")
    by_agent = collect()
    if not by_agent:
        print("[plot] no data")
        return

    # Stat totali per agente
    totals = {a: sum(w for _, w in evs) for a, evs in by_agent.items()}
    n_events = {a: len(evs) for a, evs in by_agent.items()}

    print(f"\n{'AGENTE':<14} {'EVENTS':>7} {'WEIGHTED kT':>12}")
    print("─" * 36)
    for a in sorted(totals, key=lambda x: -totals[x]):
        print(f"{a:<14} {n_events[a]:>7} {totals[a]/1000:>11,.1f}")
    print("─" * 36)
    print(f"{'TOTAL':<14} {sum(n_events.values()):>7} {sum(totals.values())/1000:>11,.1f}")

    # Plot
    fig, axes = plt.subplots(2, 1, figsize=(14, 9),
                             gridspec_kw={"height_ratios": [2.5, 1]})
    fig.suptitle(
        f"JHT Token consumption per agente — da {TEAM_START.strftime('%H:%M UTC')}",
        fontsize=14, fontweight="bold"
    )

    # Pannello 1: linee cumulative
    ax = axes[0]
    cmap = plt.cm.tab20
    sorted_agents = sorted(totals, key=lambda x: -totals[x])
    for i, agent in enumerate(sorted_agents):
        evs = by_agent[agent]
        times = [e[0] for e in evs]
        cum = []
        s = 0
        for _, w in evs:
            s += w
            cum.append(s / 1000)
        emoji = EMOJI.get(agent, "?")
        label = f"{emoji} {agent}  ({totals[agent]/1000:.1f} kT, {n_events[agent]} ev)"
        ax.plot(times, cum, linewidth=2, marker="o", markersize=3,
                color=cmap(i % 20), label=label)
    ax.set_ylabel("kT cumulati (weighted)", fontsize=11)
    ax.grid(alpha=0.3)
    ax.legend(loc="upper left", fontsize=9, framealpha=0.92, ncol=2)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M", tz=timezone.utc))
    ax.set_title("Consumo cumulativo per agente nel tempo", fontsize=12)

    # Pannello 2: bar totali
    ax = axes[1]
    labels = [f"{EMOJI.get(a,'?')} {a}" for a in sorted_agents]
    vals = [totals[a] / 1000 for a in sorted_agents]
    colors = [cmap(i % 20) for i in range(len(sorted_agents))]
    bars = ax.barh(range(len(labels))[::-1], vals[::-1], color=colors[::-1],
                   edgecolor="black", linewidth=0.5)
    ax.set_yticks(range(len(labels))[::-1])
    ax.set_yticklabels(labels[::-1], fontsize=11)
    ax.set_xlabel("kT weighted (totale)")
    ax.set_title(f"Totale per agente (team total: {sum(totals.values())/1000:.1f} kT)",
                 fontsize=12)
    ax.grid(alpha=0.3, axis="x")
    for bar, v in zip(bars, vals[::-1]):
        ax.text(v + max(vals) * 0.01, bar.get_y() + bar.get_height() / 2,
                f"{v:.1f} kT", va="center", fontsize=9)

    plt.tight_layout()
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT_PNG, dpi=120, bbox_inches="tight")
    print(f"\n[plot] saved {OUT_PNG}")


if __name__ == "__main__":
    main()
