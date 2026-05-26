#!/usr/bin/env python3
"""
provider_capacity.py — `window_cap_pct_of_weekly` per provider attivo.

Concetto: ogni piano (Codex Pro, Claude Max x20, Kimi Plan, ecc.) ha un
rapporto fisso tra il cap della finestra rate-limit 5h e il cap del
weekly budget. Esempio Codex Pro: una finestra 5h piena vale ~14.7% del
weekly budget (caso studio 2026-05-21, 396.9M token in 34.84h continuativi).

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
  - docs/internal/2026-05-25-work-hours-design.md § "Scalabilità"
  - docs/about/RESULTS.md (case study Codex Pro)
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional


# Lookup seed — vedi design doc "Lookup table seed (day 0)".
# `weeklyUnlimited=True` indica provider senza weekly cap (Kimi): nessuna
# distribuzione weekly necessaria, fallback al target band classico.
_PROVIDER_SEEDS: dict[str, dict] = {
    "openai":      {"window_cap_pct_of_weekly": 14.7, "confidence": "high"},
    "codex":       {"window_cap_pct_of_weekly": 14.7, "confidence": "high"},
    "codex-plus":  {"window_cap_pct_of_weekly": 14.7, "confidence": "low"},
    "claude":      {"window_cap_pct_of_weekly": 15.0, "confidence": "low"},
    "claude-max5": {"window_cap_pct_of_weekly": 15.0, "confidence": "low"},
    "kimi":        {"weekly_unlimited": True},
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


def get_window_cap_pct_of_weekly(
    provider: str | None = None,
) -> Optional[float]:
    """Ratio in % di una finestra 5h piena rispetto al weekly cap.

    Return:
      float — provider con weekly cap (Codex/Claude), blend seed + EMA
      None  — provider weekly-unlimited (Kimi) o provider sconosciuto

    Per provider non in lookup: None (fallback band center nel chiamante).
    """
    prov = (provider or read_active_provider()).lower()
    seed = _seed_for(prov)

    if (prov in _PROVIDER_SEEDS
            and _PROVIDER_SEEDS[prov].get("weekly_unlimited")):
        return None  # Kimi & co. — nessun weekly cap, distribuzione N/A

    observed = _read_observed_ratio() or {}
    obs_provider = (observed.get("provider") or "").lower()
    if obs_provider != prov:
        observed = {}  # state file di un altro provider → ignoralo

    ema = observed.get("ema_ratio_pct")
    days = observed.get("days_observed") or 0.0
    if seed is None and isinstance(ema, (int, float)):
        # Provider sconosciuto al seed table ma osservato dal daemon:
        # usa direttamente l'EMA quando abbiamo qualche giorno di dati.
        return float(ema) if days >= 1.0 else None
    if seed is None:
        return None
    if not isinstance(ema, (int, float)):
        return seed

    w = min(1.0, days / _OBSERVED_TRUST_DAYS)
    blended = w * float(ema) + (1.0 - w) * seed
    return round(blended, 3)


def describe(provider: str | None = None) -> dict:
    """Diagnostica completa per UI / log."""
    prov = (provider or read_active_provider()).lower()
    seed_info = _PROVIDER_SEEDS.get(prov) or {}
    observed = _read_observed_ratio() or {}
    if (observed.get("provider") or "").lower() != prov:
        observed = {}
    return {
        "provider": prov,
        "seed_pct": seed_info.get("window_cap_pct_of_weekly"),
        "seed_confidence": seed_info.get("confidence"),
        "weekly_unlimited": bool(seed_info.get("weekly_unlimited")),
        "observed_ema_pct": observed.get("ema_ratio_pct"),
        "days_observed": observed.get("days_observed"),
        "effective_pct": get_window_cap_pct_of_weekly(prov),
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
        ok("codex seed 14.7", get_window_cap_pct_of_weekly("codex") == 14.7)
        ok("openai seed 14.7", get_window_cap_pct_of_weekly("openai") == 14.7)
        ok("claude seed 15.0", get_window_cap_pct_of_weekly("claude") == 15.0)
        ok("kimi → None (unlimited)",
           get_window_cap_pct_of_weekly("kimi") is None)
        ok("provider sconosciuto → None",
           get_window_cap_pct_of_weekly("foobar") is None)
        sys.exit(0 if fails == 0 else 1)
    print(json.dumps(describe(), indent=2))
