#!/usr/bin/env python3
"""agent-communication-graph.py — chi parla a chi nel team JHT.

Legge tutti gli state.json delle sessioni Kimi, parsea il custom_title
con pattern [@A -> @B], aggrega gli archi, plotta network graph.

Output:
  • PNG con nodi=agenti, archi pesati per # messaggi e weighted token
  • lista archi top per console
"""
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import math

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, Circle

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
KIMI = JHT_HOME / ".kimi" / "sessions"
OUT_PNG = Path(os.environ.get("OUT_PNG", "/jht_home/logs/agent-communication.png"))

TEAM_START = datetime.fromisoformat(
    os.environ.get("TEAM_START", "2026-04-30T22:44:00+00:00")
)
TEAM_START_TS = TEAM_START.timestamp()

CACHE_R_W = 0.1
CACHE_C_W = 1.25


def session_weighted(wire_path: Path) -> tuple[float, int]:
    w = 0.0
    n = 0
    if not wire_path.exists():
        return 0.0, 0
    try:
        with wire_path.open() as f:
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
                w += (
                    tu.get("input_other", 0) + tu.get("output", 0)
                    + tu.get("input_cache_read", 0) * CACHE_R_W
                    + tu.get("input_cache_creation", 0) * CACHE_C_W
                )
                n += 1
    except OSError:
        return 0.0, 0
    return w, n


def parse_title(title: str):
    """Ritorna (sender, receiver, msg_type) dal custom_title."""
    if not title:
        return None, None, None
    # pattern: [@A -> @B] [TYPE] ...
    m = re.match(r"^\[@?([\w-]+)\s*->\s*@?([\w-]+)\]\s*\[([\w]+)\]", title)
    if m:
        return m.group(1).lower(), m.group(2).lower(), m.group(3).upper()
    # fallback: [@A -> @B] ...
    m = re.match(r"^\[@?([\w-]+)\s*->\s*@?([\w-]+)\]", title)
    if m:
        return m.group(1).lower(), m.group(2).lower(), "MSG"
    # broadcast: [SENTINELLA] [STATUS] ... = sender = receiver = SENTINELLA
    m = re.match(r"^\[([A-Z][A-Z0-9_-]+)\]\s*\[([\w]+)\]", title)
    if m:
        a = m.group(1).lower().replace("_", "-")
        return a, a, m.group(2).upper()
    return None, None, None


def collect():
    """Aggrega per coppia (sender, receiver):
       msgs = numero di sessioni
       weighted = somma kT consumati nelle sessioni di quella coppia
    """
    edges_msgs = defaultdict(int)
    edges_weighted = defaultdict(float)
    msg_types = defaultdict(int)
    nodes = set()

    if not KIMI.exists():
        return edges_msgs, edges_weighted, msg_types, nodes

    for hd in KIMI.iterdir():
        if not hd.is_dir():
            continue
        for sd in hd.iterdir():
            if not sd.is_dir():
                continue
            state_f = sd / "state.json"
            wire_f = sd / "wire.jsonl"
            if not (state_f.exists() and wire_f.exists()):
                continue
            try:
                with state_f.open() as f:
                    state = json.load(f)
            except (OSError, json.JSONDecodeError):
                continue
            sender, receiver, mtype = parse_title(state.get("custom_title"))
            if not sender or not receiver:
                continue
            # filtra "utente" come sender? lo teniamo per visibilità del Comandante
            # ma marcato separatamente
            w, n = session_weighted(wire_f)
            if w <= 0:
                continue
            sender = sender.lower()
            receiver = receiver.lower()
            edges_msgs[(sender, receiver)] += 1
            edges_weighted[(sender, receiver)] += w
            msg_types[mtype] += 1
            nodes.add(sender)
            nodes.add(receiver)
    return edges_msgs, edges_weighted, msg_types, nodes


def main():
    print(f"[graph] team_start = {TEAM_START}")
    edges_msgs, edges_weighted, msg_types, nodes = collect()

    if not edges_msgs:
        print("[graph] no edges found")
        return

    print(f"\n=== nodi: {len(nodes)} ===")
    print(f"agenti coinvolti: {sorted(nodes)}")
    print(f"\n=== archi top per # sessioni ===")
    for (s, r), n in sorted(edges_msgs.items(), key=lambda x: -x[1])[:15]:
        w = edges_weighted[(s, r)] / 1000
        print(f"  {s:>14} → {r:<14}  msgs={n:>3}  weighted={w:>7.1f} kT")
    print(f"\n=== distribuzione tipi messaggio ===")
    for t, n in sorted(msg_types.items(), key=lambda x: -x[1]):
        print(f"  {t:<10} {n}")

    # ── Layout: utente al centro-alto, capitano al centro,
    #            sentinella in alto-destra,
    #            agenti operativi ai vertici di un poligono inferiore
    role_layout = {
        "utente":      (0.0,  0.95),
        "capitano":    (0.0,  0.50),
        "sentinella":  (0.65, 0.85),
        "assistente":  (-0.65, 0.85),
        # operativi: poligono in basso
        "scout-1":     (-0.80, -0.10),
        "scout-2":     (-0.80, -0.40),
        "analista-1":  (-0.30, -0.55),
        "analista-2":  (-0.30, -0.85),
        "scrittore-1": (0.30, -0.85),
        "scrittore-2": (0.30, -0.55),
        "scrittore-3": (0.55, -0.30),
        "scorer-1":    (0.80, -0.10),
        "critico":     (0.80, -0.40),
    }
    # default per agenti non noti
    extra = [n for n in nodes if n not in role_layout]
    for i, name in enumerate(extra):
        angle = (i / max(1, len(extra))) * 2 * math.pi
        role_layout[name] = (math.cos(angle) * 0.5, math.sin(angle) * 0.5 - 0.2)

    # ── Plot
    fig, ax = plt.subplots(figsize=(13, 11))
    fig.patch.set_facecolor("#0e1117")
    ax.set_facecolor("#0e1117")
    ax.set_xlim(-1.15, 1.15)
    ax.set_ylim(-1.15, 1.15)
    ax.set_aspect("equal")
    ax.axis("off")

    EMOJI = {
        "capitano": "👑", "sentinella": "🛡", "assistente": "🤖",
        "scout-1": "🕵 1", "scout-2": "🕵 2",
        "analista-1": "📊 1", "analista-2": "📊 2",
        "scrittore-1": "📝 1", "scrittore-2": "📝 2", "scrittore-3": "📝 3",
        "scorer-1": "⚖", "critico": "🔎",
        "utente": "🧑‍💻",
    }

    # nodi: dimensione = somma weighted in/out, colore per ruolo
    node_w = defaultdict(float)
    for (s, r), w in edges_weighted.items():
        node_w[s] += w
        node_w[r] += w
    max_node_w = max(node_w.values()) if node_w else 1.0

    role_color = {
        "utente":      "#ffd700",
        "capitano":    "#7c3aed",
        "sentinella":  "#10b981",
        "assistente":  "#0ea5e9",
        "scout":       "#3b82f6",
        "analista":    "#f59e0b",
        "scrittore":   "#ef4444",
        "scorer":      "#8b5cf6",
        "critico":     "#ec4899",
    }

    def color_for(name):
        for k, c in role_color.items():
            if name.startswith(k):
                return c
        return "#9ca3af"

    # archi
    max_msgs = max(edges_msgs.values())
    for (s, r), n in edges_msgs.items():
        if s not in role_layout or r not in role_layout:
            continue
        x1, y1 = role_layout[s]
        x2, y2 = role_layout[r]
        if (x1, y1) == (x2, y2):
            # self-loop = broadcast (es. SENTINELLA -> SENTINELLA)
            continue
        lw = 0.5 + 5 * (n / max_msgs)
        alpha = 0.3 + 0.6 * (n / max_msgs)
        w_kt = edges_weighted[(s, r)] / 1000
        # arco curvato per evitare sovrapposizione con il reverse
        rad = 0.15 if (r, s) in edges_msgs else 0.0
        arr = FancyArrowPatch(
            (x1, y1), (x2, y2),
            connectionstyle=f"arc3,rad={rad}",
            arrowstyle="-|>", mutation_scale=15,
            linewidth=lw, color="#cbd5e1", alpha=alpha, zorder=2,
        )
        ax.add_patch(arr)
        # label sull'arco con # msgs e kT
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        # offset perpendicolare per leggibilità
        dx, dy = x2 - x1, y2 - y1
        norm = (dx ** 2 + dy ** 2) ** 0.5 or 1
        ox, oy = -dy / norm * 0.04, dx / norm * 0.04
        if n >= max(1, max_msgs * 0.05):
            ax.text(mx + ox, my + oy, f"{n}m\n{w_kt:.0f}kT",
                    fontsize=8, color="#e5e7eb", ha="center", va="center",
                    bbox=dict(facecolor="#1f2937", edgecolor="none", alpha=0.7,
                             boxstyle="round,pad=0.2"))

    # nodi
    for name, (x, y) in role_layout.items():
        if name not in nodes:
            continue
        size_factor = 0.06 + 0.10 * (node_w[name] / max_node_w)
        c = Circle((x, y), size_factor, facecolor=color_for(name),
                   edgecolor="white", linewidth=1.5, zorder=3, alpha=0.9)
        ax.add_patch(c)
        # label
        emoji = EMOJI.get(name, "?")
        ax.text(x, y, emoji, fontsize=14, color="white",
                ha="center", va="center", zorder=4, fontweight="bold")
        kt = node_w[name] / 1000
        ax.text(x, y - size_factor - 0.04, f"{name}\n{kt:.0f} kT total",
                fontsize=9, color="#cbd5e1", ha="center", va="top", zorder=4)

    title = (f"JHT Communication Graph — {TEAM_START.strftime('%H:%M UTC')} → now\n"
             f"{sum(edges_msgs.values())} sessioni, {len(nodes)} agenti, "
             f"{int(sum(edges_weighted.values())/1000):,} kT scambiati")
    ax.set_title(title, color="white", fontsize=14, fontweight="bold", pad=10)

    # legenda tipi messaggio
    legend_y = -1.05
    type_order = sorted(msg_types.items(), key=lambda x: -x[1])[:6]
    legend_text = "  ·  ".join([f"{t}={n}" for t, n in type_order])
    ax.text(0, legend_y, f"Message types:  {legend_text}",
            fontsize=9, color="#9ca3af", ha="center")

    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT_PNG, dpi=130, facecolor=fig.get_facecolor(),
                bbox_inches="tight")
    print(f"\n[graph] saved {OUT_PNG}")


if __name__ == "__main__":
    main()
