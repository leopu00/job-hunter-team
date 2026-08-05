"""shared/i18n.py — Python i18n helper

Reads shared/locales/<lang>.json — same catalog used by bash i18n.sh and
cli/wizard/i18n.js. Resolves $JHT_LANG with cascade: env → host.env → 'en'.
Missing key: returns the key (visible in dev, doesn't break UI).

Designed for Python scripts (skills, bridges) that need the same strings
as the bash launcher and Node CLI.

Usage:
    from i18n import t, tf
    print(t('welcome.capitano'))
    print(tf('host_setup.swap_low_ram', 4))
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Optional


_LOCALES_DIR = Path(__file__).resolve().parent / "locales"


def _read_kv_file(path: Path, key: str) -> Optional[str]:
    try:
        with path.open(encoding="utf-8") as f:
            for line in f:
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                if "=" not in stripped:
                    continue
                k, _, v = stripped.partition("=")
                if k.strip() == key:
                    return v.strip().strip('"').strip("'")
    except (OSError, UnicodeDecodeError):
        pass
    return None


@lru_cache(maxsize=1)
def _resolve_lang() -> str:
    env_lang = (os.environ.get("JHT_LANG") or "").strip()
    if env_lang:
        return env_lang
    candidates = [
        os.environ.get("JHT_HOST_ENV_FILE"),
        os.path.join(os.environ.get("JHT_HOME", "/jht_home"), "host.env"),
        os.path.join(os.environ.get("HOME", "/root"), ".jht", "host.env"),
    ]
    for raw in candidates:
        if not raw:
            continue
        v = _read_kv_file(Path(raw), "JHT_LANG")
        if v:
            return v
    return "en"


@lru_cache(maxsize=4)
def _load_catalog(lang: str) -> dict:
    target = _LOCALES_DIR / f"{lang}.json"
    fallback = _LOCALES_DIR / "en.json"
    merged: dict = {}
    if fallback.exists():
        try:
            merged = json.loads(fallback.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            merged = {}
    if lang != "en" and target.exists():
        try:
            overlay = json.loads(target.read_text(encoding="utf-8"))
            merged = {**merged, **overlay}
        except (json.JSONDecodeError, OSError):
            pass
    return merged


def t(key: str) -> str:
    """Lookup a translated string by key. Falls back to en, then to the key."""
    lang = _resolve_lang()
    # T0-T1 launch copy is English-only in phase 1. Do not let an old
    # JHT_LANG=it in host.env leak Italian into the recorded onboarding path.
    if (
        key.startswith(("host_setup.", "welcome.", "wizard.checks.", "wizard.cloud.",
                        "wizard.step.", "wizard.provider.", "wizard.oauth.", "wizard.cli."))
        or key in {
            "wizard.welcome_subtitle", "wizard.aborted_prereqs",
            "wizard.profile.intro", "wizard.team.starting",
            "wizard.team.start_failed", "wizard.outro_done",
            "wizard.outro_aborted", "wizard.start.ready", "wizard.start.done",
        }
    ):
        lang = "en"
    cat = _load_catalog(lang)
    v = cat.get(key)
    if isinstance(v, str):
        return v
    return key


def tf(key: str, *args) -> str:
    """Lookup with printf-style %s/%d substitution."""
    template = t(key)
    try:
        return template % args
    except (TypeError, ValueError):
        return template


def current_lang() -> str:
    """Current resolved language (useful for downstream decisions)."""
    return _resolve_lang()
