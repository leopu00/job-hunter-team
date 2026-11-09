"""A short sentence in the user's language is not flagged as another language (JHT-T310).

The Italian list lacked the short function words the Portuguese one carries («e», «da», «o»), so «Vivo a Bologna e
preferisco lavorare da remoto o in modalità ibrida.» scored for Portuguese and the profile check said «looks pt». The
real refusals stay: a clearly Portuguese, Spanish, French, English, German or Hungarian text is still named.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import text_language  # noqa: E402

# Sentences a person writes to the Assistant about a made-up profile, and the summaries made from them.
ITALIAN = [
    "Vivo a Bologna e preferisco lavorare da remoto o in modalità ibrida.",
    "Ho cinque anni di esperienza e negli ultimi due ho lavorato come analista dati in una società di logistica.",
    "Uso soprattutto SQL, Python e Power BI e conosco bene anche Excel e i fogli di calcolo.",
    "Parlo italiano madrelingua e inglese a livello B2, sono laureata in statistica a Bologna.",
    "Cerco un contratto da dipendente, non mi interessano le collaborazioni a partita IVA.",
]

OTHER = {
    "pt": "Vivo em Lisboa e prefiro trabalhar a partir de casa, mas também posso ir ao escritório duas vezes por semana.",
    "es": "Vivo en Madrid y prefiero trabajar desde casa, pero también puedo ir a la oficina dos veces por semana.",
    "fr": "Je vis à Lyon et je préfère travailler depuis chez moi, mais je peux aussi aller au bureau deux fois par semaine.",
    "en": "I live in Manchester and I prefer to work from home, but I can also go to the office twice a week.",
    "de": "Ich wohne in Hamburg und arbeite lieber von zu Hause aus, kann aber auch zweimal pro Woche ins Büro kommen.",
    "hu": "Budapesten lakom, és szívesebben dolgozom otthonról, de hetente kétszer be tudok menni az irodába is.",
}


@pytest.mark.parametrize("sentence", ITALIAN)
def test_a_short_italian_sentence_is_italian_or_unclear_never_another_language(sentence):
    assert text_language.guess_language(sentence) in ("it", None)
    assert text_language.wrong_language(sentence, "it") is None


def test_the_sentence_of_the_measure_round_is_italian():
    assert text_language.guess_language(ITALIAN[0]) == "it"


@pytest.mark.parametrize("language", sorted(OTHER))
def test_a_clearly_other_language_is_still_named(language):
    assert text_language.guess_language(OTHER[language]) == language
    assert text_language.wrong_language(OTHER[language], "it") == language


def test_the_check_command_passes_the_sentence_and_still_refuses_the_other_language(tmp_path):
    (tmp_path / "i18n-prefs.json").write_text('{"locale": "it"}', encoding="utf-8")
    env = {**os.environ, "JHT_HOME": str(tmp_path)}
    env.pop("JHT_LANG", None)

    def check(text):
        return subprocess.run([sys.executable, "-I", str(SKILLS / "text_language.py"), "check", text],
                              capture_output=True, text=True, env=env)

    assert check(ITALIAN[0]).returncode == 0
    refused = check(OTHER["pt"])
    assert refused.returncode == 3 and "pt" in refused.stdout + refused.stderr
