"""The email-forwarding guide names the app's Mail page the way the app does.

The desktop app has a Mail page (top menu) with a form that saves the mailbox address, says whether
the mailbox is dedicated to forwarded job alerts and saves an app password. The guide, in the seven
languages of the site and in English in docs/, tells the reader where to go and what to fill in.
Each label it quotes is read here from the app's own texts, and the labels of the old flow
(Settings → Team email, the «How to set up forwarding» button, the credentials/ folder) must be gone.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

LANGS = ["en", "it", "es", "fr", "de", "hu", "pt"]
PAGE = (ROOT / "web/app/docs/guides/email-forwarding/page.i18n.tsx").read_text(encoding="utf-8")
MD = (ROOT / "docs/guides/EMAIL-FORWARDING.md").read_text(encoding="utf-8")
MAIL = (ROOT / "desktop/src/pages/mail/mail.i18n.ts").read_text(encoding="utf-8")
LINKS = (ROOT / "desktop/src/shell/desktop-links.ts").read_text(encoding="utf-8")
READONLY = (ROOT / "desktop/src/lib/existing-team-readonly.i18n.ts").read_text(encoding="utf-8")
ROUTES = (ROOT / "desktop/src/shell/routes.tsx").read_text(encoding="utf-8")

# What the guide said before it followed the app: none of it exists in the app.
OLD_LABELS = {
    "en": ["Team email", "How to set up forwarding"],
    "it": ["Email del team", "Come configurare l'inoltro"],
    "es": ["Correo del equipo", "Cómo configurar el reenvío"],
    "fr": ["E-mail de l'équipe", "Comment configurer le transfert"],
    "de": ["Team-E-Mail", "So richtest du die Weiterleitung ein"],
    "hu": ["Csapat e-mail", "Hogyan állítsd be a továbbítást"],
    "pt": ["E-mail da equipe", "Como configurar o encaminhamento"],
}

# The labels of the Mail page the guide quotes, by the key the app gives them.
QUOTED = ["title", "formTitle", "mailboxAddress", "dedicatedLegend", "dedicatedYes", "appPassword", "save", "saved", "configured"]


def plain(markup: str) -> str:
    """The text a reader sees: no tags, no entities, one space between words, one kind of apostrophe."""
    text = re.sub(r"<[^>]+>", "", markup)
    text = text.replace('{" "}', " ").replace("&apos;", "'").replace("&quot;", '"').replace("’", "'")
    return re.sub(r"\s+", " ", text)


def app_texts() -> dict[str, dict[str, str]]:
    found = {}
    for block in re.finditer(r"^const (\w+)(?::\s*MailCopy)? = \{\n(.*?)\n\};", MAIL, re.S | re.M):
        found[block.group(1)] = dict(re.findall(r'^\s+(\w+): "(.*)",$', block.group(2), re.M))
    return found


def page_blocks() -> dict[str, str]:
    parts = re.split(r"(?m)^  (en|it|es|fr|de|hu|pt): \{\n", PAGE)
    return {parts[i]: plain(parts[i + 1]) for i in range(1, len(parts), 2)}


APP = app_texts()
BLOCKS = page_blocks()


def test_the_page_has_the_seven_languages_and_so_does_the_app():
    assert sorted(BLOCKS) == sorted(LANGS)
    assert sorted(APP) == sorted(LANGS)


def test_every_label_the_guide_quotes_is_the_apps_own():
    for lang in LANGS:
        for key in QUOTED:
            label = plain(APP[lang][key])
            assert label in BLOCKS[lang], (lang, key, label)


def test_the_menu_entry_is_the_one_the_app_shows_in_its_top_menu():
    # the guide says «open Mail in the top menu»: the entry is the page's title
    for lang in LANGS:
        assert re.search(rf'"/mail": \{{.*?\b{lang}: "{re.escape(APP[lang]["title"])}"', LINKS), lang


def test_the_old_flow_is_gone_from_the_site_guide():
    for lang in LANGS:
        for old in OLD_LABELS[lang]:
            assert plain(old) not in BLOCKS[lang], (lang, old)
        assert "credentials/" not in BLOCKS[lang], lang


def test_the_dedicated_question_is_answered_in_the_guide():
    # a «No» answer makes the team read only the allowed senders: the guide tells the reader which to pick
    for lang in LANGS:
        assert plain(APP[lang]["dedicatedYes"]) in BLOCKS[lang], lang


def test_the_guide_says_the_mail_entry_is_missing_in_read_only_and_names_the_apps_button():
    # the read-only menu (READ_ONLY_NAV) has no /mail: a reader on a team opened read only must be told
    nav = re.search(r"export const READ_ONLY_NAV = \[(.*?)\] as const", ROUTES, re.S).group(1)
    assert '"/mail"' not in nav
    texts = {}
    for block in re.finditer(r"^  (\w+): \{\n(.*?)\n  \},", READONLY, re.S | re.M):
        texts[block.group(1)] = dict(re.findall(r'^\s+(\w+): "(.*)",$', block.group(2), re.M))
    for lang in LANGS:
        assert plain(texts[lang]["connectInFull"]) in BLOCKS[lang], lang


# ── the guide in docs/, in English ───────────────────────────────────────

def test_the_english_guide_quotes_the_apps_labels():
    text = re.sub(r"[*`]", "", re.sub(r"\s+", " ", MD))
    for key in QUOTED:
        assert APP["en"][key] in text, key


def test_the_english_guide_names_the_read_only_button():
    assert "the Mail entry is not in the menu" in re.sub(r"\s+", " ", MD)
    assert "**Connect with write access**" in re.sub(r"\s+", " ", MD)


def test_the_english_guide_has_no_label_of_the_old_flow():
    for old in OLD_LABELS["en"] + ["credentials/"]:
        assert old not in MD, old
