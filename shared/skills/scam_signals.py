#!/usr/bin/env python3
"""scam_signals.py — deterministic scam signals on a job ad. A warning, never an exclusion.

The code computes only facts that can be verified on the ad's text and in the
database, with no network and no model, BEFORE the Analista's opinion: the same
data gives the same answer. The result is stored in `positions.scam_signals`
(JSON) and the position stays where it is: its `status` is never touched and
nothing is deleted.

  1 signal                          → bucket "badge"   ("suspicious" badge with its reason)
  2+ signals of different families  → bucket "section" ("suspicious" section, always visible)

Signals (closed codes) and families:
  same_text_many_places  [text]     the same normalised text in >=2 OTHER positions of
                                    DIFFERENT companies (the same company in more cities
                                    does not count)
  advance_payment        [text]     a phrase from a closed list: fee/kit/paid training,
                                    payment in advance, gift cards… (not when denied: "no fees")
  company_unverifiable   [company]  no website recorded for the company AND the position's
                                    link is neither a known portal/ATS nor its own domain
  private_chat_only      [contact]  one applies by writing on WhatsApp/Telegram/WeChat and
                                    there is no other way (no email in the text, no portal link)

The lists (known portals, phrases, negations) live in scam_signals_data.json.

The ad's text is external data: this script never prints it. Where it shows a matched
phrase it puts it in an inline fence (external_content); the database only gets the
list of codes, never the text.

Usage:
  python3 scam_signals.py check --id N [--dry-run]    # compute, write if changed, print JSON
  python3 scam_signals.py sweep [--all] [--limit N]   # backlog: positions never checked
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import urlparse

DATA_FILE = Path(__file__).with_name("scam_signals_data.json")

# Ordine canonico dei codici (e quindi dell'output) e famiglia di ciascuno.
FAMILIES = {
    "same_text_many_places": "text",
    "advance_payment": "text",
    "company_unverifiable": "company",
    "private_chat_only": "contact",
}

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_URL_RE = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
_BARE_HOST_RE = re.compile(r"\b((?:wa\.me|t\.me|telegram\.me|signal\.me|api\.whatsapp\.com|chat\.whatsapp\.com)/\S*)", re.IGNORECASE)


_DATA: dict | None = None


def load_data(path: Path | None = None) -> dict:
    """Le liste di scam_signals_data.json (lette una volta sola per il file di default)."""
    global _DATA
    if path is not None:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    if _DATA is None:
        with open(DATA_FILE, encoding="utf-8") as handle:
            _DATA = json.load(handle)
    return _DATA


# ── normalizzazione ──────────────────────────────────────────────────────────

def norm_words(text) -> list[str]:
    """Minuscolo, senza accenti, solo lettere e cifre: le parole del testo."""
    text = unicodedata.normalize("NFKD", str(text or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.findall(r"[a-z0-9]+", text)


def _drop_urls_and_emails(text: str) -> str:
    return _EMAIL_RE.sub(" ", _URL_RE.sub(" ", text))


def company_key(name) -> str:
    """Il nome azienda ridotto a una chiave: senza forma societaria né punteggiatura."""
    legal = set(load_data()["company_legal_suffixes"])
    text = str(name or "").lower()
    for _ in range(3):                       # «S.r.l.» → «srl», «S.p.A.» → «spa»
        text = re.sub(r"\b([a-z])\.(?=[a-z]\b)", r"\1", text)
    words = [w for w in norm_words(text) if w not in legal]
    return " ".join(words)


def fingerprints_of(position: dict, data: dict) -> list:
    """Gli hash del testo normalizzato (senza URL, email e numeri) che identificano una
    copia. Due varianti: senza i nomi dell'azienda e della città di QUESTA posizione (cambiano
    da un annuncio ripubblicato all'altro), e con tutte le parole (quando quei nomi sono
    parole comuni, come «Logistics», e togliendoli i due testi non coinciderebbero più).
    Vuota se il testo è troppo corto per riconoscerlo."""
    body = _drop_urls_and_emails(str(position.get("jd_text") or ""))
    words = [w for w in norm_words(body) if not w.isdigit()]
    if len(words) < int(data["same_text"]["min_tokens"]):
        return []
    drop = set(norm_words(position.get("company"))) | set(norm_words(position.get("location")))
    drop = {w for w in drop if len(w) >= 3}
    variants = [" ".join(w for w in words if w not in drop), " ".join(words)]
    digests = []
    for text in variants:
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if digest not in digests:
            digests.append(digest)
    return digests


# ── host e portali ───────────────────────────────────────────────────────────

def host_of(url) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = "//" + raw
    try:
        host = (urlparse(raw).hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def registrable(host: str, data: dict) -> str:
    labels = [part for part in host.split(".") if part]
    if len(labels) <= 2:
        return ".".join(labels)
    tail2 = ".".join(labels[-2:])
    if tail2 in set(data["second_level_suffixes"]):
        return ".".join(labels[-3:])
    return tail2


def _is_known_portal(host: str, data: dict) -> bool:
    return any(host == p or host.endswith("." + p) for p in data["known_portals"])


def _same_site(host: str, website: str, data: dict) -> bool:
    site = host_of(website)
    return bool(host and site and registrable(host, data) == registrable(site, data))


# ── i singoli segnali ────────────────────────────────────────────────────────

def _phrase_hits(tokens: list[str], phrases: list[str], negations: set, window: int) -> list[str]:
    """Le frasi della lista presenti nel testo e NON negate poco prima (`no fees`)."""
    text = " " + " ".join(tokens) + " "
    found = []
    for phrase in phrases:
        needle = " " + phrase + " "
        start = 0
        while True:
            at = text.find(needle, start)
            if at < 0:
                break
            before = text[:at].split()[-window:]
            if not any(word in negations for word in before):
                found.append(phrase)
                break
            start = at + 1
    return found


def advance_payment(position: dict, data: dict) -> str | None:
    tokens = norm_words(position.get("jd_text"))
    negations = set(data["negations"])
    window = int(data["negation_window_tokens"])
    for phrases in data["advance_payment"].values():
        hits = _phrase_hits(tokens, phrases, negations, window)
        if hits:
            return hits[0]
    return None


def private_chat_only(position: dict, data: dict) -> str | None:
    """Cosa si legge come «scrivi su una chat privata» e nessun altro modo di candidarsi."""
    text = str(position.get("jd_text") or "")
    if _EMAIL_RE.search(text):
        return None
    apply_host = host_of(position.get("url"))
    if apply_host and (_is_known_portal(apply_host, data)
                       or _same_site(apply_host, position.get("company_website") or "", data)):
        return None
    chat = data["chat"]
    chat_hosts = set(chat["hosts"])
    # un link a una chat (anche scritto senza https://)
    links = [host_of(m) for m in _URL_RE.findall(text)] + [host_of(m) for m in _BARE_HOST_RE.findall(text)]
    for host in links:
        if host in chat_hosts:
            return host
    if apply_host in chat_hosts:
        return apply_host
    # una chat nominata accanto a una parola di contatto («scrivici su WhatsApp»)
    tokens = norm_words(_drop_urls_and_emails(text))
    contact = set(chat["contact_words"])
    span = int(chat["window_tokens"])
    for keyword in chat["keywords"]:
        words = keyword.split()
        for i in range(len(tokens) - len(words) + 1):
            if tokens[i:i + len(words)] == words:
                around = tokens[max(0, i - span):i] + tokens[i + len(words):i + len(words) + span]
                if any(word in contact for word in around):
                    return keyword.replace(" ", "")
    return None


def company_unverifiable(position: dict, data: dict) -> bool:
    """Nessun sito registrato per l'azienda e il link non è un portale/ATS noto."""
    if str(position.get("company_website") or "").strip():
        return False
    host = host_of(position.get("url"))
    if not host:
        return False                     # niente da giudicare: non si accusa
    return not _is_known_portal(host, data)


def same_text_many_places(position: dict, fingerprints: dict, data: dict) -> list:
    """Gli id delle ALTRE posizioni con lo stesso testo e un'azienda DIVERSA, se sono
    abbastanza: la stessa azienda in più città (agenzie, grandi aziende) non è un segnale."""
    own_company = company_key(position.get("company"))
    others = {}
    for digest in fingerprints_of(position, data):
        for pid, ckey in fingerprints.get(digest, []):
            if pid != position.get("id") and ckey != own_company:
                others[pid] = ckey
    if len(set(others.values())) < int(data["same_text"]["min_other_companies"]):
        return []
    return sorted(others)


# ── esito ────────────────────────────────────────────────────────────────────

def evaluate(position: dict, fingerprints: dict | None = None, data: dict | None = None) -> dict:
    """I segnali di una posizione. `position` porta anche `company_website`.
    Ritorna {"codes": [...], "bucket": "none"|"badge"|"section", "evidence": {...}}."""
    data = data or load_data()
    codes: list[str] = []
    evidence: dict = {}
    ids = same_text_many_places(position, fingerprints or {}, data)
    if ids:
        codes.append("same_text_many_places")
        evidence["same_text_many_places"] = {"position_ids": ids}
    phrase = advance_payment(position, data)
    if phrase:
        codes.append("advance_payment")
        evidence["advance_payment"] = {"phrase": phrase}
    if company_unverifiable(position, data):
        codes.append("company_unverifiable")
        evidence["company_unverifiable"] = {"link_host": host_of(position.get("url"))}
    chat = private_chat_only(position, data)
    if chat:
        codes.append("private_chat_only")
        evidence["private_chat_only"] = {"channel": chat}
    return {"codes": codes, "bucket": bucket_of(codes), "evidence": evidence}


def bucket_of(codes: list) -> str:
    if not codes:
        return "none"
    families = {FAMILIES[code] for code in codes if code in FAMILIES}
    return "section" if len(families) >= 2 else "badge"


def stored_value(result: dict) -> str:
    """Quello che va in `positions.scam_signals`: i codici e il bucket, mai il testo."""
    return json.dumps({"v": 1, "codes": result["codes"], "bucket": result["bucket"]},
                      sort_keys=True, separators=(",", ":"))


# ── DB ───────────────────────────────────────────────────────────────────────

def load_fingerprints(conn, data: dict | None = None) -> dict:
    """{hash: [(position_id, company_key)]} su tutte le posizioni con un testo."""
    data = data or load_data()
    out: dict = {}
    for row in conn.execute("SELECT id, company, location, jd_text FROM positions "
                            "WHERE jd_text IS NOT NULL AND jd_text <> ''"):
        record = dict(row) if hasattr(row, "keys") else dict(zip(("id", "company", "location", "jd_text"), row))
        ckey = company_key(record["company"])
        for digest in fingerprints_of(record, data):
            out.setdefault(digest, []).append((record["id"], ckey))
    return out


def load_position(conn, position_id: int) -> dict | None:
    row = conn.execute(
        "SELECT p.id, p.title, p.company, p.location, p.url, p.jd_text, p.scam_signals, "
        "       (SELECT c.website FROM companies c WHERE c.name = p.company LIMIT 1) AS company_website "
        "FROM positions p WHERE p.id = ?", (position_id,)).fetchone()
    return dict(row) if row is not None else None


def check_position(conn, position_id: int, fingerprints: dict | None = None,
                   write: bool = True, data: dict | None = None) -> dict | None:
    """Calcola e, se cambia, scrive. Non tocca nient'altro della riga."""
    data = data or load_data()
    position = load_position(conn, position_id)
    if position is None:
        return None
    if fingerprints is None:
        fingerprints = load_fingerprints(conn, data)
    result = evaluate(position, fingerprints, data)
    value = stored_value(result)
    result["changed"] = value != position.get("scam_signals")
    if write and result["changed"]:
        conn.execute("UPDATE positions SET scam_signals = ? WHERE id = ?", (value, position_id))
        conn.commit()
    result["position_id"] = position_id
    return result


def _public(result: dict) -> dict:
    """L'esito per chi lo legge (un agente): le frasi trovate sono dato esterno, recintate."""
    from external_content import inline_external_value

    evidence = {}
    for code, detail in result["evidence"].items():
        evidence[code] = {key: (inline_external_value(value) if isinstance(value, str) else value)
                          for key, value in detail.items()}
    return {"position_id": result["position_id"], "codes": result["codes"],
            "bucket": result["bucket"], "changed": result["changed"], "evidence": evidence}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    check = sub.add_parser("check")
    check.add_argument("--id", type=int, required=True)
    check.add_argument("--dry-run", action="store_true")
    sweep = sub.add_parser("sweep")
    sweep.add_argument("--all", action="store_true", help="also the positions already checked")
    sweep.add_argument("--limit", type=int, default=0)
    args = parser.parse_args(argv)

    from _db import ensure_schema, get_db

    conn = get_db()
    ensure_schema(conn)
    data = load_data()
    fingerprints = load_fingerprints(conn, data)
    if args.cmd == "check":
        result = check_position(conn, args.id, fingerprints, write=not args.dry_run, data=data)
        if result is None:
            print(json.dumps({"error": "position_not_found", "position_id": args.id}))
            return 2
        print(json.dumps(_public(result), ensure_ascii=False))
        return 0
    where = "" if args.all else "WHERE scam_signals IS NULL"
    ids = [row[0] for row in conn.execute(f"SELECT id FROM positions {where} ORDER BY id")]
    if args.limit > 0:
        ids = ids[:args.limit]
    counts = {"none": 0, "badge": 0, "section": 0}
    changed = 0
    for position_id in ids:
        result = check_position(conn, position_id, fingerprints, data=data)
        counts[result["bucket"]] += 1
        changed += 1 if result["changed"] else 0
    print(json.dumps({"checked": len(ids), "changed": changed, **counts}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
