#!/usr/bin/env python3
"""email_monitor — poll inbox IMAP, estrae link job da alert email (F-2.C).

Strategia utente (decisione 2026-05-17): l'utente crea un'email dedicata
(es. jobs+jht@gmail.com) + setta forward rules sul client primario per
inoltrare lì LinkedIn Jobs / Glassdoor / Indeed alerts. Lo Scout monta
questa skill ogni 30 min: legge nuove email, estrae i link job, push in
`positions` via db_insert.

Vantaggi:
- Aggira il cookie wall di LinkedIn (bug #2 della doc F-2): l'email
  è già "pre-filtrata sul target" dall'utente.
- Sorgente passiva: i job arrivano, lo Scout non deve indovinare keyword.
- Cross-provider: funziona uguale su Claude/Codex/Kimi (zero Playwright).

Config (`$JHT_HOME/credentials/email_monitor.json`):
{
  "imap_host": "imap.gmail.com",
  "imap_port": 993,
  "user": "jobs+jht@gmail.com",
  "password": "<app-password-google>",
  "folder": "INBOX",
  "from_filters": ["jobs-listings@linkedin.com",
                   "jobalerts-noreply@glassdoor.com",
                   "alerts@indeed.com"]
}

State idempotency in `$JHT_HOME/state/email_monitor_seen.json` con set
di Message-ID già processati — re-run safe ogni 30 min senza duplicati.

CLI:
    python3 /app/shared/skills/email_monitor.py poll
    → stdout JSONL: 1 riga per nuovo job link estratto
      {"url": "...", "title": "...", "company": "...", "source": "linkedin-email"}

    python3 /app/shared/skills/email_monitor.py poll --since-days 1
    → restringe ricerca a email degli ultimi N giorni

    python3 /app/shared/skills/email_monitor.py status
    → conta email già processate, frequenza sender, ecc.
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
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
CREDS_PATH = JHT_HOME / "credentials" / "email_monitor.json"
STATE_PATH = JHT_HOME / "state" / "email_monitor_seen.json"


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


# ── Pattern estrazione link per provider ───────────────────────────────
# Ogni alert ha formato suo. Pattern conservativi — meglio nessun link
# che link sbagliato. Lo Scout pulisce i query-string di tracking dopo.
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


def _extract_email_body(msg: email.message.Message) -> str:
    """Concatena tutti i body text/html in un singolo blob — sufficiente
    per la regex extraction (non serve render)."""
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


def _extract_jobs(body: str, sender: str) -> list[dict]:
    """Best-effort: identifica provider dal sender, applica regex."""
    sender_lc = (sender or "").lower()
    jobs = []
    seen_urls = set()

    if "linkedin" in sender_lc:
        for m in LINKEDIN_JOB_RE.finditer(body):
            jid = m.group(1)
            url = f"https://www.linkedin.com/jobs/view/{jid}"
            if url not in seen_urls:
                seen_urls.add(url)
                jobs.append({"url": url, "job_id": jid, "source": "linkedin-email"})
    if "glassdoor" in sender_lc:
        for m in GLASSDOOR_JOB_RE.finditer(body):
            url = m.group(0).rstrip(".,);")
            if url not in seen_urls:
                seen_urls.add(url)
                jobs.append({"url": url, "source": "glassdoor-email"})
    if "indeed" in sender_lc:
        for m in INDEED_JOB_RE.finditer(body):
            url = m.group(0).rstrip(".,);")
            if url not in seen_urls:
                seen_urls.add(url)
                jobs.append({"url": url, "source": "indeed-email"})

    return jobs


def poll(since_days: int = 3) -> list[dict]:
    creds = _load_creds()
    if not creds.get("user"):
        return []

    state = _load_state()
    seen = set(state.get("seen_message_ids", []))
    new_jobs: list[dict] = []
    new_seen_msgids: list[str] = []

    host = creds.get("imap_host", "imap.gmail.com")
    port = int(creds.get("imap_port", 993))
    user = creds["user"]
    password = creds.get("password", "")
    folder = creds.get("folder", "INBOX")
    from_filters = creds.get("from_filters") or [
        "jobs-listings@linkedin.com",
        "jobalerts-noreply@glassdoor.com",
        "alerts@indeed.com",
    ]

    since_dt = datetime.now(timezone.utc) - timedelta(days=since_days)
    since_imap = since_dt.strftime("%d-%b-%Y")

    M = imaplib.IMAP4_SSL(host, port)
    try:
        M.login(user, password)
        M.select(folder, readonly=True)
        # FROM ... OR encadeniati. Singola query per filtro per semplicità,
        # accumuliamo i risultati.
        all_uids: list[bytes] = []
        for from_addr in from_filters:
            typ, data = M.search(None, "(FROM", f'"{from_addr}"', "SINCE", since_imap + ")")
            if typ == "OK" and data and data[0]:
                all_uids.extend(data[0].split())
        # Dedup UIDs
        all_uids = sorted(set(all_uids))
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
            body = _extract_email_body(msg)
            jobs = _extract_jobs(body, sender)
            for j in jobs:
                j["received_at"] = (
                    parsedate_to_datetime(msg.get("Date", "")).isoformat()
                    if msg.get("Date") else datetime.now(timezone.utc).isoformat()
                )
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


def status() -> dict:
    creds = _load_creds()
    state = _load_state()
    return {
        "configured": bool(creds.get("user")),
        "user": creds.get("user", ""),
        "host": creds.get("imap_host", ""),
        "from_filters": creds.get("from_filters", []),
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

    sub.add_parser("status")

    args = p.parse_args(argv)

    if args.cmd == "poll":
        jobs = poll(args.since_days)
        for j in jobs:
            print(json.dumps(j))
        return 0

    if args.cmd == "status":
        print(json.dumps(status(), indent=2))
        return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
