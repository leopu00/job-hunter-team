"""JHT-T304 — the person who writes to the Assistant in another language than the team's sets their language.

RULE-T14 keeps the language of a teammate's message, a script or a job ad from changing the team's language. The Assistant
is the one agent the person talks to, so for it (and only for it) the person's own message decides, and it saves the
choice where every reader looks first. Three layers: the prompt says so in the seven languages, `text_language.py set`
saves it, and once saved the kickoff line every agent gets already carries the new language.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import text_language  # noqa: E402

LANGS = ("en", "it", "de", "es", "fr", "hu", "pt")
ROLES = sorted(p.name for p in (ROOT / "agents").iterdir() if p.is_dir() and not p.name.startswith("_"))


def _prompt(role: str, lang: str) -> str:
    name = f"{role}.md" if lang == "en" else f"{role}.{lang}.md"
    return (ROOT / "agents" / role / name).read_text(encoding="utf-8")


def _exception(role: str, lang: str) -> list[str]:
    return [ln for ln in _prompt(role, lang).split("\n") if ln.startswith("> 🗣️")]


def _run(home: Path, *args: str, env: dict | None = None):
    return subprocess.run(
        [sys.executable, "-I", str(SKILLS / "text_language.py"), *args], capture_output=True, text=True,
        env={"PATH": os.environ["PATH"], "PYTHONDONTWRITEBYTECODE": "1", "JHT_HOME": str(home), "HOME": str(home), **(env or {})},
    )


# --- the prompts --------------------------------------------------------------------------------------


@pytest.mark.parametrize("lang", LANGS)
def test_the_assistant_prompt_gives_the_user_the_last_word_on_their_language(lang):
    lines = _exception("assistente", lang)
    assert len(lines) == 1, f"assistente.{lang}: the exception must be there exactly once"
    assert "text_language.py set" in lines[0] and "[TEAM-LANGUAGE]" in lines[0] and "[CHAT]" in lines[0]
    # it sits with the rule, before the first section of the role
    text = _prompt("assistente", lang).split("\n")
    rule = next(i for i, ln in enumerate(text) if ln.startswith("> 🌍") and "RULE-T14" in ln)
    exception = next(i for i, ln in enumerate(text) if ln.startswith("> 🗣️"))
    first_heading = next(i for i, ln in enumerate(text) if ln.startswith("## "))
    assert rule < exception < first_heading


@pytest.mark.parametrize("lang", LANGS)
def test_the_exception_is_in_the_language_of_its_prompt(lang):
    line = _exception("assistente", lang)[0]
    if lang != "en":
        assert text_language.guess_language(line) in (lang, None)
    texts = {l: _exception("assistente", l)[0] for l in LANGS}
    assert len(set(texts.values())) == len(LANGS)


@pytest.mark.parametrize("role", [r for r in ROLES if r != "assistente"])
def test_no_other_role_changes_the_team_language_on_a_message(role):
    for lang in LANGS:
        assert "text_language.py set" not in _prompt(role, lang), f"{role}.{lang} must keep RULE-T14 whole"


# --- the saving ---------------------------------------------------------------------------------------


def test_set_writes_the_prefs_file_and_every_reader_follows(tmp_path):
    assert _run(tmp_path, "lang").stdout.strip() == "en"
    done = _run(tmp_path, "set", "it")
    assert done.returncode == 0 and "Italian (it)" in done.stdout
    assert json.loads((tmp_path / "i18n-prefs.json").read_text(encoding="utf-8")) == {"locale": "it"}
    assert _run(tmp_path, "lang").stdout.strip() == "it"
    # a stale JHT_LANG does not win over the file the Assistant just wrote
    assert _run(tmp_path, "lang", env={"JHT_LANG": "de"}).stdout.strip() == "it"
    # and the line every agent gets in a kickoff or a resume now says Italian
    assert _run(tmp_path, "line").stdout.startswith("[TEAM-LANGUAGE] Italian (it).")


def test_set_keeps_the_other_keys_leaves_no_temporary_file_and_refuses_a_wrong_code(tmp_path):
    (tmp_path / "i18n-prefs.json").write_text(json.dumps({"locale": "en", "note": "x"}), encoding="utf-8")
    assert _run(tmp_path, "set", "de").returncode == 0
    assert json.loads((tmp_path / "i18n-prefs.json").read_text(encoding="utf-8")) == {"locale": "de", "note": "x"}
    bad = _run(tmp_path, "set", "xx")
    assert bad.returncode == 2 and "unknown language" in bad.stderr
    assert json.loads((tmp_path / "i18n-prefs.json").read_text(encoding="utf-8"))["locale"] == "de"
    assert [p.name for p in tmp_path.iterdir()] == ["i18n-prefs.json"]


def test_set_works_on_a_broken_prefs_file(tmp_path):
    (tmp_path / "i18n-prefs.json").write_text("{ not json", encoding="utf-8")
    assert _run(tmp_path, "set", "fr").returncode == 0
    assert json.loads((tmp_path / "i18n-prefs.json").read_text(encoding="utf-8")) == {"locale": "fr"}


def test_set_says_why_when_it_cannot_write(tmp_path):
    missing = tmp_path / "nope"
    result = _run(missing, "set", "it")
    assert result.returncode == 1 and "could not write" in result.stderr


def test_the_python_function_and_the_node_one_write_the_same_file(tmp_path):
    text_language.set_language("pt", tmp_path)
    assert (tmp_path / "i18n-prefs.json").read_text(encoding="utf-8") == '{\n  "locale": "pt"\n}\n'
