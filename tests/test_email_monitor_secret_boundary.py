"""P1 portal secrets: the mailbox password stays out of the agents' view.

Phase 0: the chat skill used to tell CAPITANO, MENTOR and ASSISTENTE to
`json.load` `credentials/email_monitor.json` and log in to SMTP themselves.
Phase 1a: the account lives in the broker container; the agents' CLI only
sends requests to it and never opens a credentials file. What stays here:

- the IMAP/SMTP core the broker runs (`send_message`, `_imap_connect`) never
  shows the password, in a result or in an exception;
- the agents' CLI refuses a body file inside the portal secrets, and with no
  broker it answers `broker_unavailable` without falling back to the file;
- nothing in jht reads the legacy file any more (audit G1): the readers
  `_read_creds`/`_load_creds` are gone, and the core gets the account only
  as an argument.

A canary stands in for the password; no real credential is read.

Run with: pytest tests/test_email_monitor_secret_boundary.py -v
"""

import contextlib
import io
import json
import os
import smtplib
import sys
import traceback
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

CANARY = "CANARY-mailbox-password-91e4"


class FakeSmtp:
    """Stands in for smtplib.SMTP_SSL: records the login and the message."""

    logins: list[tuple[str, str]] = []
    sent: list[object] = []
    fail_with: Exception | None = None

    def __init__(self, host, port, context=None, timeout=None):
        self.host, self.port = host, port

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def login(self, user, password):
        if FakeSmtp.fail_with is not None:
            raise FakeSmtp.fail_with
        # smtplib encodes the AUTH string as ASCII: a non-ASCII password raises
        # UnicodeEncodeError here, naming the character and its position.
        ("\0%s\0%s" % (user, password)).encode("ascii")
        FakeSmtp.logins.append((user, password))

    def send_message(self, msg):
        FakeSmtp.sent.append(msg)


@pytest.fixture
def mailbox(tmp_path, monkeypatch):
    home = tmp_path / "jht_home"
    (home / "credentials").mkdir(parents=True)
    creds = home / "credentials" / "email_monitor.json"
    creds.write_text(json.dumps({
        "imap_host": "imap.example.invalid",
        "user": "team@example.invalid",
        "password": CANARY,
    }))
    creds.chmod(0o600)
    monkeypatch.setenv("JHT_HOME", str(home))
    # No broker in this test: the CLI must say so, never read the file.
    monkeypatch.setenv("JHT_BROKER_SOCKET_DIR", str(tmp_path / "no-broker"))
    sys.modules.pop("email_monitor", None)
    import email_monitor
    monkeypatch.setattr(email_monitor.smtplib, "SMTP_SSL", FakeSmtp)
    FakeSmtp.logins, FakeSmtp.sent, FakeSmtp.fail_with = [], [], None
    yield home, email_monitor
    sys.modules.pop("email_monitor", None)


def account(home: Path) -> dict:
    """The account the broker would pass to the core: the test reads its own
    fixture, the module under test never does."""
    return json.loads((home / "credentials" / "email_monitor.json").read_text())


def run_cli(module, argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = module.main(argv)
    return code, out.getvalue(), err.getvalue()


def files_without_the_secret_file(home: Path):
    return [p for p in home.rglob("*") if p.is_file() and p.name != "email_monitor.json"]


def test_the_core_send_uses_the_password_and_never_shows_it(mailbox, tmp_path):
    home, em = mailbox
    result = em.send_message(account(home), ["someone@example.com"], "Hi", "Hello from the team")

    # The send really happened with the stored password...
    assert FakeSmtp.logins == [("team@example.invalid", CANARY)]
    assert FakeSmtp.sent[0]["To"] == "someone@example.com"
    assert result["ok"] is True and result["to"] == ["someone@example.com"]
    # ...and the canary is not in what the broker hands back.
    assert CANARY not in json.dumps(result)


def test_the_agents_cli_never_reads_the_file_and_has_no_fallback(mailbox):
    home, em = mailbox
    expected = {
        "send": {"ok": False, "reason": "broker_unavailable"},
        "poll": {"ok": False, "reason": "broker_unavailable"},
        # status and count still say `configured: false`: the prompts read it.
        "status": {"ok": True, "configured": False, "unavailable": "broker_unavailable"},
        "count": {"ok": False, "reason": "broker_unavailable", "configured": False, "new_total": 0, "by_sender": {}},
    }
    for argv in (["send", "--to", "someone@example.com", "--subject", "Hi", "--body", "x"], ["status"], ["poll"], ["count"]):
        code, out, err = run_cli(em, argv)
        assert code == (0 if argv == ["status"] else 1), argv
        assert json.loads((out or err).strip()) == expected[argv[0]], argv
        assert CANARY not in out + err
    assert run_cli(em, ["poll"])[1] == ""
    assert FakeSmtp.logins == [] and FakeSmtp.sent == []


def test_a_failed_login_reports_a_code_never_the_server_text(mailbox):
    home, em = mailbox
    # A server that echoes what it got: its text must never reach the result.
    FakeSmtp.fail_with = smtplib.SMTPAuthenticationError(535, f"bad credentials {CANARY}".encode())
    result = em.send_message(account(home), ["someone@example.com"], "Hi", "x")
    assert result == {"ok": False, "reason": "auth_failed"}


@pytest.mark.parametrize("to,subject,reason", [
    ("not-an-address", "Hi", "invalid_recipient"),
    ("a@example.com\r\nBcc: injected@example.com", "Hi", "invalid_recipient"),
    ("a@example.com", "Hi\r\nBcc: injected@example.com", "invalid_subject"),
])
def test_header_injection_sends_nothing(mailbox, to, subject, reason):
    home, em = mailbox
    assert em.send_message(account(home), [to], subject, "x") == {"ok": False, "reason": reason}
    assert FakeSmtp.logins == [] and FakeSmtp.sent == []


def test_the_module_has_no_reader_of_the_credentials_file(mailbox):
    # Audit G1: the last reader (for verification_code.py) is gone.
    _, em = mailbox
    for name in ("_read_creds", "_load_creds", "CREDS_PATH"):
        assert not hasattr(em, name), name


def test_no_agent_prompt_tells_the_model_to_open_a_credentials_file():
    # Mentioning where a file lives is fine; telling the model to load it is
    # what put the mailbox password in the context.
    offenders = []
    for path in (ROOT / "agents").rglob("*.md"):
        text = path.read_text(encoding="utf-8")
        for line in text.splitlines():
            if "credentials" in line and ("json.load" in line or "open(" in line) and "Never" not in line:
                offenders.append(f"{path.relative_to(ROOT)}: {line.strip()}")
    # The translated "never open" lines name json.load on purpose: they forbid it.
    offenders = [o for o in offenders if not any(w in o for w in ("Non aprire", "Nunca", "N'ouvre", "Soha", "Öffne"))]
    assert offenders == []


# ── hosea R1 and R2 (08/10) ───────────────────────────────────────────────

NON_ASCII_CANARY = "CANARY-pässwörd-è-7c2d"


def pieces_of(secret: str) -> list[str]:
    """What a leak can look like: the whole canary, each non-ASCII character
    and its escapes, and the position a UnicodeEncodeError reports."""
    out = [secret, secret[:8]]
    for ch in secret:
        if ord(ch) > 127:
            out += [ch, repr(ch)[1:-1], ch.encode("unicode_escape").decode(), f"\\x{ord(ch):02x}"]
    return out + ["position", "codec can't encode"]


def write_password(home: Path, password: str) -> None:
    creds = home / "credentials" / "email_monitor.json"
    data = json.loads(creds.read_text())
    data["password"] = password
    creds.write_text(json.dumps(data, ensure_ascii=False))


def test_a_non_ascii_password_never_leaks_through_an_encoding_error(mailbox):
    home, em = mailbox
    write_password(home, NON_ASCII_CANARY)
    result = em.send_message(account(home), ["someone@example.com"], "Hi", "x")
    assert result == {"ok": False, "reason": "encoding_unsupported"}
    for piece in pieces_of(NON_ASCII_CANARY):
        assert piece not in json.dumps(result), piece
    assert FakeSmtp.sent == []


class FakeImap:
    def __init__(self, host, port):
        pass

    def login(self, user, password):
        # imaplib sends LOGIN as ASCII: same failure as smtplib.
        password.encode("ascii")

    def logout(self):
        pass


def test_imap_login_with_a_non_ascii_password_raises_a_clean_error(mailbox, monkeypatch):
    home, em = mailbox
    write_password(home, NON_ASCII_CANARY)
    monkeypatch.setattr(em.imaplib, "IMAP4_SSL", FakeImap)
    with pytest.raises(em.CredentialsEncodingError) as caught:
        em._imap_connect(account(home))
    rendered = "".join(traceback.format_exception(caught.value))
    assert caught.value.__cause__ is None and caught.value.__suppress_context__
    for piece in pieces_of(NON_ASCII_CANARY):
        assert piece not in rendered, piece


@pytest.mark.parametrize("where", ["credentials/email_monitor.json", ".cache/linkedin/storage-state.json", "credentials/ats-accounts/x.json"])
def test_a_body_file_inside_the_portal_secrets_is_refused(mailbox, where):
    home, em = mailbox
    target = home / where
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_text(CANARY)
    code, out, err = run_cli(em, ["send", "--to", "someone@example.com", "--subject", "Hi", "--body-file", str(target)])
    assert code == 1 and json.loads(out) == {"ok": False, "reason": "body_file_forbidden"}
    assert FakeSmtp.logins == [] and CANARY not in out + err


def test_a_symlink_to_a_secret_is_refused_too(mailbox, tmp_path):
    home, em = mailbox
    link = tmp_path / "innocent.txt"
    link.symlink_to(home / "credentials" / "email_monitor.json")
    code, out, _ = run_cli(em, ["send", "--to", "someone@example.com", "--subject", "Hi", "--body-file", str(link)])
    assert code == 1 and json.loads(out)["reason"] == "body_file_forbidden"
    assert FakeSmtp.sent == []


def test_recipients_are_capped(mailbox):
    home, em = mailbox
    creds = account(home)
    many = [f"r{i}@example.com" for i in range(em.MAX_RECIPIENTS + 1)]
    assert em.send_message(creds, many, "Hi", "x") == {"ok": False, "reason": "too_many_recipients"}
    assert em.send_message(creds, many[: em.MAX_RECIPIENTS], "Hi", "x")["ok"] is True
