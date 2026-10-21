"""JHT-T31 — everything the user reads is in the user's language, whatever language the agent is answering.

Three layers, each checked here:

- the rule (RULE-T14) heads every role prompt, in all seven languages, before the role's own sections;
- the skills that write the profile and its summaries tell the agent how to read the user's language
  and to check what it wrote;
- a deterministic check: `text_language.py` guesses the language of a free text, and
  `validate_profile.py` warns (never refuses, not even with --strict) on a long text clearly in
  another language than the user's.
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

SAMPLES = {
    "en": "I am a developer with a lot of experience working with data, and I have always tried to improve the way our team builds the products that our customers use.",
    "it": "Sono uno sviluppatore con molta esperienza nel lavoro con i dati, e ho sempre cercato di migliorare il modo in cui la nostra squadra costruisce i prodotti che usano i clienti.",
    "de": "Ich bin ein Entwickler mit viel Erfahrung in der Arbeit mit Daten, und ich habe immer versucht, die Art zu verbessern, wie unser Team die Produkte baut, die unsere Kunden nutzen.",
    "es": "Soy un desarrollador con mucha experiencia en el trabajo con datos, y siempre he intentado mejorar la forma en que nuestro equipo construye los productos que usan los clientes.",
    "fr": "Je suis un développeur avec beaucoup d'expérience dans le travail avec les données, et j'ai toujours essayé d'améliorer la façon dont notre équipe construit les produits que les clients utilisent.",
    "hu": "Fejlesztő vagyok, sok tapasztalattal az adatokkal való munkában, és mindig igyekeztem javítani azon, ahogyan a csapatunk az ügyfelek által használt termékeket építi.",
    "pt": "Sou um desenvolvedor com muita experiência no trabalho com dados, e sempre procurei melhorar a forma como a nossa equipa constrói os produtos que os clientes usam.",
}


def _prompt(role: str, lang: str) -> list[str]:
    name = f"{role}.md" if lang == "en" else f"{role}.{lang}.md"
    return (ROOT / "agents" / role / name).read_text(encoding="utf-8").split("\n")


# --- the prompts -----------------------------------------------------------------------------------


def test_the_team_has_its_twelve_roles():
    assert len(ROLES) >= 12


@pytest.mark.parametrize("lang", LANGS)
@pytest.mark.parametrize("role", ROLES)
def test_the_rule_is_the_first_thing_in_every_prompt(role, lang):
    lines = _prompt(role, lang)
    rule = [i for i, ln in enumerate(lines) if ln.startswith("> 🌍") and "RULE-T14" in ln]
    assert len(rule) == 1, f"{role}.{lang}: the rule must be there exactly once"
    first_heading = next(i for i, ln in enumerate(lines) if ln.startswith("## "))
    assert rule[0] < first_heading, f"{role}.{lang}: the rule is buried under the role's own sections"
    line = lines[rule[0]]
    assert "i18n-prefs.json" in line and "$JHT_LANG" in line


@pytest.mark.parametrize("role", ROLES)
def test_every_language_of_a_prompt_has_its_own_wording(role):
    rules = {lang: next(ln for ln in _prompt(role, lang) if ln.startswith("> 🌍")) for lang in LANGS}
    assert len(set(rules.values())) == len(LANGS)
    # In its own language: the rule of each prompt is read as that language, not as English.
    for lang, rule in rules.items():
        if lang != "en":
            assert text_language.guess_language(rule) in (lang, None), (role, lang)


# --- the skills that write for the user --------------------------------------------------------------


@pytest.mark.parametrize("lang", LANGS)
@pytest.mark.parametrize("skill", ["profile-schema", "profile-yaml", "profile-summaries"])
def test_the_skills_tell_how_to_read_the_users_language(skill, lang):
    name = "SKILL.md" if lang == "en" else f"SKILL.{lang}.md"
    text = (ROOT / "agents" / "_skills" / skill / name).read_text(encoding="utf-8")
    assert "RULE-T14" in text and "text_language.py" in text
    # The language section is the first one of the skill, before the skill's own.
    first = next(ln for ln in text.split("\n") if ln.startswith("## "))
    assert "🌍" in first


# --- the guess ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("lang", LANGS)
def test_a_paragraph_is_recognised_in_its_language(lang):
    assert text_language.guess_language(SAMPLES[lang]) == lang


def test_a_short_text_a_list_of_tools_or_a_mix_gives_no_answer():
    assert text_language.guess_language("Backend developer, Python, SQL") is None
    assert text_language.guess_language("") is None
    assert text_language.guess_language(None) is None
    assert text_language.guess_language(SAMPLES["en"] + " " + SAMPLES["it"]) is None


def test_the_language_follows_the_prefs_file_then_the_environment(tmp_path):
    def run(env: dict[str, str]):
        return subprocess.run(
            [sys.executable, "-I", str(SKILLS / "text_language.py"), "lang"],
            capture_output=True, text=True,
            env={"PATH": os.environ["PATH"], "PYTHONDONTWRITEBYTECODE": "1", "JHT_HOME": str(tmp_path), "HOME": str(tmp_path), **env},
        ).stdout.strip()

    assert run({}) == "en"
    assert run({"JHT_LANG": "de"}) == "de"
    (tmp_path / "i18n-prefs.json").write_text(json.dumps({"locale": "hu"}), encoding="utf-8")
    assert run({"JHT_LANG": "de"}) == "hu"


def test_check_says_wrong_language_for_an_italian_text_when_the_user_speaks_english(tmp_path):
    base = {"PATH": os.environ["PATH"], "PYTHONDONTWRITEBYTECODE": "1", "JHT_HOME": str(tmp_path), "HOME": str(tmp_path), "JHT_LANG": "en"}

    def check(text: str):
        return subprocess.run([sys.executable, "-I", str(SKILLS / "text_language.py"), "check", text], capture_output=True, text=True, env=base)

    wrong = check(SAMPLES["it"])
    assert wrong.returncode == 3 and "WRONG_LANGUAGE" in wrong.stderr
    right = check(SAMPLES["en"])
    assert right.returncode == 0 and right.stdout.strip() == "OK"
    assert check("Backend developer").returncode == 0


# --- the validator -----------------------------------------------------------------------------------

PROFILE = """name: Ada Example
target_role: Backend Developer
location: Milan
experience_years: 6
has_degree: true
seniority_target: mid
skills:
  primary: [python, sql]
languages:
  - language: English
    level: C1
blocks:
  - key: about
    title: About
    kind: narrative
    content: {about}
  - key: strengths
    title: Strengths
    kind: key_points
    content:
      - heading: Teamwork
        text: {point}
"""


def _validate(tmp_path: Path, about: str, point: str = "Short.", *flags: str, lang: str = "en"):
    pytest.importorskip("yaml")
    path = tmp_path / "candidate_profile.yml"
    path.write_text(PROFILE.format(about=json.dumps(about), point=json.dumps(point)), encoding="utf-8")
    return subprocess.run(
        [sys.executable, "-I", str(SKILLS / "validate_profile.py"), str(path), *flags],
        capture_output=True, text=True,
        env={"PATH": os.environ["PATH"], "PYTHONDONTWRITEBYTECODE": "1", "JHT_HOME": str(tmp_path), "HOME": str(tmp_path), "JHT_LANG": lang},
    )


def test_an_italian_summary_for_an_english_user_is_a_warning_and_the_profile_stays_valid(tmp_path):
    done = _validate(tmp_path, SAMPLES["it"])
    assert done.returncode == 0 and done.stdout.strip() == "VALID_PROFILE"
    assert "WARN: LANGUAGE: blocks[0] (about) looks it, the user's language is en" in done.stderr


def test_the_notice_is_not_counted_by_strict(tmp_path):
    done = _validate(tmp_path, SAMPLES["it"], "Short.", "--strict")
    assert done.returncode == 0 and "LANGUAGE" in done.stderr


def test_the_right_language_or_a_forced_one_says_nothing(tmp_path):
    assert "LANGUAGE" not in _validate(tmp_path, SAMPLES["en"]).stderr
    assert "LANGUAGE" not in _validate(tmp_path, SAMPLES["it"], "Short.", "--lang", "it").stderr
    assert "LANGUAGE" not in _validate(tmp_path, SAMPLES["it"], lang="it").stderr


def test_a_key_point_text_is_judged_too_and_json_reports_it_apart(tmp_path):
    done = _validate(tmp_path, SAMPLES["en"], SAMPLES["de"], "--json")
    report = json.loads(done.stdout)
    assert report["ok"] is True and report["errors"] == [] and report["warnings"] == []
    assert len(report["language_warnings"]) == 1 and "content[0]" in report["language_warnings"][0]
