#!/usr/bin/env python3
"""token-by-agent-rate.py — VELOCITÀ media dei token per agente nel tempo.

Stessa fonte di token-by-agent-plot.py (Kimi wire.jsonl, mapping via state.json),
ma plotta:
  • Pannello 1: rolling-window rate (kT/min) per agente — finestra ROLL_WIN_S
  • Pannello 2: velocità media sul periodo per agente (bar chart)
"""
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

sys.path.insert(0, str(Path(__file__).resolve().parent))
import token_metrics_lib as tlib  # noqa: E402

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
KIMI = JHT_HOME / ".kimi" / "sessions"
OUT_PNG = Path(os.environ.get("OUT_PNG", "/jht_home/logs/token-by-agent-rate.png"))

TEAM_START = datetime.fromisoformat(
    os.environ.get("TEAM_START", "2026-04-30T22:44:00+00:00")
)
TEAM_START_TS = TEAM_START.timestamp()

# Finestra rolling per la media: 120s (più stabile) o 60s (più reattivo).
ROLL_WIN_S = float(os.environ.get("ROLL_WIN_S", "120"))

EMOJI = {
    "capitano": "👑", "sentinella": "🛡", "assistente": "🤖",
    "scout-1": "🕵", "scout-2": "🕵2",
    "analista-1": "📊", "analista-2": "📊2",
    "scrittore-1": "📝1", "scrittore-2": "📝2", "scrittore-3": "📝3",
    "scorer-1": "⚖", "critico": "🔎", "?unknown": "❓",
}


def collect():
    """Ritorna dict[agent] -> list[(ts_float, weighted)] usando la lib."""
    events = tlib.read_kimi_events(TEAM_START_TS, sessions_root=KIMI)
    by_agent = defaultdict(list)
    for e in events:
        agent = e["agent"] or "?unknown"
        by_agent[agent].append((e["ts"], e["weighted"]))
    return by_agent


def rolling_rate(events, win_s):
    """Wrapper su tlib.rolling_rate che ritorna [(dt, kT/min)] (la lib è
    in token/min, qui dividiamo per 1000 per kT/min)."""
    raw = tlib.rolling_rate(events, win_s)
    return [(dt, rate_per_min / 1000.0) for dt, rate_per_min in raw]


def main():
    print(f"[plot] team_start = {TEAM_START}, rolling = {ROLL_WIN_S}s")
    by_agent = collect()
    if not by_agent:
        print("[plot] no data")
        return

    # Stat
    totals = {a: sum(w for _, w in evs) for a, evs in by_agent.items()}
    n_events = {a: len(evs) for a, evs in by_agent.items()}
    # Span per agente
    spans = {}
    for a, evs in by_agent.items():
        if len(evs) >= 2:
            spans[a] = (evs[-1][0] - evs[0][0]) / 60.0  # minuti
        else:
            spans[a] = 0.0
    avg_rate = {
        a: (totals[a] / 1000) / spans[a] if spans[a] > 0 else 0
        for a in totals
    }

    print(f"\n{'AGENTE':<14} {'EVENTS':>7} {'kT total':>10} "
          f"{'span min':>9} {'avg kT/min':>11}")
    print("─" * 56)
    for a in sorted(totals, key=lambda x: -avg_rate[x]):
        print(f"{a:<14} {n_events[a]:>7} {totals[a]/1000:>9.1f} "
              f"{spans[a]:>9.1f} {avg_rate[a]:>11.2f}")
    print("─" * 56)

    # Plot
    fig, axes = plt.subplots(2, 1, figsize=(14, 9),
                             gridspec_kw={"height_ratios": [2.5, 1]})
    fig.suptitle(
        f"JHT Token rate per agente — rolling {int(ROLL_WIN_S)}s — "
        f"da {TEAM_START.strftime('%H:%M UTC')}",
        fontsize=14, fontweight="bold"
    )

    cmap = plt.cm.tab20
    sorted_agents = sorted(totals, key=lambda x: -avg_rate[x])

    ax = axes[0]
    for i, agent in enumerate(sorted_agents):
        rates = rolling_rate(by_agent[agent], ROLL_WIN_S)
        if not rates:
            continue
        times = [r[0] for r in rates]
        vals = [r[1] for r in rates]
        emoji = EMOJI.get(agent, "?")
        label = (f"{emoji} {agent}  (avg {avg_rate[agent]:.1f} kT/min, "
                 f"peak {max(vals):.1f}, {n_events[agent]} ev)")
        ax.plot(times, vals, linewidth=2, marker="o", markersize=3,
                color=cmap(i % 20), label=label, alpha=0.85)
    ax.set_ylabel(f"kT/min  (rolling {int(ROLL_WIN_S)}s)", fontsize=11)
    ax.grid(alpha=0.3)
    ax.legend(loc="upper right", fontsize=9, framealpha=0.92, ncol=1)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M", tz=timezone.utc))
    ax.set_title(
        f"Velocità di consumo: weighted token per minuto, finestra mobile {int(ROLL_WIN_S)}s",
        fontsize=12,
    )

    ax = axes[1]
    labels = [f"{EMOJI.get(a,'?')} {a}" for a in sorted_agents]
    vals = [avg_rate[a] for a in sorted_agents]
    colors = [cmap(i % 20) for i in range(len(sorted_agents))]
    bars = ax.barh(range(len(labels))[::-1], vals[::-1], color=colors[::-1],
                   edgecolor="black", linewidth=0.5)
    ax.set_yticks(range(len(labels))[::-1])
    ax.set_yticklabels(labels[::-1], fontsize=11)
    ax.set_xlabel("kT/min  (media sull'intero periodo dell'agente)")
    team_avg = sum(totals.values()) / 1000 / max(spans.values()) if spans else 0
    ax.set_title(
        f"Velocità media per agente (team avg: {team_avg:.1f} kT/min nel periodo più lungo)",
        fontsize=12,
    )
    ax.grid(alpha=0.3, axis="x")
    for bar, v in zip(bars, vals[::-1]):
        ax.text(v + max(vals) * 0.01, bar.get_y() + bar.get_height() / 2,
                f"{v:.2f} kT/min", va="center", fontsize=9)

    plt.tight_layout()
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT_PNG, dpi=120, bbox_inches="tight")
    print(f"\n[plot] saved {OUT_PNG}")


if __name__ == "__main__":
    main()
