"""Two application channels a careers page gives without an ATS form (14/09 live queue).

1800 — the vacancy's Apply led to /contact: Name, Email, a custom Subject
listbox with "Job Application", a Message, no file. Decision (master-2): that
form is the application, Subject = the application option, Message = a short
letter by the CLOSER, no CV; only when an Apply control led there.

1798 — no form: "How to Apply: Send your CV and a short cover letter to
careers@…" in plain text inside collapsed role blocks: the email channel.

Synthetic pages with those structures, served by Playwright routes.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "tests"))

import apply_generic  # noqa: E402
from apply_flow import ApplicationFlow  # noqa: E402
from apply_generic import contact_application_topic  # noqa: E402
from test_apply_generic import BASE  # noqa: E402

CHECKPOINT = Path(".cache") / "apply-flow" / "91.json"
LETTER = "Synthetic letter written for a fictional test only. My CV is available on request."
PROFILE = {"name": "Jane Example", "contacts": {"email": "jane@example.invalid"}}


@dataclass(frozen=True)
class GateVerdict:
    allowed: bool = True
    reason: str = "apply_allowed"
    context: dict = field(default_factory=lambda: {"mode": "authorised"})

    def log_line(self) -> str:
        return "[apply-gate] ALLOW"


# ── the structures seen live ─────────────────────────────────────────────────

CAREERS = """<!doctype html><html><head><title>Careers</title></head><body><main>
<h1>Join us early</h1><h2>Open positions</h2>
{roles}
<h2>Don't see your role?</h2><a href="/contact">Get in touch</a></main></body></html>"""
ROLE = '<article><h3>{title}</h3><p>Remote (US/EU) · Full-time</p><a href="/contact">Apply</a></article>'

CONTACT = """<!doctype html><html><head><title>Contact</title></head><body><main id="main">
<h1>Get in touch</h1><p>Have a question, feature request, or want to explore enterprise options?</p>
<a href="mailto:hello@example.com">hello@example.com</a>
<form id="contact">
  <label for="name">Name</label><input id="name" required placeholder="Your name">
  <label for="email">Email</label><input id="email" type="email" required placeholder="you@example.com">
  <label for="subject">Subject</label>
  <div class="relative"><button id="subject" type="button" aria-haspopup="listbox" aria-expanded="false"
     aria-controls="subject-listbox"><span>General Inquiry</span></button></div>
  <label for="message">Message</label><textarea id="message" required placeholder="How can we help?"></textarea>
  <button type="submit">Send message</button>
</form>
<script>
  const options = __OPTIONS__;
  window.submitCount = 0; window.sent = null;
  const button = document.getElementById('subject');
  button.addEventListener('click', () => {
    const open = document.getElementById('subject-listbox');
    if (open) { open.remove(); button.setAttribute('aria-expanded', 'false'); return; }
    const list = document.createElement('div');
    list.id = 'subject-listbox'; list.setAttribute('role', 'listbox');
    options.forEach((text, i) => {
      const option = document.createElement('button');
      option.type = 'button'; option.setAttribute('role', 'option'); option.id = 'subject-listbox-option-' + i;
      option.textContent = text;
      option.addEventListener('click', () => { button.querySelector('span').textContent = text; list.remove();
        button.setAttribute('aria-expanded', 'false'); });
      list.appendChild(option);
    });
    button.parentElement.appendChild(list); button.setAttribute('aria-expanded', 'true');
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const l = document.getElementById('subject-listbox');
    if (l) { l.remove(); button.setAttribute('aria-expanded', 'false'); } } });
  document.getElementById('contact').addEventListener('submit', e => {
    e.preventDefault(); window.submitCount += 1;
    window.sent = {name: document.getElementById('name').value, email: document.getElementById('email').value,
      subject: button.innerText.trim(), message: document.getElementById('message').value};
    localStorage.setItem('sent', JSON.stringify(window.sent));
    document.getElementById('main').innerHTML = '<h1>Message sent</h1><p>Thank you for reaching out. We\\'ll get back to you as soon as possible.</p>';
  });
</script></main></body></html>"""
WITH_APPLICATION = '["General Inquiry", "Feature Request", "Enterprise", "Job Application", "Partnership"]'
WITHOUT_APPLICATION = '["General Inquiry", "Feature Request", "Enterprise", "Partnership"]'

ROLE_BLOCK = """<div class="role"><h3>{title}</h3><p>Location: Remote within UK / AT / IT / GR</p>
<div class="collapsible-content" style="display:none"><p>The Role. Python and data.</p><p>How to Apply</p>
<p>{how}</p></div><button class="collapsible-content-more">Show More</button></div>"""
INSTRUCTIONS = """<!doctype html><html><head><title>Careers</title></head><body><h1>Careers</h1><h2>We are hiring!</h2>
{roles}
<p>By responding to the advertisement, you agree that your personal information may be processed. Contact info@example.com.</p>
<h2>Join us</h2><form class="w-form"><input type="email" placeholder="Email address">
<textarea placeholder="Provide a brief motivation"></textarea><button type="submit">Send</button></form>
<script>window.submitCount = 0; document.querySelector('form').addEventListener('submit', e => { e.preventDefault(); window.submitCount += 1; });</script>
</body></html>"""
CV_FORM = """<!doctype html><html><body><h1>Engineer</h1><p>Or send your CV to jobs@example.com.</p>
<form><h2>Apply for this job</h2><label for="n">Full name</label><input id="n" required>
<label for="e">Email</label><input id="e" type="email" required><label for="cv">CV</label><input id="cv" type="file" required>
<button type="submit">Submit application</button></form></body></html>"""


def instructions(*hows: str) -> str:
    return INSTRUCTIONS.replace("{roles}", "".join(ROLE_BLOCK.format(title=f"Role {i}", how=h) for i, h in enumerate(hows)))


# ── fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def browser():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        launched = runtime.chromium.launch(headless=True)
        yield launched
        launched.close()


@pytest.fixture
def cv_path(tmp_path: Path) -> Path:
    path = tmp_path / "synthetic-profile.pdf"
    path.write_bytes(b"%PDF-1.4\n% synthetic test fixture only\n")
    return path


@pytest.fixture(autouse=True)
def home(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(apply_generic, "guard_public_url", lambda url: url)  # synthetic hosts never resolve
    return tmp_path


def site(browser, pages: dict[str, str]):
    page = browser.new_page()

    def serve(route):
        path = route.request.url.split(BASE, 1)[-1].split("#")[0] or "/"
        body = pages.get(path)
        if body is None:
            route.fulfill(status=404, body="not found")
        else:
            route.fulfill(status=200, content_type="text/html; charset=utf-8", body=body)

    page.route("**/*", serve)
    return page


def build_flow(tmp_path: Path, cv_path: Path, url: str, *, answers: dict | None = None, recorded=None) -> ApplicationFlow:
    profile = dict(PROFILE, application_answers=answers or {})
    return ApplicationFlow(
        essentials_checker=lambda **_kwargs: [],
        cap_reserver=lambda **_kwargs: GateVerdict(True, "cap_reserved"),
        cv_checker=lambda _path: {"ok": True, "reasons": []},
        position_id=91,
        url=url,
        profile=profile,
        cv_path=cv_path,
        checkpoint_path=tmp_path / CHECKPOINT,
        receipt_dir=tmp_path / "receipts",
        gate_checker=lambda **_kwargs: GateVerdict(),
        notifier=lambda **_kwargs: "1",
        applied_recorder=lambda **kwargs: (recorded if recorded is not None else []).append(kwargs),
        confirmation_timeout_ms=2000,
    )


def saved(tmp_path: Path) -> dict:
    return json.loads((tmp_path / CHECKPOINT).read_text(encoding="utf-8"))


# ── 1800: the contact form as the application ───────────────────────────────


def orbit(browser, options: str = WITH_APPLICATION):
    careers = CAREERS.format(roles="".join(ROLE.format(title=t) for t in ("Founding Engineer", "AI Engineer", "Product Designer")))
    page = site(browser, {"/careers": careers, "/contact": CONTACT.replace("__OPTIONS__", options)})
    page.goto(f"{BASE}/careers")
    return page


def test_the_message_of_a_contact_application_is_a_question_for_the_closer(browser, cv_path, tmp_path):
    page = orbit(browser)

    result = build_flow(tmp_path, cv_path, f"{BASE}/careers").run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "required_answer_missing"), result
    question = result.pending_question
    assert (question["label"], question["field_type"], question["scope"]) == ("Message", "textarea", "company")
    assert question["purpose"] == "contact_form_application"
    assert page.evaluate("window.submitCount") == 0
    assert saved(tmp_path)["platform"] == "generic"


def test_with_the_letter_the_contact_form_is_sent_once_with_the_application_subject(browser, cv_path, tmp_path):
    page = orbit(browser)
    recorded: list = []

    result = build_flow(tmp_path, cv_path, f"{BASE}/careers", answers={"Message": LETTER}, recorded=recorded).run(
        page=page, navigate=False
    )

    assert result.status == "applied", result
    assert page.evaluate("window.submitCount") == 1
    assert json.loads(page.evaluate("localStorage.getItem('sent')")) == {
        "name": "Jane Example",
        "email": "jane@example.invalid",
        "subject": "Job Application",
        "message": LETTER,
    }
    receipt = recorded[0]["receipt"]
    assert "Message sent" in receipt.confirmation_text
    assert Path(saved(tmp_path)["pre_submit_screenshot"]).is_file()
    # The receipt tells the truth (1800, patch 22): no file field, no CV sent.
    assert (receipt.channel, receipt.attachments, receipt.cv_sha256) == ("contact_form", [], "")
    checkpoint = saved(tmp_path)
    assert checkpoint["channel"] == "contact_form"
    assert "upload_cv" not in checkpoint["completed_steps"]
    assert (checkpoint["cv_sha256"], checkpoint["receipt"]["attachments"]) == ("", [])
    assert checkpoint["receipt"]["channel"] == "contact_form"


def test_the_contact_channel_survives_the_rerun_after_the_letter_is_saved(browser, cv_path, tmp_path):
    page = orbit(browser)
    first = build_flow(tmp_path, cv_path, f"{BASE}/careers").run(page=page, navigate=False)
    assert first.reason == "required_answer_missing"
    assert saved(tmp_path)["channel"] == "contact_form"

    page.goto(f"{BASE}/careers")
    recorded: list = []
    again = build_flow(tmp_path, cv_path, f"{BASE}/careers", answers={"Message": LETTER}, recorded=recorded).run(
        page=page, navigate=False
    )

    assert again.status == "applied", again
    assert recorded[0]["receipt"].attachments == []


def test_an_application_form_receipt_names_the_cv_it_sent(browser, cv_path, tmp_path, monkeypatch):
    import hashlib

    from test_apply_generic import CLASSIC, PROFILE as GENERIC_PROFILE

    monkeypatch.setitem(globals(), "PROFILE", GENERIC_PROFILE)
    page = site(browser, {"/jobs/7": CLASSIC})
    page.goto(f"{BASE}/jobs/7")
    recorded: list = []

    result = build_flow(
        tmp_path, cv_path, f"{BASE}/jobs/7", answers=GENERIC_PROFILE["application_answers"], recorded=recorded
    ).run(page=page, navigate=False)

    assert result.status == "applied", result
    expected = hashlib.sha256(cv_path.read_bytes()).hexdigest()
    checkpoint = saved(tmp_path)
    assert (checkpoint["channel"], checkpoint["cv_sha256"]) == ("", expected)
    assert "upload_cv" in checkpoint["completed_steps"]
    receipt = recorded[0]["receipt"]
    assert (receipt.channel, receipt.attachments) == ("web_form", [{"role": "cv", "sha256": expected}])


def test_an_old_receipt_without_the_fields_reads_its_cv_as_the_attachment(tmp_path):
    from apply_flow import Receipt

    sha = "b" * 64
    old = Receipt.from_dict({"screenshot_path": "x.png", "confirmation_text": "ok", "cv_sha256": sha})
    assert (old.channel, old.attachments) == ("web_form", [{"role": "cv", "sha256": sha}])
    forged = Receipt.from_dict({"screenshot_path": "x.png", "channel": "fax", "attachments": [{"role": "cv", "sha256": "zz"}]})
    assert (forged.channel, forged.attachments) == ("web_form", [])
    contact = Receipt(Path("x.png"), confirmation_text="ok", channel="contact_form")
    assert Receipt.from_dict(contact.to_dict()).to_dict() == contact.to_dict()


def test_a_contact_form_without_an_application_topic_is_never_the_application(browser, cv_path, tmp_path):
    page = orbit(browser, WITHOUT_APPLICATION)

    result = build_flow(tmp_path, cv_path, f"{BASE}/careers", answers={"Message": LETTER}).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "generic_form_missing")
    assert page.evaluate("window.submitCount") == 0


def test_a_contact_form_the_vacancy_did_not_lead_to_is_never_the_application(browser, cv_path, tmp_path):
    # The same form, opened directly, with its list already in the page so its
    # options are readable without a click: only the missing Apply step refuses it.
    prerendered = CONTACT.replace("__OPTIONS__", WITH_APPLICATION).replace(
        "</form>",
        '<div id="subject-listbox" role="listbox" hidden>'
        + "".join(f'<div role="option">{o}</div>' for o in json.loads(WITH_APPLICATION))
        + "</div></form>",
    )
    page = site(browser, {"/contact": prerendered})
    page.goto(f"{BASE}/contact")

    result = build_flow(tmp_path, cv_path, f"{BASE}/contact", answers={"Message": LETTER}).run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "generic_form_missing"
    assert page.evaluate("window.submitCount") == 0


def test_a_listbox_that_does_not_keep_the_choice_is_not_sent(browser, cv_path, tmp_path):
    broken = CONTACT.replace("__OPTIONS__", WITH_APPLICATION).replace(
        "button.querySelector('span').textContent = text; list.remove();", "list.remove();"
    )
    careers = CAREERS.format(roles=ROLE.format(title="AI Engineer"))
    page = site(browser, {"/careers": careers, "/contact": broken})
    page.goto(f"{BASE}/careers")

    result = build_flow(tmp_path, cv_path, f"{BASE}/careers", answers={"Message": LETTER}).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "answer_not_accepted")
    assert page.evaluate("window.submitCount") == 0


def test_the_contact_page_mailto_never_becomes_a_second_channel(browser, cv_path, tmp_path):
    page = orbit(browser)

    build_flow(tmp_path, cv_path, f"{BASE}/careers", answers={"Message": LETTER}).run(page=page, navigate=False)

    checkpoint = saved(tmp_path)
    assert (checkpoint["channel"], checkpoint["mailto_href"]) == ("contact_form", "")


@pytest.mark.parametrize(
    ("options", "found"),
    [
        (["General Inquiry", "Job Application", "Partnership"], "Job Application"),
        (["Allgemeine Anfrage", "Bewerbung"], "Bewerbung"),
        (["Informazioni", "Lavora con noi"], "Lavora con noi"),
        (["General", "Careers"], "Careers"),
        (["General Inquiry", "Partnership"], None),
        (["Job Application", "Careers"], None),  # two application options: no guess
        (["Application support for our product"], None),  # a whole-option match only
    ],
)
def test_contact_application_topic(options, found):
    form = {
        "questions": [
            {"id": "0-0", "type": "text", "label": "Name"},
            {"id": "0-1", "type": "email", "label": "Email"},
            {"id": "0-2", "type": "listbox", "label": "Subject", "options": options},
            {"id": "0-3", "type": "textarea", "label": "Message"},
        ]
    }
    topic = contact_application_topic(form)
    assert (topic[1] if topic else None) == found


@pytest.mark.parametrize(
    "change",
    [
        lambda f: f["questions"].append({"id": "0-4", "type": "password", "label": "Password"}),
        lambda f: f["questions"].append({"id": "0-4", "type": "file", "label": "Attachment"}),
        lambda f: f["questions"].pop(3),  # no message
        lambda f: f["questions"].pop(1),  # no email
        lambda f: f["questions"][2].update(label="Favourite colour"),  # not a topic question
    ],
    ids=["password", "file", "no-message", "no-email", "not-a-topic"],
)
def test_only_a_plain_contact_form_can_carry_an_application_topic(change):
    form = {
        "questions": [
            {"id": "0-0", "type": "text", "label": "Name"},
            {"id": "0-1", "type": "email", "label": "Email"},
            {"id": "0-2", "type": "select", "label": "Subject", "options": ["General", "Job Application"]},
            {"id": "0-3", "type": "textarea", "label": "Message"},
        ]
    }
    change(form)
    assert contact_application_topic(form) is None


# ── 1798: the email written in the vacancy text ─────────────────────────────


def test_an_application_address_in_the_role_text_is_the_email_channel(browser, cv_path, tmp_path):
    how = "Send your CV and a short cover letter to careers@example.com"
    page = site(browser, {"/careers/": instructions(how, how, how)})
    page.goto(f"{BASE}/careers/")

    result = build_flow(tmp_path, cv_path, f"{BASE}/careers/").run(page=page, navigate=False)

    assert (result.status, result.reason) == ("email_channel", "email_instruction"), result
    checkpoint = saved(tmp_path)
    assert (checkpoint["channel"], checkpoint["mailto_href"]) == ("email", "mailto:careers@example.com")
    assert page.evaluate("window.submitCount") == 0


def test_two_application_addresses_are_no_email_channel(browser, cv_path, tmp_path):
    page = site(browser, {"/careers/": instructions("Send your CV to uk@example.com", "Send your CV to it@example.com")})
    page.goto(f"{BASE}/careers/")

    result = build_flow(tmp_path, cv_path, f"{BASE}/careers/").run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "generic_form_missing")


def test_an_application_form_on_the_page_wins_over_an_address_in_the_text(browser, cv_path, tmp_path):
    page = site(browser, {"/jobs/7": CV_FORM})
    page.goto(f"{BASE}/jobs/7")

    result = build_flow(tmp_path, cv_path, f"{BASE}/jobs/7").run(page=page, navigate=False)

    assert result.reason != "email_instruction"
    assert saved(tmp_path)["platform"] == "generic"
