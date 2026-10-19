"""shared/i18n.py follows the user's language change in a process that stays alive.

The throttle daemon (always on) sweeps question deadlines and writes the "expired" notice in the user's
language; a bridge does the same for its phrases. The language used to be resolved once for the life of the
process, so a user who switched language in the app kept getting the old one until a restart. It is now
resolved again when what it depends on changes: the prefs file (its version, or its absence) and the
environment the fallbacks read. The catalog of each language stays cached.
"""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
KEY = "question.postpone"
PHRASES = {"en": "Postpone, do nothing", "it": "Rinvia, non fare niente", "de": "Verschieben, nichts tun"}


@pytest.fixture()
def i18n(tmp_path, monkeypatch):
    """A private copy of the module (its own caches), a private home, and no language in the environment."""
    spec = importlib.util.spec_from_file_location("i18n_follows_under_test", ROOT / "shared" / "i18n.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path / "nohome"))
    monkeypatch.setenv("JHT_HOST_ENV_FILE", str(tmp_path / "no-host.env"))
    monkeypatch.delenv("JHT_LANG", raising=False)
    module.home = tmp_path
    return module


def choose(i18n, locale: str, *, mtime: int | None = None) -> None:
    path = i18n.home / "i18n-prefs.json"
    path.write_text(json.dumps({"locale": locale}), encoding="utf-8")
    if mtime is not None:
        os.utime(path, ns=(mtime, mtime))


def test_a_language_chosen_in_the_app_is_followed_without_a_restart(i18n):
    choose(i18n, "it", mtime=1_000_000_000_000_000_000)
    assert i18n.t(KEY) == PHRASES["it"]
    assert i18n.t(KEY) == PHRASES["it"]  # again: the same file, the same answer
    choose(i18n, "de", mtime=1_000_000_001_000_000_000)
    assert i18n.t(KEY) == PHRASES["de"]
    assert i18n.current_lang() == "de"


def test_a_rewrite_of_the_same_size_is_seen_by_its_time_alone(i18n):
    # "it" and "de" have the same length: only the modification time tells the two files apart.
    choose(i18n, "it", mtime=1_000_000_000_000_000_000)
    assert i18n.current_lang() == "it"
    choose(i18n, "de", mtime=1_000_000_002_000_000_000)
    assert i18n.current_lang() == "de"


def test_without_a_prefs_file_the_language_is_the_one_of_today(i18n, monkeypatch):
    assert i18n.current_lang() == "en"  # no file, no JHT_LANG: the product default
    assert i18n.t(KEY) == PHRASES["en"]
    monkeypatch.setenv("JHT_LANG", "it")  # the bootstrap input, when there is no prefs file
    assert i18n.current_lang() == "it"


def test_a_change_of_jht_lang_is_followed_while_the_prefs_file_is_absent(i18n, monkeypatch):
    monkeypatch.setenv("JHT_LANG", "it")
    assert i18n.t(KEY) == PHRASES["it"]
    monkeypatch.setenv("JHT_LANG", "de")
    assert i18n.t(KEY) == PHRASES["de"]
    monkeypatch.delenv("JHT_LANG")
    assert i18n.t(KEY) == PHRASES["en"]


def test_the_prefs_file_still_wins_over_jht_lang_and_its_removal_gives_the_fallback_back(i18n, monkeypatch):
    monkeypatch.setenv("JHT_LANG", "de")
    choose(i18n, "it")
    assert i18n.current_lang() == "it"
    (i18n.home / "i18n-prefs.json").unlink()
    assert i18n.current_lang() == "de"


def test_a_prefs_file_that_cannot_be_read_or_names_no_language_is_ignored_as_before(i18n, monkeypatch):
    monkeypatch.setenv("JHT_LANG", "de")
    (i18n.home / "i18n-prefs.json").write_text("{not json", encoding="utf-8")
    assert i18n.current_lang() == "de"
    choose(i18n, "klingon")
    assert i18n.current_lang() == "de"
    choose(i18n, "it")
    assert i18n.current_lang() == "it"


def test_nothing_is_resolved_again_while_nothing_changed_and_the_catalogs_stay_cached(i18n):
    choose(i18n, "it")
    for _ in range(5):
        i18n.t(KEY)
    resolved = i18n._resolve_lang_for.cache_info()  # noqa: SLF001
    assert (resolved.misses, resolved.hits) == (1, 4)
    choose(i18n, "de", mtime=2_000_000_000_000_000_000)
    i18n.t(KEY)
    choose(i18n, "it", mtime=2_000_000_001_000_000_000)
    i18n.t(KEY)  # back to a language whose catalog is already loaded
    catalogs = i18n._load_catalog.cache_info()  # noqa: SLF001
    assert catalogs.misses == 2 and catalogs.hits >= 1  # it, de: each loaded once


def test_the_callers_keep_the_same_api_including_clearing_the_cache(i18n):
    choose(i18n, "it")
    assert i18n.current_lang() == "it"
    i18n._resolve_lang.cache_clear()  # noqa: SLF001 - what other tests call
    i18n._load_catalog.cache_clear()  # noqa: SLF001
    assert i18n.tf("question.postpone") == PHRASES["it"]
    assert i18n.tf("a.key.that.does.not.exist") == "a.key.that.does.not.exist"
