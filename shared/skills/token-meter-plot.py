#!/usr/bin/env python3
"""token-meter-plot.py — analisi retroattiva token consumati dal team.

Filtra dati da TEAM_START in poi (default: 22:44 UTC = 00:44 CEST 30/04).
Aggrega:
  • Cumulativo weighted token (Kimi wire.jsonl)
  • % rate budget bridge (sentinel-data.jsonl)
  • Velocità tok/min in finestra mobile

Output: PNG salvato a $OUT_PNG.
"""
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
KIMI_SESSIONS = JHT_HOME / ".kimi" / "sessions"
DATA_JSONL = JHT_HOME / "logs" / "sentinel-data.jsonl"
OUT_PNG = Path(os.environ.get("OUT_PNG", "/jht_home/logs/token-analysis.png"))

# default = 22:44 UTC (mezzanotte 44 CEST 30/04)
TEAM_START = datetime.fromisoformat(
    os.environ.get("TEAM_START", "2026-04-30T22:44:00+00:00")
)

CACHE_READ_W = 0.1
CACHE_CREATION_W = 1.25


def kimi_events_from_team_start():
    """Genera (datetime, weighted_delta_token, agent_session) per ogni evento Kimi."""
    if not KIMI_SESSIONS.exists():
        return
    for wire in KIMI_SESSIONS.rglob("wire.jsonl"):
        sess = wire.parent.parent.name + "/" + wire.parent.name[:8]
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
                    ts_raw = e.get("timestamp")
                    if not isinstance(ts_raw, (int, float)):
                        continue
                    dt = datetime.fromtimestamp(ts_raw, tz=timezone.utc)
                    if dt < TEAM_START:
                        continue
                    msg = e.get("message") or {}
                    pl = msg.get("payload") or {}
                    tu = pl.get("token_usage")
                    if not isinstance(tu, dict):
                        continue
                    w = (
                        tu.get("input_other", 0) + tu.get("output", 0)
                        + tu.get("input_cache_read", 0) * CACHE_READ_W
                        + tu.get("input_cache_creation", 0) * CACHE_CREATION_W
                    )
                    yield (dt, float(w), sess, dict(tu))
        except OSError:
            continue


def bridge_samples_from_team_start():
    """Genera (dt, usage_pct, projection, status) dai sample bridge."""
    if not DATA_JSONL.exists():
        return
    with DATA_JSONL.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("source") != "bridge":
                continue
            ts_str = e.get("ts", "")
            try:
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                continue
            if dt < TEAM_START:
                continue
            yield (dt, e.get("usage"), e.get("projection"), e.get("status"))


def main():
    print(f"[plot] team start = {TEAM_START.isoformat()}")
    print(f"[plot] reading kimi events…")

    events = sorted(kimi_events_from_team_start(), key=lambda x: x[0])
    print(f"[plot] kimi events: {len(events)}")

    bridge = sorted(bridge_samples_from_team_start(), key=lambda x: x[0])
    print(f"[plot] bridge samples: {len(bridge)}")

    if not events or not bridge:
        print("[plot] not enough data, abort")
        sys.exit(1)

    # 1. Cumulative weighted tokens
    times_t = []
    cum_w = []
    running = 0.0
    by_agent = defaultdict(float)
    raw_in = 0
    raw_out = 0
    raw_cache_r = 0
    for dt, w, sess, tu in events:
        running += w
        times_t.append(dt)
        cum_w.append(running)
        # raggruppa per agent (estraibile da sess hash) — qui usiamo sess id
        by_agent[sess] += w
        raw_in += tu.get("input_other", 0)
        raw_out += tu.get("output", 0)
        raw_cache_r += tu.get("input_cache_read", 0)

    # 2. Bridge curve (% rate budget)
    times_b = [b[0] for b in bridge]
    pct = [b[1] for b in bridge if b[1] is not None]
    times_b_pct = [b[0] for b in bridge if b[1] is not None]
    proj = [b[2] for b in bridge if b[2] is not None]
    times_b_proj = [b[0] for b in bridge if b[2] is not None]

    # 3. Velocity weighted token / minuto (rolling 60s)
    vel_times = []
    vel_vals = []
    win = 60.0
    j = 0
    for i in range(len(events)):
        # somma weighted in [t_i - 60s, t_i]
        cutoff = events[i][0] - timedelta(seconds=win)
        while j < i and events[j][0] < cutoff:
            j += 1
        s = sum(e[1] for e in events[j:i + 1])
        vel_times.append(events[i][0])
        vel_vals.append(s)  # token in 60s ≈ tok/min

    # 4. Ratio incrementale tra tick consecutivi del bridge
    ratio_times = []
    ratio_vals = []
    for k in range(1, len(bridge)):
        t_prev = bridge[k - 1]
        t_now = bridge[k]
        if t_prev[1] is None or t_now[1] is None:
            continue
        d_pct = t_now[1] - t_prev[1]
        if d_pct <= 0:
            continue
        # sum weighted in [t_prev.dt, t_now.dt]
        d_w = sum(e[1] for e in events if t_prev[0] < e[0] <= t_now[0])
        if d_w <= 0:
            continue
        ratio_times.append(t_now[0])
        ratio_vals.append(d_w / d_pct / 1000)  # kT per 1%

    # ── PLOT ────────────────────────────────────────────────────────────
    fig = plt.figure(figsize=(14, 12))
    gs = fig.add_gridspec(4, 1, height_ratios=[2.2, 1.5, 1.5, 2], hspace=0.45)
    fig.suptitle(
        f"JHT Token Analysis — da {TEAM_START.strftime('%H:%M UTC')} a {events[-1][0].strftime('%H:%M UTC')} "
        f"({len(events)} kimi events, {len(bridge)} bridge ticks)",
        fontsize=14, fontweight="bold", y=0.995
    )

    # X-axis range: dinamico sui dati reali, non sul TEAM_START fisso
    x_min = min(events[0][0], bridge[0][0]) if bridge else events[0][0]
    x_max = max(events[-1][0], bridge[-1][0]) if bridge else events[-1][0]
    pad = (x_max - x_min) * 0.02
    x_lim = (x_min - pad, x_max + pad)

    ax0 = fig.add_subplot(gs[0])
    ax0.plot(times_t, [w / 1000 for w in cum_w], color="tab:blue", linewidth=2.2,
             label="Token weighted cumulativi (kT)")
    ax0.set_ylabel("kT (cumulati)", fontsize=10, color="tab:blue")
    ax0.tick_params(axis="y", labelcolor="tab:blue")
    ax0.grid(alpha=0.3)
    ax0.set_xlim(x_lim)
    ax0.legend(loc="upper left", framealpha=0.9)

    ax0r = ax0.twinx()
    ax0r.plot(times_b_pct, pct, color="tab:red", linewidth=1.8,
              marker="o", markersize=5, label="bridge usage %", zorder=3)
    if proj:
        ax0r.plot(times_b_proj, proj, color="tab:orange", linewidth=1,
                  linestyle="--", alpha=0.6, label="bridge projection %")
    ax0r.set_ylabel("% rate budget", color="tab:red", fontsize=10)
    ax0r.tick_params(axis="y", labelcolor="tab:red")
    ax0r.legend(loc="upper right", framealpha=0.9)
    ax0.set_title("Token weighted (cum.)  vs  % rate budget bridge", fontsize=11)

    ax1 = fig.add_subplot(gs[1], sharex=ax0)
    ax1.plot(vel_times, [v / 1000 for v in vel_vals], color="tab:green", linewidth=1.6)
    ax1.fill_between(vel_times, 0, [v / 1000 for v in vel_vals],
                     alpha=0.2, color="tab:green")
    ax1.set_ylabel("kT/min (60s)", fontsize=10)
    ax1.grid(alpha=0.3)
    ax1.set_title("Velocità: weighted token consumati negli ultimi 60s", fontsize=11)

    ax2 = fig.add_subplot(gs[2], sharex=ax0)
    if ratio_vals:
        # bar width = mediana tra-tick / 1.5 (visibile ma non sovrapposto)
        widths = [(ratio_times[i] - (ratio_times[i-1] if i > 0 else ratio_times[0])).total_seconds()
                  for i in range(len(ratio_times))]
        median_w = (sorted(widths)[len(widths)//2] if widths else 60) / 86400.0  # in days
        bar_w = max(median_w * 0.7, 0.0008)
        avg = sum(ratio_vals) / len(ratio_vals)
        # color-code per Δ% ampia (più affidabile)
        colors = ["tab:purple" if r >= 60 else "tab:gray" for r in ratio_vals]
        ax2.bar(ratio_times, ratio_vals, width=bar_w, color=colors, alpha=0.75,
                edgecolor="black", linewidth=0.5)
        ax2.axhline(avg, color="tab:red", linestyle="--", linewidth=1.2,
                    label=f"media = {avg:.0f} kT/%")
        # mostra valori su ogni bar
        for t, v in zip(ratio_times, ratio_vals):
            ax2.text(t, v + 3, f"{v:.0f}", ha="center", va="bottom", fontsize=8)
    ax2.set_ylabel("kT per 1% (incrementale)", fontsize=10)
    ax2.grid(alpha=0.3)
    ax2.legend(loc="upper right")
    ax2.set_title("Calibrazione: kT consumati tra 2 tick consecutivi del bridge",
                  fontsize=11)

    ax3 = fig.add_subplot(gs[3])
    top = sorted(by_agent.items(), key=lambda x: -x[1])[:10]
    labels = [t[0][:30] for t in top]  # tronca id sessione lunghi
    vals = [t[1] / 1000 for t in top]
    bars = ax3.barh(range(len(labels))[::-1], vals[::-1], color="tab:cyan",
                    edgecolor="black", linewidth=0.4)
    ax3.set_yticks(range(len(labels))[::-1])
    ax3.set_yticklabels(labels[::-1], fontsize=8, family="monospace")
    ax3.set_xlabel("kT weighted")
    ax3.set_title(f"Top sessioni Kimi per consumo (totale {sum(by_agent.values())/1e3:.1f} kT)",
                  fontsize=11)
    ax3.grid(alpha=0.3, axis="x")
    for bar, v in zip(bars, vals[::-1]):
        ax3.text(v + max(vals) * 0.01, bar.get_y() + bar.get_height() / 2,
                 f"{v:.1f} kT", va="center", fontsize=8)

    for ax in (ax0, ax1, ax2):
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M", tz=timezone.utc))
        ax.xaxis.set_major_locator(mdates.MinuteLocator(interval=5))

    plt.tight_layout()
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT_PNG, dpi=120, bbox_inches="tight")
    print(f"[plot] saved {OUT_PNG}")

    # console summary
    elapsed = (events[-1][0] - events[0][0]).total_seconds() / 60.0
    print(f"\n=== SUMMARY ===")
    print(f"timespan:           {elapsed:.1f} min")
    print(f"events:             {len(events)} kimi, {len(bridge)} bridge")
    print(f"raw input_other:    {raw_in:>12,} tok")
    print(f"raw output:         {raw_out:>12,} tok")
    print(f"raw cache_read:     {raw_cache_r:>12,} tok")
    print(f"weighted total:     {int(running):>12,} tok")
    print(f"avg velocity:       {running/elapsed/1000:.2f} kT/min")
    if ratio_vals:
        print(f"ratio incrementale: {sum(ratio_vals)/len(ratio_vals):.2f} kT per 1% "
              f"(min {min(ratio_vals):.1f}, max {max(ratio_vals):.1f}, n={len(ratio_vals)})")
    print(f"bridge pct range:   {min(pct)}% → {max(pct)}%")


if __name__ == "__main__":
    main()
