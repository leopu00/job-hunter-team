#!/usr/bin/env python3
"""
coordinator_settings.py — leggere e scrivere le impostazioni del Capitano.

## Perché esiste ([JHT-CLI-AGENT-PARITY])

La regola del progetto è una sola superficie: «se per configurare una feature
devi aprire la dashboard o l'app desktop, è un bug». Le impostazioni del
Capitano — la MODALITÀ di lavoro e i suoi ordini — si potevano cambiare solo
dalla Console del gioco. Chi guida JHT da uno script, o l'agente LLM che è il
pubblico dichiarato di `docs/guides/AI-AGENT-INTEGRATION.md`, restava fuori.

Qui vive la regola; `jht coordinator` è solo un proxy che eredita l'exit code.

## Il contratto del file (identico a quello della Console)

`$JHT_HOME/profile/capitano-maintenance.json`, enum chiuso 2026-08:

  * assenza del file **è** `search` → scegliere `search` CANCELLA il file;
  * `care` → `mode` + gli `orders` fini della cura;
  * `harvest` / `calibration` / `saving` → solo `{"mode": ...}`: cosa implicano
    vive nel manuale `team-modes` e nell'enforcement a codice, non in flag
    duplicati.

Due differenze deliberate rispetto alla Console, entrambe conservative:

1. **si preserva ciò che non si sta cambiando.** La Console riscrive il file da
   zero, e così facendo cancella `mode_until` (la scadenza di
   [SAVING-MODE-HAS-NO-DEADLINE]) ogni volta che si tocca una impostazione. Qui
   una chiave non nominata resta dov'è: un comando che non parla di scadenze
   non ha motivo di cancellarne una.
2. **si può dare e togliere la scadenza** (`--until` / `clear-until`), che dalla
   Console oggi non si scrive affatto.

La policy di enrichment ha già il suo scrittore (`enrichment_policy.py`): qui
si LEGGE per mostrarla accanto alla modalità, e non si duplica la sua
validazione.

Uso:
  python3 coordinator_settings.py show [--json]
  python3 coordinator_settings.py set-mode care [--stop-search true]
                                 [--discard-expired true] [--cv-min-score 90]
                                 [--pre-check-liveness true]
  python3 coordinator_settings.py set-mode saving --until 2026-08-10T18:00:00Z
  python3 coordinator_settings.py clear-until

Exit: 0 ok · 1 errore d'uso o scrittura fallita.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mode_deadline  # noqa: E402
from _db import DB_PATH  # noqa: E402

MODES = ("search", "harvest", "care", "calibration", "saving")

# I default della cura, gli stessi che scrive la Console: un client che non
# manda un ordine non deve ottenerne uno diverso a seconda di chi ha scritto.
CARE_DEFAULTS = {
    "stop_search": True,
    "discard_expired_rotating": True,
    "cv_min_score": 90,
    "pre_check_liveness_for_cv": True,
}


def profile_dir() -> str:
    return os.path.join(os.path.dirname(DB_PATH), "profile")


def mode_path() -> str:
    return os.path.join(profile_dir(), "capitano-maintenance.json")


def policy_path() -> str:
    return os.path.join(profile_dir(), "enrichment-policy.json")


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        return False   # esiste ma è illeggibile: diverso da assente


def _atomic(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(value, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def _boolean(value, default):
    if value is None:
        return default
    low = str(value).strip().lower()
    if low in ("true", "1", "on", "yes"):
        return True
    if low in ("false", "0", "off", "no"):
        return False
    raise ValueError(f"invalid boolean: {value!r}")


def _score(value, default):
    if value is None:
        return default
    n = int(value)
    if not 0 <= n <= 100:
        raise ValueError("cv-min-score must be between 0 and 100")
    return n


def read_state() -> dict:
    """I fatti su disco, senza interpretarli: chi legge decide.

    `mode` è il valore GREZZO del file; `effective_mode` è quello in vigore
    ADESSO, cioè dopo la scadenza `mode_until` (mode_deadline.py). Tenerli
    distinti serve: il file può dire `saving` mentre la squadra è già tornata
    in `search`, ed è esattamente il caso in cui un operatore si confonde.
    """
    data = _read_json(mode_path())
    out = {
        "path": mode_path(),
        "exists": data is not None and data is not False,
        "readable": data is not False,
        "mode": "search",
        "orders": {},
        "mode_until": None,
        "expired": False,
    }
    if data:
        raw = data.get("mode")
        out["mode"] = raw.strip() if isinstance(raw, str) and raw.strip() else "search"
        if out["mode"] == "maintenance":
            out["mode"] = "care"
        orders = data.get("orders")
        out["orders"] = orders if isinstance(orders, dict) else {}
        out["mode_until"] = data.get(mode_deadline.DEADLINE_KEY)
    deadline = mode_deadline.parse_deadline(out["mode_until"])
    effective, expired = mode_deadline.effective_mode(out["mode"], deadline)
    out["effective_mode"] = effective
    out["expired"] = expired
    out["mode_until_valid"] = bool(deadline) if out["mode_until"] else None
    out["mode_until_in"] = mode_deadline.remaining_text(deadline) or None

    policy = _read_json(policy_path())
    out["enrichment_policy"] = policy if policy else {}
    out["enrichment_policy_path"] = policy_path()
    return out


def write_mode(mode: str, orders_overrides: dict, until=None,
               clear_until=False) -> dict:
    """Scrive la modalità rispettando il contratto del file.

    Le chiavi che non si stanno cambiando restano: è la differenza con la
    Console, che riscrive da zero e porta via `mode_until` per effetto
    collaterale.
    """
    if mode not in MODES:
        raise ValueError(f"unknown mode: {mode} (expected one of {', '.join(MODES)})")

    current = _read_json(mode_path()) or {}
    if current is False:
        current = {}

    if mode == "search":
        # L'assenza del file È `search`: lasciarlo con `{"mode": "search"}`
        # significherebbe dichiarare un ordine che non c'è.
        try:
            os.unlink(mode_path())
        except FileNotFoundError:
            pass
        return {"mode": "search", "file": None}

    payload = dict(current)
    payload["mode"] = mode
    if mode != "care":
        # Gli `orders` fini sono della CURA: lasciarli sotto un'altra modalità
        # significherebbe dichiarare ordini che quella modalità non conosce —
        # e `stop_search` viene letto da tutti, quindi non sarebbe innocuo.
        # `mode_until` invece non è di nessuna modalità in particolare: resta.
        payload.pop("orders", None)
    if mode == "care":
        base = dict(CARE_DEFAULTS)
        base.update({k: v for k, v in (current.get("orders") or {}).items()
                     if k in CARE_DEFAULTS})
        base.update({k: v for k, v in orders_overrides.items() if v is not None})
        payload["orders"] = base
    elif orders_overrides:
        raise ValueError(
            f"the fine-grained orders only belong to `care` mode; "
            f"`{mode}` declares only itself (see the `team-modes` skill)")

    if clear_until:
        payload.pop(mode_deadline.DEADLINE_KEY, None)
    elif until is not None:
        if mode_deadline.parse_deadline(until) is None:
            raise ValueError(
                f"{until!r} is not an ISO 8601 date/time "
                f"(e.g. 2026-08-10T18:00:00Z): a deadline nobody can read "
                f"would leave the mode running forever")
        payload[mode_deadline.DEADLINE_KEY] = until

    _atomic(mode_path(), payload)
    return {"mode": mode, "file": payload}


def _print_human(state: dict) -> None:
    mode, effective = state["mode"], state["effective_mode"]
    if not state["readable"]:
        print(f"mode:      UNREADABLE ({state['path']}) — a human must look at it")
    elif not state["exists"]:
        print("mode:      search (no file — that is the default)")
    elif state["expired"]:
        print(f"mode:      {effective}  ← `{mode}` EXPIRED on {state['mode_until']}")
    else:
        print(f"mode:      {mode}")
    if state["mode_until"] and not state["expired"]:
        if state["mode_until_valid"]:
            print(f"ends:      {state['mode_until']} (in {state['mode_until_in']}) "
                  f"→ then back to search on its own")
        else:
            print(f"ends:      {state['mode_until']!r} is NOT a readable date: "
                  f"the mode does not expire")
    for key, value in (state["orders"] or {}).items():
        print(f"  order:   {key} = {json.dumps(value, ensure_ascii=False)}")
    policy = state["enrichment_policy"]
    if policy:
        econ = " (economy: autonomous enrichment OFF)" if policy.get("economy") else ""
        print(f"policy:    {state['enrichment_policy_path']}{econ}")
        for section in ("logo", "geocode_missing", "recheck_weekly"):
            sec = policy.get(section)
            if isinstance(sec, dict):
                print(f"  {section}: {json.dumps(sec, ensure_ascii=False)}")
    else:
        print("policy:    (default — no enrichment-policy.json)")


def main(argv) -> int:
    ap = argparse.ArgumentParser(
        prog="coordinator_settings",
        description="Read and write the Capitano's settings (mode + orders)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    show = sub.add_parser("show", help="current settings")
    show.add_argument("--json", action="store_true", help="machine-readable")

    setm = sub.add_parser("set-mode", help="set the working mode")
    setm.add_argument("mode", choices=MODES)
    setm.add_argument("--until", help="ISO 8601: the mode expires then and "
                                      "falls back to search on its own")
    setm.add_argument("--clear-until", action="store_true",
                      help="remove an existing deadline")
    setm.add_argument("--stop-search", help="care only: true|false")
    setm.add_argument("--discard-expired", help="care only: true|false")
    setm.add_argument("--cv-min-score", help="care only: 0-100")
    setm.add_argument("--pre-check-liveness", help="care only: true|false")

    clr = sub.add_parser("clear-until", help="remove the deadline, keep the mode")
    clr.add_argument("--json", action="store_true")

    args = ap.parse_args(argv)

    try:
        if args.cmd == "show":
            state = read_state()
            if args.json:
                print(json.dumps(state, ensure_ascii=False))
            else:
                _print_human(state)
            return 0

        if args.cmd == "clear-until":
            state = read_state()
            if state["mode"] == "search":
                print(json.dumps({"ok": True, "mode": "search",
                                  "note": "no file: nothing to clear"}))
                return 0
            res = write_mode(state["mode"], {}, clear_until=True)
            print(json.dumps({"ok": True, **res}, ensure_ascii=False))
            return 0

        orders = {
            "stop_search": _boolean(args.stop_search, None),
            "discard_expired_rotating": _boolean(args.discard_expired, None),
            "cv_min_score": _score(args.cv_min_score, None),
            "pre_check_liveness_for_cv": _boolean(args.pre_check_liveness, None),
        }
        orders = {k: v for k, v in orders.items() if v is not None}
        res = write_mode(args.mode, orders, until=args.until,
                         clear_until=args.clear_until)
        print(json.dumps({"ok": True, **res}, ensure_ascii=False))
        return 0
    except (ValueError, OSError) as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
