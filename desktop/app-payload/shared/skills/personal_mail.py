#!/usr/bin/env python3
"""
Lettore email personale via IMAP — Job Hunter Team

Legge email dall'account configurato per aggiornare lo status
delle candidature (risposte aziende, colloqui, rejection, etc.)

Uso:
  python3 personal_mail.py recent                  # Ultime 7 giorni
  python3 personal_mail.py recent --days 14        # Ultime 2 settimane
  python3 personal_mail.py search "azienda"        # Cerca per keyword
  python3 personal_mail.py read <uid>              # Leggi email specifica
  python3 personal_mail.py senders                 # Lista mittenti unici (ultimi 14gg)
  python3 personal_mail.py archive-preview 3677 3676 3671  # Preview archiviazione (dry-run)
  python3 personal_mail.py archive 3677 3676 3671          # Archivia email (rimuovi da inbox)
  python3 personal_mail.py archive-sender "info@azienda.com"  # Archivia TUTTE le email da un mittente
  python3 personal_mail.py archive-sender "info@azienda.com" --dry-run  # Preview

NOTA: Tutti gli ID mostrati e accettati sono IMAP UID (stabili, non cambiano dopo archiviazione).

Variabili d'ambiente:
  JH_PERSONAL_EMAIL    — indirizzo email
  JH_PERSONAL_PASSWORD — app password Gmail (o altro provider IMAP)
  JH_IMAP_SERVER       — server IMAP (default: imap.gmail.com)
  JH_IMAP_PORT         — porta IMAP (default: 993)
"""

import imaplib
import email
from email.header import decode_header
import os
import sys
import re
from datetime import datetime, timedelta


EMAIL = os.environ.get("JH_PERSONAL_EMAIL", "")
PASSWORD = os.environ.get("JH_PERSONAL_PASSWORD", "")
IMAP_SERVER = os.environ.get("JH_IMAP_SERVER", "imap.gmail.com")
IMAP_PORT = int(os.environ.get("JH_IMAP_PORT", "993"))


def connect():
    """Connessione IMAP sicura."""
    if not EMAIL or not PASSWORD:
        print("Errore: JH_PERSONAL_EMAIL e JH_PERSONAL_PASSWORD non configurate.")
        print("Imposta le variabili d'ambiente nel tuo .env:")
        print("  JH_PERSONAL_EMAIL=tuo@email.com")
        print("  JH_PERSONAL_PASSWORD=app-password-qui")
        sys.exit(1)
    mail = imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT)
    mail.login(EMAIL, PASSWORD)
    return mail


def decode_hdr(raw):
    """Decodifica header email (Subject, From, etc.)."""
    if not raw:
        return ""
    parts = decode_header(raw)
    decoded = []
    for part, charset in parts:
        if isinstance(part, bytes):
            decoded.append(part.decode(charset or "utf-8", errors="replace"))
        else:
            decoded.append(part)
    return " ".join(decoded)


def get_body_text(msg):
    """Estrai body come testo pulito (preferisci text/plain, fallback HTML stripped)."""
    plain = ""
    html = ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            charset = part.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            if ctype == "text/plain":
                plain += text
            elif ctype == "text/html" and not plain:
                html = text
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            if msg.get_content_type() == "text/html":
                html = text
            else:
                plain = text

    if plain:
        return plain.strip()

    # Fallback: strip HTML tags
    if html:
        clean = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)
        clean = re.sub(r'<script[^>]*>.*?</script>', '', clean, flags=re.DOTALL)
        clean = re.sub(r'<br\s*/?>', '\n', clean, flags=re.IGNORECASE)
        clean = re.sub(r'</p>', '\n', clean, flags=re.IGNORECASE)
        clean = re.sub(r'<[^>]+>', '', clean)
        clean = re.sub(r'\n{3,}', '\n\n', clean)
        clean = re.sub(r' {2,}', ' ', clean)
        return clean.strip()

    return ""


def recent_emails(days=7, limit=50):
    """Mostra email recenti (ultime N giorni). Usa UID stabili."""
    mail = connect()
    mail.select("INBOX", readonly=True)

    since_date = (datetime.now() - timedelta(days=days)).strftime("%d-%b-%Y")
    status, data = mail.uid('search', None, f'(SINCE "{since_date}")')

    if status != "OK" or not data[0]:
        print(f"Nessuna email trovata negli ultimi {days} giorni.")
        mail.logout()
        return

    uids = data[0].split()
    print(f"Trovate {len(uids)} email negli ultimi {days} giorni.\n")

    for uid in reversed(uids[-limit:]):
        status, msg_data = mail.uid('fetch', uid, "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])")
        if status != "OK":
            continue
        header = email.message_from_bytes(msg_data[0][1])
        subject = decode_hdr(header.get("Subject", ""))
        sender = decode_hdr(header.get("From", ""))
        date = header.get("Date", "")

        try:
            dt = email.utils.parsedate_to_datetime(date)
            date_short = dt.strftime("%d/%m %H:%M")
        except Exception:
            date_short = date[:16] if date else "?"

        subj_lower = subject.lower()
        sender_lower = sender.lower()
        marker = "  "
        hr_keywords = ["application", "candidatura", "interview", "colloquio",
                       "offer", "offerta", "rejection", "regret", "unfortunately",
                       "pleased", "congratulations", "next steps", "assessment",
                       "hiring", "recruiter", "talent", "hr ", "people",
                       "greenhouse", "lever", "workable", "bamboohr", "ashby"]
        if any(k in subj_lower or k in sender_lower for k in hr_keywords):
            marker = "**"

        print(f"  {marker} [{uid.decode():>6s}] {date_short}  {sender[:45]:45s}  {subject[:70]}")

    mail.logout()


def search_emails(query, days=30):
    """Cerca email per keyword nel subject o body. Usa UID stabili."""
    mail = connect()
    mail.select("INBOX", readonly=True)

    since_date = (datetime.now() - timedelta(days=days)).strftime("%d-%b-%Y")
    status, data = mail.uid('search', None, f'(SINCE "{since_date}" BODY "{query}")')

    if status != "OK" or not data[0]:
        status, data = mail.uid('search', None, f'(SINCE "{since_date}" SUBJECT "{query}")')

    if status != "OK" or not data[0]:
        print(f'Nessuna email trovata con "{query}" negli ultimi {days} giorni.')
        mail.logout()
        return

    uids = data[0].split()
    print(f'Trovate {len(uids)} email con "{query}" (ultimi {days}gg).\n')

    for uid in reversed(uids[-30:]):
        status, msg_data = mail.uid('fetch', uid, "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])")
        if status != "OK":
            continue
        header = email.message_from_bytes(msg_data[0][1])
        subject = decode_hdr(header.get("Subject", ""))
        sender = decode_hdr(header.get("From", ""))
        date = header.get("Date", "")

        try:
            dt = email.utils.parsedate_to_datetime(date)
            date_short = dt.strftime("%d/%m %H:%M")
        except Exception:
            date_short = date[:16] if date else "?"

        print(f"  [{uid.decode():>6s}] {date_short}  {sender[:45]:45s}  {subject[:70]}")

    mail.logout()


def read_email(uid):
    """Leggi email specifica per UID — mostra contenuto completo."""
    mail = connect()
    mail.select("INBOX", readonly=True)

    uid_bytes = uid.encode() if isinstance(uid, str) else uid
    status, data = mail.uid('fetch', uid_bytes, "(RFC822)")
    if status != "OK":
        print(f"Email UID {uid} non trovata.")
        mail.logout()
        return

    raw = data[0][1]
    msg = email.message_from_bytes(raw)

    subject = decode_hdr(msg.get("Subject", ""))
    sender = decode_hdr(msg.get("From", ""))
    date = msg.get("Date", "")
    to = decode_hdr(msg.get("To", ""))

    print(f"Subject: {subject}")
    print(f"From:    {sender}")
    print(f"To:      {to}")
    print(f"Date:    {date}")
    print("=" * 70)

    body = get_body_text(msg)
    if body:
        if len(body) > 5000:
            print(body[:5000])
            print(f"\n... [troncato, totale {len(body)} caratteri]")
        else:
            print(body)
    else:
        print("(email vuota o formato non supportato)")

    mail.logout()


def list_senders(days=14):
    """Lista mittenti unici degli ultimi N giorni — utile per trovare aziende."""
    mail = connect()
    mail.select("INBOX", readonly=True)

    since_date = (datetime.now() - timedelta(days=days)).strftime("%d-%b-%Y")
    status, data = mail.uid('search', None, f'(SINCE "{since_date}")')

    if status != "OK" or not data[0]:
        print(f"Nessuna email negli ultimi {days} giorni.")
        mail.logout()
        return

    uids = data[0].split()
    senders = {}

    for uid in uids:
        status, msg_data = mail.uid('fetch', uid, "(BODY.PEEK[HEADER.FIELDS (FROM)])")
        if status != "OK":
            continue
        header = email.message_from_bytes(msg_data[0][1])
        sender = decode_hdr(header.get("From", ""))
        if sender:
            senders[sender] = senders.get(sender, 0) + 1

    print(f"Mittenti unici (ultimi {days}gg): {len(senders)}\n")
    for sender, count in sorted(senders.items(), key=lambda x: -x[1]):
        print(f"  {count:3d}x  {sender[:80]}")

    mail.logout()


def archive_emails(uids):
    """Archivia email specifiche per UID (rimuovi da INBOX, restano in All Mail)."""
    if not uids:
        print("Nessun UID specificato.")
        return

    mail = connect()
    mail.select("INBOX")

    archived = 0
    for uid in uids:
        uid_bytes = uid.encode() if isinstance(uid, str) else uid
        status, data = mail.uid('fetch', uid_bytes, "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM)])")
        if status != "OK" or data[0] is None:
            print(f"  UID {uid}: non trovata, skip")
            continue

        header = email.message_from_bytes(data[0][1])
        subject = decode_hdr(header.get("Subject", ""))[:60]
        sender = decode_hdr(header.get("From", ""))[:40]

        mail.uid('store', uid_bytes, '+FLAGS', '\\Deleted')
        archived += 1
        print(f"  UID {uid}: archiviata — {sender} — {subject}")

    mail.expunge()
    mail.logout()
    print(f"\nArchiviate {archived}/{len(uids)} email.")


def archive_preview(uids):
    """Mostra quali email verrebbero archiviate (dry-run)."""
    mail = connect()
    mail.select("INBOX", readonly=True)

    print(f"Preview archiviazione ({len(uids)} email):\n")
    for uid in uids:
        uid_bytes = uid.encode() if isinstance(uid, str) else uid
        status, data = mail.uid('fetch', uid_bytes, "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])")
        if status != "OK" or data[0] is None:
            print(f"  UID {uid}: non trovata")
            continue
        header = email.message_from_bytes(data[0][1])
        subject = decode_hdr(header.get("Subject", ""))[:70]
        sender = decode_hdr(header.get("From", ""))[:45]
        print(f"  [{uid:>6s}] {sender:45s}  {subject}")

    mail.logout()
    print(f"\nUsa 'archive {' '.join(uids)}' per confermare.")


def archive_by_sender(sender_pattern, dry_run=False):
    """Archivia TUTTE le email da un mittente specifico."""
    mail = connect()
    if dry_run:
        mail.select("INBOX", readonly=True)
    else:
        mail.select("INBOX")

    status, data = mail.uid('search', None, f'(FROM "{sender_pattern}")')

    if status != "OK" or not data[0]:
        print(f'Nessuna email trovata da "{sender_pattern}".')
        mail.logout()
        return

    uids = data[0].split()
    action = "DA ARCHIVIARE (dry-run)" if dry_run else "ARCHIVIATE"
    print(f'{action}: {len(uids)} email da "{sender_pattern}"\n')

    archived = 0
    for uid in uids:
        status, msg_data = mail.uid('fetch', uid, "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])")
        if status != "OK" or msg_data[0] is None:
            continue

        header = email.message_from_bytes(msg_data[0][1])
        subject = decode_hdr(header.get("Subject", ""))[:60]
        sender = decode_hdr(header.get("From", ""))[:45]
        date = header.get("Date", "")
        try:
            dt = email.utils.parsedate_to_datetime(date)
            date_short = dt.strftime("%d/%m %H:%M")
        except Exception:
            date_short = "?"

        if not dry_run:
            mail.uid('store', uid, '+FLAGS', '\\Deleted')

        archived += 1
        prefix = "  [DRY]" if dry_run else "  ok"
        print(f"{prefix} [{uid.decode():>6s}] {date_short}  {sender:45s}  {subject}")

    if not dry_run:
        mail.expunge()

    mail.logout()
    print(f"\n{'Preview' if dry_run else 'Archiviate'}: {archived} email.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]

    if cmd == "recent":
        days = 7
        if "--days" in sys.argv:
            idx = sys.argv.index("--days")
            if idx + 1 < len(sys.argv):
                days = int(sys.argv[idx + 1])
        recent_emails(days)

    elif cmd == "search" and len(sys.argv) > 2:
        query = sys.argv[2]
        days = 30
        if "--days" in sys.argv:
            idx = sys.argv.index("--days")
            if idx + 1 < len(sys.argv):
                days = int(sys.argv[idx + 1])
        search_emails(query, days)

    elif cmd == "read" and len(sys.argv) > 2:
        read_email(sys.argv[2])

    elif cmd == "senders":
        days = 14
        if "--days" in sys.argv:
            idx = sys.argv.index("--days")
            if idx + 1 < len(sys.argv):
                days = int(sys.argv[idx + 1])
        list_senders(days)

    elif cmd == "archive-preview" and len(sys.argv) > 2:
        uids = [a for a in sys.argv[2:] if not a.startswith('-')]
        archive_preview(uids)

    elif cmd == "archive" and len(sys.argv) > 2:
        uids = [a for a in sys.argv[2:] if not a.startswith('-')]
        archive_emails(uids)

    elif cmd == "archive-sender" and len(sys.argv) > 2:
        sender = sys.argv[2]
        dry_run = "--dry-run" in sys.argv
        archive_by_sender(sender, dry_run=dry_run)

    else:
        print(__doc__)
