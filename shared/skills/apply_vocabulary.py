#!/usr/bin/env python3
"""Apply controls in the languages the careers pages speak, beyond the seven of the product.

Why. Position 2071 (14/09): the vacancy dialog on a Czech careers page offered
"Poslat přihlášku" (send application), a mailto link with the role in its
subject. The apply vocabulary knew English, Italian, German, French, Spanish,
Portuguese and Hungarian: the link was not an apply control, the email
channel never saw it, and the company-form recipe stopped as
generic_form_missing next to the visible button.

One pattern for the flow's mailto labels and the generic recipe's Apply
controls. It runs in two engines: Python `re`, and JavaScript, because
Playwright's get_by_role(name=re.Pattern) hands the source to the browser.
In JavaScript `\\b` and `\\w` are ASCII-only, so a word that starts or ends
with "ř", "ť" or a Cyrillic letter never has a `\\b` boundary. The words below
are whole forms, bounded by explicit look-arounds over Latin, Greek and
Cyrillic letters, which both engines read the same way.
"""

from __future__ import annotations

import re

# A letter or digit on either side means the phrase is part of a longer word.
_LETTER = r"[0-9A-Za-zÀ-ɏͰ-ϿЀ-ӿ]"

# Whole forms, lowercase; the pattern is compiled case-insensitive.
MORE_APPLY_PHRASES: tuple[str, ...] = (
    # Czech
    "poslat přihlášku", "odeslat přihlášku", "podat přihlášku", "přihlásit se", "chci se přihlásit",
    "reagovat na nabídku", "reagovat na inzerát", "odpovědět na nabídku", "ucházet se",
    # Slovak
    "poslať žiadosť", "odoslať žiadosť", "podať žiadosť", "prihlásiť sa", "reagovať na ponuku", "uchádzať sa",
    # Polish
    "aplikuj", "aplikuj teraz", "wyślij zgłoszenie", "wyślij aplikację", "złóż aplikację", "zgłoś się",
    # Dutch
    "solliciteer", "solliciteer nu", "solliciteren",
    # Swedish, Danish, Norwegian
    "ansök", "ansök nu", "skicka ansökan", "ansøg", "ansøg nu", "søg stillingen", "søk nå", "søk på stillingen",
    "send søknad",
    # Finnish, Estonian, Latvian, Lithuanian
    "hae paikkaa", "hae nyt", "lähetä hakemus", "kandideeri", "pieteikties", "kandidatuoti", "pateikti paraišką",
    # Romanian
    "aplică", "aplică acum", "aplica acum", "candidează", "trimite cv",
    # Croatian, Serbian, Bosnian, Slovenian
    "prijavi se", "pošalji prijavu", "oddaj prijavo",
    # Turkish
    "başvur", "hemen başvur", "başvuru yap",
    # Greek
    "υποβολή αίτησης", "κάνε αίτηση",
    # Russian, Ukrainian, Bulgarian
    "откликнуться", "подать заявку", "відгукнутися", "подати заявку", "кандидатствай",
)


def phrase_pattern(phrases: tuple[str, ...] = MORE_APPLY_PHRASES) -> str:
    """The phrases as one bounded alternation, safe in Python and in JavaScript."""
    body = "|".join(
        r"\s+".join(re.escape(word) for word in phrase.split())
        for phrase in sorted(phrases, key=len, reverse=True)
    )
    return rf"(?<!{_LETTER})(?:{body})(?!{_LETTER})"


MORE_APPLY = phrase_pattern()
