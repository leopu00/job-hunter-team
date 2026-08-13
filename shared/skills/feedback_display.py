#!/usr/bin/env python3
"""Boundary di presentazione per il testo libero del feedback.

``reason`` e ``comment`` restano dati macchina: clustering e moltiplicatore
devono poter leggere l'input originale. Qualunque testo che può finire in una
nota, in un prompt user-facing o in un esempio passa invece da questa funzione.
Il modulo è volutamente piccolo e senza dipendenze, così check/recent/themes e
lo Scorer condividono la stessa regola invece di tre regex divergenti.
"""

from __future__ import annotations

import os
import re


DISPLAY_TEXT_MAX_CHARS = 240

_AUTH_BEARER_RE = re.compile(
    r"(?i)\bauthorization\s*:\s*bearer\s+[^\s,;]+"
)
_BEARER_RE = re.compile(r"(?i)\bbearer\s+[^\s,;]+")
_SECRET_RE = re.compile(
    r"(?i)\b(token|api[_-]?key|secret|password|credential)\b[\"']?"
    r"\s*[:=]\s*[\"']?[^\s\"',;}{\]]+"
)
_URL_RE = re.compile(r"(?i)\b(?:https?|ssh)://[^\s\"',;]+")
_SSH_HOST_RE = re.compile(
    r"(?i)(?<![\w@])[a-z0-9._-]+@[a-z0-9._-]+(?::\d+)?"
)
_NAMED_INFRA_RE = re.compile(
    r"(?i)\b(host(?:name)?|session(?:_id)?)\b[\"']?"
    r"(\s*(?:[:=]\s*|\s+))[\"']?[^\s\"',;}{\]]+"
)
_QUOTED_PATH_RE = re.compile(
    r'''(?i)([\"'])(?:[a-z]:\\|\\\\|/)[^\"'\r\n]+\1'''
)
_WINDOWS_DRIVE_RE = re.compile(
    r"(?i)(?<![\w])(?:[a-z]:\\)(?:[^\\\s]+\\)*[^\\\s,;:!?)]*"
)
_WINDOWS_UNC_RE = re.compile(
    r"(?<![\w])\\\\[^\\\s]+\\(?:[^\\\s]+\\)*[^\\\s,;:!?)]*"
)
_POSIX_PATH_RE = re.compile(
    r"(?<![\w])/(?:[^/\s]+/)*[^/\s,;:!?)]*"
)
_IPV4_RE = re.compile(
    r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?![\w.])"
)
_JHT_HOME_LITERAL_RE = re.compile(
    r"(?i)(?:\$\{?JHT_HOME\}?|\bJHT_HOME\b)"
    r"(?:\s*=\s*[^\s,;]+|(?:[/\\][^\s,;]+)*)"
)


def _bounded(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    if max_chars <= 1:
        return "…"[:max_chars]
    return text[: max_chars - 1].rstrip() + "…"


def sanitize_feedback_display(value, max_chars: int = DISPLAY_TEXT_MAX_CHARS):
    """Return a bounded, single-line display value with infra removed.

    ``None`` remains ``None`` so callers preserve the schema distinction
    between absent text and an empty string. Raw input is never mutated.
    """
    if value is None:
        return None
    text = " ".join(str(value).split())
    if not text:
        return ""

    # The actual configured root is more specific than the generic path
    # patterns, so replace it first. Never expose a host-side or container-side
    # home through a user-authored comment echoed back by an agent.
    configured_home = (os.environ.get("JHT_HOME") or "").strip()
    if configured_home:
        text = re.sub(re.escape(configured_home), "[JHT_HOME]", text,
                      flags=re.IGNORECASE)
    text = _JHT_HOME_LITERAL_RE.sub("[JHT_HOME]", text)

    text = _AUTH_BEARER_RE.sub("Authorization: Bearer [redacted]", text)
    text = _BEARER_RE.sub("Bearer [redacted]", text)
    text = _SECRET_RE.sub(lambda m: f"{m.group(1)}=[redacted]", text)
    text = _URL_RE.sub("[url]", text)
    text = _SSH_HOST_RE.sub("[host]", text)
    text = _IPV4_RE.sub("[host]", text)
    text = _NAMED_INFRA_RE.sub(
        lambda m: f"{m.group(1)}{m.group(2)}[redacted]", text
    )
    text = _QUOTED_PATH_RE.sub("[path]", text)
    text = _WINDOWS_UNC_RE.sub("[path]", text)
    text = _WINDOWS_DRIVE_RE.sub("[path]", text)
    text = _POSIX_PATH_RE.sub("[path]", text)
    text = " ".join(text.split())
    return _bounded(text, max(1, int(max_chars)))
