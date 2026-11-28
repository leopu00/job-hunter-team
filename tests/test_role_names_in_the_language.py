"""JHT-T358: the roles' names the person reads are in the person's language, from one catalog (shared/i18n/role-names.json).

The ids stay what they are (sessions CAPITANO, SCOUT-2, folders agents/<role>, the database, the files); only the name shown
changes. A text writes {role:<id>} where the grammar allows it (English, Italian: no article or ending changes with the name); in
the other languages, where articles and cases follow the name, the catalog's name is written out. Either way no Italian name of a
role may reach a person who chose another language: this file holds it for the CLI's texts, the shared catalogs read by Python,
the wizard and the shell, and for `jht team list`.

Run:
    pytest tests/test_role_names_in_the_language.py -v
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LANGS = ("en", "it", "de", "es", "fr", "pt", "hu")
CATALOG = json.loads((ROOT / "shared" / "i18n" / "role-names.json").read_text(encoding="utf-8"))
ROLES = CATALOG["roles"]


def _module():
    spec = importlib.util.spec_from_file_location("role_names_t358", ROOT / "shared" / "skills" / "role_names.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rn = _module()


def italian_names_for(lang: str) -> re.Pattern | None:
    """The Italian names that are NOT also the name in `lang` (Mentor is Mentor everywhere)."""
    words = sorted({names["it"] for names in ROLES.values() if names["it"] != names[lang]}, key=len, reverse=True)
    return re.compile(r"(?<![\w`/@{:-])(%s)(?![\w`/}-])" % "|".join(map(re.escape, words))) if words else None


# What may stay: a word that only looks like a role (Portuguese «Assistente de configuração» is the setup assistant), and
# the id between brackets after the name in the language («a felderítők (Scout)»).
ALLOWED = (
    re.compile(r"Assistente de configuração"),
    re.compile(r"\((Scout|Scorer)\)"),
)


def leaks(text: str, lang: str) -> list[str]:
    pattern = italian_names_for(lang)
    if pattern is None or not isinstance(text, str):
        return []
    for allowed in ALLOWED:
        text = allowed.sub("", text)
    return pattern.findall(text)


def test_the_catalog_has_every_role_in_the_seven_languages_and_the_app_names():
    assert CATALOG["languages"] == ["en", "it", "de", "es", "fr", "pt", "hu"]
    for role in ("capitano", "assistente", "mentor", "scout", "analista", "scorer", "scrittore", "critico", "sentinella",
                 "dottore", "mantenitore", "closer"):
        assert set(ROLES[role]) == set(LANGS) and all(ROLES[role].values()), role
    # the same names the app's chat already shows
    app = (ROOT / "desktop" / "src" / "pages" / "messages" / "direct-chat.i18n.ts").read_text(encoding="utf-8")
    hu = re.search(r'agents: \{ capitano: "Kapitány"[^}]*\}', app).group(0)
    for role, name in re.findall(r'(\w+): "([^"]+)"', hu):
        assert ROLES[role]["hu"] == name, role


def test_the_readers_fill_a_role_and_keep_the_ids():
    assert rn.fill("ask the {role:capitano}", "hu") == "ask the Kapitány"
    assert rn.title("SCOUT-2", "hu") == "Felderítő 2" and rn.title("JHT-CRITICO-S1", "de") == "Kritiker S1"
    assert rn.name("nobody", "fr") == "Nobody"
    assert rn.line("es").startswith("[ROLE-NAMES] es: capitano=Capitán, ")
    js = subprocess.run(["node", "--input-type=module", "-e",
                         "import { roleName, agentTitle, fillRoles } from './shared/i18n/role-names.js';"
                         "console.log([roleName('scrittore','pt'), agentTitle('JHT-SCOUT-3','hu'), fillRoles('{role:mentor}/{role:closer}','de')].join('|'))"],
                        cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert js.stdout.strip() == "Redator|Felderítő 3|Mentor/Abschluss", js.stderr


@pytest.mark.parametrize("lang", LANGS)
def test_the_shared_catalogs_say_no_italian_role_to_another_language(lang):
    catalog = json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))
    found = {key: leaks(rn.fill(value, lang), lang) for key, value in catalog.items() if isinstance(value, str)}
    assert {key: words for key, words in found.items() if words} == {}
    if lang not in ("en", "it"):
        # articles and cases follow the name there: the name is written out, never a placeholder
        assert not [key for key, value in catalog.items() if isinstance(value, str) and "{role:" in value]


@pytest.mark.parametrize("lang", LANGS)
def test_the_cli_texts_say_no_italian_role_to_another_language(lang):
    script = ("const lang = process.argv[1]; const { default: texts } = await import(`./cli/src/lib/texts/${lang}.js`);"
              "const { say } = await import('./cli/src/lib/texts.js');"
              "console.log(JSON.stringify(Object.fromEntries(Object.keys(texts).map((k) => [k, say(k, {}, lang)]))));")
    done = subprocess.run(["node", "--input-type=module", "-e", script, lang], cwd=ROOT, capture_output=True, text=True, timeout=60)
    shown = json.loads(done.stdout)
    assert {key: leaks(text, lang) for key, text in shown.items() if leaks(text, lang)} == {}
    assert not [key for key, text in shown.items() if "{role:" in text], "a placeholder reached the screen"


@pytest.mark.parametrize("lang", ("hu", "de", "fr"))
def test_jht_team_list_names_the_roles_in_the_language(lang):
    with tempfile.TemporaryDirectory() as home:
        env = {**os.environ, "JHT_HOME": home, "JHT_LANG": lang, "NO_COLOR": "1"}
        out = subprocess.run(["node", str(ROOT / "cli" / "bin" / "jht.js"), "team", "list"], capture_output=True, text=True,
                             timeout=60, env=env).stdout
    for role in ("capitano", "scrittore", "critico", "assistente"):
        assert ROLES[role][lang] in out, role
    names = [line.split()[1] for line in out.splitlines() if line.strip().startswith(("·", "✓", "i "))]
    assert not [word for word in names if word in ("capitano", "scrittore", "critico", "assistente", "analista", "sentinella")]
    assert not leaks(out.replace("JHT-", "").upper().lower(), lang)


def test_the_shell_reader_fills_the_roles():
    env = {**os.environ, "JHT_HOME": "/nonexistent", "JHT_LANG": "hu"}
    out = subprocess.run(["bash", "-c", 'source shared/i18n.sh; t wizard.team.starting'], cwd=ROOT, capture_output=True, text=True,
                         timeout=60, env=env).stdout
    assert "Őrszem" in out and "Kapitány" in out and "{role:" not in out
    env["JHT_LANG"] = "en"
    out = subprocess.run(["bash", "-c", 'source shared/i18n.sh; t wizard.team.starting'], cwd=ROOT, capture_output=True, text=True,
                         timeout=60, env=env).stdout
    assert "Sentinel" in out and "Captain" in out
