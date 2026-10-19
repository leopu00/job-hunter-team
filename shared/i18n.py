"""shared/i18n.py — Python i18n helper

Reads shared/locales/<lang>.json — same catalog used by bash i18n.sh and
cli/wizard/i18n.js. Resolves the canonical i18n-prefs.json first, then the
bootstrap inputs $JHT_LANG → host.env → 'en'.
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
_VALID_LANGS = {"en", "it", "hu", "es", "de", "fr", "pt"}


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


def _prefs_stamp(home: Path) -> Optional[tuple]:
    """Which version of i18n-prefs.json is there: None when there is none."""
    try:
        st = (home / "i18n-prefs.json").stat()
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size, st.st_ino)


@lru_cache(maxsize=1)
def _resolve_lang_for(_inputs: tuple) -> str:
    """The language for these inputs; the inputs are the cache key, `_resolve_lang` builds them."""
    home = Path(os.environ.get("JHT_HOME", "/jht_home"))
    try:
        prefs = json.loads((home / "i18n-prefs.json").read_text(encoding="utf-8"))
        locale = prefs.get("locale") if isinstance(prefs, dict) else None
        if locale in _VALID_LANGS:
            return locale
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        pass
    env_lang = (os.environ.get("JHT_LANG") or "").strip()
    if env_lang in _VALID_LANGS:
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
        if v in _VALID_LANGS:
            return v
    return "en"


def _resolve_lang() -> str:
    """The language of the user NOW.

    A long-lived process (the throttle daemon sweeping deadlines, a bridge) must follow the user who
    changes language in the app, so the answer is kept only while what it depends on is the same: the
    prefs file (its version, or its absence), $JHT_LANG and the places the fallbacks read. The catalog of
    each language stays cached.
    """
    home = os.environ.get("JHT_HOME", "/jht_home")
    return _resolve_lang_for((
        home,
        _prefs_stamp(Path(home)),
        os.environ.get("JHT_LANG"),
        os.environ.get("JHT_HOST_ENV_FILE"),
        os.environ.get("HOME"),
    ))


_resolve_lang.cache_clear = _resolve_lang_for.cache_clear  # type: ignore[attr-defined]


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
