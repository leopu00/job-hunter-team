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
  throttle-config dump                   # stampa tutto il config (effettivo)
  throttle-config reset                  # tutti a 0
  throttle-config bulk-set <agent>=<sec>... # multi-set in una writelock
  throttle-config quantize <sec>         # aggancia alla ladder (floor 5min)

Ladder (2026-06-21): ogni throttle >0 è agganciato a {5,10,15,20,25,30,40,50,60}min
(floor 5min, cap 1h). `0` resta `0`. Set/get/dump restituiscono sempre l'EFFETTIVO.
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
# Cap 1h: il pattern detached (wrapper `jht-throttle` fa fork del
# subprocess Python come figlio di init) rilascia il vincolo del
# timeout shell della CLI (Kimi 60s, Codex 30s, Claude 120s/600s).
# Il subprocess detached non viene killato dal timeout della tool
# call. Per pause > 1h l'agente deve fare multi-call.
MAX_SLEEP = 3600

# ── Ladder dei throttle (2026-06-21) ─────────────────────────────────
# Floor 5min, gradini fino a 1h. Razionale (dallo storico: throttle <5min
# = 78-86% degli eventi ma correzioni marginali applicate a raffica =
# "chatter"): col floor il throttle smette di essere una micro-correzione.
# Per SPENDERE il budget il Capitano non rallenta a raffica pochi agenti,
# ma PARALLELIZZA (spawna più agenti). `0` resta `0` (nessun throttle,
# fast path); ogni valore >0 sale ad almeno 5min e si aggancia a un gradino.
THROTTLE_LADDER = [300, 600, 900, 1200, 1500, 1800, 2400, 3000, 3600]


def quantize(seconds) -> int:
    """Aggancia i secondi alla ladder: 0→0 (off), (0..300]→300 (floor 5min),
    >=3600→3600 (cap 1h), altrimenti il gradino più vicino. Idempotente.
    Robusta: input non numerico → 0 (la skill gira in loop dagli agenti)."""
    try:
        s = float(seconds)
    except (TypeError, ValueError):
        return 0
    if s <= 0:
        return 0
    if s <= THROTTLE_LADDER[0]:
        return THROTTLE_LADDER[0]
    if s >= THROTTLE_LADDER[-1]:
        return THROTTLE_LADDER[-1]
    return min(THROTTLE_LADDER, key=lambda x: abs(x - s))


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
    # Effettivo = agganciato alla ladder (floor 5min). Vale anche per i
    # valori legacy già nel throttle.json (es. 60/120 → 300) senza riscrivere.
    return quantize(max(MIN_SLEEP, min(MAX_SLEEP, v)))


def set_agent(agent: str, seconds: int) -> None:
    if not isinstance(seconds, int):
        raise TypeError(f"seconds must be int, got {type(seconds).__name__}")
    if seconds < MIN_SLEEP or seconds > MAX_SLEEP:
        raise ValueError(f"seconds must be {MIN_SLEEP}..{MAX_SLEEP}, got {seconds}")
    cfg = load()
    cfg[agent] = quantize(seconds)  # snap alla ladder: ciò che salvi è l'effettivo
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

    p_q = sub.add_parser("quantize", help="aggancia secondi alla ladder (floor 5min)")
    p_q.add_argument("seconds")

    args = ap.parse_args()

    if args.cmd == "quantize":
        print(quantize(args.seconds))
        return 0

    if args.cmd == "get":
        print(get_agent(args.agent))
        return 0

    if args.cmd == "set":
        try:
            set_agent(args.agent, args.seconds)
        except (TypeError, ValueError) as e:
            print(f"error: {e}", file=sys.stderr)
            return 1
        eff = quantize(args.seconds)
        note = "" if eff == args.seconds else f" (richiesto {args.seconds}s → ladder)"
        print(f"{args.agent}={eff}s{note}")
        return 0

    if args.cmd == "dump":
        cfg = load()
        # Output umano-leggibile, ordinato.
        print(f"default = {quantize(cfg.get('default', 0))}s")
        for k in sorted(cfg.keys()):
            if k == "default":
                continue
            print(f"{k:14s} = {quantize(cfg[k])}s")
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
            cfg[k] = quantize(v_int)  # snap alla ladder (floor 5min)
        _atomic_write(cfg)
        for pair in args.pairs:
            print(pair)
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
