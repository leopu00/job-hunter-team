#!/usr/bin/env python3
"""salary_estimate — stima salario gerarchica con cache locale (bug #27).

Lo Scorer chiama questa skill prima di valorizzare `salary_fit`. La
strategia evita di sprecare ricerche web ripetute (es. "Python junior
Italia full-time" identica per 10 posizioni → 1 sola fetch, 9 cache
hit).

LIVELLO 1 — Range dichiarato nella posizione (salary_declared_*)
              → no estimate, usa quello.
LIVELLO 2 — Cache locale ~/.jht/.cache/salary_estimates.json
              key = (stack, seniority, country, mode)
              TTL 30 giorni (salari cambiano di anno in anno).
LIVELLO 3 — Web search (TODO, web access). Stub per ora: ritorna None
              + flag estimation_failed=True. Lo Scorer ricade su L4.
LIVELLO 4 — Default neutrale 5 + flag "no_data_default" in notes.

CLI:
    python3 /app/shared/skills/salary_estimate.py \
        --stack python --seniority junior --country IT --mode remote
    → JSON: {"level":2,"min":28000,"max":38000,"currency":"EUR",
              "source":"cache","fetched_at":"2026-05-17"}

    python3 /app/shared/skills/salary_estimate.py \
        --position-id 42
    → legge salary_declared_* dalla DB, se assenti applica cache → web.

Lo Scorer poi traduce il range in salary_fit 0-10 (sua logica esistente)
e popola positions.salary_estimated_* via db_update.

Cache NO sync Supabase: solo locale agli Scorer.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
CACHE_DIR = JHT_HOME / ".cache"
CACHE_FILE = CACHE_DIR / "salary_estimates.json"
CACHE_TTL_DAYS = 30


def _now_ts() -> float:
    return time.time()


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _load_cache() -> dict:
    if not CACHE_FILE.exists():
        return {}
    try:
        with CACHE_FILE.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_cache(cache: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CACHE_FILE.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)
    tmp.replace(CACHE_FILE)


def _cache_key(stack: str, seniority: str, country: str, mode: str) -> str:
    parts = [
        (stack or "").strip().lower(),
        (seniority or "").strip().lower(),
        (country or "").strip().upper(),
        (mode or "").strip().lower(),
    ]
    return "|".join(parts)


def _is_fresh(entry: dict) -> bool:
    fetched_at = entry.get("fetched_at_ts")
    if not isinstance(fetched_at, (int, float)):
        return False
    age_days = (_now_ts() - fetched_at) / 86400
    ttl = entry.get("ttl_days", CACHE_TTL_DAYS)
    return age_days < ttl


def lookup_cache(stack: str, seniority: str, country: str, mode: str) -> dict | None:
    cache = _load_cache()
    key = _cache_key(stack, seniority, country, mode)
    entry = cache.get(key)
    if entry and _is_fresh(entry):
        return entry
    return None


def store_cache(
    stack: str, seniority: str, country: str, mode: str,
    *, min_eur: int, max_eur: int, source: str,
) -> dict:
    cache = _load_cache()
    key = _cache_key(stack, seniority, country, mode)
    entry = {
        "min": min_eur,
        "max": max_eur,
        "currency": "EUR",
        "source": source,
        "fetched_at": _now_iso(),
        "fetched_at_ts": _now_ts(),
        "ttl_days": CACHE_TTL_DAYS,
    }
    cache[key] = entry
    _save_cache(cache)
    return entry


# ── LIVELLO 3: web search stub ─────────────────────────────────────────
def web_estimate(stack: str, seniority: str, country: str, mode: str) -> dict | None:
    """Stub LIVELLO 3 — web fetch + parsing Glassdoor/Levels/Indeed.

    Non implementato in questo ciclo (F-2 Scout web access lo abiliterà
    cross-provider). Per ora ritorna None così il caller cade su L4
    (default neutrale + flag).
    """
    return None


# ── Entry point principale ────────────────────────────────────────────
def estimate(
    *,
    stack: str | None,
    seniority: str | None,
    country: str | None,
    mode: str | None = "remote",
    declared_min: int | None = None,
    declared_max: int | None = None,
) -> dict:
    """Restituisce il dict di stima + livello applicato.

    Schema risposta:
        {"level":1|2|3|4, "min":N, "max":N, "currency":"EUR",
         "source":"declared|cache|web|default", "fetched_at":"YYYY-MM-DD",
         "estimation_failed":bool}
    """
    # L1: declared nella posizione
    if declared_min is not None and declared_max is not None:
        return {
            "level": 1,
            "min": int(declared_min),
            "max": int(declared_max),
            "currency": "EUR",
            "source": "declared",
            "fetched_at": _now_iso(),
            "estimation_failed": False,
        }

    if not (stack and seniority and country):
        # Senza chiave di cache non possiamo fare niente di intelligente.
        return {
            "level": 4,
            "min": None,
            "max": None,
            "currency": "EUR",
            "source": "default",
            "fetched_at": _now_iso(),
            "estimation_failed": True,
            "reason": "missing_inputs",
        }

    # L2: cache locale
    hit = lookup_cache(stack, seniority, country, mode or "remote")
    if hit:
        return {
            "level": 2,
            "min": hit["min"],
            "max": hit["max"],
            "currency": hit.get("currency", "EUR"),
            "source": hit.get("source", "cache"),
            "fetched_at": hit.get("fetched_at", _now_iso()),
            "estimation_failed": False,
        }

    # L3: web search (stub per ora)
    web = web_estimate(stack, seniority, country, mode or "remote")
    if web:
        entry = store_cache(
            stack, seniority, country, mode or "remote",
            min_eur=web["min"], max_eur=web["max"], source=web.get("source", "web"),
        )
        return {
            "level": 3,
            "min": entry["min"],
            "max": entry["max"],
            "currency": entry["currency"],
            "source": entry["source"],
            "fetched_at": entry["fetched_at"],
            "estimation_failed": False,
        }

    # L4: default neutrale
    return {
        "level": 4,
        "min": None,
        "max": None,
        "currency": "EUR",
        "source": "default",
        "fetched_at": _now_iso(),
        "estimation_failed": True,
        "reason": "no_data_default",
    }


def main(argv):
    p = argparse.ArgumentParser(description="Estimate salary from declared ranges, local cache, and fallback data.")
    p.add_argument("--stack", help='for example "python", "go", or "react"')
    p.add_argument("--seniority", help='"junior" | "mid" | "senior"')
    p.add_argument("--country", help='ISO2 country, for example "IT" or "DE"')
    p.add_argument("--mode", default="remote", help='"remote" | "hybrid" | "onsite"')
    p.add_argument("--declared-min", type=int)
    p.add_argument("--declared-max", type=int)
    p.add_argument("--position-id", type=int,
                   help="read salary_declared_* from the position database row")
    p.add_argument("--seed-cache", action="store_true",
                   help="development only: write a mock cache entry for tests")
    args = p.parse_args(argv)

    if args.seed_cache:
        if not (args.stack and args.seniority and args.country and args.declared_min and args.declared_max):
            print("--seed-cache requires --stack --seniority --country --declared-min --declared-max", file=sys.stderr)
            return 2
        entry = store_cache(args.stack, args.seniority, args.country, args.mode,
                            min_eur=args.declared_min, max_eur=args.declared_max, source="seed")
        print(json.dumps(entry))
        return 0

    declared_min = args.declared_min
    declared_max = args.declared_max
    if args.position_id and (declared_min is None or declared_max is None):
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from _db import get_db, ensure_schema  # type: ignore
        conn = get_db()
        ensure_schema(conn)
        r = conn.execute(
            "SELECT salary_declared_min, salary_declared_max "
            "FROM positions WHERE id = ?", (args.position_id,),
        ).fetchone()
        if r:
            declared_min = declared_min if declared_min is not None else r["salary_declared_min"]
            declared_max = declared_max if declared_max is not None else r["salary_declared_max"]

    result = estimate(
        stack=args.stack,
        seniority=args.seniority,
        country=args.country,
        mode=args.mode,
        declared_min=declared_min,
        declared_max=declared_max,
    )
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
