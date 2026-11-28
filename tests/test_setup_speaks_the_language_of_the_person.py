"""The setup and the first steps of the onboarding speak the language of the person, in all 7.

They used to be English only, whatever the person chose: the host setup, the welcome, the steps of the wizard
(checks, provider, sign-in, options of `jht setup`) and its last line. The three readers of the catalogs
(shared/i18n.py, shared/i18n.sh, cli/wizard/i18n.js) sent those keys to English. Now every key follows the
language like the rest, and every language has its own text for them.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LOCALES = ROOT / "shared" / "locales"
LANGUAGES = ("it", "de", "es", "fr", "hu", "pt")
ONBOARDING = re.compile(
    r"^(host_setup\.|welcome\.|wizard\.(checks|cloud|step|provider|oauth|cli|access|language|key|release|summary|telegram|substep)\.|"
    r"wizard\.(welcome_subtitle|aborted_prereqs|profile\.intro|outro_done|outro_done_running|outro_aborted|cancelled|"
    r"start\.ready|start\.done|team\.starting|team\.start_failed)$)"
)
# the same in every language on purpose: the names of the languages and the picker, written in all of them;
# «Node 22, npm OK» is the same words almost everywhere; «Host» is the word used in Italian too, and so are «Provider» and
# «Config» in the summaries of the setup
SAME_AS_ENGLISH = {
    "host_setup.choose_language", "host_setup.choice_prompt", "wizard.checks.prerequisites.ready",
    "host_setup.host_line", "host_setup.host_line_no_swap", "wizard.summary.provider", "wizard.summary.config",
}
PLACEHOLDER = re.compile(r"%[sd]")


def _catalog(lang: str) -> dict[str, str]:
    return _role_filled(json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8")), lang)

def _role_filled(catalog: dict, lang: str) -> dict:
    """The catalog as the readers show it: {role:<id>} with the role's name in `lang` (shared/i18n/role-names.json)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("role_names_t", Path(__file__).resolve().parents[1] / "shared" / "skills" / "role_names.py")
    names = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(names)
    return {key: names.fill(value, lang) for key, value in catalog.items()}



ENGLISH = {k: v for k, v in _catalog("en").items() if ONBOARDING.match(k)}


def _keys_to_say() -> list[str]:
    return [k for k in ENGLISH if k not in SAME_AS_ENGLISH and not k.startswith("host_setup.lang.")]


def test_the_onboarding_keys_are_still_there():
    # a renamed prefix would leave this test with nothing to check
    assert len(ENGLISH) > 150


@pytest.mark.parametrize("lang", LANGUAGES)
def test_every_onboarding_key_has_its_text_in_each_language(lang):
    catalog = _catalog(lang)
    assert [k for k in ENGLISH if k not in catalog] == []
    for key, english in ENGLISH.items():
        assert PLACEHOLDER.findall(catalog[key]) == PLACEHOLDER.findall(english), f"{lang}: {key}"
    assert [k for k in _keys_to_say() if catalog[k] == ENGLISH[k]] == [], f"{lang}: left in English"


def _environment(tmp_path: Path, lang: str) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("JHT_")}
    env.update(JHT_HOME=str(tmp_path), HOME=str(tmp_path / "nohome"),
               JHT_HOST_ENV_FILE=str(tmp_path / "no-host.env"), JHT_LANG=lang)
    return env


@pytest.mark.parametrize("lang", ("it", "de"))
def test_the_python_reader_does_not_answer_in_english(lang, tmp_path):
    keys = _keys_to_say()
    script = (
        "import json, sys; sys.path.insert(0, sys.argv[1]); import i18n; "
        "print(json.dumps({k: i18n.t(k) for k in json.loads(sys.argv[2])}))"
    )
    out = subprocess.run(
        ["python3", "-c", script, str(ROOT / "shared"), json.dumps(keys)],
        env=_environment(tmp_path, lang), capture_output=True, text=True, timeout=60, check=True,
    ).stdout
    catalog = _catalog(lang)
    assert json.loads(out) == {k: catalog[k] for k in keys}


@pytest.mark.parametrize("lang", ("it", "de"))
def test_the_shell_reader_does_not_answer_in_english(lang, tmp_path):
    if not shutil.which("jq"):
        pytest.skip("shared/i18n.sh needs jq")
    keys = [k for k in _keys_to_say() if k.startswith(("host_setup.", "welcome.", "wizard.cli.", "wizard.step."))]
    script = 'source "$1"; shift; for k in "$@"; do t "$k"; printf "\\0"; done'
    out = subprocess.run(
        ["bash", "-c", script, "bash", str(ROOT / "shared" / "i18n.sh"), *keys],
        env=_environment(tmp_path, lang), capture_output=True, text=True, timeout=120, check=True,
    ).stdout
    catalog = _catalog(lang)
    assert dict(zip(keys, out.split("\0"))) == {k: catalog[k] for k in keys}


@pytest.mark.parametrize("lang", ("it", "de"))
def test_the_wizard_reader_does_not_answer_in_english(lang, tmp_path):
    if not shutil.which("node"):
        pytest.skip("no node")
    keys = _keys_to_say()
    script = (
        "const { t } = await import(process.argv[1]); const keys = JSON.parse(process.argv[2]);"
        "console.log(JSON.stringify(Object.fromEntries(keys.map((k) => [k, t(k)]))));"
    )
    out = subprocess.run(
        ["node", "--input-type=module", "-e", script, (ROOT / "cli" / "wizard" / "i18n.js").as_uri(), json.dumps(keys)],
        env=_environment(tmp_path, lang), capture_output=True, text=True, timeout=60, check=True,
    ).stdout
    catalog = _catalog(lang)
    assert json.loads(out) == {k: catalog[k] for k in keys}


def test_no_reader_keeps_a_list_of_keys_in_english():
    for path in ("shared/i18n.py", "shared/i18n.sh", "cli/wizard/i18n.js"):
        source = (ROOT / path).read_text(encoding="utf-8")
        assert not re.search(r"wizard\\?\.cli|wizard\\?\.oauth|phase1|English-only", source), path
