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
(floor 5min, cap 1h). Set/get/dump restituiscono sempre l'EFFETTIVO.

Worker floor (2026-06-26): i WORKER (Scout/Analista/Scorer/Scrittore/Critico)
hanno floor 5min SEMPRE — `0` su un worker → 300s (anti-marathon). Il core
interattivo (Capitano/Sentinella/Assistente/Mentor) NON ha floor (`0` resta `0`)
→ resta reattivo per la chat utente. Vedi `_is_worker` / `WORKER_FLOOR`.

Deroga a termine (2026-07-28): floor e ladder sono automatismi di SPESA, quindi
cedono quando l'utente ha dichiarato l'intento opposto — `.burn-intent.flag`,
vedi `shared/skills/burn_intent.py` e `effective()` qui sotto. È l'unico modo
per cui un override dell'utente sopravvive alla `get_agent` successiva: floor e
ladder si applicano IN LETTURA, quindi vanno derogati in lettura. Alla scadenza
del flag il freno torna da solo, senza che nessuno debba ricordarsene.
"""
import argparse
import json
import os
import re
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
# Gradini in MINUTI PRIMI (tranne il primo e l'ultimo): 1, 2, 3, 5, 7, 11, 13,
# 17, 23, 31, 41, 53, 60. La scala precedente era tutta multipli di 5 — e due
# worker su gradini diversi si risincronizzavano di continuo *per costruzione*:
# 5+10 ricadevano insieme ogni 10 minuti, 5+15 ogni 15. Ogni coincidenza è un
# picco di richieste simultanee sulla stessa macchina.
# Con gradini coprimi il minimo comune multiplo esplode: il peggior caso passa
# da 10 a 35 minuti, la media da 84 a 638. Non elimina le collisioni — le rende
# rare invece che periodiche.
# Sotto i 5 minuti servono a un worker solo se esentato dal WORKER_FLOOR
# (config/throttle-floor-exempt.txt); il core interattivo li usa liberamente.
# Sotto il minuto non si scende: la pausa smetterebbe di essere un checkpoint.
THROTTLE_LADDER = [60, 120, 180, 300, 420, 660, 780, 1020, 1380, 1860, 2460,
                   3180, 3600]


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


# ── Floor 5min per i WORKER (anti-marathon, 2026-06-26) ──────────────
# I worker (Scout/Analista/Scorer/Scrittore/Critico) macinano budget in loop:
# a throttle 0 incatenano batch su batch (il marathon di scout-6, ~308kT per 3
# posizioni). Floor 5min = ogni unità è seguita da una pausa-checkpoint, il
# consumo si spalma, e il Capitano ha un punto di controllo tra un'unità e
# l'altra. Il CORE interattivo (Capitano/Sentinella/Assistente/Mentor) NON ha
# floor: deve restare reattivo per la chat serale dell'utente.
WORKER_FLOOR = 300  # 5min — il minimo per un worker, mai 0
_WORKER_ROLES = frozenset({"scout", "analista", "scorer", "scrittore", "critico"})


def _is_worker(agent) -> bool:
    """True se l'agente è un worker (nome base in _WORKER_ROLES, ignorando il
    suffisso `-N`: scout-3 → scout). Core/one-shot/ignoti → False (niente floor)."""
    base = re.sub(r"-\d+$", "", str(agent or "").strip().lower())
    return base in _WORKER_ROLES


# Esenzione PER SINGOLO AGENTE dal worker floor, un nome per riga in
# `$JHT_HOME/config/throttle-floor-exempt.txt` (righe `#` = commento).
# Esiste per un caso solo: un esperimento a termine in cui si vuole misurare
# cosa produce UN worker senza pause, tenendo il floor su tutti gli altri.
# ⚠️ Non è un interruttore generale — è deliberatamente per-agente, perché il
# floor nasce da un incidente misurato (il marathon di uno Scout, ~308kT per 3
# posizioni) e toglierlo a tutti riproduce la configurazione della burn
# notturna del 2026-07-15, dove floor e hard-stop erano entrambi off.
# Il file va rimosso a esperimento finito: nessuno lo scade al posto tuo.
_FLOOR_EXEMPT_FILE = CONFIG_DIR / "throttle-floor-exempt.txt"


def _floor_exempt(agent) -> bool:
    """True se l'agente è elencato nel file di esenzione. Robusta per
    costruzione: qualunque errore di lettura lascia il floor attivo — la
    direzione sicura è tenere il freno, non toglierlo."""
    try:
        if not _FLOOR_EXEMPT_FILE.exists():
            return False
        names = {
            ln.strip().lower()
            for ln in _FLOOR_EXEMPT_FILE.read_text(encoding="utf-8").splitlines()
            if ln.strip() and not ln.lstrip().startswith("#")
        }
    except OSError:
        return False
    return str(agent or "").strip().lower() in names


# ── Deroga a termine dell'utente (shared/skills/burn_intent.py) ──────────
# Il file di esenzione sopra è per-agente e non scade: è la forma sbagliata per
# un ordine come *"stanotte spremete"*, che riguarda TUTTI i worker e deve
# finire da solo. `.burn-intent.flag` è quella giusta — e va letto **qui**,
# perché il floor e la ladder si applicano IN LETTURA: senza questo controllo
# qualunque override dell'utente torna a 300s alla prima `get_agent`, che è il
# sintomo osservato («il throttle torna a 300») dopo ogni deroga tentata.
# Modulo cachato, stato no: `is_active()` rilegge il flag a ogni chiamata.
_BURN_INTENT_MOD = None


def _burn_intent_active() -> bool:
    """True se l'utente ha derogato agli automatismi di spesa e la deroga non è
    scaduta. Fail-closed: qualunque errore lascia floor e ladder attivi."""
    global _BURN_INTENT_MOD
    try:
        if _BURN_INTENT_MOD is None:
            import importlib.util
            for cand in (Path("/app/shared/skills/burn_intent.py"),
                         Path(__file__).resolve().parent / "burn_intent.py"):
                if not cand.exists():
                    continue
                spec = importlib.util.spec_from_file_location("burn_intent", cand)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                _BURN_INTENT_MOD = mod
                break
        return bool(_BURN_INTENT_MOD.is_active()) if _BURN_INTENT_MOD else False
    except Exception:  # noqa: BLE001 — la skill gira in loop dagli agenti
        return False


def effective(agent: str, seconds: int) -> int:
    """Valore EFFETTIVO per l'agente: ladder + worker floor, salvo deroghe.

    In deroga (BURN-INTENT) il valore richiesto vale così com'è, entro
    `MIN_SLEEP..MAX_SLEEP`: niente floor 5min, niente aggancio alla ladder.
    È una decisione economica dell'utente sulla velocità — i freni di sicurezza
    (weekly-halt, host_agent_cap, SC-09, freeze_team) stanno altrove e non
    passano di qui.
    """
    v = max(MIN_SLEEP, min(MAX_SLEEP, seconds))
    if _burn_intent_active():
        return v
    floor = WORKER_FLOOR if (_is_worker(agent) and not _floor_exempt(agent)) \
        else MIN_SLEEP
    # L'esente salta anche la ladder: quantize() aggancerebbe comunque a 300
    # (il suo primo gradino), quindi il valore richiesto va usato tale e quale.
    if floor == MIN_SLEEP and _is_worker(agent):
        return v
    return quantize(max(floor, v))


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
    # Effettivo = agganciato alla ladder. I WORKER hanno floor 5min SEMPRE
    # (anti-marathon, 2026-06-26): mai 0. Il core interattivo NON ha floor →
    # resta reattivo. Vale anche per i valori legacy già nel throttle.json
    # (es. 60/120 → 300, o 0 su un worker → 300) senza riscrivere il file.
    # Unica eccezione: la deroga a termine dell'utente (vedi `effective`).
    return effective(agent, v)


def set_agent(agent: str, seconds: int) -> None:
    if not isinstance(seconds, int):
        raise TypeError(f"seconds must be int, got {type(seconds).__name__}")
    if seconds < MIN_SLEEP or seconds > MAX_SLEEP:
        raise ValueError(f"seconds must be {MIN_SLEEP}..{MAX_SLEEP}, got {seconds}")
    cfg = load()
    # Snap alla ladder: ciò che salvi è l'effettivo. In deroga (BURN-INTENT) si
    # salva il valore CHIESTO — se lo snappassimo qui, alla scadenza della
    # deroga resterebbe scritto un numero che l'utente non ha mai chiesto.
    cfg[agent] = seconds if _burn_intent_active() else quantize(seconds)
    _atomic_write(cfg)


def reset_all() -> None:
    """Tutti a 0. Mantiene la chiave 'default' a 0."""
    _atomic_write(dict(DEFAULT_CONFIG))


def main() -> int:
    ap = argparse.ArgumentParser(prog="throttle-config")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_get = sub.add_parser("get", help="print the current seconds for an agent")
    p_get.add_argument("agent")

    p_set = sub.add_parser("set", help="set seconds for an agent (atomic)")
    p_set.add_argument("agent")
    p_set.add_argument("seconds", type=int)

    sub.add_parser("dump", help="print the full configuration")

    sub.add_parser("reset", help="clear all overrides (default=0)")

    p_bulk = sub.add_parser("bulk-set", help="set multiple values in one atomic write")
    p_bulk.add_argument("pairs", nargs="+", help="agent=seconds ...")

    p_q = sub.add_parser("quantize", help="snap seconds to the ladder (5min floor)")
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
        eff = get_agent(args.agent)
        note = "" if eff == args.seconds else f" (requested {args.seconds}s → ladder)"
        if _burn_intent_active():
            note += " [BURN-INTENT: floor and ladder overridden]"
        print(f"{args.agent}={eff}s{note}")
        return 0

    if args.cmd == "dump":
        cfg = load()
        # Output umano-leggibile, ordinato.
        print(f"default = {quantize(cfg.get('default', 0))}s")
        for k in sorted(cfg.keys()):
            if k == "default":
                continue
            # get_agent applica il floor worker (5min) → dump mostra l'EFFETTIVO
            print(f"{k:14s} = {get_agent(k)}s")
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
            # Snap alla ladder (floor 5min), salvo deroga a termine dell'utente.
            cfg[k] = v_int if _burn_intent_active() else quantize(v_int)
        _atomic_write(cfg)
        for pair in args.pairs:
            print(pair)
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
