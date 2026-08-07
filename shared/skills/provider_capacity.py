#!/usr/bin/env python3
"""
provider_capacity.py — `window_cap_pct_of_weekly` per provider attivo.

Concetto: ogni piano (Codex Pro, Claude Max x20, Kimi Plan, ecc.) ha un
rapporto fisso tra il cap della finestra rate-limit 5h e il cap del
weekly budget. Esempio Codex Pro: una finestra 5h piena vale ~17% del
weekly budget (misura beta VPS 2026-06-03/04: finestra primary 0→79% →
weekly 0→15%, ratio ≈16-17% per finestra piena; il vecchio 14.7% del caso
studio 2026-05-21 sottostimava → target/finestra troppo generoso).

Questo modulo espone un'unica funzione:

    get_window_cap_pct_of_weekly() → float | None

Strategia:
  1. Se esiste `~/.jht/logs/window-ratio-state.json` (scritto dal daemon
     `window_ratio_meter.py`) e `ema_ratio_pct` è popolato con confidenza
     adeguata, ritorna quello (osservato dal vivo, alta accuratezza).
  2. Altrimenti seed value dalla lookup table sotto (basato su design doc
     2026-05-25 + case study Codex Pro).
  3. Per provider weekly-unlimited (Kimi) ritorna None → il chiamante
     fa fallback al target band classico (92% del 5h cap).

Quando `window_ratio_meter.py` non è ancora deployato, vale la regola (2):
il bridge gira con seed value, il sistema è già funzionante end-to-end.
Quando il daemon parte, EMA blendato gradualmente con seed (peso w =
min(1, days_observed/4)) → calibrazione auto in 3-4 giorni.

Riferimenti:
  - docs/internal/architecture/2026-05-25-work-hours-design.md § "Scalabilità"
  - docs/about/RESULTS.md (case study Codex Pro)
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional


# Lookup seed — vedi design doc "Lookup table seed (day 0)".
# `weekly_unlimited=True` indica provider senza weekly cap (Kimi): nessuna
# distribuzione weekly necessaria, fallback al target band classico.
#
# Campi:
#   window_cap_pct_of_weekly  — % del weekly cap che vale una finestra 5h piena
#   natural_burn_pct_per_h    — burn rate naturale del team (% weekly / h) a
#                               full speed senza throttle, dal case study di
#                               riferimento del provider. Usato per calcolare
#                               il `sweet_spot_min_hours` (= ore minime/sett
#                               per saturare il sub al 100% del weekly cap).
#   confidence                — "high" se basato su run reale, "low" se stima.
_PROVIDER_SEEDS: dict[str, dict] = {
    "openai":      {"window_cap_pct_of_weekly": 17.0,
                    "natural_burn_pct_per_h":   2.70,
                    "confidence": "high"},
    "codex":       {"window_cap_pct_of_weekly": 17.0,
                    "natural_burn_pct_per_h":   2.70,
                    "confidence": "high"},
    "codex-plus":  {"window_cap_pct_of_weekly": 17.0,
                    "natural_burn_pct_per_h":   2.70,
                    "confidence": "low"},
    "claude":      {"window_cap_pct_of_weekly": 15.0,
                    "natural_burn_pct_per_h":   2.50,
                    "confidence": "low"},
    "claude-max5": {"window_cap_pct_of_weekly": 15.0,
                    "natural_burn_pct_per_h":   2.50,
                    "confidence": "low"},
    # Kimi NON è weekly-unlimited (correzione 2026-07-26). Tutti i piani a
    # abbonamento (Moderato/Allegretto/Allegro/Vivace) hanno una quota
    # settimanale OLTRE alla finestra rolling 5h — vedi `plan_registry.py`.
    # Il ratio 23% è MISURATO sul run ThinkPad del 2026-07-26 (Allegretto):
    # finestra 5h portata da 0 a 100% → weekly da 0 a 23%. Il rapporto è ~
    # costante fra i tier (finestra e weekly scalano insieme col moltiplicatore),
    # quindi vale un solo seed per il provider; il `window_ratio_meter` lo
    # raffina appena ha storia.
    # `natural_burn` è invece una STIMA, non una misura: quel run bruciava
    # 9.5 %weekly/h ma con un roster gonfiato a mano (~8 sessioni vive);
    # riportato a un roster normale di 3-4 worker viene ~4.6 %weekly/h.
    "kimi":        {"window_cap_pct_of_weekly": 23.0,
                    "natural_burn_pct_per_h":   4.60,
                    "confidence": "low"},
}

# Soglia minima di "blend weight" per fidarsi dell'EMA invece del seed.
_OBSERVED_TRUST_DAYS = 4.0


def _jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))


def _config_path() -> Path:
    return _jht_home() / "jht.config.json"


def _ratio_state_path() -> Path:
    return _jht_home() / "logs" / "window-ratio-state.json"


def read_active_provider() -> str:
    """Provider attivo da jht.config.json. Fallback 'openai' se assente."""
    try:
        with _config_path().open(encoding="utf-8") as f:
            return (json.load(f).get("active_provider") or "openai").lower()
    except (OSError, json.JSONDecodeError):
        return "openai"


def _read_observed_ratio() -> Optional[dict]:
    """Legge window-ratio-state.json se presente, altrimenti None."""
    p = _ratio_state_path()
    if not p.exists():
        return None
    try:
        with p.open(encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _seed_for(provider: str) -> Optional[float]:
    info = _PROVIDER_SEEDS.get(provider) or {}
    if info.get("weekly_unlimited"):
        return None
    val = info.get("window_cap_pct_of_weekly")
    return float(val) if val is not None else None


def _observed_for(prov: str) -> dict:
    """window-ratio-state del provider richiesto, o {} se assente/di un altro."""
    observed = _read_observed_ratio() or {}
    if (observed.get("provider") or "").lower() != prov:
        return {}
    return observed


def _weekly_cap_observed(observed: dict) -> bool:
    """True se il daemon ha MISURATO un weekly cap reale e affidabile.

    Il flag statico `weekly_unlimited` è un DEFAULT day-0, non una verità
    perenne: un provider può introdurre un weekly cap dopo (caso Kimi/Moonshot
    2026 — `weekly_usage` esposto e enforced, EMA ratio finestra→weekly misurata
    da settimane). Quando il `window_ratio_meter` ha ≥1 giorno di storia con un
    `ema_ratio_pct` valido, quel provider HA di fatto un weekly cap: il dato
    OSSERVATO vince sul flag. Niente hardcoding "kimi ora ha il cap" — è il dato
    a deciderlo, così resta corretto se il provider cambia di nuovo.
    """
    ema = observed.get("ema_ratio_pct")
    days = observed.get("days_observed") or 0.0
    return isinstance(ema, (int, float)) and days >= 1.0


def get_window_cap_pct_of_weekly(
    provider: str | None = None,
) -> Optional[float]:
    """Ratio in % di una finestra 5h piena rispetto al weekly cap.

    Return:
      float — provider con weekly cap (Codex/Claude, o un provider il cui cap
              è stato OSSERVATO dal daemon): blend seed + EMA, o EMA pura
      None  — provider davvero weekly-unlimited (flag e NESSUNA osservazione
              contraria) o sconosciuto e mai osservato

    Per provider non in lookup e mai osservato: None (fallback band center nel
    chiamante).
    """
    prov = (provider or read_active_provider()).lower()
    observed = _observed_for(prov)
    cap_observed = _weekly_cap_observed(observed)

    info = _PROVIDER_SEEDS.get(prov) or {}
    if info.get("weekly_unlimited") and not cap_observed:
        # Davvero weekly-unlimited: il flag dice unlimited e il daemon NON ha
        # misurato nulla che lo contraddica → fallback band center nel chiamante.
        return None

    seed = _seed_for(prov)  # None per provider unlimited (manca il campo nel seed)
    ema = observed.get("ema_ratio_pct")
    days = observed.get("days_observed") or 0.0

    if seed is None:
        # Provider senza seed numerico (unlimited-ma-osservato, oppure
        # sconosciuto-ma-osservato): usa l'EMA misurata. `cap_observed`
        # garantisce ema valido e days>=1.
        return round(float(ema), 3) if cap_observed else None
    if not isinstance(ema, (int, float)):
        return seed

    w = min(1.0, days / _OBSERVED_TRUST_DAYS)
    blended = w * float(ema) + (1.0 - w) * seed
    return round(blended, 3)


def get_natural_burn_pct_per_h(provider: str | None = None) -> Optional[float]:
    """Burn rate naturale del provider in % weekly / h (full speed, no throttle).

    Usato per il vincolo "saturazione" del sweet-spot: con burn naturale B,
    saturi il weekly al 100% in 100/B ore di lavoro/settimana. Sotto
    quel valore spreci budget.

    Kimi (weekly-unlimited) → None.
    """
    prov = (provider or read_active_provider()).lower()
    info = _PROVIDER_SEEDS.get(prov) or {}
    if info.get("weekly_unlimited"):
        return None
    v = info.get("natural_burn_pct_per_h")
    return float(v) if v is not None else None


def get_sweet_spot_hours(provider: str | None = None) -> dict:
    """Range ore/sett "buone" per il provider.

    Ritorna dict con:
      min_hours        — sotto = sprechi budget (non saturi il weekly)
      max_hours        — sopra = diluisci troppo le finestre (overhead alto)
      weekly_unlimited — Kimi: nessun vincolo budget
    """
    prov = (provider or read_active_provider()).lower()
    info = _PROVIDER_SEEDS.get(prov) or {}
    if info.get("weekly_unlimited"):
        return {
            "weekly_unlimited": True,
            "min_hours": None,
            "max_hours": None,
            "provider": prov,
        }
    burn = info.get("natural_burn_pct_per_h")
    ratio = get_window_cap_pct_of_weekly(prov)
    min_h = round(100.0 / burn, 1) if isinstance(burn, (int, float)) and burn > 0 else None
    # Sweet spot superiore: tetto al ~25% di utilizzo del cap finestra 5h
    # (sotto a quello il target/finestra diventa < 25% e l'overhead di
    # spawn/coordinazione domina sul lavoro utile).
    # Formula: 2000 / windowCapPct_percent (vedi design doc).
    max_h = round(2000.0 / ratio, 1) if isinstance(ratio, (int, float)) and ratio > 0 else None
    return {
        "weekly_unlimited": False,
        "min_hours": min_h,
        "max_hours": max_h,
        "natural_burn_pct_per_h": burn,
        "window_cap_pct_of_weekly": ratio,
        "provider": prov,
    }


def describe(provider: str | None = None) -> dict:
    """Diagnostica completa per UI / log."""
    prov = (provider or read_active_provider()).lower()
    seed_info = _PROVIDER_SEEDS.get(prov) or {}
    observed = _read_observed_ratio() or {}
    if (observed.get("provider") or "").lower() != prov:
        observed = {}
    sweet = get_sweet_spot_hours(prov)
    return {
        "provider": prov,
        "seed_pct": seed_info.get("window_cap_pct_of_weekly"),
        "seed_burn_pct_per_h": seed_info.get("natural_burn_pct_per_h"),
        "seed_confidence": seed_info.get("confidence"),
        "weekly_unlimited": bool(seed_info.get("weekly_unlimited")),
        "observed_ema_pct": observed.get("ema_ratio_pct"),
        "days_observed": observed.get("days_observed"),
        "effective_pct": get_window_cap_pct_of_weekly(prov),
        "sweet_spot_min_hours": sweet["min_hours"],
        "sweet_spot_max_hours": sweet["max_hours"],
    }


if __name__ == "__main__":
    import sys
    if "--self-test" in sys.argv:
        # Test seed lookup + Kimi unlimited + provider sconosciuto
        fails = 0
        def ok(label, cond):
            global fails
            print(f"  {'OK' if cond else 'FAIL'} {label}")
            if not cond:
                fails += 1
        ok("codex seed 17.0", get_window_cap_pct_of_weekly("codex") == 17.0)
        ok("openai seed 17.0", get_window_cap_pct_of_weekly("openai") == 17.0)
        ok("claude seed 15.0", get_window_cap_pct_of_weekly("claude") == 15.0)
        # 2026-07-26: Kimi NON è più weekly-unlimited (403 "billing cycle" preso
        # sul campo + quote settimanali dichiarate su tutti i piani).
        ok("kimi seed 23.0 (measured on ThinkPad 2026-07-26)",
           get_window_cap_pct_of_weekly("kimi") == 23.0)
        ok("unknown provider → None",
           get_window_cap_pct_of_weekly("foobar") is None)
        # Data-driven override: se il daemon ha osservato un weekly cap per un
        # provider flaggato unlimited, l'EMA vince (non più None).
        ok("kimi unlimited+observed → EMA",
           _weekly_cap_observed({"ema_ratio_pct": 18.5, "days_observed": 34}) is True)
        ok("kimi unlimited+early observation (<1d) → remains unlimited",
           _weekly_cap_observed({"ema_ratio_pct": 18.5, "days_observed": 0.3}) is False)
        sys.exit(0 if fails == 0 else 1)
    print(json.dumps(describe(), indent=2))
