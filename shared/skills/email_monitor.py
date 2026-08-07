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

Config (`$JHT_HOME/credentials/email_monitor.json`):
{
  "imap_host": "imap.gmail.com",
  "imap_port": 993,
  "user": "nome.jht@gmail.com",
  "password": "<app-password>",
  "folder": "INBOX",
  "from_filters": []   # optional: empty/missing processes the whole dedicated
                       # inbox; otherwise it is a sender allowlist
}

Idempotency state lives in `$JHT_HOME/state/email_monitor_seen.json` as a set
of processed Message-IDs, so a rerun does not create duplicates.

CLI:
    python3 /app/shared/skills/email_monitor.py poll
    → stdout JSONL: one row per newly extracted job link
      {"url": "...", "source": "linkedin-email|email:<domain>", "subject": "...",
       "sender": "...", "received_at": "..."}

    python3 /app/shared/skills/email_monitor.py poll --since-days 1
    → restrict the search to messages from the last N days

    python3 /app/shared/skills/email_monitor.py count
    → count new messages by sender WITHOUT downloading their bodies

    python3 /app/shared/skills/email_monitor.py status
    → show configuration and the processed-message count
"""
from __future__ import annotations

import argparse
import email
import email.policy
import imaplib
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime, parseaddr
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
CREDS_PATH = JHT_HOME / "credentials" / "email_monitor.json"
STATE_PATH = JHT_HOME / "state" / "email_monitor_seen.json"

# Cap di link estratti da una singola email (una digest può contenerne molti):
# evita che un solo messaggio gonfi la coda con decine di candidati.
MAX_LINKS_PER_EMAIL = 25


def _load_creds() -> dict:
    if not CREDS_PATH.exists():
        return {}
    try:
        with CREDS_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _load_state() -> dict:
    if not STATE_PATH.exists():
        return {"seen_message_ids": []}
    try:
        with STATE_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"seen_message_ids": []}


def _save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    tmp.replace(STATE_PATH)


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


def _imap_connect(creds: dict):
    host = creds.get("imap_host", "imap.gmail.com")
    port = int(creds.get("imap_port", 993))
    M = imaplib.IMAP4_SSL(host, port)
    M.login(creds["user"], creds.get("password", ""))
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


def poll(since_days: int = 3) -> list[dict]:
    creds = _load_creds()
    if not creds.get("user"):
        return []

    state = _load_state()
    seen = set(state.get("seen_message_ids", []))
    new_jobs: list[dict] = []
    new_seen_msgids: list[str] = []

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

    # Idempotency: aggiungi solo i Message-ID processati con successo
    if new_seen_msgids:
        state.setdefault("seen_message_ids", []).extend(new_seen_msgids)
        # Cap a 10000 per evitare crescita illimitata
        state["seen_message_ids"] = state["seen_message_ids"][-10000:]
        _save_state(state)

    return new_jobs


def count(since_days: int = 1) -> dict:
    """Conta le NUOVE email (non ancora processate) per mittente SENZA scaricarne
    il body. Serve al Capitano per stimare il volume e bilanciare il carico."""
    creds = _load_creds()
    if not creds.get("user"):
        return {"configured": False, "new_total": 0, "by_sender": {}}

    state = _load_state()
    seen = set(state.get("seen_message_ids", []))
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
            typ, msg_data = M.fetch(uid, "(BODY.PEEK[HEADER.FIELDS (FROM MESSAGE-ID)])")
            if typ != "OK" or not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            msg = email.message_from_bytes(raw, policy=email.policy.default)
            mid = (msg.get("Message-ID", "") or "").strip()
            if not mid or mid in seen:
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


def status() -> dict:
    creds = _load_creds()
    state = _load_state()
    return {
        "configured": bool(creds.get("user")),
        "user": creds.get("user", ""),
        "host": creds.get("imap_host", ""),
        "from_filters": creds.get("from_filters", []),
        "any_platform": not bool(creds.get("from_filters")),
        "seen_count": len(state.get("seen_message_ids", [])),
        "state_path": str(STATE_PATH),
        "creds_path": str(CREDS_PATH),
        "creds_exists": CREDS_PATH.exists(),
    }


def main(argv):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    pp = sub.add_parser("poll")
    pp.add_argument("--since-days", type=int, default=3)

    cp = sub.add_parser("count")
    cp.add_argument("--since-days", type=int, default=1)

    sub.add_parser("status")

    args = p.parse_args(argv)

    if args.cmd == "poll":
        jobs = poll(args.since_days)
        for j in jobs:
            print(json.dumps(j))
        return 0

    if args.cmd == "count":
        print(json.dumps(count(args.since_days), indent=2))
        return 0

    if args.cmd == "status":
        print(json.dumps(status(), indent=2))
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
