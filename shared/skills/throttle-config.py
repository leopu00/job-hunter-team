#!/usr/bin/env python3
"""throttle-config.py — config-driven throttle per agente.

Modello (vs il vecchio "il Capitano manda 5 messaggi tmux con un nuovo
numero ogni volta"):

  ┌──────────────┐         write atomico         ┌────────────────────┐
  │  CAPITANO    │ ──────────────────────────►   │ throttle.json      │
  │              │  set scout-1 60               │ {                  │
  │ (calibra)    │  set scrittore-1 120          │   "default": 0,    │
  │              │  set default 0                │   "scout-1": 60,   │
  └──────────────┘                                │   "scrittore-1":120│
                                                  │ }                  │
                                                  └─────────┬──────────┘
                                                            │ read
                                                            ▼
                                                  ┌──────────────────┐
                                                  │ jht-throttle     │
                                                  │   --agent scout-1│
                                                  │ (no seconds)     │
                                                  │                  │
                                                  │ → sleep 60s      │
                                                  └──────────────────┘

Vantaggi:
  - 1 write atomico al posto di 5 messaggi tmux per cambio throttle
  - Niente race condition con agente "in mezzo a sleep di 300s"
  - Stato centralizzato e leggibile (è solo JSON)
  - Capitano può fare bulk update con uno script

Schema del file:
  {
    "default": <int>,         # secondi se l'agente non è esplicitamente listato
    "<agent-name>": <int>,    # override per agente specifico
    ...
  }

Posizione: $JHT_HOME/config/throttle.json. Creato on-the-fly se manca,
default = {"default": 0}.

CLI:
  throttle-config get <agent>            # stampa secondi correnti
  throttle-config set <agent> <seconds>  # set atomico
  throttle-config dump                   # stampa tutto il config
  throttle-config reset                  # tutti a 0
  throttle-config bulk-set <agent>=<sec>... # multi-set in una writelock
"""
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
CONFIG_DIR = JHT_HOME / "config"
CONFIG_FILE = CONFIG_DIR / "throttle.json"

DEFAULT_CONFIG: dict = {"default": 0}

MIN_SLEEP = 0      # 0 = no throttle (fast path)
MAX_SLEEP = 3600   # 1h cap, allineato al cap di throttle.py


def load() -> dict:
    """Read config from disk. Missing file → default. Corrupt → default
    (logged to stderr, never raises — la skill DEVE essere robusta perché
    è invocata in loop dagli agenti)."""
    if not CONFIG_FILE.exists():
        return dict(DEFAULT_CONFIG)
    try:
        with CONFIG_FILE.open() as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"warn: throttle config unreadable, using defaults: {e}",
              file=sys.stderr)
        return dict(DEFAULT_CONFIG)
    if not isinstance(data, dict):
        return dict(DEFAULT_CONFIG)
    if "default" not in data or not isinstance(data["default"], (int, float)):
        data["default"] = 0
    return data


def _atomic_write(payload: dict) -> None:
    """Write tmp + rename, atomic on POSIX. Diretto al file finale è
    un'invitto a leggere a metà write (e dato che il file è ri-letto
    centinaia di volte/min in regime, la corsa accade davvero)."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    fd, tmp_path = tempfile.mkstemp(prefix=".throttle-config-", suffix=".tmp",
                                    dir=str(CONFIG_DIR))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, CONFIG_FILE)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def get_agent(agent: str) -> int:
    """Secondi per l'agente. Override > default > 0."""
    cfg = load()
    if agent in cfg and isinstance(cfg[agent], (int, float)):
        v = cfg[agent]
    else:
        v = cfg.get("default", 0)
    try:
        v = int(v)
    except (TypeError, ValueError):
        v = 0
    return max(MIN_SLEEP, min(MAX_SLEEP, v))


def set_agent(agent: str, seconds: int) -> None:
    if not isinstance(seconds, int):
        raise TypeError(f"seconds must be int, got {type(seconds).__name__}")
    if seconds < MIN_SLEEP or seconds > MAX_SLEEP:
        raise ValueError(f"seconds must be {MIN_SLEEP}..{MAX_SLEEP}, got {seconds}")
    cfg = load()
    cfg[agent] = seconds
    _atomic_write(cfg)


def reset_all() -> None:
    """Tutti a 0. Mantiene la chiave 'default' a 0."""
    _atomic_write(dict(DEFAULT_CONFIG))


def main() -> int:
    ap = argparse.ArgumentParser(prog="throttle-config")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_get = sub.add_parser("get", help="stampa secondi correnti per agente")
    p_get.add_argument("agent")

    p_set = sub.add_parser("set", help="set secondi per agente (atomic)")
    p_set.add_argument("agent")
    p_set.add_argument("seconds", type=int)

    sub.add_parser("dump", help="stampa tutto il config")

    sub.add_parser("reset", help="azzera tutti gli override (default=0)")

    p_bulk = sub.add_parser("bulk-set", help="set multipli in 1 write atomico")
    p_bulk.add_argument("pairs", nargs="+", help="agent=seconds ...")

    args = ap.parse_args()

    if args.cmd == "get":
        print(get_agent(args.agent))
        return 0

    if args.cmd == "set":
        try:
            set_agent(args.agent, args.seconds)
        except (TypeError, ValueError) as e:
            print(f"error: {e}", file=sys.stderr)
            return 1
        print(f"{args.agent}={args.seconds}s")
        return 0

    if args.cmd == "dump":
        cfg = load()
        # Output umano-leggibile, ordinato.
        d = cfg.get("default", 0)
        print(f"default = {d}s")
        for k in sorted(cfg.keys()):
            if k == "default":
                continue
            print(f"{k:14s} = {cfg[k]}s")
        return 0

    if args.cmd == "reset":
        reset_all()
        print("config reset (all defaults to 0)")
        return 0

    if args.cmd == "bulk-set":
        cfg = load()
        for pair in args.pairs:
            if "=" not in pair:
                print(f"error: '{pair}' invalid, expected agent=seconds",
                      file=sys.stderr)
                return 1
            k, v = pair.split("=", 1)
            try:
                v_int = int(v)
            except ValueError:
                print(f"error: seconds must be int in '{pair}'", file=sys.stderr)
                return 1
            if v_int < MIN_SLEEP or v_int > MAX_SLEEP:
                print(f"error: '{pair}' out of range {MIN_SLEEP}..{MAX_SLEEP}",
                      file=sys.stderr)
                return 1
            cfg[k] = v_int
        _atomic_write(cfg)
        for pair in args.pairs:
            print(pair)
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
