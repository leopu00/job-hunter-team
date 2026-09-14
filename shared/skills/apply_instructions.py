#!/usr/bin/env python3
"""An application channel written in words: "send your CV to careers@example.com".

Why. Position 1798 (14/09) stopped as ats_unsupported on a careers page with no
form and no mailto link: every role says, in plain text inside a collapsed
block, "How to Apply: Send your CV and a short cover letter to
careers@…". The email channel only knew apply-labelled mailto links.

email_instruction reads the page text and returns the one address the page
tells applicants to write to, or None. Fail closed:

  - only a sentence that sends a CV / an application to an address counts
    ("contact info@… about your data" does not);
  - exactly one distinct address across those sentences: two different ones
    (one per role, one per country) is no conclusion, never a guess;
  - the address must look like a mailbox (local part, @, domain with a dot), bounded.

page_text returns the body's textContent without scripts, styles or templates:
collapsed "Show more" blocks are hidden to innerText but are the vacancy text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_ADDRESS = re.compile(r"(?<![\w.+-])([a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*\.[a-z]{2,24})(?![\w-])", re.I)

# What is sent: a CV, a résumé, an application, a cover letter (seven languages).
_SENT = (
    r"cv\b|c\.v\.|r[ée]sum[ée]|resume\b|curriculum|application|applications|cover letter|motivation letter"
    r"|candidatura|candidature|candidatures|candidatos|candidaturas|lettera di presentazione"
    r"|bewerbung\w*|lebenslauf|anschreiben"
    r"|lettre de motivation|solicitud\w*|carta de presentaci[oó]n|hoja de vida"
    r"|curr[ií]culo|carta de apresenta[cç][aã]o"
    r"|önéletrajz\w*|jelentkez\w*|motivációs level\w*"
)
# How it is sent: a verb of sending / applying.
_SEND = (
    r"send|e-?mail|mail|submit|forward|apply|direct"
    r"|invia\w*|manda\w*|scrivi\w*|candidati"
    r"|send(?:e|en)|schick\w*|richte\w*|bewirb|bewerben"
    r"|envoy\w*|adress\w*|postul\w*"
    r"|env[ií]a\w*|mand[ae]\w*|remit\w*"
    r"|envie\w*|mande\w*"
    r"|küld\w*"
)
_SENT_RE = re.compile(_SENT, re.I)
_SEND_RE = re.compile(r"\b(?:" + _SEND + r")", re.I)
# A sentence about personal data or support is not an application channel.
_NOT_APPLICATION = re.compile(
    r"personal (?:data|information)|data protection|privacy|gdpr|dsgvo|datenschutz|protezione dei dati"
    r"|donn[ée]es personnelles|datos personales|dados pessoais|adatvédel\w*|unsubscribe|press|media inquiries",
    re.I,
)
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-ZÀ-Ý])|\n+")

_PAGE_TEXT_JS = """() => {
  const body = document.body;
  if (!body) return "";
  const copy = body.cloneNode(true);
  copy.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove());
  copy.querySelectorAll('br, p, li, div, h1, h2, h3, h4, h5, h6, section, article').forEach((node) => node.append('\\n'));
  return copy.textContent || "";
}"""

MAX_TEXT = 400_000


@dataclass(frozen=True)
class EmailInstruction:
    address: str
    evidence: str  # the sentence, bounded, for the log — never for the user


def page_text(page: Any) -> str:
    try:
        text = page.evaluate(_PAGE_TEXT_JS)
    except Exception:
        return ""
    return text[:MAX_TEXT] if isinstance(text, str) else ""


def _sentences(text: str) -> list[str]:
    clean = re.sub(r"[ \t\r\f\v ]+", " ", str(text or ""))
    return [part.strip() for part in _SENTENCE_END.split(clean) if part.strip()]


def email_instruction(text: str) -> EmailInstruction | None:
    """The one address the page tells applicants to send their application to."""
    found: dict[str, str] = {}
    sentences = _sentences(text)
    for index, sentence in enumerate(sentences):
        addresses = _ADDRESS.findall(sentence)
        if not addresses:
            continue
        # "How to Apply" often stands alone right before the sentence.
        context = f"{sentences[index - 1]} {sentence}" if index else sentence
        if _NOT_APPLICATION.search(sentence):
            continue
        if not (_SENT_RE.search(sentence) and _SEND_RE.search(context)):
            continue
        for address in addresses:
            found.setdefault(address.casefold(), " ".join(sentence.split())[:200])
    if len(found) != 1:
        return None
    address, evidence = next(iter(found.items()))
    return EmailInstruction(address, evidence)


def mailto_href(instruction: EmailInstruction) -> str:
    return f"mailto:{instruction.address}"
