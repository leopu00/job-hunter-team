#!/usr/bin/env python3
"""
plan_registry.py — quale abbonamento ha l'utente, e cosa ci si può fare.

Il provider da solo (`kimi`, `claude`, `openai`) NON basta a decidere quanti
agenti tenere accesi: un Kimi Moderato da 19$ e un Kimi Vivace da 199$ sono
lo stesso `active_provider` ma hanno capacità 30x diverse. Finché il piano
non è dichiarato, il team parte con la calibrazione prudente (1 worker →
osserva 30 min → sali di un gradino) e il primo utente vede *una* posizione
in dieci minuti: sembra rotto, e disinstalla.

Questo modulo è la singola fonte di verità su:
  - quali piani esistono per ogni provider (per la UI di setup)
  - se il piano ha un tetto SETTIMANALE oltre alla finestra 5h
  - quanti worker spawnare al primo avvio (`burst roster`)

⚠️ I prezzi e i moltiplicatori sono un SEED del 2026-07-26 (ricerca web) e
invecchiano: servono a dimensionare il roster, non a fatturare. Il pacing
reale resta guidato dalla misura (`window_ratio_meter` → `provider_capacity`),
che corregge questi valori appena ha dati veri.

Uso:
  python3 plan_registry.py list [provider]      # piani, human-readable
  python3 plan_registry.py list --json          # tutti i piani, per la UI
  python3 plan_registry.py get                  # piano attivo da jht.config.json
  python3 plan_registry.py roster               # roster di primo avvio (JSON)
  python3 plan_registry.py roster --plan kimi:allegretto
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Optional


# ── Provider canonici ───────────────────────────────────────────────────
# Allineati a cli/src/commands/providers.js: `codex`→`openai`, `moonshot`→`kimi`,
# `anthropic` e `claude` convivono entrambi (li scrivono web e launcher).
_PROVIDER_ALIASES = {
    "codex": "openai",
    "codex-plus": "openai",
    "moonshot": "kimi",
    "anthropic": "claude",
    "claude-max5": "claude",
}


def normalize_provider(provider: str | None) -> str:
    p = (provider or "").strip().lower()
    return _PROVIDER_ALIASES.get(p, p)


# ── Tabella piani (seed 2026-07-26) ─────────────────────────────────────
#
# Campi:
#   id            — chiave stabile scritta in jht.config.json
#   label         — nome commerciale mostrato all'utente
#   price         — prezzo di listino mensile, come stringa (solo display)
#   tier          — capacità relativa al tier base del provider (1 / 5 / 15 / 20 / 30)
#   weekly_capped — il piano ha un tetto oltre la finestra 5h (settimanale o
#                   di ciclo di fatturazione). Se True il pacing DEVE
#                   distribuire il budget, non solo centrare la finestra.
#   window_5h     — esiste una finestra rolling 5h che può bloccarti prima
#                   che il weekly sia finito.
#
# Fonti: Kimi/Moonshot 5 tier (Adagio free · Moderato 19$ · Allegretto 39$ ·
# Allegro 99$ · Vivace 199$, quote settimanali + finestra 5h) · Claude
# (Pro 20$ · Max 5x 100$ · Max 20x 200$, 5h + due tetti settimanali) ·
# Codex/OpenAI (Plus 20$ · Pro 100$ · Pro 200$; la finestra 5h è stata
# RIMOSSA il 2026-07-12, resta il weekly).
PLANS: dict[str, list[dict]] = {
    "kimi": [
        {"id": "adagio",     "label": "Adagio (gratuito)", "price": "0",
         "tier": 0.2, "weekly_capped": True, "window_5h": True},
        {"id": "moderato",   "label": "Moderato",          "price": "19 $/mese",
         "tier": 1,   "weekly_capped": True, "window_5h": True},
        {"id": "allegretto", "label": "Allegretto",        "price": "39 $/mese",
         "tier": 5,   "weekly_capped": True, "window_5h": True},
        {"id": "allegro",    "label": "Allegro",           "price": "99 $/mese",
         "tier": 15,  "weekly_capped": True, "window_5h": True},
        {"id": "vivace",     "label": "Vivace",            "price": "199 $/mese",
         "tier": 30,  "weekly_capped": True, "window_5h": True},
    ],
    "claude": [
        {"id": "pro",     "label": "Pro",     "price": "20 $/mese",
         "tier": 1,  "weekly_capped": True, "window_5h": True},
        {"id": "max5",    "label": "Max 5x",  "price": "100 $/mese",
         "tier": 5,  "weekly_capped": True, "window_5h": True},
        {"id": "max20",   "label": "Max 20x", "price": "200 $/mese",
         "tier": 20, "weekly_capped": True, "window_5h": True},
    ],
    "openai": [
        {"id": "plus",    "label": "Plus",    "price": "20 $/mese",
         "tier": 1,  "weekly_capped": True, "window_5h": False},
        {"id": "pro",     "label": "Pro",     "price": "100 $/mese",
         "tier": 5,  "weekly_capped": True, "window_5h": False},
        {"id": "pro-max", "label": "Pro 20x", "price": "200 $/mese",
         "tier": 20, "weekly_capped": True, "window_5h": False},
    ],
}


# ── Roster di primo avvio, per fascia di capacità ───────────────────────
#
# Non è il roster "a regime" (quello lo calibra il Capitano sui dati veri):
# è la formazione con cui il team PARTE, per dare all'utente nuovo posizioni
# CON PUNTEGGIO nella prima mezz'ora invece che una sola posizione grezza.
#
# Il rapporto conta più del numero assoluto: uno Scout produce materiale che
# Analista e Scorer devono digerire. Roster tutto-Scout = 50 posizioni grezze
# e 3 punteggiate (run reale 2026-07-26), che per l'utente vale zero.
_BURST_ROSTER = [
    # (tier minimo, scout, analista, scorer)
    (20, 4, 2, 2),
    (15, 3, 2, 1),
    (5,  2, 1, 1),
    (1,  1, 1, 1),
    (0,  1, 1, 1),
]

# Quante posizioni lo Scout porta a casa nel PRIMO giro prima di fermarsi e
# lasciare la finestra al downstream. Senza questo cap lo scouting si mangia
# la finestra e il punteggio non arriva mai (root cause del run 2026-07-26).
_BURST_SCOUT_CAP = {20: 25, 15: 20, 5: 15, 1: 10, 0: 8}

# Obiettivo dichiarato del burst: quante posizioni PUNTEGGIATE far vedere
# all'utente prima di passare al regime normale.
_BURST_TARGET_SCORED = {20: 15, 15: 12, 5: 10, 1: 6, 0: 4}

# RAM stimata per agente (GB). Cap hardware: su una macchina piccola il roster
# del piano va ridotto anche se l'abbonamento lo permetterebbe.
_RAM_GB_PER_AGENT = 0.6
_RAM_GB_RESERVED = 2.0


def _jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))


def _config_path() -> Path:
    return _jht_home() / "jht.config.json"


def _read_config() -> dict:
    try:
        with _config_path().open(encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def list_plans(provider: str | None = None) -> dict[str, list[dict]]:
    """Piani disponibili. Senza `provider`: tutti."""
    if provider:
        prov = normalize_provider(provider)
        return {prov: PLANS.get(prov, [])}
    return dict(PLANS)


def find_plan(provider: str, plan_id: str) -> Optional[dict]:
    prov = normalize_provider(provider)
    wanted = (plan_id or "").strip().lower()
    for p in PLANS.get(prov, []):
        if p["id"] == wanted:
            return dict(p, provider=prov)
    return None


def active_plan() -> Optional[dict]:
    """Piano dichiarato dall'utente in jht.config.json, o None se mancante.

    None NON è un errore di lettura: è lo stato "l'utente non ce l'ha ancora
    detto". Il chiamante deve trattarlo come gate di setup non superato, non
    come piano minimo (assumere il minimo farebbe partire il team in prima
    marcia su un abbonamento da 200$).
    """
    cfg = _read_config()
    prov = normalize_provider(cfg.get("active_provider"))
    if not prov:
        return None
    entry = ((cfg.get("providers") or {}).get(prov) or {})
    plan_id = entry.get("plan") or cfg.get("provider_plan")
    if not plan_id:
        return None
    return find_plan(prov, str(plan_id))


def set_plan(provider: str, plan_id: str) -> dict:
    """Scrive il piano in jht.config.json (providers.<prov>.plan). Idempotente."""
    plan = find_plan(provider, plan_id)
    if plan is None:
        raise ValueError(f"piano sconosciuto: {provider}:{plan_id}")
    prov = plan["provider"]
    cfg = _read_config()
    providers = cfg.setdefault("providers", {})
    if not isinstance(providers, dict):
        providers = cfg["providers"] = {}
    entry = providers.setdefault(prov, {})
    if not isinstance(entry, dict):
        entry = providers[prov] = {}
    entry["plan"] = plan["id"]
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
        f.write("\n")
    tmp.replace(path)
    return plan


def _tier_bucket(tier: float) -> int:
    for floor, *_ in _BURST_ROSTER:
        if tier >= floor:
            return floor
    return 0


def _host_agent_cap() -> Optional[int]:
    """Quanti agenti regge questa macchina, dalla RAM. None se non misurabile.

    Il collo di bottiglia misurato non è la CPU (i worker aspettano la rete)
    ma la memoria: oltre il limite la macchina va in thrash e RALLENTA tutto.
    """
    try:
        total = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (ValueError, OSError, AttributeError):
        return None
    gb = total / (1024 ** 3)
    usable = gb - _RAM_GB_RESERVED
    if usable <= 0:
        return 1
    # +5 core fissi (Capitano, Sentinella, Assistente, Mentor, Dottore) già accesi.
    return max(1, int(usable / _RAM_GB_PER_AGENT) - 5)


def burst_roster(plan: dict | None = None, host_cap: int | None = None) -> dict:
    """Formazione di primo avvio per il piano dato.

    Ritorna sempre un dict; `ok=False` quando il piano non è dichiarato —
    il Capitano in quel caso NON deve indovinare, deve dirlo all'utente.
    """
    plan = plan or active_plan()
    if plan is None:
        return {"ok": False,
                "reason": "piano non dichiarato",
                "hint": "l'utente deve selezionare l'abbonamento nel setup"}

    bucket = _tier_bucket(float(plan.get("tier") or 0))
    scout, analista, scorer = next(
        (s, a, sc) for floor, s, a, sc in _BURST_ROSTER if floor == bucket)

    cap = host_cap if host_cap is not None else _host_agent_cap()
    capped_by_host = False
    if cap is not None and scout + analista + scorer > cap:
        capped_by_host = True
        # Si taglia a cascata partendo dalla testa: uno Scout in meno costa
        # posizioni trovate, un Analista o uno Scorer in meno costa posizioni
        # PUNTEGGIATE — cioè l'unico risultato che l'utente vede. Sotto un
        # worker per ruolo non si scende: una pipeline monca non produce
        # nulla, e a quel punto il limite non è più il roster ma la macchina.
        for role in ("scout", "analista", "scorer"):
            excess = scout + analista + scorer - cap
            if excess <= 0:
                break
            if role == "scout":
                scout = max(1, scout - excess)
            elif role == "analista":
                analista = max(1, analista - excess)
            else:
                scorer = max(1, scorer - excess)

    return {
        "ok": True,
        "provider": plan["provider"],
        "plan": plan["id"],
        "plan_label": plan["label"],
        "tier": plan["tier"],
        "weekly_capped": bool(plan.get("weekly_capped")),
        "window_5h": bool(plan.get("window_5h")),
        "roster": {"scout": scout, "analista": analista, "scorer": scorer},
        "total_workers": scout + analista + scorer,
        "scout_cap_first_pass": _BURST_SCOUT_CAP[bucket],
        "target_scored": _BURST_TARGET_SCORED[bucket],
        "host_agent_cap": cap,
        "capped_by_host": capped_by_host,
    }


# ── CLI ─────────────────────────────────────────────────────────────────
def _cmd_list(argv: list[str]) -> int:
    as_json = "--json" in argv
    rest = [a for a in argv if not a.startswith("-")]
    data = list_plans(rest[0] if rest else None)
    if as_json:
        print(json.dumps(data, ensure_ascii=False))
        return 0
    for prov, plans in data.items():
        if not plans:
            print(f"{prov}: nessun piano noto")
            continue
        print(f"{prov}:")
        for p in plans:
            weekly = "tetto settimanale" if p["weekly_capped"] else "no weekly"
            win = "finestra 5h" if p["window_5h"] else "no finestra 5h"
            print(f"  {p['id']:<12} {p['label']:<16} {p['price']:<12} "
                  f"{p['tier']:>4}x  [{weekly}, {win}]")
    return 0


def _cmd_get() -> int:
    plan = active_plan()
    if plan is None:
        print("PLAN_MISSING")
        return 1
    print(json.dumps(plan, ensure_ascii=False))
    return 0


def _cmd_set(argv: list[str]) -> int:
    if len(argv) < 1:
        print("uso: plan_registry.py set <provider>:<plan> | <provider> <plan>",
              file=sys.stderr)
        return 2
    if ":" in argv[0]:
        provider, plan_id = argv[0].split(":", 1)
    elif len(argv) >= 2:
        provider, plan_id = argv[0], argv[1]
    else:
        print("uso: plan_registry.py set <provider>:<plan>", file=sys.stderr)
        return 2
    try:
        plan = set_plan(provider, plan_id)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(plan, ensure_ascii=False))
    return 0


def _cmd_roster(argv: list[str]) -> int:
    plan = None
    if "--plan" in argv:
        spec = argv[argv.index("--plan") + 1]
        provider, _, plan_id = spec.partition(":")
        plan = find_plan(provider, plan_id)
        if plan is None:
            print(f"piano sconosciuto: {spec}", file=sys.stderr)
            return 1
    out = burst_roster(plan)
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if out.get("ok") else 1


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "get"
    rest = argv[1:]
    if cmd == "list":
        return _cmd_list(rest)
    if cmd == "get":
        return _cmd_get()
    if cmd == "set":
        return _cmd_set(rest)
    if cmd == "roster":
        return _cmd_roster(rest)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
