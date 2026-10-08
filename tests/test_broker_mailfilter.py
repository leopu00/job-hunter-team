"""What the broker's `mail.poll` may hand to an agent (P1 portal secrets, phase 1).

Fixtures only: every address, id and token below is made up. The alerts keep
the real shape of an Indeed and a Greenhouse alert, anonymised, so the test
also proves the reduction leaves a job alert useful.

Run with: pytest tests/test_broker_mailfilter.py -v
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared"))

from broker import mailfilter  # noqa: E402
from broker.mailfilter import Admission, reduce_text, reduce_url, verdict  # noqa: E402

WHOLE = Admission(policy="whole_mailbox")
STRICT = Admission(
    policy="allowlist",
    addresses=frozenset({"alert@indeed.invalid"}),
    domains=frozenset({"greenhouse-mail.invalid"}),
    thread_ids=frozenset({"<sent-1@jht.invalid>"}),
)

INDEED_ALERT = {
    "sender": "Indeed <alert@indeed.invalid>",
    "subject": "3 new Backend Engineer jobs in Milano",
    "body": (
        "Backend Engineer - Example Srl - Milano\n"
        "https://it.indeed.com/rc/clk?jk=0a1b2c3d4e5f6a7b&fccid=9f8e7d6c5b4a3921&vjs=3&from=ja&tk=1hq2w3e4r5t6y7u8i\n"
        "Unsubscribe: https://it.indeed.com/unsubscribe?token=abc"
    ),
}
GREENHOUSE_ALERT = {
    "sender": "Example Co <no-reply@greenhouse-mail.invalid>",
    "subject": "New role at Example Co: Data Engineer",
    "body": "Apply here: https://boards.greenhouse.io/exampleco/jobs/4012345678?gh_jid=4012345678&utm_source=alert#app",
}
LINKEDIN_ALERT = {
    "sender": "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
    "subject": "Software Engineer at Example: 12 new jobs",
    "body": "https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA%3D%3D&refId=abc",
}

RESETS = [
    ("GitHub <noreply@github.invalid>", "[GitHub] Please reset your password", "Click https://github.example/password_reset/abc"),
    ("Posta <account@provider.invalid>", "Reimposta la password del tuo account", "Usa questo link."),
    ("Bank <info@bank.invalid>", "Passwort zurücksetzen", "Folgen Sie dem Link."),
    ("Shop <hola@shop.invalid>", "Restablecer tu contraseña", "Haz clic aquí."),
    ("Service <bonjour@svc.invalid>", "Réinitialisation de votre mot de passe", "Cliquez ici."),
    ("Szolg <info@szolg.invalid>", "Jelszó visszaállítás", "Kattintson ide."),
    ("Loja <ola@loja.invalid>", "Redefinir sua senha", "Clique aqui."),
    ("Mail <security@provider.invalid>", "New sign-in to your account", "We noticed a new sign-in."),
    ("Mail <security@provider.invalid>", "Nuovo accesso al tuo account", "Abbiamo rilevato un accesso."),
    ("App <hi@app.invalid>", "Your two-factor setup", "Turn on 2FA."),
]


@pytest.mark.parametrize("sender,subject,body", RESETS)
@pytest.mark.parametrize("admission", [WHOLE, STRICT], ids=["whole_mailbox", "allowlist"])
def test_security_mail_of_unregistered_senders_is_withheld_in_every_language(admission, sender, subject, body):
    assert verdict(admission, sender=sender, subject=subject, body=body) in ("security", "withheld")
    assert verdict(WHOLE, sender=sender, subject=subject, body=body) == "security"


def test_the_filter_holds_inside_the_allowlist_too():
    assert verdict(STRICT, sender="alert@indeed.invalid", subject="Your verification code", body="") == "security"


def test_otp_in_the_subject_is_caught_and_also_masked():
    assert verdict(WHOLE, sender="x@svc.invalid", subject="Il tuo codice è 482913", body="") == "security"
    assert "482913" not in reduce_text("Il tuo codice è 482913")
    assert "8C2KQ7ZD" not in reduce_text("Enter code 8C2KQ7ZD to continue")
    assert "123 456" not in reduce_text("Login: 123 456")


def _fake_jwt() -> str:
    """A JWT-shaped token built at runtime from made-up parts, so the source
    holds no whole token for a secret scanner to flag."""
    import base64
    import json

    def part(obj) -> str:
        raw = obj if isinstance(obj, bytes) else json.dumps(obj, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    return ".".join([part({"alg": "HS256"}), part({"sub": "fixture-user"}), part(b"fixture-signature")])


def test_a_magic_link_with_the_token_in_the_path_loses_the_token():
    url = "https://app.example/auth/magic/" + _fake_jwt()
    assert mailfilter._JWT_RE.match(_fake_jwt())  # the fixture really has a JWT's shape
    assert reduce_url(url) == "https://app.example/auth/magic/[token]"
    url = "https://app.example/login/q8Zx3Lm0Pw7Rt2Yv9Kd4Ns1B"
    assert reduce_url(url) == "https://app.example/login/[token]"


def test_a_magic_link_message_is_withheld():
    body = "Sign in: https://app.example/auth?token=abc123"
    assert verdict(WHOLE, sender="no-reply@app.invalid", subject="Welcome back", body=body) == "security"


def test_a_real_indeed_alert_stays_useful():
    assert verdict(WHOLE, **INDEED_ALERT) == "ok"
    assert verdict(STRICT, **INDEED_ALERT) == "ok"
    url = reduce_url("https://it.indeed.com/rc/clk?jk=0a1b2c3d4e5f6a7b&fccid=9f8e7d6c5b4a3921&vjs=3&from=ja&tk=1hq2w3e4r5t6y7u8i")
    assert url == "https://it.indeed.com/rc/clk?jk=0a1b2c3d4e5f6a7b"
    assert reduce_url("https://it.indeed.com/viewjob?jk=0a1b2c3d4e5f6a7b") == "https://it.indeed.com/viewjob?jk=0a1b2c3d4e5f6a7b"


def test_a_real_greenhouse_alert_stays_useful():
    assert verdict(STRICT, **GREENHOUSE_ALERT) == "ok"
    url = reduce_url("https://boards.greenhouse.io/exampleco/jobs/4012345678?gh_jid=4012345678&utm_source=alert#app")
    assert url == "https://boards.greenhouse.io/exampleco/jobs/4012345678?gh_jid=4012345678"


def test_a_linkedin_alert_keeps_its_id_and_drops_the_tracking():
    assert verdict(WHOLE, **LINKEDIN_ALERT) == "ok"
    url = reduce_url("https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=Zm9vYmFy&refId=abc")
    assert url == "https://www.linkedin.com/comm/jobs/view/4012345678/"
    assert reduce_url("https://www.linkedin.com/jobs/search/?currentJobId=4012345678&geoId=1") == (
        "https://www.linkedin.com/jobs/search/?currentJobId=4012345678"
    )


def test_an_offer_id_parameter_that_looks_like_a_token_goes():
    assert reduce_url("https://ats.example/apply?jobId=Q8Zx3Lm0Pw7Rt2Yv9Kd4Ns1B") == "https://ats.example/apply"
    assert reduce_url("https://ats.example/apply?jobId=ab%2Fcd") == "https://ats.example/apply"


@pytest.mark.parametrize(
    "url",
    [
        "https://jobs.lever.co/exampleco/3f2b6c1e-8a4d-4b2a-9d3e-1a2b3c4d5e6f",
        "https://example.wd3.myworkdayjobs.com/en-US/careers/job/Milano/Senior-Backend-Engineer_JR-0012345",
        "https://www.example.com/careers/senior-platform-reliability-engineering-manager",
    ],
)
def test_slugs_and_uuids_are_not_tokens(url):
    assert reduce_url(url) == url


def test_admission_allowlist():
    assert verdict(STRICT, sender="someone@other.invalid", subject="Hi", body="") == "withheld"
    # A subdomain of an allowed domain is allowed (checked on domains: the
    # fixtures carry no address outside example.* and .invalid).
    assert mailfilter._domain_matches("eu.greenhouse-mail.invalid", "greenhouse-mail.invalid")
    assert not mailfilter._domain_matches("greenhouse-mail.invalid.evil", "greenhouse-mail.invalid")
    assert verdict(STRICT, sender="r@recruiter.invalid", subject="Re: application", body="",
                   in_reply_to="<sent-1@jht.invalid>") == "ok"
    assert verdict(STRICT, sender="r@recruiter.invalid", subject="Re: application", body="",
                   references="<a@b> <sent-1@jht.invalid>") == "ok"


def test_no_admission_field_promises_a_check_nobody_feeds():
    # Audit M7: `registered_domains` was read from the state and written by no
    # command. Phase 2 brings it back with its writer.
    assert "registered_domains" not in Admission.__dataclass_fields__
    assert "registered_domains" not in (ROOT / "shared" / "broker" / "mailops.py").read_text(encoding="utf-8")


def test_there_is_no_switch_for_the_filter_or_the_reduction():
    assert set(mailfilter.ADMISSION_POLICIES) == {"allowlist", "whole_mailbox"}
    fields = set(Admission.__dataclass_fields__)
    assert not {f for f in fields if "filter" in f or "reduc" in f or "secur" in f}
    with pytest.raises(ValueError):
        Admission(policy="off")


def test_reduce_row_touches_url_and_subject_only():
    row = {"url": "https://x.example/job/1?utm=1#f", "subject": "PIN 1234", "sender": "a@example.com"}
    assert mailfilter.reduce_row(row) == {"url": "https://x.example/job/1", "subject": "PIN [codice]", "sender": "a@example.com"}


@pytest.mark.parametrize("subject,body", [
    ("Hello", "<p>Please reset <b>your</b> password below.</p>"),
    ("Hello", "<p>Please reset&nbsp;your&nbsp;password below.</p>"),
    ("Hello", "<p>Please re<span>set</span> your pass<i>word</i> below.</p>"),
    ("Hello", "<p>Please reset your pass​word below.</p>"),
    ("Hello", '<a href="https://acct.example/login?next=%2F&amp;token=abc123">open</a>'),
])
def test_html_markup_cannot_split_a_security_phrase_or_hide_a_token(subject, body):
    # Audit M8: the filter reads the HTML without tags and entities.
    assert mailfilter.is_security_message(subject, body)


def test_plain_job_alert_html_stays_a_job_alert():
    body = '<p>New <b>Python</b> jobs&nbsp;for you</p><a href="https://www.indeed.com/viewjob?jk=0a1b2c3d4e5f6a7b&amp;from=mail">View</a>'
    assert not mailfilter.is_security_message("New jobs", body)
