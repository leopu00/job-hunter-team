"""P1 portal secrets, phase 0: the mailbox password stays out of the agents' view.

The chat skill used to tell CAPITANO, MENTOR and ASSISTENTE to `json.load`
`credentials/email_monitor.json` and log in to SMTP themselves: the password
went through the model's context, the provider and the transcripts. Now they
call `email_monitor.py send`, which reads the account by itself and prints
only a result.

This reduces, it does not close: the agents still share the uid that owns the
file. A canary stands in for the password; no real credential is read.

Run with: pytest tests/test_email_monitor_secret_boundary.py -v
"""

import contextlib
import io
import json
import os
import smtplib
import sys
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
    sys.modules.pop("email_monitor", None)
    import email_monitor
    monkeypatch.setattr(email_monitor.smtplib, "SMTP_SSL", FakeSmtp)
    FakeSmtp.logins, FakeSmtp.sent, FakeSmtp.fail_with = [], [], None
    yield home, email_monitor
    sys.modules.pop("email_monitor", None)


def run_cli(module, argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = module.main(argv)
    return code, out.getvalue(), err.getvalue()


def files_without_the_secret_file(home: Path):
    return [p for p in home.rglob("*") if p.is_file() and p.name != "email_monitor.json"]


def test_a_test_send_uses_the_password_and_never_shows_it(mailbox, tmp_path):
    home, em = mailbox
    body = tmp_path / "body.txt"
    body.write_text("Hello from the team")
    code, out, err = run_cli(em, ["send", "--to", "someone@example.com", "--subject", "Hi", "--body-file", str(body)])

    assert code == 0
    # The send really happened with the stored password...
    assert FakeSmtp.logins == [("team@example.invalid", CANARY)]
    assert FakeSmtp.sent[0]["To"] == "someone@example.com"
    # ...derived from the IMAP host, as the old example did by hand.
    result = json.loads(out)
    assert result["ok"] is True and result["to"] == ["someone@example.com"]
    # ...and the canary is nowhere the agent sees: stdout, stderr, files it can list.
    assert CANARY not in out and CANARY not in err
    for path in files_without_the_secret_file(home):
        assert CANARY.encode() not in path.read_bytes(), path


def test_a_failed_login_reports_a_code_never_the_server_text(mailbox):
    home, em = mailbox
    # A server that echoes what it got: its text must never reach stdout.
    FakeSmtp.fail_with = smtplib.SMTPAuthenticationError(535, f"bad credentials {CANARY}".encode())
    code, out, err = run_cli(em, ["send", "--to", "someone@example.com", "--subject", "Hi", "--body", "x"])
    assert code == 1
    assert json.loads(out) == {"ok": False, "reason": "auth_failed"}
    assert CANARY not in out and CANARY not in err


def test_status_never_shows_the_password(mailbox):
    _, em = mailbox
    code, out, err = run_cli(em, ["status"])
    assert code == 0
    assert json.loads(out)["credentials_problem"] is None
    assert CANARY not in out and CANARY not in err


@pytest.mark.parametrize("to,subject,reason", [
    ("not-an-address", "Hi", "invalid_recipient"),
    ("a@example.com\r\nBcc: injected@example.com", "Hi", "invalid_recipient"),
    ("a@example.com", "Hi\r\nBcc: injected@example.com", "invalid_subject"),
])
def test_header_injection_sends_nothing(mailbox, to, subject, reason):
    _, em = mailbox
    assert em.send([to], subject, "x") == {"ok": False, "reason": reason}
    assert FakeSmtp.logins == [] and FakeSmtp.sent == []


def test_a_file_of_another_uid_is_refused(mailbox, monkeypatch):
    _, em = mailbox
    real_uid = os.getuid()
    monkeypatch.setattr(em.os, "getuid", lambda: real_uid + 1)
    assert em.send(["someone@example.com"], "Hi", "x") == {"ok": False, "reason": "credentials_foreign_owner"}
    assert em._load_creds() == {}
    assert em.status()["credentials_problem"] == "credentials_foreign_owner"
    assert FakeSmtp.logins == []


def test_a_symlink_is_refused(mailbox, tmp_path):
    home, em = mailbox
    creds = home / "credentials" / "email_monitor.json"
    target = tmp_path / "elsewhere.json"
    target.write_text(creds.read_text())
    target.chmod(0o600)
    creds.unlink()
    creds.symlink_to(target)
    assert em.send(["someone@example.com"], "Hi", "x") == {"ok": False, "reason": "credentials_symlink"}
    assert em._load_creds() == {}


def test_an_open_mode_of_this_uid_is_tightened_not_refused(mailbox):
    home, em = mailbox
    creds = home / "credentials" / "email_monitor.json"
    creds.chmod(0o644)
    assert em._load_creds()["user"] == "team@example.invalid"
    assert creds.stat().st_mode & 0o777 == 0o600


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
