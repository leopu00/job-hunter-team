#!/usr/bin/env python3
"""email_monitor — poll IMAP and extract job links from email alerts (F-2.C).

The user creates a DEDICATED inbox and forwards job alerts to it from any
platform, not only LinkedIn, Glassdoor, or Indeed. At the start of the day the
Scout reads new messages, extracts job links, and adds positions through
db_insert.

Benefits:
- Bypasses LinkedIn's cookie wall because alerts are already filtered by the
  user.
- Passive source: jobs arrive without the Scout guessing keywords.
- Cross-provider: identical behavior on Claude, Codex, and Kimi.
- Any platform: the dedicated inbox processes every sender by default. Known
  providers use precise extraction; unknown providers use bounded generic
  extraction that the Scout validates.

The mailbox account lives in the portal-secrets broker (container
`jht-broker`, P1 of 08/10), never in `/jht_home`: the host saves it with
`jht mail setup`. This file has two halves:

- the IMAP/SMTP core (`poll_mailbox`, `count_mailbox`, `send_message`), which
  takes the account as an argument and runs inside the broker;
- the CLI the agents call, which only sends a request to the broker and
  prints the answer. The broker filters and reduces what comes back (no
  reset links, codes or sign-in mail), and the seen Message-IDs live in its
  state.

CLI (agents):
    python3 /app/shared/skills/email_monitor.py poll [--since-days N]
    → stdout JSONL: one row per newly extracted job link
      {"url": "...", "source": "linkedin-email|email:<domain>", "subject": "...",
       "sender": "...", "received_at": "..."}
      URLs come back without fragment, without query (except the offer id),
      and without token-like path segments; codes in the subject are masked.

    python3 /app/shared/skills/email_monitor.py count [--since-days N]
    → count new messages by sender WITHOUT downloading their bodies

    python3 /app/shared/skills/email_monitor.py status
    → whether a mailbox is configured, its address and its admission policy

    python3 /app/shared/skills/email_monitor.py send --to <addr> --subject <s> --body-file <f>
    → a draft the user approves in the desktop or with `jht mail approve`;
      a mail to the mailbox's own address goes out at once. stdout is one
      JSON line with ok, status (`pending_user_approval` or `sent`) and, on
      failure, a fixed reason code.

Nothing in this file opens a credentials file (audit G1): the account
reaches the core only as an argument, inside the broker.
"""
from __future__ import annotations

import argparse
import email
import email.policy
import imaplib
import json
import os
import re
import smtplib
import ssl
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import make_msgid, parsedate_to_datetime, parseaddr
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from url_guard import is_fetchable  # noqa: E402  (dopo sys.path, per costruzione)

# Cap di link estratti da una singola email (una digest può contenerne molti):
# evita che un solo messaggio gonfi la coda con decine di candidati.
MAX_LINKS_PER_EMAIL = 25


# ── Pattern estrazione link per provider NOTO ──────────────────────────────
# Ogni alert ha formato suo. Pattern conservativi — meglio nessun link che link
# sbagliato. Lo Scout pulisce i query-string di tracking dopo.
LINKEDIN_JOB_RE = re.compile(
    r"https?://(?:www\.)?linkedin\.com/(?:comm/)?jobs/view/(\d+)",
    re.I,
)
GLASSDOOR_JOB_RE = re.compile(
    r"https?://(?:www\.)?glassdoor\.[a-z\.]+/(?:job/|partner/jobListing\.htm[^\"\s<]*)",
    re.I,
)
INDEED_JOB_RE = re.compile(
    r"https?://(?:www\.)?indeed\.(?:com|it|de|fr)/(?:rc/clk\?|viewjob\?jk=)[^\"\s<]+",
    re.I,
)

# ── Estrazione GENERICA per qualsiasi altra piattaforma ────────────────────
# Tutti gli href dell'email; poi teniamo solo quelli che "sembrano" un annuncio
# e scartiamo il rumore tipico delle newsletter. Multilingua di proposito
# (board nazionali): IT/EN/DE/FR/ES/PT.
ANY_URL_RE = re.compile(r"""https?://[^\s"'<>)\]]+""", re.I)

# Hint che un link sia un annuncio/posizione (path o query).
JOB_HINT_RE = re.compile(
    r"(?:"
    r"job|jobs|career|careers|vacanc|position|posting|opening|hiring|apply|"
    r"offerta|offerte|lavoro|annunci|posizione|"          # IT
    r"stelle|stellenangebot|bewerb|"                       # DE
    r"emploi|offre|poste|carriere|"                        # FR
    r"empleo|oferta|vacante|trabajo|"                      # ES/PT
    r"emprego|vaga|"                                        # PT
    r"gh_jid|greenhouse\.io|lever\.co|myworkdayjobs|workable|smartrecruiters|"
    r"recruitee|personio|ashbyhq|teamtailor|jobvite|icims|breezy"
    r")",
    re.I,
)

# Rumore da scartare sempre (footer newsletter, asset, social, tracking).
JUNK_RE = re.compile(
    r"(?:"
    r"unsubscribe|opt[-_]?out|email[-_]?prefs|preferences|notification[-_]?settings|"
    r"privacy|terms|/help|/support|/about|/legal|cookie|"
    r"\.(?:png|jpe?g|gif|svg|css|js|woff2?)(?:\?|$)|"
    r"facebook\.com|twitter\.com|x\.com/|instagram\.com|youtube\.com|"
    r"play\.google\.com|apps\.apple\.com|itunes\.apple\.com|"
    r"/account|/settings|/unsubscribe"
    r")",
    re.I,
)


def _sender_domain(sender: str) -> str:
    """morgan@jobs-listings.linkedin.com -> linkedin.com (best-effort)."""
    addr = parseaddr(sender or "")[1]
    dom = addr.split("@")[-1].lower() if "@" in addr else ""
    parts = [p for p in dom.split(".") if p]
    if len(parts) >= 2:
        return ".".join(parts[-2:])
    return dom


def _extract_email_body(msg: email.message.Message) -> str:
    """Concatena tutti i body text/html in un singolo blob — sufficiente per la
    regex extraction (non serve render)."""
    parts = []
    for part in msg.walk():
        ctype = part.get_content_type()
        if ctype not in ("text/plain", "text/html"):
            continue
        try:
            payload = part.get_content()
            if isinstance(payload, bytes):
                payload = payload.decode("utf-8", errors="ignore")
            parts.append(payload)
        except Exception:
            continue
    return "\n".join(parts)


def _extract_generic(body: str, domain: str) -> list[dict]:
    """Per mittenti SCONOSCIUTI: tutti gli href che sembrano un annuncio, meno il
    rumore. Source = email:<domain>. Conservativo + cappato; lo Scout valida."""
    jobs: list[dict] = []
    seen_urls: set[str] = set()
    for m in ANY_URL_RE.finditer(body):
        url = m.group(0).rstrip(".,);'\"")
        if url in seen_urls:
            continue
        if JUNK_RE.search(url):
            continue
        if not JOB_HINT_RE.search(url):
            continue
        # La barriera d'ingresso di questo canale e' conoscere l'indirizzo
        # della casella: chi scrive la mail sceglie la destinazione, e chi la
        # scarica e' lo Scout, da dentro il container, dove `192.168.x`,
        # `127.0.0.1` e i metadati su `169.254.169.254` esistono. Il filtro
        # sta qui perche' e' deterministico: non chiede a un modello di
        # riconoscere un indirizzo interno, e non lo emette proprio.
        if not is_fetchable(url):
            continue
        seen_urls.add(url)
        jobs.append({"url": url, "source": f"email:{domain}" if domain else "email"})
        if len(jobs) >= MAX_LINKS_PER_EMAIL:
            break
    return jobs


def _extract_jobs(body: str, sender: str) -> list[dict]:
    """Identifica il provider dal sender: estrazione PRECISA per i noti, GENERICA
    per gli altri (any-platform)."""
    sender_lc = (sender or "").lower()
    jobs: list[dict] = []
    seen_urls: set[str] = set()

    def _add(url: str, source: str, **extra):
        if url in seen_urls:
            return
        # Anche i rami dei mittenti noti passano di qui. Oggi non ne hanno
        # bisogno — LinkedIn ricostruisce l'URL dal codice, Glassdoor e Indeed
        # hanno il dominio dentro la regex — ma la porta d'uscita e' una sola,
        # e un ramo aggiunto domani eredita il controllo invece di doverselo
        # ricordare.
        if not is_fetchable(url):
            return
        seen_urls.add(url)
        rec = {"url": url, "source": source}
        rec.update(extra)
        jobs.append(rec)

    known = False
    if "linkedin" in sender_lc:
        known = True
        for m in LINKEDIN_JOB_RE.finditer(body):
            jid = m.group(1)
            _add(f"https://www.linkedin.com/jobs/view/{jid}", "linkedin-email", job_id=jid)
    if "glassdoor" in sender_lc:
        known = True
        for m in GLASSDOOR_JOB_RE.finditer(body):
            _add(m.group(0).rstrip(".,);"), "glassdoor-email")
    if "indeed" in sender_lc:
        known = True
        for m in INDEED_JOB_RE.finditer(body):
            _add(m.group(0).rstrip(".,);"), "indeed-email")

    # Mittente sconosciuto → estrazione generica (any-platform).
    if not known:
        for j in _extract_generic(body, _sender_domain(sender)):
            _add(j["url"], j["source"])

    return jobs[:MAX_LINKS_PER_EMAIL]


class CredentialsEncodingError(Exception):
    """The stored login has characters the protocol cannot send. Raised with
    a fixed message and no chained exception: a UnicodeEncodeError names the
    character and its position, i.e. a piece of the password."""

    def __init__(self) -> None:
        super().__init__("credentials_unsupported_characters")


def _imap_connect(creds: dict):
    host = creds.get("imap_host", "imap.gmail.com")
    port = int(creds.get("imap_port", 993))
    M = imaplib.IMAP4_SSL(host, port)
    try:
        M.login(creds["user"], creds.get("password", ""))
    except UnicodeError:
        try:
            M.logout()
        except Exception:
            pass
        raise CredentialsEncodingError() from None
    return M


def _search_uids(M, from_filters: list[str], since_imap: str) -> list[bytes]:
    """from_filters non vuoto = allow-list per mittente; vuoto = TUTTA la casella
    (inbox dedicata, any-platform)."""
    uids: list[bytes] = []
    if from_filters:
        for from_addr in from_filters:
            typ, data = M.search(None, "(FROM", f'"{from_addr}"', "SINCE", since_imap + ")")
            if typ == "OK" and data and data[0]:
                uids.extend(data[0].split())
    else:
        typ, data = M.search(None, "(SINCE", since_imap + ")")
        if typ == "OK" and data and data[0]:
            uids.extend(data[0].split())
    return sorted(set(uids))


def poll_mailbox(creds: dict, seen: set[str], since_days: int, gate=None) -> tuple[list[dict], list[str], int]:
    """(jobs, newly seen Message-IDs, withheld count). The IMAP core, with the
    account passed in: the broker calls it with the account from its own
    volume and a `gate(msg, sender, subject, body) -> bool` that decides
    whether a message may be opened for extraction (P1 portal secrets).

    A withheld message is still marked as seen, so it is not fetched again."""
    new_jobs: list[dict] = []
    new_seen_msgids: list[str] = []
    withheld = 0

    folder = creds.get("folder", "INBOX")
    from_filters = creds.get("from_filters") or []

    since_dt = datetime.now(timezone.utc) - timedelta(days=since_days)
    since_imap = since_dt.strftime("%d-%b-%Y")

    M = _imap_connect(creds)
    try:
        M.select(folder, readonly=True)
        all_uids = _search_uids(M, from_filters, since_imap)
        for uid in all_uids:
            typ, msg_data = M.fetch(uid, "(RFC822)")
            if typ != "OK" or not msg_data or not msg_data[0]:
                continue
            raw_bytes = msg_data[0][1]
            msg = email.message_from_bytes(raw_bytes, policy=email.policy.default)
            mid = msg.get("Message-ID", "").strip()
            if not mid or mid in seen:
                continue
            sender = msg.get("From", "")
            subject = (msg.get("Subject", "") or "").strip()
            body = _extract_email_body(msg)
            if gate is not None and not gate(msg, sender, subject, body):
                withheld += 1
                new_seen_msgids.append(mid)
                continue
            jobs = _extract_jobs(body, sender)
            received_at = (
                parsedate_to_datetime(msg.get("Date", "")).isoformat()
                if msg.get("Date") else datetime.now(timezone.utc).isoformat()
            )
            for j in jobs:
                j["subject"] = subject
                j["sender"] = parseaddr(sender)[1] or sender
                j["received_at"] = received_at
                new_jobs.append(j)
            new_seen_msgids.append(mid)
    finally:
        try:
            M.logout()
        except Exception:
            pass
    return new_jobs, new_seen_msgids, withheld


def count_mailbox(creds: dict, seen: set[str], since_days: int = 1, admit=None) -> dict:
    """Conta le NUOVE email (non ancora processate) per mittente SENZA scaricarne
    il body. Serve al Capitano per stimare il volume e bilanciare il carico.
    Account passato dal chiamante (il broker). `admit(msg) -> bool` sugli
    header decide se un messaggio entra nel conto: il broker ci passa la sua
    admission, così il conto non rivela i mittenti di una casella personale
    (audit M6). Senza `admit` non conta niente."""
    folder = creds.get("folder", "INBOX")
    from_filters = creds.get("from_filters") or []
    since_dt = datetime.now(timezone.utc) - timedelta(days=since_days)
    since_imap = since_dt.strftime("%d-%b-%Y")

    by_sender: Counter = Counter()
    new_total = 0
    M = _imap_connect(creds)
    try:
        M.select(folder, readonly=True)
        all_uids = _search_uids(M, from_filters, since_imap)
        for uid in all_uids:
            # Solo header: From + Message-ID, niente body (economico).
            typ, msg_data = M.fetch(uid, "(BODY.PEEK[HEADER.FIELDS (FROM MESSAGE-ID IN-REPLY-TO REFERENCES)])")
            if typ != "OK" or not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw, policy=email.policy.default)
            mid = (msg.get("Message-ID", "") or "").strip()
            if not mid or mid in seen:
                continue
            if admit is None or not admit(msg):
                continue
            new_total += 1
            by_sender[_sender_domain(msg.get("From", ""))] += 1
    finally:
        try:
            M.logout()
        except Exception:
            pass

    return {
        "configured": True,
        "since_days": since_days,
        "new_total": new_total,
        "by_sender": dict(by_sender.most_common()),
    }


MAX_RECIPIENTS = 10
_ADDRESS = re.compile(r"^[^@\s<>,;\"]+@[^@\s<>,;\"]+\.[^@\s<>,;\"]+$")
MAX_BODY_BYTES = 200_000


def _smtp_endpoint(creds: dict) -> tuple[str, int]:
    """SMTP host/port of the configured account: explicit smtp_host/smtp_port,
    otherwise derived from the IMAP host (imap.<domain> → smtp.<domain>, 465)."""
    host = str(creds.get("smtp_host") or "").strip()
    if not host:
        imap_host = str(creds.get("imap_host") or "imap.gmail.com").strip()
        host = "smtp." + imap_host[5:] if imap_host.startswith("imap.") else imap_host
    return host, int(creds.get("smtp_port") or 465)


def send_message(creds: dict, to: list[str], subject: str, body: str) -> dict:
    """Send one plain-text email from the account passed in (the broker's).
    The result is safe to print: no password, no server text, only a fixed
    reason code."""
    if not creds.get("user") or not creds.get("password"):
        return {"ok": False, "reason": "not_configured"}
    if not to or any(not _ADDRESS.match(addr) for addr in to):
        return {"ok": False, "reason": "invalid_recipient"}
    if len(to) > MAX_RECIPIENTS:
        return {"ok": False, "reason": "too_many_recipients"}
    if "\r" in subject or "\n" in subject:
        return {"ok": False, "reason": "invalid_subject"}
    if len(body.encode("utf-8")) > MAX_BODY_BYTES:
        return {"ok": False, "reason": "body_too_large"}

    msg = EmailMessage()
    msg["From"] = creds["user"]
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid()
    msg.set_content(body)

    host, port = _smtp_endpoint(creds)
    context = ssl.create_default_context()
    try:
        if port == 587:
            with smtplib.SMTP(host, port, timeout=30) as smtp:
                smtp.starttls(context=context)
                smtp.login(creds["user"], creds["password"])
                smtp.send_message(msg)
        else:
            with smtplib.SMTP_SSL(host, port, context=context, timeout=30) as smtp:
                smtp.login(creds["user"], creds["password"])
                smtp.send_message(msg)
    except UnicodeError:
        # A non-ASCII password (or address) the server cannot take. The
        # exception names the character and its position: never shown.
        return {"ok": False, "reason": "encoding_unsupported"}
    except smtplib.SMTPAuthenticationError:
        return {"ok": False, "reason": "auth_failed"}
    except smtplib.SMTPRecipientsRefused:
        return {"ok": False, "reason": "recipient_refused"}
    except (smtplib.SMTPException, OSError):
        return {"ok": False, "reason": "smtp_unavailable"}
    return {"ok": True, "to": to, "subject": subject, "message_id": msg["Message-ID"]}


def _is_secret_path(path: str) -> bool:
    """A body file inside the portal secrets: credentials/ or .cache/linkedin/,
    anywhere, after resolving links — sending one would mail the secret out."""
    parts = Path(path).resolve().parts
    return (
        "credentials" in parts
        or (bool(parts) and parts[-1] == "storage-state.json")
        or any(a == ".cache" and b == "linkedin" for a, b in zip(parts, parts[1:]))
    )


def _broker_call(op: str, args: dict) -> dict:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from broker.client import call

    return call(op, args)


def main(argv):
    """Agent side (P1 portal secrets, phase 1a): every command is a request to
    the broker, which holds the account. Nothing here reads credentials."""
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    pp = sub.add_parser("poll")
    pp.add_argument("--since-days", type=int, default=3)

    cp = sub.add_parser("count")
    cp.add_argument("--since-days", type=int, default=1)

    sub.add_parser("status")

    sp = sub.add_parser("send")
    sp.add_argument("--to", action="append", required=True)
    sp.add_argument("--subject", required=True)
    body = sp.add_mutually_exclusive_group()
    body.add_argument("--body")
    body.add_argument("--body-file")

    args = p.parse_args(argv)

    if args.cmd == "poll":
        answer = _broker_call("mail.poll", {"since_days": args.since_days})
        if not answer.get("ok"):
            print(json.dumps(answer), file=sys.stderr)
            return 1
        for j in answer.get("jobs", []):
            print(json.dumps(j))
        if answer.get("withheld"):
            print(json.dumps({"withheld": answer["withheld"]}), file=sys.stderr)
        return 0

    # status and count keep `configured` even when the broker refuses or is
    # down: the Scout's and the Captain's prompts decide on that field
    # (`configured=false` → source from the web).
    if args.cmd == "count":
        answer = _broker_call("mail.count", {"since_days": args.since_days})
        if not answer.get("ok"):
            answer = {**answer, "configured": False, "new_total": 0, "by_sender": {}}
        print(json.dumps(answer, indent=2))
        return 0 if answer.get("ok") else 1

    # status reports a state: a broker that is down or refuses is a mailbox
    # that is not available, said with its reason, not a failed command.
    if args.cmd == "status":
        answer = _broker_call("mail.status", {})
        if not answer.get("ok"):
            answer = {"ok": True, "configured": False, "unavailable": answer.get("reason", "broker_unavailable")}
        print(json.dumps(answer, indent=2))
        return 0

    if args.cmd == "send":
        if args.body is not None:
            text = args.body
        elif args.body_file:
            if _is_secret_path(args.body_file):
                print(json.dumps({"ok": False, "reason": "body_file_forbidden"}))
                return 1
            try:
                text = Path(args.body_file).read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                print(json.dumps({"ok": False, "reason": "body_unreadable"}))
                return 1
        else:
            text = sys.stdin.read()
        answer = _broker_call("mail.send", {"kind": "chat", "to": args.to, "subject": args.subject, "body": text})
        print(json.dumps(answer, ensure_ascii=False))
        return 0 if answer.get("ok") else 1
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
