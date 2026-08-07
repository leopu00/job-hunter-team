#!/usr/bin/env python3
"""host_vitals.py — campionamento RAM/CPU del container + summary.

Una SOLA fonte di verità per i vitals di sistema, usata da due consumatori:

  - **sentinel-bridge.py** (a ogni tick, ~2-10 min): `append_sample()` scrive un
    record su `vitals.jsonl` — un FILE DEDICATO, NON il tick della Sentinella (la
    Sentinella NON viene avvisata del consumo PC nel suo flusso decisionale di
    quota). Il bridge usa `over_threshold()` per mandare un `[VITALS ALERT]` alla
    Sentinella **solo** se RAM o CPU superano la soglia (default 95%).
  - **Mantenitore** (1×/giorno): `summary` (CLI) per leggere picchi/trend delle
    ultime 24h e metterli IN CROCE con la diagnosi infra.

Letture (Linux): RAM da **cgroup v2** (`memory.current`/`memory.max` = uso reale
del container vs limite) con fallback `/proc/meminfo`; CPU da delta `/proc/stat`
(% sull'intervallo di campionamento) + `/proc/loadavg` come contesto. Zero LLM,
zero dipendenze esterne. Degrada a campi `None` fuori da Linux.

CLI:
    python3 host_vitals.py sample [--file PATH]     # campiona + append (bridge)
    python3 host_vitals.py current                  # solo lettura, stampa JSON
    python3 host_vitals.py check [--pct 95]         # exit 1 + righe se sopra soglia
    python3 host_vitals.py summary [--hours 24]     # picchi/medie (Mantenitore)
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

CGROUP = Path("/sys/fs/cgroup")
DEFAULT_FILE = Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht"))) / "logs" / "vitals.jsonl"
MAX_LINES = 4000  # ~7+ giorni a 1 sample / 2-10 min — cap anti-crescita


def _read_int(p):
    try:
        return int(Path(p).read_text().strip())
    except Exception:
        return None


def _mem():
    """RAM dal cgroup v2 (uso reale container vs limite); fallback /proc/meminfo."""
    cur = _read_int(CGROUP / "memory.current")
    mx = None
    try:
        raw = (CGROUP / "memory.max").read_text().strip()
        mx = None if raw == "max" else int(raw)
    except Exception:
        pass
    swap_pct = None
    try:
        sc = _read_int(CGROUP / "memory.swap.current")
        sm = (CGROUP / "memory.swap.max").read_text().strip()
        sm = None if sm == "max" else int(sm)
        if sc is not None and sm:
            swap_pct = round(sc / sm * 100, 1)
    except Exception:
        pass
    if cur is not None and mx:
        return {"src": "cgroup", "used_bytes": cur, "total_bytes": mx,
                "pct": round(cur / mx * 100, 1), "swap_pct": swap_pct}
    # fallback /proc/meminfo
    info = {}
    try:
        for ln in Path("/proc/meminfo").read_text().splitlines():
            k, _, v = ln.partition(":")
            if v.strip():
                info[k.strip()] = int(v.strip().split()[0]) * 1024
    except Exception:
        return {"src": "none", "used_bytes": None, "total_bytes": None, "pct": None, "swap_pct": None}
    total = info.get("MemTotal")
    avail = info.get("MemAvailable")
    used = (total - avail) if (total and avail is not None) else None
    st = info.get("SwapTotal")
    sf = info.get("SwapFree")
    if st and sf is not None and st > 0:
        swap_pct = round((st - sf) / st * 100, 1)
    return {"src": "meminfo", "used_bytes": used, "total_bytes": total,
            "pct": round(used / total * 100, 1) if (used and total) else None,
            "swap_pct": swap_pct}


def _cpu(sample_s=0.25):
    """CPU% sull'intervallo (delta /proc/stat) + loadavg di contesto."""
    def snap():
        parts = Path("/proc/stat").read_text().splitlines()[0].split()[1:]
        vals = [int(x) for x in parts]
        idle = vals[3] + (vals[4] if len(vals) > 4 else 0)  # idle + iowait
        return sum(vals), idle
    pct = None
    try:
        t0, i0 = snap()
        time.sleep(sample_s)
        t1, i1 = snap()
        dt, di = t1 - t0, i1 - i0
        if dt > 0:
            pct = round((1 - di / dt) * 100, 1)
    except Exception:
        pass
    load = None
    try:
        load = [float(x) for x in Path("/proc/loadavg").read_text().split()[:3]]
    except Exception:
        pass
    return {"pct": pct, "ncpu": os.cpu_count() or 1,
            "load1": load[0] if load else None,
            "load5": load[1] if load else None,
            "load15": load[2] if load else None}


def read_vitals(ts=None):
    return {"ts": ts or datetime.now(timezone.utc).isoformat(), "cpu": _cpu(), "mem": _mem()}


def over_threshold(v, pct=95):
    """Ritorna lista di stringhe 'risorsa N%' per ciò che supera la soglia."""
    out = []
    cp = (v.get("cpu") or {}).get("pct")
    mp = (v.get("mem") or {}).get("pct")
    sp = (v.get("mem") or {}).get("swap_pct")
    if cp is not None and cp >= pct:
        out.append(f"CPU {cp}%")
    if mp is not None and mp >= pct:
        out.append(f"RAM {mp}%")
    if sp is not None and sp >= pct:
        out.append(f"SWAP {sp}%")
    return out


def append_sample(path=None, max_lines=MAX_LINES):
    """Campiona e appende a vitals.jsonl; tronca ai max_lines più recenti."""
    path = Path(path) if path else DEFAULT_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    v = read_vitals()
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(v) + "\n")
    # prune cheap: solo se sforiamo il cap
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
        if len(lines) > max_lines:
            path.write_text("\n".join(lines[-max_lines:]) + "\n", encoding="utf-8")
    except Exception:
        pass
    return v


def summarize(path=None, hours=24):
    """Picchi/medie sulle ultime `hours` ore — per il Mantenitore."""
    path = Path(path) if path else DEFAULT_FILE
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    cpu, mem, swap = [], [], []
    peak_cpu = peak_mem = None
    n = 0
    try:
        for ln in path.read_text(encoding="utf-8").splitlines():
            ln = ln.strip()
            if not ln:
                continue
            try:
                v = json.loads(ln)
                if datetime.fromisoformat(v["ts"]) < cutoff:
                    continue
            except Exception:
                continue
            n += 1
            cp = (v.get("cpu") or {}).get("pct")
            mp = (v.get("mem") or {}).get("pct")
            sp = (v.get("mem") or {}).get("swap_pct")
            if cp is not None:
                cpu.append(cp)
                if peak_cpu is None or cp > peak_cpu[0]:
                    peak_cpu = (cp, v["ts"])
            if mp is not None:
                mem.append(mp)
                if peak_mem is None or mp > peak_mem[0]:
                    peak_mem = (mp, v["ts"])
            if sp is not None:
                swap.append(sp)
    except FileNotFoundError:
        pass
    avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else None
    return {
        "window_h": hours, "samples": n,
        "cpu_avg": avg(cpu), "cpu_max": peak_cpu[0] if peak_cpu else None, "cpu_peak_ts": peak_cpu[1] if peak_cpu else None,
        "mem_avg": avg(mem), "mem_max": peak_mem[0] if peak_mem else None, "mem_peak_ts": peak_mem[1] if peak_mem else None,
        "swap_max": max(swap) if swap else None,
    }


def main():
    ap = argparse.ArgumentParser(description="Container RAM/CPU vitals")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sp = sub.add_parser("sample"); sp.add_argument("--file", default=None)
    sub.add_parser("current")
    ck = sub.add_parser("check"); ck.add_argument("--pct", type=float, default=95); ck.add_argument("--file", default=None)
    sm = sub.add_parser("summary"); sm.add_argument("--hours", type=float, default=24); sm.add_argument("--file", default=None)
    args = ap.parse_args()

    if args.cmd == "sample":
        print(json.dumps(append_sample(args.file)))
    elif args.cmd == "current":
        print(json.dumps(read_vitals()))
    elif args.cmd == "check":
        v = read_vitals()
        over = over_threshold(v, args.pct)
        if over:
            print("OVER: " + ", ".join(over))
            sys.exit(1)
        print("OK")
    elif args.cmd == "summary":
        s = summarize(args.file, args.hours)
        print(f"VITALS last {s['window_h']}h ({s['samples']} samples):")
        print(f"  CPU: average {s['cpu_avg']}%  peak {s['cpu_max']}% @ {s['cpu_peak_ts']}")
        print(f"  RAM: average {s['mem_avg']}%  peak {s['mem_max']}% @ {s['mem_peak_ts']}")
        if s["swap_max"] is not None:
            print(f"  SWAP peak {s['swap_max']}%")
        print(json.dumps(s))


if __name__ == "__main__":
    main()
