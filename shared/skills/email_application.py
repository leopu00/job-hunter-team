#!/usr/bin/env python3
"""email_application.py — send ONE user-authorised application by email. [JHT-CLOSER-EMAIL]

Some vacancies have no application form: their "Apply" control is a
`mailto:` link. This module is the whole email channel, from reading that link
to the receipt. The browser flow (`apply_flow.py`) recognises the link as a
channel and leaves the raw `mailto_href` in its checkpoint; everything from
the parsing on happens here.

Invariants, each enforced by code and by a test:

1. **The user's flag is the authorisation.** `apply_gate.py` decides in
   `preflight` and again immediately before the transport. There is no second
   consent, and nothing goes out if either decision is a no.
2. **Nothing is invented.** Recipients come from the link only; personal facts
   come from the candidate profile only. A required fact that is absent stops
   the flow with `blocked_human required_fact_missing`.
3. **One letter at most.** A `send_started` row is committed before the SMTP
   DATA command. After it, a timeout or an unclear answer becomes
   `send_outcome_unknown`, which is never retried, not even by a new run.
4. **`applied` only after acceptance.** The application is recorded once, with
   `applied_via=agent_closer_email`, after the transport accepted the message
   and the redacted receipt is persisted.
5. **No secret leaves the credential file.** The SMTP password is read from a
   0600 file and never reaches logs, receipts, the database or the output.

Commands (one JSON line on stdout)::

    email_application.py inspect   --position-id ID --json
    email_application.py preflight --position-id ID --json
    email_application.py draft     --position-id ID --json
    email_application.py send      --position-id ID --json [--dry-run]
    email_application.py status    --position-id ID --json

States: inspected · blocked_human · denied · draft_ready · send_started · sent ·
send_outcome_unknown · receipt_incomplete · error.

Exit codes: 0 inspected/draft_ready/sent · 1 denied/blocked_human ·
3 send_outcome_unknown/receipt_incomplete · 2 error.

Transport configuration (no secret) lives in `$JHT_HOME/jht.config.json`::

    "applications": {
      "email_transport": {
        "kind": "smtp", "host": "smtp.example.com", "port": 587 (default),
        "security": "starttls" (default) | "ssl", "username": "jobs@example.com",
        "from_address": "jobs@example.com", "from_name": "optional",
        "verified_senders": ["optional@example.com"]
      }
    }

The secret lives in `$JHT_HOME/credentials/email_transport.json`
(`{"password": "..."}`), mode 0600.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import re
import smtplib
import ssl
import sqlite3
import stat
import subprocess
import sys
import tempfile
import urllib.parse
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, formatdate
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol, Sequence

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import apply_gate  # noqa: E402
import application_answers  # noqa: E402

__all__ = [
    "APPLIED_VIA",
    "EmailApplication",
    "MailtoError",
    "Mailto",
    "SmtpTransport",
    "TRANSPORTS",
    "parse_mailto",
]

APPLIED_VIA = "agent_closer_email"

STATES = (
    "inspected",
    "blocked_human",
    "denied",
    "draft_ready",
    "send_started",
    "sent",
    "send_outcome_unknown",
    "receipt_incomplete",
    "error",
)

EXIT_CODES = {
    "inspected": 0,
    "draft_ready": 0,
    "sent": 0,
    "denied": 1,
    "blocked_human": 1,
    "send_started": 3,
    "send_outcome_unknown": 3,
    "receipt_incomplete": 3,
    "error": 2,
}

# Gate reasons that mean "the user's authorisation is no longer there".
FLAG_REVOKED_REASONS = frozenset(
    {
        "position_not_authorised",
        "authorisation_undated",
        "authorisation_not_from_user",
        "consent_absent",
        "consent_disabled",
    }
)

MAX_CC = 5
# The browser flow hands over at most this many characters (its checkpoint contract).
MAX_HREF = 4000
MAX_SUBJECT = 300
MAX_BODY = 10_000
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
SMTP_TIMEOUT_SECONDS = 30
DEFAULT_SMTP_PORT = 587

_ADDRESS = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
)
EMAIL_CHANNEL_STATE = "email_channel"
_BAD_PERCENT = re.compile(r"%(?![0-9A-Fa-f]{2})")
_HEADER_CONTROL = re.compile(r"[\x00-\x1f\x7f]")

_COVER_LETTER_REQUEST = re.compile(
    r"cover\s*letter|motivation(?:al)?\s*letter|letter\s+of\s+motivation|"
    r"lettera\s+(?:di\s+presentazione|motivazionale)|"
    r"anschreiben|motivationsschreiben|lettre\s+de\s+motivation|"
    r"carta\s+de\s+(?:presentaci[oó]n|motivaci[oó]n|apresenta[cç][aã]o)|"
    r"motiv[aá]ci[oó]s\s+lev[eé]l",
    re.I,
)
_COVER_LETTER_NOT_REQUIRED = re.compile(
    r"(?:no|without)\s+(?:a\s+)?cover\s*letter|cover\s*letter\s+(?:is\s+)?(?:not\s+(?:required|needed)|optional)",
    re.I,
)

# Facts that an application email may be asked to state. Detected in the
# vacancy text and in the link; answered only from the candidate profile.
REQUIRED_FACTS: tuple[tuple[str, re.Pattern[str], tuple[str, ...]], ...] = (
    (
        "availability",
        # Phrases, not words: "high availability" is a skill, not a question.
        re.compile(
            r"(?:your|earliest|date\s+of)\s+availability|availability\s+(?:to\s+start|date)|"
            r"available\s+to\s+start|(?:earliest\s+)?start(?:ing)?\s+date|notice\s+period|"
            r"(?:tua|vostra|sua)\s+disponibilit|disponibilit[aà]\s+(?:a|ad)\s+(?:iniziare|partire)|"
            r"data\s+di\s+(?:inizio|disponibilit)|preavviso|"
            r"eintrittstermin|k[uü]ndigungsfrist|"
            r"fecha\s+de\s+(?:inicio|incorporaci[oó]n)|disponibilidad\s+(?:para|de)\s+incorporaci|"
            r"date\s+de\s+(?:d[eé]but|disponibilit)|pr[eé]avis|"
            r"data\s+de\s+in[ií]cio|disponibilidade\s+para\s+(?:in[ií]cio|come[cç]ar)|"
            r"kezd[eé]si\s+id[oő]pont|felmond[aá]si\s+id",
            re.I,
        ),
        ("availability", "start date", "earliest start date", "notice period"),
    ),
    (
        "salary_expectation",
        re.compile(
            r"salary\s+expectations?|expected\s+salary|desired\s+salary|"
            r"aspettative?\s+(?:economiche|retributive)|retribuzione\s+desiderata|"
            r"gehaltsvorstellung|pretensi[oó]n(?:es)?\s+salarial(?:es)?|"
            r"pr[eé]tentions?\s+salariales?|pretens[aã]o\s+salarial|b[eé]rig[eé]ny",
            re.I,
        ),
        ("salary expectation", "salary expectations", "expected salary", "desired salary"),
    ),
)


# ── Time and files ───────────────────────────────────────────────────────────


def _utc_now() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _atomic_write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        path.parent.chmod(0o700)
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
    )
    try:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
        handle.close()
        os.chmod(handle.name, 0o600)
        os.replace(handle.name, path)
    except Exception:
        handle.close()
        with contextlib.suppress(OSError):
            os.unlink(handle.name)
        raise


# ── The mailto link ──────────────────────────────────────────────────────────


class MailtoError(ValueError):
    def __init__(self, reason: str, detail: str):
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True)
class Mailto:
    to: str
    cc: tuple[str, ...] = ()
    subject: str = ""
    body: str = ""


def _decode(text: str, name: str) -> str:
    if _BAD_PERCENT.search(text):
        raise MailtoError("mailto_invalid", f"malformed percent-encoding in `{name}`")
    try:
        return urllib.parse.unquote(text, encoding="utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise MailtoError("mailto_invalid", f"`{name}` is not valid UTF-8") from exc


def _normalise_address(value: str) -> str:
    value = value.strip()
    if not _ADDRESS.match(value):
        raise MailtoError(
            "recipient_ambiguous",
            "a recipient is not a single plain email address",
        )
    local, _, domain = value.rpartition("@")
    return f"{local}@{domain.lower()}"


def _addresses(value: str, name: str) -> list[str]:
    if _HEADER_CONTROL.search(value):
        raise MailtoError("mailto_invalid", f"control characters in `{name}`")
    out: list[str] = []
    for part in value.split(","):
        if part.strip():
            address = _normalise_address(part)
            if address not in out:
                out.append(address)
    return out


def parse_mailto(href: Any) -> Mailto:
    """Parse a `mailto:` link into ONE recipient, CCs, subject and body.

    Pure function. Refuses every link that could send the letter somewhere
    the vacancy did not ask for: another scheme, zero or several `To`
    recipients, a header the link has no business setting (`bcc`, `from`,
    `reply-to`, ...), a repeated field, or a CR/LF smuggled into a header.
    `+` is a literal plus (RFC 6068), not a space.
    """
    if not isinstance(href, str) or not href.strip():
        raise MailtoError("mailto_invalid", "the application link is empty")
    raw = href.strip()
    if len(raw) > MAX_HREF:
        raise MailtoError("mailto_invalid", f"the application link is longer than {MAX_HREF} characters")
    if any(ch in raw for ch in "\r\n\x00"):
        raise MailtoError("mailto_invalid", "raw control characters in the application link")
    scheme, sep, rest = raw.partition(":")
    if not sep or scheme.lower() != "mailto":
        raise MailtoError("mailto_invalid", "the application link is not a mailto link")
    if "#" in rest:
        raise MailtoError("mailto_invalid", "a mailto link cannot carry a fragment")
    path, _, query = rest.partition("?")

    to = _addresses(_decode(path, "to"), "to") if path else []
    cc: list[str] = []
    subject = ""
    body = ""
    seen: set[str] = set()
    for part in query.split("&") if query else ():
        if not part:
            continue
        raw_key, _, raw_value = part.partition("=")
        key = _decode(raw_key, "field name").strip().lower()
        if key not in {"to", "cc", "subject", "body"}:
            raise MailtoError(
                "mailto_invalid",
                f"the link sets `{key}`, which an application link may not set",
            )
        if key in seen:
            raise MailtoError("mailto_invalid", f"the link sets `{key}` twice")
        seen.add(key)
        value = _decode(raw_value, key)
        if key == "to":
            for address in _addresses(value, "to"):
                if address not in to:
                    to.append(address)
        elif key == "cc":
            cc = _addresses(value, "cc")
        elif key == "subject":
            if _HEADER_CONTROL.search(value):
                raise MailtoError("mailto_invalid", "control characters in `subject`")
            subject = " ".join(value.split())
        else:
            if "\x00" in value:
                raise MailtoError("mailto_invalid", "a NUL character in `body`")
            body = value.replace("\r\n", "\n").replace("\r", "\n").strip()

    if len(to) != 1:
        raise MailtoError(
            "recipient_ambiguous",
            f"the link names {len(to)} main recipients; exactly one is required",
        )
    cc = [address for address in cc if address != to[0]]
    if len(cc) > MAX_CC:
        raise MailtoError("recipient_ambiguous", f"the link names more than {MAX_CC} CC recipients")
    if len(subject) > MAX_SUBJECT or len(body) > MAX_BODY:
        raise MailtoError("mailto_invalid", "the link subject or body is too long")
    return Mailto(to=to[0], cc=tuple(cc), subject=subject, body=body)


# ── Transport seam ───────────────────────────────────────────────────────────


class TransportError(Exception):
    """Raised before anything was handed to the server."""


class TransportAuthError(TransportError):
    pass


class TransportUnavailable(TransportError):
    pass


class RecipientsRefused(TransportError):
    """The server refused sender or every recipient BEFORE the DATA command."""


@dataclass(frozen=True)
class TransportSettings:
    kind: str
    host: str
    port: int
    security: str
    username: str
    from_address: str
    from_name: str = ""
    verified_senders: tuple[str, ...] = ()


class Transport(Protocol):
    def open(self) -> None: ...

    def send(self, message: EmailMessage, envelope_from: str, recipients: Sequence[str]) -> dict: ...

    def close(self) -> None: ...


class SmtpTransport:
    """SMTP over TLS (implicit `ssl` or `starttls`). Plain text is refused."""

    def __init__(self, settings: TransportSettings, password: str, timeout: int = SMTP_TIMEOUT_SECONDS):
        self.settings = settings
        self._password = password
        self.timeout = timeout
        self._smtp: smtplib.SMTP | None = None
        # The numeric reply to DATA (250 when the server took the letter), for the receipt.
        self.last_reply_code: int | None = None

    def open(self) -> None:
        context = ssl.create_default_context()
        try:
            if self.settings.security == "ssl":
                smtp = smtplib.SMTP_SSL(
                    self.settings.host, self.settings.port, timeout=self.timeout, context=context
                )
            elif self.settings.security == "starttls":
                smtp = smtplib.SMTP(self.settings.host, self.settings.port, timeout=self.timeout)
                smtp.ehlo()
                smtp.starttls(context=context)
                smtp.ehlo()
            else:
                raise TransportUnavailable("unsupported transport security")
            self._smtp = smtp
            smtp.login(self.settings.username, self._password)
        except smtplib.SMTPAuthenticationError as exc:
            self.close()
            raise TransportAuthError("the mail server refused the credentials") from exc
        except TransportError:
            self.close()
            raise
        except (smtplib.SMTPException, OSError) as exc:
            self.close()
            raise TransportUnavailable(f"the mail server is unreachable ({type(exc).__name__})") from exc

    def send(self, message: EmailMessage, envelope_from: str, recipients: Sequence[str]) -> dict:
        if self._smtp is None:
            raise TransportUnavailable("the transport is not open")
        smtp = self._smtp
        self.last_reply_code = None
        data = smtp.data

        def data_with_reply(msg):
            # sendmail() drops the reply to DATA: keep its code.
            code, reply = data(msg)
            self.last_reply_code = int(code)
            return code, reply

        smtp.data = data_with_reply
        try:
            return dict(smtp.sendmail(envelope_from, list(recipients), message.as_bytes()))
        except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused) as exc:
            raise RecipientsRefused(type(exc).__name__) from exc
        finally:
            del smtp.data

    def close(self) -> None:
        if self._smtp is not None:
            with contextlib.suppress(Exception):
                self._smtp.quit()
            self._smtp = None


# Gmail API or Microsoft Graph plug in here without touching the flow.
TRANSPORTS: dict[str, Callable[[TransportSettings, str], Transport]] = {"smtp": SmtpTransport}


# ── Results ──────────────────────────────────────────────────────────────────


@dataclass
class Outcome:
    state: str
    reason: str = ""
    detail: str = ""
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self, position_id: int) -> dict[str, Any]:
        return {
            "position_id": position_id,
            "state": self.state,
            "reason": self.reason,
            "detail": self.detail,
            **self.data,
        }


class _Stop(Exception):
    def __init__(self, outcome: Outcome):
        super().__init__(outcome.reason)
        self.outcome = outcome


def _blocked(reason: str, detail: str, **data: Any) -> _Stop:
    return _Stop(Outcome("blocked_human", reason, detail, data))


def _denied(reason: str, detail: str, **data: Any) -> _Stop:
    return _Stop(Outcome("denied", reason, detail, data))


def _error(reason: str, detail: str, **data: Any) -> _Stop:
    return _Stop(Outcome("error", reason, detail, data))


# ── The flow ─────────────────────────────────────────────────────────────────


def _default_notifier(*, position_id: int, message: str, source_id: str) -> str:
    candidates = [
        shutil_which("jht-notify-user"),
        "/app/agents/_tools/jht-notify-user",
        str(Path(__file__).resolve().parents[2] / "agents" / "_tools" / "jht-notify-user"),
    ]
    executable = next((c for c in candidates if c and Path(c).is_file()), None)
    if not executable:
        raise RuntimeError("jht-notify-user is unavailable")
    command = [
        executable,
        "--agent",
        "closer",
        "--kind",
        "question",
        "--position-id",
        str(position_id),
        "--source-id",
        source_id,
    ]
    if os.environ.get("JHT_APPLY_FLOW_NO_EXTERNAL_NOTIFY") == "1":
        command.append("--no-telegram")
    command.append(message)
    result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"jht-notify-user failed with exit {result.returncode}")
    return result.stdout.strip().split(maxsplit=1)[0] if result.stdout.strip() else ""


def shutil_which(name: str) -> str | None:
    import shutil

    return shutil.which(name)


class EmailApplication:
    def __init__(
        self,
        position_id: int,
        *,
        jht_home: str | Path | None = None,
        db_path: str | Path | None = None,
        config_path: str | Path | None = None,
        transports: Mapping[str, Callable[[TransportSettings, str], Transport]] | None = None,
        notifier: Callable[..., str] | None = None,
        recorder: Callable[[int], None] | None = None,
        clock: Callable[[], str] = _utc_now,
    ):
        self.position_id = int(position_id)
        self.jht_home = Path(jht_home or os.environ.get("JHT_HOME") or (Path.home() / ".jht"))
        self.db_path = Path(db_path or os.environ.get("JHT_DB") or (self.jht_home / "jobs.db"))
        self.config_path = Path(config_path) if config_path else self.jht_home / "jht.config.json"
        self.transports = dict(transports or TRANSPORTS)
        self.notifier = notifier or _default_notifier
        self.recorder = recorder or self._record_applied
        self.clock = clock

    # ── paths and persistence ────────────────────────────────────────────────

    @property
    def state_path(self) -> Path:
        return apply_gate.email_state_path(self.position_id, self.jht_home)

    @property
    def draft_path(self) -> Path:
        return self.state_path.with_name(f"{self.position_id}.draft.json")

    @property
    def receipt_dir(self) -> Path:
        return self.jht_home / "application-receipts"

    def _connect(self) -> sqlite3.Connection:
        if not self.db_path.is_file():
            raise _error("db_unavailable", "the local jobs database does not exist")
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self) -> None:
        from _db import _migrate_email_application_attempts

        with contextlib.closing(self._connect()) as conn:
            _migrate_email_application_attempts(conn)
            conn.commit()

    def _read_state(self) -> dict[str, Any]:
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def _write_state(self, outcome: Outcome, extra: Mapping[str, Any] | None = None) -> None:
        payload = dict(self._read_state())
        payload.update(
            {
                "position_id": self.position_id,
                "state": outcome.state,
                "reason": outcome.reason,
                "detail": outcome.detail,
                "updated_at": self.clock(),
            }
        )
        if extra:
            payload.update(extra)
        with contextlib.suppress(OSError):
            _atomic_write_json(self.state_path, payload)

    # ── readers ──────────────────────────────────────────────────────────────

    def _position(self) -> sqlite3.Row:
        try:
            with contextlib.closing(self._connect()) as conn:
                row = conn.execute(
                    "SELECT p.id, p.title, p.company, p.url, p.status, p.jd_text, p.requirements, "
                    "p.apply_requested_at, a.cv_pdf_path, a.cl_pdf_path, a.applied, a.applied_via "
                    "FROM positions p LEFT JOIN applications a ON a.position_id = p.id "
                    "WHERE p.id = ?",
                    (self.position_id,),
                ).fetchone()
        except sqlite3.Error as exc:
            raise _error("db_unavailable", f"cannot read the position ({type(exc).__name__})") from exc
        if row is None:
            raise _error("position_not_found", "no such position in the local database")
        return row

    def _config(self) -> dict[str, Any]:
        try:
            data = json.loads(self.config_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def _profile(self) -> Mapping[str, Any]:
        path = self.jht_home / "profile" / "candidate_profile.yml"
        try:
            import yaml

            value = yaml.safe_load(path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise _blocked("required_fact_missing", "the candidate profile does not exist", fact="profile") from exc
        except Exception as exc:
            raise _error("profile_unreadable", f"the candidate profile cannot be read ({type(exc).__name__})") from exc
        if not isinstance(value, Mapping):
            raise _error("profile_unreadable", "the candidate profile is not a mapping")
        return value

    # ── inspect ──────────────────────────────────────────────────────────────

    def _mailto_href(self, position: sqlite3.Row) -> tuple[str, str]:
        # The link comes only from the browser flow, which tells an "Apply"
        # control from a contact address. Reading the public page here would
        # take any mailto (a privacy@ footer) as the recipient: an invented one.
        checkpoint = apply_gate.checkpoint_path(self.position_id, self.jht_home)
        try:
            data = json.loads(checkpoint.read_text(encoding="utf-8"))
        except FileNotFoundError:
            data = None
        except (OSError, ValueError) as exc:
            raise _error("checkpoint_unreadable", "the browser checkpoint cannot be read") from exc
        if not (
            isinstance(data, dict)
            and data.get("channel") == "email"
            and data.get("state") == EMAIL_CHANNEL_STATE
        ):
            raise _blocked(
                "mailto_missing",
                "no browser checkpoint names the email channel: run apply_flow.py for this position first",
            )
        if data.get("position_id") != self.position_id or data.get("url") != position["url"]:
            raise _error("checkpoint_mismatch", "the browser checkpoint belongs to another position or vacancy URL")
        href = data.get("mailto_href")
        if not isinstance(href, str) or not href.strip():
            raise _blocked("mailto_invalid", "the browser checkpoint names the email channel without a link")
        return href, "checkpoint"

    def _inspect(self) -> tuple[sqlite3.Row, Mailto, dict[str, Any]]:
        position = self._position()
        href, source = self._mailto_href(position)
        try:
            mailto = parse_mailto(href)
        except MailtoError as exc:
            raise _blocked(exc.reason, exc.detail, source=source) from exc
        data = {
            "source": source,
            "to": mailto.to,
            "cc": list(mailto.cc),
            "subject": mailto.subject,
            "link_body_present": bool(mailto.body),
        }
        return position, mailto, data

    def inspect(self) -> Outcome:
        return self._run(lambda: Outcome("inspected", "mailto_parsed", "the application link is valid", self._inspect()[2]))

    # ── preflight ────────────────────────────────────────────────────────────

    def _gate(self) -> dict[str, Any]:
        verdict = apply_gate.apply_verdict(self.position_id, config_path=self.config_path, db_path=str(self.db_path))
        if not verdict.allowed:
            reason = "flag_revoked" if verdict.reason in FLAG_REVOKED_REASONS else verdict.reason
            if verdict.reason == "already_submitted":
                reason = "duplicate_attempt"
            raise _denied(reason, verdict.detail, gate_reason=verdict.reason)
        cap = apply_gate.daily_cap_verdict(config_path=self.config_path, db_path=str(self.db_path))
        if not cap.allowed:
            raise _denied(cap.reason, cap.detail, gate_reason=cap.reason, **cap.context)
        return {"mode": verdict.context.get("mode"), "remaining_today": cap.context.get("remaining_today")}

    def _transport_settings(self, required: bool) -> tuple[TransportSettings | None, str]:
        raw = ((self._config().get("applications") or {}).get("email_transport"))
        if not isinstance(raw, dict):
            if required:
                raise _blocked("transport_missing", "no email transport is configured")
            return None, ""
        try:
            settings = TransportSettings(
                kind=str(raw["kind"]),
                host=str(raw["host"]).strip(),
                # 587 STARTTLS by default: many hosts (Hetzner among them)
                # block outbound 465 and 25, and a default that cannot connect
                # reads as a broken mailbox rather than a blocked port.
                port=int(raw.get("port", DEFAULT_SMTP_PORT)),
                security=str(raw.get("security", "starttls")),
                username=str(raw["username"]).strip(),
                from_address=str(raw.get("from_address") or raw["username"]).strip(),
                from_name=" ".join(str(raw.get("from_name") or "").split()),
                verified_senders=tuple(str(v).strip() for v in raw.get("verified_senders") or ()),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise _blocked("transport_missing", "the email transport configuration is incomplete") from exc
        if settings.kind not in self.transports or not settings.host or settings.security not in {"ssl", "starttls"}:
            raise _blocked("transport_missing", "the email transport is not a supported TLS transport")
        try:
            sender = _normalise_address(settings.from_address)
            known = {_normalise_address(settings.username)} if _ADDRESS.match(settings.username) else set()
            known.update(_normalise_address(v) for v in settings.verified_senders if v)
        except MailtoError as exc:
            raise _blocked("sender_unverified", "the sender address is not a valid address") from exc
        if sender not in known or _HEADER_CONTROL.search(settings.from_name):
            raise _blocked(
                "sender_unverified",
                "the sender address is neither the authenticated account nor a verified sender",
            )
        secret_path = self.jht_home / "credentials" / "email_transport.json"
        try:
            info = secret_path.lstat()
        except OSError as exc:
            raise _blocked("transport_missing", "the email transport secret file does not exist") from exc
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise _blocked("transport_missing", "the email transport secret file must be a regular file with mode 0600")
        try:
            password = json.loads(secret_path.read_text(encoding="utf-8"))["password"]
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise _blocked("transport_missing", "the email transport secret cannot be read") from exc
        if not isinstance(password, str) or not password:
            raise _blocked("transport_missing", "the email transport secret is empty")
        return settings, password

    def _attachment(self, value: Any, reason: str, label: str) -> dict[str, Any]:
        if not value or not str(value).strip():
            raise _blocked(reason, f"no {label} is associated with this application")
        path = Path(str(value).strip())
        if not path.is_absolute():
            path = self.jht_home / path
        try:
            info = path.stat()
            if not stat.S_ISREG(info.st_mode):
                raise OSError("not a regular file")
            if info.st_size <= 0 or info.st_size > MAX_ATTACHMENT_BYTES:
                raise _blocked(reason, f"the {label} is empty or larger than {MAX_ATTACHMENT_BYTES} bytes")
            data = path.read_bytes()
        except _Stop:
            raise
        except OSError as exc:
            raise _blocked(reason, f"the {label} file cannot be read") from exc
        if not data.startswith(b"%PDF-"):
            raise _blocked(reason, f"the {label} file is not a PDF")
        return {
            "role": label,
            "filename": path.name,
            "size": len(data),
            "sha256": _sha256_bytes(data),
            "path": str(path),
        }

    def _request_cover_letter(self) -> dict[str, Any]:
        script = Path(__file__).with_name("write_request.py")
        env = {**os.environ, "JHT_DB": str(self.db_path), "JHT_HOME": str(self.jht_home)}
        try:
            result = subprocess.run(
                [sys.executable, str(script), str(self.position_id), "--mode", "on", "--kind", "cover_letter"],
                check=False,
                capture_output=True,
                text=True,
                env=env,
                timeout=30,
            )
            line = (result.stdout.strip().splitlines() or ["{}"])[-1]
            payload = json.loads(line)
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            return {"ok": False, "status_code": type(exc).__name__}
        return {"ok": bool(payload.get("ok")), "status_code": payload.get("status_code", "")}

    def _facts(self, profile: Mapping[str, Any], position: sqlite3.Row, mailto: Mailto) -> dict[str, str]:
        # jobs.db first: an answer the user gave on Telegram or on the dashboard
        # lives there. Read only: inspect and the draft write nothing; the YAML
        # answers are imported when the letter is really sent.
        with contextlib.closing(self._connect()) as conn:
            answers: dict[str, Any] = application_answers.read_answers(conn, profile, self.position_id)

        haystack = "\n".join(
            str(v) for v in (mailto.subject, mailto.body, position["jd_text"], position["requirements"]) if v
        )
        facts: dict[str, str] = {}
        for name, pattern, keys in REQUIRED_FACTS:
            if not pattern.search(haystack):
                continue
            value = next(
                (answers[k] for k in keys if isinstance(answers.get(k), str) and answers[k].strip()),
                profile.get(name) if isinstance(profile.get(name), str) else None,
            )
            if not isinstance(value, str) or not value.strip():
                raise _blocked(
                    "required_fact_missing",
                    f"the vacancy asks for `{name}` and the candidate profile does not state it",
                    fact=name,
                )
            facts[name] = " ".join(value.split())
        return facts

    def _identity(self, profile: Mapping[str, Any]) -> dict[str, str]:
        name = profile.get("name")
        contacts = profile.get("contacts") if isinstance(profile.get("contacts"), Mapping) else {}
        email_address = contacts.get("email") or profile.get("email")
        phone = contacts.get("phone")
        if not isinstance(name, str) or not name.strip():
            raise _blocked("required_fact_missing", "the candidate profile has no name", fact="name")
        if not isinstance(email_address, str) or not _ADDRESS.match(email_address.strip()):
            raise _blocked("required_fact_missing", "the candidate profile has no contact email", fact="email")
        return {
            "name": " ".join(name.split()),
            "email": email_address.strip(),
            "phone": " ".join(phone.split()) if isinstance(phone, str) else "",
        }

    def _preflight(self, *, dry_run: bool) -> dict[str, Any]:
        position, mailto, inspected = self._inspect()
        gate = self._gate()
        dry = dry_run or gate.get("mode") == "dry_run"
        # A dry run stops before the transport, so it neither needs nor reads the secret.
        settings, password = (None, "") if dry else self._transport_settings(required=True)
        cv = self._attachment(position["cv_pdf_path"], "cv_missing", "cv")
        attachments = [cv]
        haystack = "\n".join(
            str(v) for v in (mailto.subject, mailto.body, position["jd_text"], position["requirements"]) if v
        )
        cover_required = bool(
            _COVER_LETTER_REQUEST.search(haystack) and not _COVER_LETTER_NOT_REQUIRED.search(haystack)
        )
        if cover_required:
            try:
                attachments.append(self._attachment(position["cl_pdf_path"], "cover_letter_required", "cover_letter"))
            except _Stop as stop:
                stop.outcome.data["writer_request"] = self._request_cover_letter()
                raise
        profile = self._profile()
        identity = self._identity(profile)
        facts = self._facts(profile, position, mailto)
        return {
            "position": position,
            "mailto": mailto,
            "inspected": inspected,
            "gate": gate,
            "dry_run": dry,
            "settings": settings,
            "password": password,
            "attachments": attachments,
            "cover_letter_required": cover_required,
            "profile": profile,
            "identity": identity,
            "facts": facts,
        }

    def preflight(self, dry_run: bool = False) -> Outcome:
        def run() -> Outcome:
            ctx = self._preflight(dry_run=dry_run)
            return Outcome(
                "inspected",
                "preflight_passed",
                "gate, transport, attachments and facts are ready",
                {
                    **ctx["inspected"],
                    "dry_run": ctx["dry_run"],
                    "remaining_today": ctx["gate"].get("remaining_today"),
                    "attachments": [_public_attachment(a) for a in ctx["attachments"]],
                    "cover_letter_required": ctx["cover_letter_required"],
                    "transport": "configured" if ctx["settings"] else "not_checked",
                },
            )

        return self._run(run)

    # ── draft ────────────────────────────────────────────────────────────────

    def _compose(self, ctx: Mapping[str, Any]) -> dict[str, Any]:
        position = ctx["position"]
        mailto: Mailto = ctx["mailto"]
        profile = ctx["profile"]
        identity = ctx["identity"]
        facts = ctx["facts"]
        title = " ".join(str(position["title"] or "").split())
        company = " ".join(str(position["company"] or "").split())
        subject = mailto.subject or f"Application for {title}"
        if _HEADER_CONTROL.search(subject):
            raise _error("mailto_invalid", "the subject contains control characters")

        lines = [f"Dear {company} hiring team," if company else "Dear hiring team,", ""]
        lines.append(f"I would like to apply for the {title} position." if title else "I would like to apply for this position.")
        intro = []
        role = profile.get("target_role")
        years = profile.get("experience_years")
        if isinstance(role, str) and role.strip():
            if isinstance(years, int) and not isinstance(years, bool) and years > 0:
                intro.append(f"I am a {' '.join(role.split())} with {years} years of experience.")
            else:
                intro.append(f"I am a {' '.join(role.split())}.")
        skills = _skills_for(profile, "\n".join(str(v) for v in (position["jd_text"], position["requirements"]) if v))
        if skills:
            intro.append(f"My main skills include {', '.join(skills)}.")
        if intro:
            lines += ["", " ".join(intro)]
        if facts:
            lines.append("")
            labels = {"availability": "Availability", "salary_expectation": "Salary expectation"}
            lines += [f"{labels[k]}: {v}" for k, v in facts.items()]
        lines += [
            "",
            "Please find my CV attached"
            + (" together with my cover letter." if len(ctx["attachments"]) > 1 else "."),
            "",
            "Kind regards,",
            identity["name"],
            identity["email"],
        ]
        if identity["phone"]:
            lines.append(identity["phone"])
        body = "\n".join(lines) + "\n"

        recipients = [mailto.to, *mailto.cc]
        body_sha = _sha256_bytes(f"{subject}\n\n{body}".encode("utf-8"))
        authorised_at = str(position["apply_requested_at"] or "")
        key_material = json.dumps(
            {
                "position_id": self.position_id,
                "to": mailto.to,
                "cc": list(mailto.cc),
                "body_sha256": body_sha,
                "attachments": [a["sha256"] for a in ctx["attachments"]],
                "authorised_at": authorised_at,
            },
            sort_keys=True,
        )
        key = _sha256_bytes(key_material.encode("utf-8"))
        settings: TransportSettings | None = ctx["settings"]
        domain = (settings.from_address.rpartition("@")[2] if settings else "jht.invalid").lower()
        return {
            "subject": subject,
            "body": body,
            "to": mailto.to,
            "cc": list(mailto.cc),
            "recipients": recipients,
            "body_sha256": body_sha,
            "idempotency_key": key,
            "message_id": f"<jht-{self.position_id}-{key[:32]}@{domain}>",
            "attachments": ctx["attachments"],
            "facts": facts,
        }

    def _message(self, draft: Mapping[str, Any], settings: TransportSettings, identity: Mapping[str, str]) -> EmailMessage:
        message = EmailMessage()
        message["From"] = formataddr((settings.from_name or identity["name"], settings.from_address))
        message["To"] = draft["to"]
        if draft["cc"]:
            message["Cc"] = ", ".join(draft["cc"])
        message["Subject"] = draft["subject"]
        message["Message-ID"] = draft["message_id"]
        message["Date"] = formatdate(localtime=True)
        if identity["email"].lower() != settings.from_address.lower():
            message["Reply-To"] = identity["email"]
        message.set_content(draft["body"])
        for attachment in draft["attachments"]:
            data = Path(attachment["path"]).read_bytes()
            if _sha256_bytes(data) != attachment["sha256"]:
                raise _error("attachment_changed", f"the {attachment['role']} changed after the draft")
            message.add_attachment(data, maintype="application", subtype="pdf", filename=attachment["filename"])
        return message

    def _draft(self, *, dry_run: bool) -> tuple[dict[str, Any], dict[str, Any]]:
        ctx = self._preflight(dry_run=dry_run)
        draft = self._compose(ctx)
        self._ensure_schema()
        with contextlib.closing(self._connect()) as conn:
            conn.execute(
                "INSERT INTO email_application_attempts "
                "(position_id, idempotency_key, state, message_id, recipients_json, body_sha256, attachments_json) "
                "VALUES (?, ?, 'draft_ready', ?, ?, ?, ?) "
                "ON CONFLICT (position_id, idempotency_key) DO UPDATE SET "
                "message_id = excluded.message_id, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') "
                "WHERE email_application_attempts.state IN ('draft_ready', 'error')",
                (
                    self.position_id,
                    draft["idempotency_key"],
                    draft["message_id"],
                    json.dumps(draft["recipients"]),
                    draft["body_sha256"],
                    json.dumps([_public_attachment(a) for a in draft["attachments"]], sort_keys=True),
                ),
            )
            conn.commit()
        with contextlib.suppress(OSError):
            _atomic_write_json(
                self.draft_path,
                {
                    **{k: v for k, v in draft.items() if k != "attachments"},
                    "attachments": [_public_attachment(a) for a in draft["attachments"]],
                    "created_at": self.clock(),
                },
            )
        return ctx, draft

    def draft(self, dry_run: bool = False) -> Outcome:
        def run() -> Outcome:
            ctx, draft = self._draft(dry_run=dry_run)
            return Outcome("draft_ready", "draft_ready", "the draft and its attachments are valid", _public_draft(draft, ctx))

        return self._run(run)

    # ── send ─────────────────────────────────────────────────────────────────

    def _attempts(self, conn: sqlite3.Connection) -> list[sqlite3.Row]:
        return conn.execute(
            "SELECT * FROM email_application_attempts WHERE position_id = ? ORDER BY id DESC",
            (self.position_id,),
        ).fetchall()

    def _update_attempt(self, key: str, **fields: Any) -> None:
        assignments = ", ".join(f"{name} = ?" for name in fields)
        with contextlib.closing(self._connect()) as conn:
            conn.execute(
                f"UPDATE email_application_attempts SET {assignments}, "
                "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') "
                "WHERE position_id = ? AND idempotency_key = ?",
                (*fields.values(), self.position_id, key),
            )
            conn.commit()

    def _existing_send(self) -> Outcome | None:
        """A previous send decides this run: never a second letter."""
        self._ensure_schema()
        with contextlib.closing(self._connect()) as conn:
            rows = self._attempts(conn)
        for row in rows:
            state = row["state"]
            if state in ("send_started", "send_outcome_unknown"):
                if state == "send_started":
                    # A run died after `send_started`: nobody knows whether the
                    # server accepted the letter. That is the definition of unknown.
                    self._update_attempt(row["idempotency_key"], state="send_outcome_unknown", error_class="interrupted")
                return Outcome(
                    "send_outcome_unknown",
                    "send_outcome_unknown",
                    "a previous send may have reached the recruiter; it is never retried",
                    {"message_id": row["message_id"]},
                )
            if state == "receipt_incomplete":
                return self._reconcile(row)
            if state == "sent":
                return Outcome(
                    "sent",
                    "duplicate_attempt",
                    "this application was already sent by email",
                    {"message_id": row["message_id"], "accepted_at": row["accepted_at"]},
                )
        return None

    def _reconcile(self, row: sqlite3.Row) -> Outcome:
        receipt = json.loads(row["receipt_json"]) if row["receipt_json"] else None
        if not _receipt_complete(receipt):
            return Outcome(
                "receipt_incomplete",
                "receipt_incomplete",
                "the server's acceptance is not fully recorded; a human must check before anything is sent again",
                {"message_id": row["message_id"]},
            )
        try:
            self.recorder(self.position_id)
        except Exception as exc:
            self._update_attempt(row["idempotency_key"], error_class=f"record_failed:{type(exc).__name__}")
            return Outcome(
                "receipt_incomplete",
                "receipt_incomplete",
                "the email was accepted but the application could not be recorded",
                {"message_id": row["message_id"]},
            )
        self._update_attempt(row["idempotency_key"], state="sent", error_class=None)
        return Outcome(
            "sent",
            "sent",
            "the email was accepted and the application is recorded",
            {"message_id": row["message_id"], "accepted_at": receipt["accepted_at"], "receipt": receipt},
        )

    def _mark_send_started(self, key: str) -> None:
        with contextlib.closing(self._connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            blocking = conn.execute(
                "SELECT state FROM email_application_attempts WHERE position_id = ? "
                "AND state IN ('send_started', 'send_outcome_unknown', 'receipt_incomplete', 'sent')",
                (self.position_id,),
            ).fetchone()
            if blocking:
                conn.rollback()
                raise _denied("duplicate_attempt", f"another attempt is already `{blocking['state']}`")
            cursor = conn.execute(
                "UPDATE email_application_attempts SET state = 'send_started', send_started_at = ?, "
                "error_class = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') "
                "WHERE position_id = ? AND idempotency_key = ? AND state IN ('draft_ready', 'error')",
                (self.clock(), self.position_id, key),
            )
            if cursor.rowcount != 1:
                conn.rollback()
                raise _error("attempt_not_observed", "the send_started marker could not be written")
            conn.commit()
            observed = conn.execute(
                "SELECT state FROM email_application_attempts WHERE position_id = ? AND idempotency_key = ?",
                (self.position_id, key),
            ).fetchone()
        if not observed or observed["state"] != "send_started":
            raise _error("attempt_not_observed", "the send_started marker is not observable")

    def _record_applied(self, position_id: int) -> None:
        with contextlib.closing(self._connect()) as conn:
            existing = conn.execute(
                "SELECT a.applied, a.applied_via, p.status FROM positions p "
                "LEFT JOIN applications a ON a.position_id = p.id WHERE p.id = ?",
                (position_id,),
            ).fetchone()
        if existing and existing["applied"] == 1:
            if existing["applied_via"] == APPLIED_VIA and existing["status"] == "applied":
                return
            raise RuntimeError("the application is already applied through another channel")
        updater = Path(__file__).with_name("db_update.py")
        env = {**os.environ, "JHT_DB": str(self.db_path), "JHT_AGENT_NAME": "closer"}
        result = subprocess.run(
            [sys.executable, str(updater), "application", str(position_id), "--applied-at", "now", "--applied-via", APPLIED_VIA],
            check=False,
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(f"db_update rejected the applied transition (exit {result.returncode})")
        with contextlib.closing(self._connect()) as conn:
            observed = conn.execute(
                "SELECT a.applied, a.applied_at, a.applied_via, p.status FROM positions p "
                "LEFT JOIN applications a ON a.position_id = p.id WHERE p.id = ?",
                (position_id,),
            ).fetchone()
        if not (
            observed
            and observed["applied"] == 1
            and observed["applied_at"]
            and observed["applied_via"] == APPLIED_VIA
            and observed["status"] == "applied"
        ):
            raise RuntimeError("db_update returned success but the applied transition is absent")

    def _import_profile_answers(self) -> None:
        """Best effort: the letter already holds the answers, this only remembers them."""
        try:
            profile = self._profile()
            with contextlib.closing(self._connect()) as conn:
                application_answers.import_profile_answers(conn, profile)
                conn.commit()
        except (_Stop, sqlite3.Error, OSError, ValueError):
            pass

    def _send(self, dry_run: bool) -> Outcome:
        previous = self._existing_send()
        if previous is not None:
            return previous
        ctx, draft = self._draft(dry_run=dry_run)
        public = _public_draft(draft, ctx)
        if ctx["dry_run"]:
            return Outcome(
                "draft_ready",
                "dry_run",
                "dry run: the draft and attachments are valid; nothing was sent",
                {**public, "dry_run": True},
            )
        settings: TransportSettings = ctx["settings"]
        self._import_profile_answers()
        message = self._message(draft, settings, ctx["identity"])
        transport = self.transports[settings.kind](settings, ctx["password"])
        try:
            try:
                transport.open()
            except TransportAuthError as exc:
                raise _blocked("auth_failed", str(exc)) from exc
            except TransportError as exc:
                raise _error("transport_unavailable", str(exc)) from exc

            # The second decision, as late as possible: between the draft and
            # this line the user may have withdrawn or the cap may be spent.
            gate = self._gate()
            if gate.get("mode") != "authorised":
                raise _denied("gate_mode_changed", "the apply mode is no longer authorised; nothing was sent")
            # The cap, atomically: a run racing for the last slot waits for this
            # commit and is refused. From here the slot counts for the day.
            slot = apply_gate.reserve_daily_slot(
                self.position_id, "email", config_path=self.config_path, db_path=str(self.db_path)
            )
            if not slot.allowed:
                context = {k: v for k, v in slot.context.items() if k in ("max_per_day", "sent_today", "remaining_today")}
                raise _denied(slot.reason, slot.detail, gate_reason=slot.reason, **context)
            token = str(slot.context["token"])
            try:
                self._mark_send_started(draft["idempotency_key"])
            except BaseException:
                # No marker, no send: the slot goes back.
                apply_gate.release_daily_slot(token, db_path=str(self.db_path))
                raise
            try:
                refused = transport.send(message, settings.from_address, draft["recipients"])
            except RecipientsRefused as exc:
                self._update_attempt(draft["idempotency_key"], state="error", error_class="recipients_refused")
                # Refused before DATA: certainly nothing reached anyone.
                apply_gate.release_daily_slot(token, db_path=str(self.db_path))
                raise _blocked("recipient_refused", "the mail server refused the recipients; nothing was sent") from exc
            except Exception as exc:
                self._update_attempt(
                    draft["idempotency_key"], state="send_outcome_unknown", error_class=type(exc).__name__
                )
                return Outcome(
                    "send_outcome_unknown",
                    "send_outcome_unknown",
                    "the send did not end with a clear answer; it is never retried",
                    {"message_id": draft["message_id"]},
                )
        finally:
            transport.close()

        accepted_at = self.clock()
        accepted = [r for r in draft["recipients"] if r not in (refused or {})]
        receipt = {
            "channel": "email",
            "transport": settings.kind,
            "message_id": draft["message_id"],
            "accepted_at": accepted_at,
            "recipients": accepted,
            "refused": sorted((refused or {}).keys()),
            # The server's numeric reply to the letter (SMTP: 250); None for a transport without one.
            "smtp_reply_code": getattr(transport, "last_reply_code", None),
            "body_sha256": draft["body_sha256"],
            "attachments": [{"role": a["role"], "sha256": a["sha256"], "size": a["size"]} for a in draft["attachments"]],
        }
        state = "receipt_incomplete"
        try:
            self._update_attempt(
                draft["idempotency_key"],
                state="receipt_incomplete",
                message_id=draft["message_id"],
                accepted_at=accepted_at,
                receipt_json=json.dumps(receipt, sort_keys=True),
            )
            _atomic_write_json(
                self.receipt_dir / f"email-{self.position_id}-{draft['idempotency_key'][:16]}.json", receipt
            )
            state = "persisted"
        except (OSError, sqlite3.Error):
            pass
        if state != "persisted" or refused:
            return Outcome(
                "receipt_incomplete",
                "receipt_incomplete",
                (
                    "the server accepted the letter for some recipients and refused "
                    + ", ".join(receipt["refused"])
                    + ": it has probably reached the recruiter; a human must check, nothing is sent again"
                )
                if refused
                else "the server's acceptance is not complete or not recorded; a human must check",
                {"message_id": draft["message_id"], "refused": receipt["refused"]},
            )
        with contextlib.closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT * FROM email_application_attempts WHERE position_id = ? AND idempotency_key = ?",
                (self.position_id, draft["idempotency_key"]),
            ).fetchone()
        return self._reconcile(row)

    def send(self, dry_run: bool = False) -> Outcome:
        return self._run(lambda: self._send(dry_run))

    # ── status ───────────────────────────────────────────────────────────────

    def status(self) -> Outcome:
        def run() -> Outcome:
            self._ensure_schema()
            with contextlib.closing(self._connect()) as conn:
                rows = self._attempts(conn)
            saved = self._read_state()
            attempt = None
            if rows:
                row = rows[0]
                attempt = {
                    "state": row["state"],
                    "message_id": row["message_id"],
                    "recipients": json.loads(row["recipients_json"]),
                    "attachments": json.loads(row["attachments_json"]),
                    "send_started_at": row["send_started_at"],
                    "accepted_at": row["accepted_at"],
                    "error_class": row["error_class"],
                }
            unresolved = next((r["state"] for r in rows if r["state"] in ("send_started", "send_outcome_unknown", "receipt_incomplete", "sent")), None)
            state = unresolved or saved.get("state") or "inspected"
            if state not in STATES:
                state = "error"
            return Outcome(
                state,
                saved.get("reason", "") if not unresolved else unresolved,
                saved.get("detail", ""),
                {"attempt": attempt},
            )

        return self._run(run, persist=False)

    # ── plumbing ─────────────────────────────────────────────────────────────

    def _run(self, action: Callable[[], Outcome], persist: bool = True) -> Outcome:
        try:
            outcome = action()
        except _Stop as stop:
            outcome = stop.outcome
        except Exception as exc:  # the flow answers with a state, never a traceback
            outcome = Outcome("error", "internal_error", f"unexpected {type(exc).__name__}")
        if persist:
            self._write_state(outcome)
            if outcome.state in ("blocked_human", "send_outcome_unknown", "receipt_incomplete"):
                outcome.data["notified"] = self._notify_once(outcome)
        return outcome

    def _notify_once(self, outcome: Outcome) -> bool:
        saved = self._read_state()
        try:
            with contextlib.closing(self._connect()) as conn:
                row = conn.execute(
                    "SELECT title, company, apply_requested_at FROM positions WHERE id = ?",
                    (self.position_id,),
                ).fetchone()
        except (_Stop, sqlite3.Error):
            row = None
        authorised_at = row["apply_requested_at"] if row else ""
        source_id = "closer-email:{}:{}:{}".format(
            self.position_id,
            outcome.reason,
            _sha256_bytes(str(authorised_at).encode("utf-8"))[:12],
        )
        if saved.get("notified_source_id") == source_id:
            return True
        title = " ".join(str(row["title"] or "").split()) if row else ""
        company = " ".join(str(row["company"] or "").split()) if row else ""
        message = (
            f"CLOSER stopped the email application for position #{self.position_id}"
            + (f" ({title} at {company})" if title else "")
            + f": {outcome.detail} [{outcome.reason}]"
        )
        try:
            self.notifier(position_id=self.position_id, message=message, source_id=source_id)
        except Exception:
            return False
        self._write_state(outcome, {"notified_source_id": source_id})
        return True


def _public_attachment(attachment: Mapping[str, Any]) -> dict[str, Any]:
    return {k: attachment[k] for k in ("role", "filename", "size", "sha256")}


def _public_draft(draft: Mapping[str, Any], ctx: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "to": draft["to"],
        "cc": draft["cc"],
        "subject": draft["subject"],
        "body": draft["body"],
        "body_sha256": draft["body_sha256"],
        "idempotency_key": draft["idempotency_key"],
        "message_id": draft["message_id"],
        "attachments": [_public_attachment(a) for a in draft["attachments"]],
        "cover_letter_required": ctx["cover_letter_required"],
        "dry_run": ctx["dry_run"],
    }


def _receipt_complete(receipt: Any) -> bool:
    return (
        isinstance(receipt, dict)
        and bool(receipt.get("message_id"))
        and bool(receipt.get("accepted_at"))
        and bool(receipt.get("recipients"))
        and not receipt.get("refused")
        and bool(receipt.get("body_sha256"))
        and isinstance(receipt.get("attachments"), list)
        and bool(receipt["attachments"])
        and all(a.get("sha256") for a in receipt["attachments"])
    )


def _skills_for(profile: Mapping[str, Any], vacancy_text: str) -> list[str]:
    skills = profile.get("skills")
    primary = skills.get("primary") if isinstance(skills, Mapping) else None
    if not isinstance(primary, list):
        return []
    names = [" ".join(s.split()) for s in primary if isinstance(s, str) and s.strip()]
    text = vacancy_text.casefold()
    matched = [s for s in names if s.casefold() in text]
    chosen = matched or names
    return chosen[:5]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="email_application", description="Send one user-authorised application by email.")
    parser.add_argument("command", choices=("inspect", "preflight", "draft", "send", "status"))
    parser.add_argument("--position-id", type=int, required=True)
    parser.add_argument("--json", action="store_true", help="JSON output (always on; kept for the skill contract)")
    parser.add_argument("--dry-run", action="store_true", help="validate draft and attachments, stop before the transport")
    parser.add_argument("--db", default=None, help="override the SQLite path")
    parser.add_argument("--config", default=None, help="override the user config path")
    args = parser.parse_args(argv)

    flow = EmailApplication(args.position_id, db_path=args.db, config_path=args.config)
    if args.command == "inspect":
        outcome = flow.inspect()
    elif args.command == "preflight":
        outcome = flow.preflight(dry_run=args.dry_run)
    elif args.command == "draft":
        outcome = flow.draft(dry_run=args.dry_run)
    elif args.command == "send":
        outcome = flow.send(dry_run=args.dry_run)
    else:
        outcome = flow.status()
    print(json.dumps(outcome.to_dict(flow.position_id), ensure_ascii=False, sort_keys=True))
    return EXIT_CODES.get(outcome.state, 2)


if __name__ == "__main__":
    sys.exit(main())
