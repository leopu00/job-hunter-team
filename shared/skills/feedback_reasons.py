#!/usr/bin/env python3
"""feedback_reasons.py — il vocabolario chiuso dei motivi del feedback (JHT-T05).

Un solo elenco, `shared/feedback-reasons.json`, letto qui e da web e desktop.
Il motivo di un giudizio è uno di quei codici; quello che l'utente aggiunge a
parole sue è la NOTA (max 200 caratteri), che resta all'utente: nessuna skill
degli agenti la legge e nessun prompt la riceve.

Questo modulo non legge né scrive la nota negli agenti: la pulisce quando
entra (`clean_note`) e dice se un codice è nel vocabolario (`safe_reason`).
Le skill che parlano agli agenti usano SOLO `safe_reason`, mai il testo.
"""
import json
import unicodedata
from pathlib import Path

_PATHS = (
    Path(__file__).resolve().parent.parent / "feedback-reasons.json",
    Path(__file__).resolve().parent / "feedback-reasons.json",
)


def _load() -> dict:
    for path in _PATHS:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    raise FileNotFoundError("feedback-reasons.json")


_DATA = _load()
REASONS = tuple(_DATA["reasons"])
FACTUAL = frozenset(_DATA["factual"])
PROPOSABLE = frozenset(_DATA["proposable"])
LEGACY = dict(_DATA["legacy"])
LABELS = dict(_DATA["labels"])
NOTE_MAX = int(_DATA["note_max_chars"])
PROPOSAL_MIN_POSITIONS = int(_DATA["proposal_min_positions"])


def is_reason(value) -> bool:
    return isinstance(value, str) and value in REASONS


def safe_reason(value):
    """Il codice del vocabolario per un valore salvato, o None se non c'è motivo.

    Un valore del vecchio elenco si rimappa (`not_interested` → `other`), e
    qualunque testo libero che non è un codice vale `other`: nel passaggio
    non arriva mai il testo, solo il codice.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text in REASONS:
        return text
    return LEGACY.get(text, "other")


def clean_note(value) -> str:
    """La nota dell'utente, ripulita: NFC, senza controlli né bidi, spazi singoli.

    Non taglia: chi la scrive controlla `len(...) <= NOTE_MAX` e rifiuta, così
    un testo troppo lungo non viene accorciato di nascosto.
    """
    if value is None:
        return ""
    text = unicodedata.normalize("NFC", str(value))
    kept = []
    for ch in text:
        cat = unicodedata.category(ch)
        if ch in "\r\n\t\u2028\u2029" or cat == "Zs":
            kept.append(" ")
        elif cat in ("Cc", "Cf", "Cs", "Co", "Cn"):
            continue
        else:
            kept.append(ch)
    return " ".join("".join(kept).split())


def migrated_note(value) -> str | None:
    """Il testo di un giudizio vecchio, come nota: ripulito e tagliato a NOTE_MAX.

    Solo per la migrazione dei dati già salvati: l'originale resta dov'era.
    """
    cleaned = clean_note(value)
    return cleaned[:NOTE_MAX] or None


_REJECTIONS = ("dislike", "hide")


def _stamp(event):
    from datetime import datetime, timezone

    raw = str(event.get("created_at") or "").strip()
    if not raw:
        return float("-inf")
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw.replace(" ", "T", 1))
    except ValueError:
        return float("-inf")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def proposals(events, min_positions=PROPOSAL_MIN_POSITIONS):
    """Le esclusioni del profilo che l'app può PROPORRE (l'utente decide).

    Per ogni motivo proponibile, le posizioni DIVERSE il cui ultimo giudizio è
    una bocciatura (`dislike`/`hide`) con quel motivo. La stessa posizione
    conta 1; se l'ultimo evento è `clear` (voto ritirato) conta 0; `other` e i
    motivi fattuali non contano mai. Stessa regola di `exclusionProposals` in
    `web/lib/feedback-reasons.ts`: i due sono tenuti uguali da un test che
    legge le stesse tabelle di casi.
    """
    latest = {}
    for event in events:
        key = str(event.get("legacy_id"))
        current = latest.get(key)
        if current is None or _stamp(event) > _stamp(current):
            latest[key] = event
    by = {}
    for key, event in latest.items():
        if event.get("action") not in _REJECTIONS:
            continue
        code = safe_reason(event.get("reason"))
        if code not in PROPOSABLE:
            continue
        by.setdefault(code, []).append(key)
    rows = [
        {"reason": code, "positions": len(ids), "legacy_ids": sorted(ids)}
        for code, ids in by.items()
        if len(ids) >= min_positions
    ]
    rows.sort(key=lambda r: (-r["positions"], r["reason"]))
    return rows
