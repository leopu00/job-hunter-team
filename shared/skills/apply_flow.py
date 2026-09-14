#!/usr/bin/env python3
"""Checkpointed, fail-closed application flow for the CLOSER.

The state machine is ``detect -> fill -> upload_cv -> screening -> review ->
submit``.  Every completed step is written atomically to a mode-0600
checkpoint.  Filling steps are replayed idempotently after a browser restart;
submission is different: ``submit_started`` is persisted *before* the click,
and an uncertain outcome is never clicked again.

The complete public-form recipes are Ashby and Greenhouse.  A vacancy whose
application control is a ``mailto:`` link is not a missing form: the flow stops
in ``email_channel`` and records the raw ``mailto_href`` in the checkpoint for
the email channel (``email_application.py``), which owns everything after
that.  A real submit has four hard conditions:

* the phase-A gate allows this position at start and immediately before click;
* every required value comes from the candidate profile (nothing is guessed);
* captcha, 2FA, unknown controls, and upload errors block for a human;
* a screenshot plus a confirmation URL or text exists before ``applied`` is
  recorded.

The module imports Playwright lazily so deterministic checkpoint/detection
tests can still run without starting a browser.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.parse
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Mapping

if __name__ == "__main__":
    # Run as a script, this module is `__main__`.  The recipes that live in
    # their own modules (`linkedin_apply`) import it as `apply_flow`: without
    # this line they would get a second copy whose BlockedHuman the flow
    # below never catches.
    sys.modules.setdefault("apply_flow", sys.modules[__name__])

try:
    from ats_detect import detect_ats
except ImportError:  # pragma: no cover - package-style import outside the CLI
    from shared.skills.ats_detect import detect_ats
try:
    import application_answers
except ImportError:  # pragma: no cover - package-style import outside the CLI
    from shared.skills import application_answers
try:
    import profile_facts
except ImportError:  # pragma: no cover - package-style import outside the CLI
    from shared.skills import profile_facts
try:
    import page_failure
except ImportError:  # pragma: no cover - package-style import outside the CLI
    from shared.skills import page_failure
try:
    import location_choice
except ImportError:  # pragma: no cover - package-style import outside the CLI
    from shared.skills import location_choice


LOG = logging.getLogger("jht.apply_flow")
CHECKPOINT_VERSION = 1
SUPPORTED_PLATFORMS = frozenset({"ashby", "greenhouse", "lever", "linkedin", "generic"})
GREENHOUSE_HOSTS = frozenset(
    {
        "job-boards.greenhouse.io",
        "job-boards.eu.greenhouse.io",
        "boards.greenhouse.io",
    }
)
# Lever's US and EU public boards.  Separate instances: a confirmation on one
# never proves a submit made on the other.
LEVER_HOSTS = frozenset({"jobs.lever.co", "jobs.eu.lever.co"})
LINKEDIN_HOSTS = frozenset({"www.linkedin.com", "linkedin.com"})
# The country pages the Scout's links also use (es.linkedin.com, nl.linkedin.com).
_LINKEDIN_COUNTRY_HOST = re.compile(r"^[a-z]{2}\.linkedin\.com$")
STEP_ORDER = ("detect", "fill", "upload_cv", "screening", "review", "submit")
EMAIL_CHANNEL_STATE = "email_channel"
RETRY_LATER_EXIT = 5

# Collect every control that would hand the application to a mail client: an
# anchor, a form action, or a button whose click handler/data attribute holds a
# mailto: target.  Only the raw attribute text is returned — parsing To, CC,
# subject and body belongs to the email channel, not to the browser flow.
_MAILTO_CONTROLS_JS = r"""
() => {
  const out = [];
  const rawMailto = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (/^mailto:/i.test(trimmed)) return trimmed;
    const inScript = trimmed.match(/mailto:[^'"`]*/i);
    return inScript ? inScript[0] : null;
  };
  const labelOf = (element) => [
    element.innerText || "",
    element.getAttribute("value") || "",
    element.getAttribute("aria-label") || "",
    element.getAttribute("title") || "",
  ].join(" ").replace(/\s+/g, " ").trim().slice(0, 200);
  const push = (element, href) => { if (href) out.push({ href, label: labelOf(element) }); };
  document.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (/^\s*mailto:/i.test(href)) push(a, href.trim());
  });
  document.querySelectorAll("button, input[type=button], input[type=submit], [role=button]").forEach((el) => {
    const direct = ["onclick", "formaction", "data-href", "data-url", "data-mailto"]
      .map((name) => rawMailto(el.getAttribute(name))).find(Boolean);
    if (direct) push(el, direct);
  });
  document.querySelectorAll("form[action]").forEach((form) => {
    const href = rawMailto(form.getAttribute("action"));
    if (!href || !/^mailto:/i.test(href)) return;
    const submit = form.querySelector("button[type=submit], input[type=submit], button:not([type])");
    push(submit || form, href);
  });
  return out;
}
"""
# An application control, not "email us with questions": the visible label must
# say apply/application (a few languages the CLOSER meets).  A bare address in
# the footer is a contact, and a contact is not a channel.
_MAILTO_APPLY_LABEL = re.compile(
    r"\b(apply|application|send\s+(?:us\s+)?(?:your\s+)?(?:cv|resume|application)|"
    r"candidat\w*|bewerb\w*|postul\w*|solicit\w*|invia\w*\s+(?:il\s+)?cv)\b",
    re.I,
)


# A vacancy that is no longer open.  Seen live (13-14/09): the page said so, or
# the vacancy URL redirected to the generic careers page, and the flow went on
# looking for a form.  Each phrase names the posting AND says it is gone, so a
# job description that merely contains "no longer" does not match.
# Pattern text for page INPUT in several languages, not user-visible copy.
_NOUNS_EN = r"(?:job|position|posting|vacancy|role|opening|listing|requisition)"
_NOUNS_IT = r"(?:posizione|offerta|annuncio|ruolo|lavoro|selezione)"
_NOUNS_DE = r"(?:stelle|stellenanzeige|stellenangebot|position|job|ausschreibung|anzeige)"
_NOUNS_FR = r"(?:offre|poste|annonce|emploi)"
_NOUNS_ES = r"(?:oferta|vacante|puesto|empleo)"
_NOUNS_PT = r"(?:vaga|oferta|posição|posicao|emprego)"
_NOUNS_HU = r"(?:állás\w*|pozíció\w*|hirdetés\w*)"
_NEAR = r"\b[^.!?,;:\n]{0,40}?"
_VACANCY_CLOSED_PATTERNS = tuple(
    (lang, re.compile(pattern, re.I))
    for lang, pattern in (
        ("en", r"\bno longer (?:accepting|taking|receiving) (?:new )?applications\b(?! (?:from|by|via|through|at|on)\b)"),
        ("en", rf"\b{_NOUNS_EN}{_NEAR}\b(?:is|has been|was) no longer (?:available|open|active|live|online)\b"),
        ("en", rf"\b{_NOUNS_EN} (?:has|have) (?:expired|been filled|been closed)\b"),
        ("en", r"\bapplications (?:for this \w+ )?(?:are|have been) (?:now )?closed\b"),
        ("it", rf"\b{_NOUNS_IT}{_NEAR}\bnon (?:è|e'|risulta) più (?:disponibile|attiv[ao]|apert[ao])\b"),
        ("it", r"\bnon (?:accetta|riceve) più candidature\b"),
        ("it", r"\bcandidature (?:sono )?chiuse\b"),
        ("it", r"\b(?:annuncio|offerta|posizione) (?:è )?(?:scadut[ao]|chius[ao])\b"),
        ("it", r"\bposizione (?:è )?(?:stata )?(?:coperta|chiusa)\b"),
        ("de", rf"\b{_NOUNS_DE}{_NEAR}\bnicht mehr (?:verfügbar|aktiv|online|offen|ausgeschrieben)\b"),
        ("de", r"\b(?:stelle|position) (?:ist )?(?:bereits )?(?:besetzt|vergeben)\b"),
        ("de", r"\bbewerbungsfrist (?:ist )?abgelaufen\b"),
        ("de", r"\bkeine (?:weiteren )?bewerbungen mehr (?:an|entgegen)\b"),
        ("fr", rf"\b{_NOUNS_FR}{_NEAR}\bn'est plus (?:disponible|active|ouverte?|en ligne)\b"),
        ("fr", r"\bn'accept(?:e|ons) plus de candidatures\b"),
        ("fr", r"\b(?:poste|offre) (?:a été |est )?(?:pourvue?|expirée?|clôturée?)\b"),
        ("fr", r"\bcandidatures (?:sont )?(?:closes|clôturées)\b"),
        ("es", rf"\b{_NOUNS_ES}{_NEAR}\bya no (?:está|esta) (?:disponible|activa?|abierta?)\b"),
        ("es", r"\bya no (?:acepta|aceptamos|admite) (?:candidaturas|solicitudes|postulaciones)\b"),
        ("es", r"\b(?:oferta|vacante) (?:ha )?(?:expirado|caducado|cerrada)\b"),
        ("es", r"\bpuesto (?:ha sido )?cubierto\b"),
        ("pt", rf"\b{_NOUNS_PT}{_NEAR}\bnão (?:está|esta) mais (?:disponível|disponivel|aberta|ativa)\b"),
        ("pt", r"\b(?:vaga|oferta) (?:foi )?(?:encerrada|preenchida|expirada)\b"),
        ("pt", r"\bnão (?:aceita|aceitamos) mais candidaturas\b"),
        ("hu", rf"\b{_NOUNS_HU}{_NEAR}\b(?:már nem (?:elérhető|aktív|érhető el)|lejárt|betöltésre került)\b"),
    )
)


_NOTICE_CONDITION = re.compile(
    r"\b(?:until|till|once|when|whenever|after|before|if|unless|as soon as|"
    r"bis|sobald|wenn|falls|nachdem|finché|fino a quando|quando|una volta che|se|dopo che|"
    r"jusqu'à ce que|dès que|lorsque|quand|si|hasta que|cuando|una vez que|en cuanto|"
    r"até que|quando|assim que|amíg|miután|ha)\b",
    re.I,
)
_NOTICE_DATE_AFTER = re.compile(
    r"\s*(?:on|by|at|from|as of|am|ab|il|entro|dal|le|à partir du|el|a partir del|em|a partir de)\b[^.!?]{0,15}\d",
    re.I,
)


def vacancy_closed_evidence(text: str) -> str | None:
    """The language of a "this vacancy is closed" notice in the page text, or None.

    Only the language tag leaves this function: the page text is employer
    content and never goes into a checkpoint, a log or a notification.
    """
    clean = " ".join(str(text or "").replace("\u2019", "'").replace("\u00a0", " ").split())
    for lang, pattern in _VACANCY_CLOSED_PATTERNS:
        for match in pattern.finditer(clean):
            sentence_start = max(clean.rfind(mark, 0, match.start()) for mark in ".!?")
            before = clean[sentence_start + 1 : match.start()]
            after = clean[match.end() : match.end() + 30]
            # "open until it has been filled", "closed on 30 September": a
            # condition or a future date describes an OPEN vacancy.
            if _NOTICE_CONDITION.search(before) or _NOTICE_DATE_AFTER.match(after):
                continue
            return lang
    return None


def vacancy_redirected_away(requested_url: str, final_url: str) -> bool:
    """Did opening the vacancy land somewhere that is not that vacancy?

    A closed posting typically redirects to the company's job list, its
    careers page or its home page ("Book a demo").  The vacancy survives a
    redirect when its identifier (a path segment carrying a digit: a numeric
    id or a UUID) is still in the final path; without such an identifier, only
    a shorter prefix of the requested path (down to the root) counts as away.
    Scheme, host moves (boards → job-boards) and query strings do not count.
    """
    try:
        requested = urllib.parse.urlsplit(requested_url)
        final = urllib.parse.urlsplit(final_url)
    except ValueError:
        return True
    if final.scheme not in {"http", "https"}:
        return True
    requested_segments = [s.casefold() for s in requested.path.split("/") if s]
    final_segments = [s.casefold() for s in final.path.split("/") if s]
    # ".../senior-engineer/apply" landing on ".../senior-engineer" is the vacancy itself.
    if requested_segments and requested_segments[-1] in {"apply", "application", "form"}:
        requested_segments = requested_segments[:-1]
    identifiers = [s for s in requested_segments if any(ch.isdigit() for ch in s)]
    if identifiers:
        return not any(identifier in final_segments for identifier in identifiers)
    # No identifier: only a landing on a shorter prefix of the requested path
    # (the job list, careers or home page) is a redirect away.  A language
    # prefix or a move to another subdomain proves nothing.
    return len(final_segments) < len(requested_segments) and (
        final_segments == requested_segments[: len(final_segments)]
    )


def mailto_application_href(page) -> str | None:
    """Return the raw href of the page's single mailto application control.

    ``None`` when no apply-labelled control targets mailto:.  Several controls
    are fine when they carry the same href (header and footer buttons); two
    different targets are ambiguous and stop for a human.
    """
    try:
        controls = page.evaluate(_MAILTO_CONTROLS_JS) or []
    except Exception:
        return None
    hrefs = []
    for control in controls:
        href = str(control.get("href") or "").strip()
        label = str(control.get("label") or "")
        if not href or not _MAILTO_APPLY_LABEL.search(label):
            continue
        if href not in hrefs:
            hrefs.append(href)
    if not hrefs:
        return None
    if len(hrefs) > 1:
        raise BlockedHuman(
            "mailto_ambiguous",
            "More than one different mailto application address was found",
            "detect",
        )
    if len(hrefs[0]) > 4000:
        raise BlockedHuman("mailto_invalid", "The mailto application link is implausibly long", "detect")
    return hrefs[0]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _resolve_headless(
    override: bool | None,
    *,
    env: Mapping[str, str] | None = None,
    socket_root: str | Path = "/tmp/.X11-unix",
) -> bool:
    """Choose headed mode only for a live, local X display unless overridden."""
    if override is not None:
        return override
    environment = os.environ if env is None else env
    if environment.get("JHT_LIVE_SCREEN", "").strip().casefold() in {
        "0",
        "false",
        "no",
        "off",
    }:
        return True
    display = environment.get("DISPLAY", "").strip()
    match = re.fullmatch(r"(?:(?:unix)?):([0-9]+)(?:\.[0-9]+)?", display)
    if not match:
        return True
    return not (Path(socket_root) / f"X{match.group(1)}").is_socket()


def _normalise_label(value: str) -> str:
    return application_answers.normalise_label(value)


def _safe_label(value: str) -> str:
    """Bound external form text before it enters a user notification."""
    clean = " ".join(value.replace("\x00", " ").split())
    return clean[:240] or "unnamed required field"


def _exact_form_text(value: Any, *, maximum: int = 1000) -> str:
    """Return bounded visible form text without changing its words or case."""
    if not isinstance(value, str):
        return ""
    clean = " ".join(value.replace("\x00", " ").replace("\u00a0", " ").split())
    return clean if 0 < len(clean) <= maximum else ""


def _control_option_labels(controls) -> list[str]:
    """Read exact accessible labels; ambiguity is represented by an empty list."""
    values: list[str] = []
    for index in range(controls.count()):
        control = controls.nth(index)
        labels = control.evaluate(
            "element => Array.from(element.labels || []).map(label => label.innerText)"
        )
        exact = [_exact_form_text(value, maximum=500) for value in labels]
        exact = [value for value in exact if value]
        if len(exact) != 1 or exact[0] in values:
            return []
        values.append(exact[0])
    return values


# Profile path a recipe reads → the profile_facts fact with its aliases.
_CORE_PATH_FACTS = {
    ("name",): "full name",
    ("first_name",): "first name",
    ("last_name",): "last name",
    ("contacts", "email"): "email",
    ("email",): "email",
    ("contacts", "phone"): "phone",
    ("contacts", "linkedin"): "linkedin",
    ("contacts", "github"): "github",
    ("contacts", "website"): "website",
    ("location",): "location",
}


def _profile_fact(profile: Mapping[str, Any], paths: tuple[tuple[str, ...], ...]) -> str | None:
    """A core fact from the profile: the recipe's own paths, then the known aliases."""
    for path in paths:
        fact = _CORE_PATH_FACTS.get(tuple(path))
        value = profile_facts.profile_value(profile, fact) if fact else None
        if value is not None:
            return value
    return None


def _core_fact_missing(platform: str, label: str, step: str, control_type: str = "text") -> "BlockedHuman":
    """A required core field the profile and the saved answers do not hold.

    1967 (14/09): Greenhouse "First Name" with a profile holding only `name`
    was a hard stop. It is a question the CLOSER works out from the profile
    (CL-08), never a name split in code.
    """
    request = profile_facts.core_answer_request(label, control_type)
    if request is None:
        return BlockedHuman(
            "required_profile_field_missing",
            f"Required {platform} field needs profile data: {_safe_label(label)}",
            step,
        )
    return BlockedHuman(
        "required_answer_missing",
        f"Required {platform} field needs a fact the profile does not state: {_safe_label(label)}",
        step,
        answer_request=request,
    )


def _fill_suggested_location(
    recipe: Any,
    page: Any,
    *,
    platform: str,
    control: Any,
    options: Callable[[], Any],
    accepted: Callable[[str], bool],
    label: str,
    field_key: str,
    required: bool,
    step: str,
) -> None:
    """A location field that keeps only one of its own suggestions (location_choice).

    1888 (14/09): Lever "Current location" stopped with unknown_required_control
    though the profile says where the candidate lives. The saved answer, else
    the profile's location, is typed; a suggestion is clicked only when it is
    certainly that place; otherwise the suggestions are the question's exact
    options, for the CLOSER to choose (CL-08).
    """
    present, saved = recipe._answer_for(label, field_key)
    source_key = _normalise_label(label) or _normalise_label(field_key)
    if present and (isinstance(saved, bool) or not isinstance(saved, (str, int, float))):
        raise _inferred_answer_refused(
            recipe,
            BlockedHuman("answer_type_unknown", f"{platform} location needs one suggestion as text: {_safe_label(label)}", step),
            lambda: None,
        )
    wanted = str(saved).strip() if present else (profile_facts.profile_value(recipe.profile, "location") or "")
    if not wanted:
        if required:
            raise _core_fact_missing(platform, label, step)
        return
    if not present:
        recipe.answer_sources[source_key] = "profile"
    seen: list[str] = []
    for query in location_choice.queries(wanted):
        found = location_choice.suggestions(page, control, options, query)
        seen = seen or found
        choice = location_choice.pick(wanted, found)
        if not choice:
            continue
        if location_choice.click_option(options(), choice):
            page.wait_for_timeout(200)
            if accepted(choice):
                return
        location_choice.dismiss(page, control)
        raise _inferred_answer_refused(
            recipe,
            BlockedHuman("answer_not_accepted", f"{platform} did not keep the chosen location for: {_safe_label(label)}", step),
            lambda: None,
        )
    location_choice.dismiss(page, control)
    if not present:
        recipe.answer_sources.pop(source_key, None)
    if not required:
        return
    exact_label = _exact_form_text(label)
    choices = [text for text in (_exact_form_text(option, maximum=500) for option in seen) if text]
    request = (
        {"key": _normalise_label(exact_label), "label": exact_label, "field_type": "select", "options": choices}
        if exact_label and _normalise_label(exact_label) and choices
        else None
    )
    if request is None:
        raise BlockedHuman(
            "unknown_required_control",
            f"{platform} location shows no suggestions to choose from: {_safe_label(label)}",
            step,
        )
    if present:
        # A saved answer no suggestion matches: the CLOSER's own is asked
        # again with the options; a user's stays a human stop.
        raise _inferred_answer_refused(
            recipe,
            BlockedHuman("answer_option_unknown", f"No {platform} location suggestion matches the saved answer for: {_safe_label(label)}", step),
            lambda: request,
        )
    raise BlockedHuman(
        "required_answer_missing",
        f"Required {platform} location needs one of the page's suggestions: {_safe_label(label)}",
        step,
        answer_request=request,
    )


class FlowError(RuntimeError):
    pass


class _HeadedRetry(FlowError):
    """An anti-bot wall in a headless browser: open the page once more, headed."""


class BlockedHuman(FlowError):
    def __init__(
        self,
        reason: str,
        detail: str,
        step: str,
        *,
        answer_request: Mapping[str, Any] | None = None,
    ):
        super().__init__(detail)
        self.reason = reason
        self.detail = detail
        self.step = step
        self.answer_request = dict(answer_request) if answer_request else None


class FlowDeferred(FlowError):
    """Not now, and not a person's problem: the run is denied and the queue retries later."""

    def __init__(self, reason: str, detail: str):
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


class PlatformHandoff(FlowError):
    """The application continues on another site (a company ATS behind a board).

    Raised by a recipe that found the real application address.  The flow
    follows it once, with the recipe of the destination, after the same
    public-address guard as any application URL.
    """

    def __init__(self, url: str, detail: str = ""):
        super().__init__(detail or "the application continues on another site")
        self.url = str(url)
        self.detail = detail


ANSWER_ORIGINS = ("user", "profile", "agent_inferred")
_REFUSED_ANSWER_REASONS = frozenset(
    {"answer_option_unknown", "answer_type_unknown", "answer_not_accepted"}
)


def _inferred_answer_refused(recipe: Any, refused: BlockedHuman, request_of: Callable[[], Any]) -> BlockedHuman:
    """An answer the CLOSER worked out that the form refuses is its question again.

    The CLOSER can correct its own answer (a different option, another
    wording); a user's or the profile's answer that does not fit stays a
    human stop, as before.
    """
    key = getattr(recipe, "last_answer_key", "")
    if refused.reason not in _REFUSED_ANSWER_REASONS or recipe.answer_sources.get(key) != "agent_inferred":
        return refused
    try:
        request = request_of()
    except Exception:
        request = None
    if not request:
        return refused
    value = recipe.answers.get(key)
    recipe.answer_sources.pop(key, None)
    again = BlockedHuman(
        "required_answer_missing",
        f"The worked-out answer does not fit the form ({refused.reason})",
        refused.step,
        answer_request=request,
    )
    # Which value was refused, as a digest only: the flow counts repeats.
    again.refused_digest = _value_digest(value)
    return again


# The same worked-out value refused this many times for the same question
# stops the loop: the question then needs the CLOSER's explicit ask.
MAX_INFERRED_REFUSALS = 2


def _value_digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")).hexdigest()[:16]


def _answer_fits(payload: Mapping[str, Any], value: Any) -> bool:
    """Would this saved value fill the question as asked? Exact options, never a guess."""
    field_type = str(payload.get("field_type", ""))
    options = [str(option) for option in payload.get("options") or []]
    if field_type in {"radio", "select"}:
        return isinstance(value, str) and value in options
    if field_type == "checkbox":
        return isinstance(value, bool) or value in {"Yes", "No"}
    if field_type == "checkboxes":
        return (
            isinstance(value, list)
            and bool(value)
            and all(isinstance(item, str) and item in options for item in value)
            and len(set(value)) == len(value)
        )
    if isinstance(value, bool) or value is None:
        return False
    return bool(str(value).strip())


def _answer_sources(value: Any) -> dict[str, str]:
    """A clean key → origin map; anything else in it is dropped, never trusted."""
    if not isinstance(value, Mapping):
        return {}
    return {
        str(key): str(origin)
        for key, origin in value.items()
        if isinstance(key, str) and key and origin in ANSWER_ORIGINS
    }


@dataclass(frozen=True)
class Receipt:
    screenshot_path: Path
    confirmation_url: str = ""
    confirmation_text: str = ""
    captured_at: str = field(default_factory=_utc_now)
    # Where each saved answer used in the form came from: key → user / profile /
    # agent_inferred.  Keys and origins only, never a value.
    answer_sources: dict[str, str] = field(default_factory=dict)
    # sha256 of the CV file handed to the form, as the email receipt records
    # its attachment: which document the employer received.
    cv_sha256: str = ""

    def is_valid(self) -> bool:
        try:
            screenshot_ok = self.screenshot_path.is_file() and self.screenshot_path.stat().st_size > 0
        except OSError:
            screenshot_ok = False
        return screenshot_ok and bool(
            self.confirmation_url.strip() or self.confirmation_text.strip()
        )

    def to_dict(self) -> dict[str, str]:
        return {
            "screenshot_path": str(self.screenshot_path),
            "confirmation_url": self.confirmation_url,
            "confirmation_text": self.confirmation_text,
            "captured_at": self.captured_at,
            "answer_sources": dict(self.answer_sources),
            "cv_sha256": self.cv_sha256,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "Receipt":
        sha = str(value.get("cv_sha256", ""))
        return cls(
            Path(str(value.get("screenshot_path", ""))),
            str(value.get("confirmation_url", "")),
            str(value.get("confirmation_text", "")),
            str(value.get("captured_at", "")) or _utc_now(),
            _answer_sources(value.get("answer_sources")),
            sha if re.fullmatch(r"[0-9a-f]{64}", sha) else "",
        )


@dataclass
class FlowCheckpoint:
    position_id: int
    url: str
    state: str = "detect"
    platform: str = ""
    completed_steps: list[str] = field(default_factory=list)
    submit_started: bool = False
    submit_started_at: str = ""
    blocked_reason: str = ""
    blocked_detail: str = ""
    resume_state: str = ""
    receipt: dict[str, Any] | None = None
    answer_request: dict[str, Any] | None = None
    # Set only when the application control is a mailto: link.  The browser
    # flow stops there; the email channel reads these two fields.
    channel: str = ""
    mailto_href: str = ""
    # The page as it looked when the flow last stopped (blocked, denied or an
    # error), saved next to the checkpoint.  Empty when no page was open.
    stop_screenshot: str = ""
    # Key → user / profile / agent_inferred for every saved answer the form used.
    answer_sources: dict[str, str] = field(default_factory=dict)
    # Question key → {digest, count} of the worked-out value the form refused.
    answer_refusals: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Page 1 of the CV PDF as rendered when the layout check stopped the flow.
    cv_preview: str = ""
    # The application address a board handed the flow to (LinkedIn → company
    # ATS).  `url` stays the address the queue asked for.
    handoff_url: str = ""
    # The form as it was right before the submit click, when a recipe saves it.
    pre_submit_screenshot: str = ""
    # The last step a multi-step form (LinkedIn Easy Apply) reached.
    modal_step: int = 0
    # sha256 of the CV file as the flow handed it to the form (see Receipt).
    cv_sha256: str = ""
    # The vacancy page as the browser last opened it: HTTP status and
    # scheme://host/path (no query).  None / "" before any navigation.
    http_status: int | None = None
    final_url: str = ""
    # Temporary page failures (5xx, timeout) in the last 24 hours, and the
    # instant before which a retry_later checkpoint is not opened again.
    transient_failures: list[str] = field(default_factory=list)
    retry_after: str = ""
    version: int = CHECKPOINT_VERSION
    updated_at: str = field(default_factory=_utc_now)

    @classmethod
    def new(cls, position_id: int, url: str) -> "FlowCheckpoint":
        return cls(position_id=int(position_id), url=url)

    @classmethod
    def load(cls, path: Path, position_id: int, url: str) -> "FlowCheckpoint":
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return cls.new(position_id, url)
        except (OSError, ValueError, TypeError) as exc:
            raise FlowError(f"checkpoint cannot be read: {exc}") from exc
        if not isinstance(raw, dict) or raw.get("version") != CHECKPOINT_VERSION:
            raise FlowError("checkpoint has an unknown format")
        if raw.get("position_id") != int(position_id) or raw.get("url") != url:
            raise FlowError("checkpoint belongs to a different application")
        valid_states = set(STEP_ORDER) | {
            "blocked_human",
            "denied",
            "dry_run",
            "complete",
            EMAIL_CHANNEL_STATE,
            page_failure.RETRY_LATER_STATE,
        }
        if raw.get("state") not in valid_states:
            raise FlowError("checkpoint has an unknown state")
        completed = raw.get("completed_steps")
        if not isinstance(completed, list) or any(step not in STEP_ORDER for step in completed):
            raise FlowError("checkpoint has invalid completed steps")
        if not isinstance(raw.get("submit_started"), bool):
            raise FlowError("checkpoint has an invalid submit marker")
        if raw.get("receipt") is not None and not isinstance(raw.get("receipt"), dict):
            raise FlowError("checkpoint has an invalid receipt")
        if raw.get("answer_request") is not None and not isinstance(
            raw.get("answer_request"), dict
        ):
            raise FlowError("checkpoint has an invalid answer request")
        if raw.get("channel", "") not in {"", "email"} or not isinstance(raw.get("mailto_href", ""), str):
            raise FlowError("checkpoint has an invalid application channel")
        if raw.get("state") == EMAIL_CHANNEL_STATE and not (
            raw.get("channel") == "email" and str(raw.get("mailto_href", "")).lower().startswith("mailto:")
        ):
            raise FlowError("checkpoint email channel has no mailto target")
        if not isinstance(raw.get("stop_screenshot", ""), str):
            raise FlowError("checkpoint has an invalid stop screenshot")
        if not isinstance(raw.get("answer_sources", {}), dict):
            raise FlowError("checkpoint has invalid answer sources")
        raw = {**raw, "answer_sources": _answer_sources(raw.get("answer_sources", {}))}
        refusals = raw.get("answer_refusals", {})
        if not isinstance(refusals, dict) or any(
            not isinstance(entry, dict)
            or not isinstance(entry.get("digest"), str)
            or isinstance(entry.get("count"), bool)
            or not isinstance(entry.get("count"), int)
            for entry in refusals.values()
        ):
            raise FlowError("checkpoint has invalid answer refusals")
        if not isinstance(raw.get("cv_preview", ""), str):
            raise FlowError("checkpoint has an invalid CV preview")
        if not isinstance(raw.get("handoff_url", ""), str) or not isinstance(
            raw.get("pre_submit_screenshot", ""), str
        ):
            raise FlowError("checkpoint has an invalid handoff or pre-submit screenshot")
        if not isinstance(raw.get("cv_sha256", ""), str):
            raise FlowError("checkpoint has an invalid CV digest")
        step = raw.get("modal_step", 0)
        if isinstance(step, bool) or not isinstance(step, int) or step < 0:
            raise FlowError("checkpoint has an invalid form step")
        status = raw.get("http_status")
        if status is not None and (isinstance(status, bool) or not isinstance(status, int)):
            raise FlowError("checkpoint has an invalid HTTP status")
        if not isinstance(raw.get("final_url", ""), str) or not isinstance(raw.get("retry_after", ""), str):
            raise FlowError("checkpoint has an invalid page access record")
        failures = raw.get("transient_failures", [])
        if not isinstance(failures, list) or any(not isinstance(item, str) for item in failures):
            raise FlowError("checkpoint has invalid transient failures")
        if raw.get("state") == page_failure.RETRY_LATER_STATE and not raw.get("retry_after"):
            raise FlowError("checkpoint waits for a retry with no retry time")
        known = {name for name in cls.__dataclass_fields__}
        return cls(**{name: value for name, value in raw.items() if name in known})

    def complete_step(self, step: str, next_state: str) -> None:
        if step not in self.completed_steps:
            self.completed_steps.append(step)
        self.state = next_state
        self.blocked_reason = ""
        self.blocked_detail = ""
        self.resume_state = ""

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            path.parent.chmod(0o700)
        except OSError:
            pass
        self.updated_at = _utc_now()
        payload = {
            name: getattr(self, name)
            for name in self.__dataclass_fields__
        }
        handle = None
        temporary = ""
        try:
            handle = tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=path.parent,
                prefix=f".{path.name}.",
                delete=False,
            )
            temporary = handle.name
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
            handle.close()
            os.chmod(temporary, 0o600)
            os.replace(temporary, path)
        except Exception:
            if handle and not handle.closed:
                handle.close()
            if temporary:
                with contextlib.suppress(OSError):
                    os.unlink(temporary)
            raise


@dataclass(frozen=True)
class FlowResult:
    status: str
    state: str
    reason: str = ""
    receipt: Receipt | None = None
    # What the CLOSER has to work out before a rerun: the essential facts
    # still unknown, or the one form question the flow stopped on.
    missing: tuple[str, ...] = ()
    pending_question: Mapping[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "status": self.status,
            "state": self.state,
            "reason": self.reason,
            "receipt": self.receipt.to_dict() if self.receipt else None,
        }
        if self.missing:
            out["missing"] = list(self.missing)
        if self.pending_question:
            out["pending_question"] = dict(self.pending_question)
        return out


@dataclass(frozen=True)
class _DeniedVerdict:
    reason: str
    detail: str
    context: dict[str, Any] = field(default_factory=dict)
    allowed: bool = False

    def log_line(self) -> str:
        return f"[apply-gate] DENY {self.reason} — {self.detail}"


def _default_gate_checker(**kwargs):
    try:
        from apply_gate import apply_verdict
    except ImportError:
        try:
            from shared.skills.apply_gate import apply_verdict
        except ImportError:
            return _DeniedVerdict(
                "gate_missing",
                "shared/skills/apply_gate.py is unavailable; submission is closed",
            )
    try:
        return apply_verdict(**kwargs)
    except Exception as exc:
        return _DeniedVerdict(
            "gate_error",
            f"the authorisation gate could not decide ({type(exc).__name__})",
        )


def _default_notifier(
    *, position_id: int, message: str, answer_request: Mapping[str, Any] | None = None
) -> str:
    candidates = [
        shutil.which("jht-notify-user"),
        "/app/agents/_tools/jht-notify-user",
        str(Path(__file__).resolve().parents[2] / "agents" / "_tools" / "jht-notify-user"),
    ]
    executable = next((value for value in candidates if value and Path(value).is_file()), None)
    if not executable:
        raise FlowError("jht-notify-user is unavailable")
    command = [
        executable,
        "--agent",
        "closer",
        "--kind",
        "question",
        "--position-id",
        str(position_id),
    ]
    if os.environ.get("JHT_APPLY_FLOW_NO_EXTERNAL_NOTIFY") == "1":
        command.append("--no-telegram")
    if answer_request:
        command.extend(
            [
                "--existing-id",
                str(answer_request["message_id"]),
                "--source-id",
                str(answer_request["source_id"]),
                "--source-action",
                "closer_application_answer",
                "--source-payload",
                json.dumps(answer_request["payload"], ensure_ascii=False, sort_keys=True),
            ]
        )
    command.append(message)
    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise FlowError(f"jht-notify-user failed with exit {result.returncode}")
    notification_id = result.stdout.strip().split(maxsplit=1)[0]
    if not notification_id.isdigit():
        raise FlowError("jht-notify-user returned no durable message id")
    return notification_id


def _default_essentials_checker(
    *, profile: Mapping[str, Any], position_id: int, db_path: str | Path | None
) -> list[str]:
    """Ask each missing essential fact once (Telegram first); return what is missing."""
    db = _resolve_db_path(db_path)
    with contextlib.closing(sqlite3.connect(db, timeout=10)) as conn:
        result = application_answers.ensure_essentials(conn, profile, position_id)
    return list(result["missing"])


def _read_only_essentials(
    *, profile: Mapping[str, Any], position_id: int, db_path: str | Path | None
) -> list[str]:
    """What is missing, without asking: a dry run has no effect on the user."""
    db = _resolve_db_path(db_path)
    if not db.is_file():
        raise FlowError("jobs.db not found")
    with contextlib.closing(
        sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True, timeout=10)
    ) as conn:
        return list(application_answers.check_essentials(conn, profile)["missing"])


class CvCheckUnavailable(FlowError):
    """The CV PDF could not be measured: not a pass."""


_CV_REASON = re.compile(r"^[a-z][a-z0-9_]{0,40}$")


def _cv_pdf_check_module():
    try:
        import pdf_layout_check as cv_pdf_check
    except ImportError:
        try:
            from shared.skills import pdf_layout_check as cv_pdf_check
        except ImportError as exc:
            raise CvCheckUnavailable("pdf_layout_check is not installed") from exc
    return cv_pdf_check


def _default_cv_checker(cv_path: Path) -> Mapping[str, Any]:
    """The shared visual check of the CV PDF (`pdf_layout_check.analyze`)."""
    module = _cv_pdf_check_module()
    try:
        return module.analyze(Path(cv_path))
    except module.CheckError as exc:
        raise CvCheckUnavailable(type(exc).__name__) from exc


def _default_cv_previewer(cv_path: Path, target: Path) -> None:
    _cv_pdf_check_module().render_preview(Path(cv_path), Path(target))


def _default_cap_reserver(*, position_id: int, db_path: str | Path | None):
    """One slot of today's cap, atomically, before the irreversible click."""
    try:
        from apply_gate import reserve_daily_slot
    except ImportError:
        try:
            from shared.skills.apply_gate import reserve_daily_slot
        except ImportError:
            return _DeniedVerdict("gate_missing", "shared/skills/apply_gate.py is unavailable; submission is closed")
    try:
        return reserve_daily_slot(position_id, "browser", db_path=str(db_path) if db_path else None)
    except Exception as exc:
        return _DeniedVerdict("cap_unreadable", f"the daily cap could not be reserved ({type(exc).__name__})")


def _resolve_db_path(db_path: str | Path | None) -> Path:
    if db_path:
        return Path(db_path)
    if os.environ.get("JHT_DB"):
        return Path(os.environ["JHT_DB"])
    if os.environ.get("JHT_HOME"):
        return Path(os.environ["JHT_HOME"]) / "jobs.db"
    raise FlowError("no database configured: set JHT_DB or JHT_HOME")


def _default_applied_recorder(
    *, position_id: int, receipt: Receipt, db_path: str | Path | None
) -> None:
    if not receipt.is_valid():
        raise FlowError("refusing to record applied without a complete receipt")
    resolved_db = _resolve_db_path(db_path)
    if not resolved_db.is_file():
        raise FlowError("configured jobs database does not exist")

    # A replay after a process crash is harmless only when the effect is read
    # first.  Do not replace a previous channel or timestamp with a new one.
    with sqlite3.connect(resolved_db) as conn:
        existing = conn.execute(
            "SELECT applied, applied_at, applied_via FROM applications WHERE position_id = ?",
            (position_id,),
        ).fetchone()
        position = conn.execute(
            "SELECT status FROM positions WHERE id = ?", (position_id,)
        ).fetchone()
    if (
        existing
        and existing[0] == 1
        and existing[1]
        and existing[2] == "agent_closer"
        and position
        and position[0] == "applied"
    ):
        return
    if existing and existing[0] == 1:
        raise FlowError("application is already applied through a different channel")

    updater = Path(__file__).with_name("db_update.py")
    env = {**os.environ, "JHT_DB": str(resolved_db), "JHT_AGENT_NAME": "closer"}
    result = subprocess.run(
        [
            sys.executable,
            str(updater),
            "application",
            str(position_id),
            "--applied-at",
            "now",
            "--applied-via",
            "agent_closer",
        ],
        check=False,
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )
    if result.returncode != 0:
        raise FlowError(f"db_update rejected the applied transition (exit {result.returncode})")

    # Exit zero is not the effect.  The command must have atomically changed
    # both sides of the funnel before this function returns success.
    with sqlite3.connect(resolved_db) as conn:
        observed = conn.execute(
            "SELECT applied, applied_at, applied_via FROM applications WHERE position_id = ?",
            (position_id,),
        ).fetchone()
        observed_position = conn.execute(
            "SELECT status FROM positions WHERE id = ?", (position_id,)
        ).fetchone()
    if not (
        observed
        and observed[0] == 1
        and observed[1]
        and observed[2] == "agent_closer"
        and observed_position
        and observed_position[0] == "applied"
    ):
        raise FlowError("db_update returned success but the applied transition is absent")


class AshbyRecipe:
    FIELD_ENTRY = ".ashby-application-form-field-entry"
    QUESTION = ".ashby-application-form-question-title"
    SUBMIT = ".ashby-application-form-submit-button"
    SUCCESS = ".ashby-application-form-success-container"

    _CORE_LABELS = {
        "name": ("name",),
        "full name": ("name",),
        "email": ("contacts", "email"),
        "email address": ("contacts", "email"),
        "phone": ("contacts", "phone"),
        "phone number": ("contacts", "phone"),
        "linkedin": ("contacts", "linkedin"),
        "linkedin profile": ("contacts", "linkedin"),
        "github": ("contacts", "github"),
        "github profile": ("contacts", "github"),
        "website": ("contacts", "website"),
        "personal website": ("contacts", "website"),
        "personal web": ("contacts", "website"),
        "portfolio url": ("contacts", "website"),
        "address": ("contacts", "address"),
        "location": ("location",),
        "current location": ("location",),
        "where do you currently live": ("location",),
        "where are you currently located": ("location",),
    }

    _SEMANTIC_ANSWER_KEYS = (
        (re.compile(r"sponsor|sponsorship", re.I), "sponsorship"),
        (re.compile(r"relocat", re.I), "relocation"),
        (re.compile(r"authorized to work|authorised to work|work authorization", re.I), "work_authorization"),
        (re.compile(r"how did you hear|how you heard", re.I), "how_heard"),
        (re.compile(r"notice period", re.I), "notice_period"),
        (re.compile(r"available to start|start date|availability", re.I), "availability"),
        (re.compile(r"salary expectation|desired salary", re.I), "salary_expectations"),
    )

    def __init__(self, profile: Mapping[str, Any], cv_path: Path):
        self.profile = profile
        self.cv_path = cv_path
        self.answers = self._answer_index(profile.get("application_answers"))
        # Set by the flow: key → origin of each saved answer; unknown means the profile.
        self.answer_origins: Mapping[str, str] = {}
        self.answer_sources: dict[str, str] = {}
        self.last_answer_key = ""

    @staticmethod
    def _answer_index(value: Any) -> dict[str, Any]:
        result: dict[str, Any] = {}
        if isinstance(value, Mapping):
            for key, answer in value.items():
                result[_normalise_label(str(key))] = answer
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, Mapping) and item.get("question"):
                    result[_normalise_label(str(item["question"]))] = item.get("answer")
        return result

    @staticmethod
    def _label(entry) -> str:
        label = entry.locator(AshbyRecipe.QUESTION)
        if label.count():
            return label.first.inner_text().replace("\u00a0", " ").strip()
        controls = entry.locator("input, textarea, select")
        if controls.count():
            return controls.first.get_attribute("id") or ""
        return ""

    @staticmethod
    def _field_path(entry) -> str:
        return entry.get_attribute("data-field-path") or ""

    @staticmethod
    def _required(entry) -> bool:
        if entry.locator("input[required], textarea[required], select[required]").count():
            return True
        label = entry.locator(AshbyRecipe.QUESTION)
        if not label.count():
            return False
        classes = label.first.get_attribute("class") or ""
        return "required" in classes.casefold() or label.first.get_attribute("aria-required") == "true"

    @staticmethod
    def _profile_value(profile: Mapping[str, Any], path: tuple[str, ...]) -> Any:
        value: Any = profile
        for part in path:
            if not isinstance(value, Mapping):
                return None
            value = value.get(part)
        # Core Ashby identity/contact controls are textual.  Coercing a
        # malformed boolean or object to a plausible-looking string would
        # bypass the profile schema instead of failing closed.
        if not isinstance(value, str):
            return None
        return value.strip() or None

    @staticmethod
    def _first_control(entry):
        controls = entry.locator("input:not([type=hidden]), textarea, select")
        return controls.first if controls.count() else None

    @staticmethod
    def _is_answered(entry) -> bool:
        if entry.locator("button[aria-pressed=true]").count():
            return True
        if entry.locator("input[type=radio]:checked, input[type=checkbox]:checked").count():
            return True
        controls = entry.locator("input:not([type=hidden]), textarea, select")
        for index in range(controls.count()):
            control = controls.nth(index)
            control_type = (control.get_attribute("type") or "").casefold()
            if control_type in {"radio", "checkbox"}:
                continue
            if control_type == "file":
                if control.evaluate("element => element.files.length") > 0:
                    return True
            elif control.input_value().strip():
                return True
        return False

    def form_present(self, page) -> bool:
        return page.locator(self.FIELD_ENTRY).count() > 0

    def apply_control_present(self, page) -> bool:
        """The control `open_form` would click; only without it can a closed notice count."""
        return page.get_by_text("Apply for this Job", exact=False).count() > 0

    def _container(self, page, step: str):
        """The one application form every Ashby action is confined to.

        Fields, the CV upload and the submit button are looked up inside it,
        never on the whole page: a newsletter, search box or demo form next to
        the application is not part of the application.  A field entry outside
        that form means the page is not the layout the recipe knows.
        """
        forms = page.locator("form", has=page.locator(self.FIELD_ENTRY))
        if forms.count() != 1:
            raise BlockedHuman(
                "application_form_ambiguous",
                "The Ashby application form cannot be identified as exactly one form",
                step,
            )
        container = forms.first
        if container.locator(self.FIELD_ENTRY).count() != page.locator(self.FIELD_ENTRY).count():
            raise BlockedHuman(
                "application_field_outside_form",
                "An Ashby application field sits outside the application form",
                step,
            )
        return container

    def open_form(self, page) -> None:
        if page.locator(self.FIELD_ENTRY).count():
            self._container(page, "detect")
            return
        apply_link = page.get_by_text("Apply for this Job", exact=False)
        if not apply_link.count():
            raise BlockedHuman(
                "ashby_form_missing",
                "Ashby application form or Apply button was not found",
                "detect",
            )
        if apply_link.count() != 1:
            raise BlockedHuman(
                "ashby_apply_ambiguous",
                "more than one Ashby Apply button was found",
                "detect",
            )
        apply_link.click()
        try:
            page.locator(self.FIELD_ENTRY).first.wait_for(state="attached", timeout=10_000)
        except Exception as exc:
            raise BlockedHuman(
                "ashby_form_missing",
                "Ashby Apply button did not open an application form",
                "detect",
            ) from exc
        self._container(page, "detect")

    def fill_core(self, page) -> None:
        entries = self._container(page, "fill").locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            label = self._label(entry)
            field_path = self._field_path(entry)
            key = _normalise_label(label)
            profile_path = None
            if field_path == "_systemfield_name":
                profile_path = ("name",)
            elif field_path == "_systemfield_email":
                profile_path = ("contacts", "email")
            elif key in self._CORE_LABELS:
                profile_path = self._CORE_LABELS[key]
            if not profile_path:
                continue
            value = self._profile_value(self.profile, profile_path)
            if value is None and profile_path == ("contacts", "email"):
                value = self._profile_value(self.profile, ("email",))
            if value is None:
                value = _profile_fact(self.profile, (profile_path,))
            if value is None:
                present, answer = self._answer_for(label, field_path)
                if present and isinstance(answer, str) and answer.strip():
                    value = answer.strip()
            if value is None:
                if self._required(entry):
                    control = self._first_control(entry)
                    raise _core_fact_missing(
                        "Ashby", label, "fill", (control.get_attribute("type") or "text") if control else "text"
                    )
                continue
            control = self._first_control(entry)
            if control is None:
                raise BlockedHuman(
                    "unknown_required_control",
                    f"Required Ashby field has no recognised control: {_safe_label(label)}",
                    "fill",
                )
            control_type = (control.get_attribute("type") or "").casefold()
            if control_type in {"file", "radio", "checkbox"}:
                continue
            control.fill(str(value))
            self.answer_sources[key or _normalise_label(field_path)] = "profile"

    def upload_cv(self, page) -> None:
        if not self.cv_path.is_file() or self.cv_path.stat().st_size <= 0:
            raise BlockedHuman("cv_missing", "The selected CV file is missing or empty", "upload_cv")
        resume = self._container(page, "upload_cv").locator("#_systemfield_resume")
        if resume.count() != 1 or (resume.first.get_attribute("type") or "") != "file":
            raise BlockedHuman(
                "resume_field_missing",
                "Ashby resume upload field was not found unambiguously",
                "upload_cv",
            )
        resume.first.set_input_files(str(self.cv_path))
        page.wait_for_timeout(100)
        if resume.first.evaluate("element => element.files.length") != 1:
            raise BlockedHuman("upload_rejected", "Ashby did not retain the selected CV", "upload_cv")
        group = resume.first.locator("xpath=ancestor::*[contains(@class, 'ashby-application-form-field-entry')][1]")
        if group.count() and self._visible_error_text(group.first):
            raise BlockedHuman("upload_rejected", "Ashby reported a CV upload error", "upload_cv")

    def _answer_for(self, label: str, field_path: str) -> tuple[bool, Any]:
        keys = [_normalise_label(field_path), _normalise_label(label)]
        for pattern, semantic in self._SEMANTIC_ANSWER_KEYS:
            if pattern.search(label):
                keys.append(_normalise_label(semantic))
        for key in keys:
            if key in self.answers:
                self.answer_sources[key] = self.answer_origins.get(key, "profile")
                self.last_answer_key = key
                return True, self.answers[key]
        return False, None

    @staticmethod
    def _answer_request(entry, label: str) -> dict[str, Any] | None:
        exact_label = _exact_form_text(label)
        key = _normalise_label(exact_label)
        if not exact_label or not key:
            return None
        yes_no = entry.locator(".ashby-application-form-input-yesno-option")
        if yes_no.count():
            return {
                "key": key,
                "label": exact_label,
                "field_type": "radio",
                "options": ["Yes", "No"],
            }
        radios = entry.locator("input[type=radio]")
        if radios.count():
            options = _control_option_labels(radios)
            if not options:
                return None
            return {
                "key": key,
                "label": exact_label,
                "field_type": "radio",
                "options": options,
            }
        select = entry.locator("select")
        if select.count() == 1:
            options = []
            choices = select.first.locator("option")
            for index in range(choices.count()):
                choice = choices.nth(index)
                text = _exact_form_text(choice.inner_text(), maximum=500)
                value = choice.get_attribute("value")
                if text and value not in {None, ""} and text not in options:
                    options.append(text)
            if not options:
                return None
            return {
                "key": key,
                "label": exact_label,
                "field_type": "select",
                "options": options,
            }
        checkboxes = entry.locator("input[type=checkbox]")
        if checkboxes.count() == 1:
            return {
                "key": key,
                "label": exact_label,
                "field_type": "checkbox",
                "options": ["Yes", "No"],
            }
        text = entry.locator("textarea")
        if text.count() == 1:
            return {"key": key, "label": exact_label, "field_type": "textarea", "options": []}
        inputs = entry.locator("input:not([type=hidden]):not([type=file])")
        if inputs.count() == 1:
            input_type = (inputs.first.get_attribute("type") or "text").casefold()
            if input_type in {"text", "email", "tel", "url", "number", "date"}:
                return {"key": key, "label": exact_label, "field_type": input_type, "options": []}
        return None

    def fill_screening(self, page) -> None:
        entries = self._container(page, "screening").locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            field_path = self._field_path(entry)
            if field_path in {"_systemfield_name", "_systemfield_email", "_systemfield_resume"}:
                continue
            label = self._label(entry)
            key = _normalise_label(label)
            if key in self._CORE_LABELS or self._is_answered(entry):
                continue
            present, answer = self._answer_for(label, field_path)
            if not present:
                if self._required(entry):
                    request = self._answer_request(entry, label)
                    if request is None:
                        raise BlockedHuman(
                            "unknown_required_control",
                            f"Ashby required question cannot be represented exactly: {_safe_label(label)}",
                            "screening",
                        )
                    raise BlockedHuman(
                        "required_answer_missing",
                        f"Required Ashby question needs an answer: {_safe_label(label)}",
                        "screening",
                        answer_request=request,
                    )
                continue
            try:
                self._fill_answer(entry, label, answer)
                if not self._is_answered(entry):
                    raise BlockedHuman(
                        "answer_not_accepted",
                        f"Ashby did not retain the answer for: {_safe_label(label)}",
                        "screening",
                    )
            except BlockedHuman as refused:
                raise _inferred_answer_refused(self, refused, lambda: self._answer_request(entry, label)) from None

    def _fill_answer(self, entry, label: str, answer: Any) -> None:
        yes_no = entry.locator(".ashby-application-form-input-yesno-option")
        if yes_no.count():
            if isinstance(answer, bool):
                wanted = "yes" if answer else "no"
            elif isinstance(answer, str) and _normalise_label(answer) in {"yes", "no"}:
                wanted = _normalise_label(answer)
            else:
                raise BlockedHuman(
                    "answer_type_unknown",
                    f"Yes/no question has no explicit boolean answer: {_safe_label(label)}",
                    "screening",
                )
            option = entry.locator(f"button[data-option={wanted}]")
            if option.count() != 1:
                raise BlockedHuman(
                    "unknown_required_control",
                    f"Ashby yes/no options are ambiguous for: {_safe_label(label)}",
                    "screening",
                )
            option.click()
            return

        radios = entry.locator("input[type=radio]")
        if radios.count():
            wanted = _normalise_label(str(answer))
            matches = []
            for index in range(radios.count()):
                radio = radios.nth(index)
                labels = radio.evaluate("element => Array.from(element.labels || []).map(label => label.innerText)")
                if any(_normalise_label(str(value)) == wanted for value in labels):
                    matches.append(radio)
            if len(matches) != 1:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"No single Ashby option matches the saved answer for: {_safe_label(label)}",
                    "screening",
                )
            matches[0].check()
            return

        select = entry.locator("select")
        if select.count() == 1:
            try:
                select.select_option(label=str(answer))
            except Exception as exc:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"Ashby select has no option matching the saved answer for: {_safe_label(label)}",
                    "screening",
                ) from exc
            return

        checkboxes = entry.locator("input[type=checkbox]")
        if checkboxes.count() == 1 and isinstance(answer, bool):
            checkboxes.first.set_checked(answer)
            return

        text = entry.locator("textarea, input:not([type=hidden]):not([type=file])")
        if text.count() == 1 and isinstance(answer, (str, int, float)) and not isinstance(answer, bool):
            rendered = str(answer).strip()
            if not rendered:
                raise BlockedHuman(
                    "required_answer_missing",
                    f"Saved answer is empty for: {_safe_label(label)}",
                    "screening",
                )
            text.first.fill(rendered)
            return

        raise BlockedHuman(
            "unknown_required_control",
            f"Ashby field type is not supported safely: {_safe_label(label)}",
            "screening",
        )

    @staticmethod
    def _visible_error_text(scope) -> str:
        selectors = (
            ".ashby-application-form-error",
            "[role=alert]",
            "[aria-invalid=true]",
        )
        for selector in selectors:
            matches = scope.locator(selector)
            for index in range(matches.count()):
                match = matches.nth(index)
                if match.is_visible():
                    return (match.inner_text() or match.get_attribute("aria-label") or selector).strip()
        return ""

    @staticmethod
    def _challenge_reason(page) -> str:
        selectors = (
            ("iframe[title*='captcha' i]", "captcha"),
            ("iframe[src*='recaptcha' i]", "captcha"),
            ("iframe[src*='hcaptcha' i]", "captcha"),
            ("input[autocomplete='one-time-code']", "two_factor"),
            ("input[name*='otp' i]", "two_factor"),
        )
        for selector, reason in selectors:
            matches = page.locator(selector)
            for index in range(matches.count()):
                match = matches.nth(index)
                if (
                    reason == "captcha"
                    and match.evaluate("element => element.tagName") == "IFRAME"
                    and AshbyRecipe._is_invisible_recaptcha_badge(
                        match.get_attribute("src") or ""
                    )
                ):
                    continue
                if match.is_visible():
                    return reason
        body = page.locator("body")
        text = body.inner_text().casefold() if body.count() else ""
        if any(marker in text for marker in ("verify you are human", "complete the captcha")):
            return "captcha"
        if any(marker in text for marker in ("enter verification code", "two-factor authentication")):
            return "two_factor"
        return ""

    @staticmethod
    def _is_invisible_recaptcha_badge(src: str) -> bool:
        try:
            parsed = urllib.parse.urlsplit(src)
            sizes = urllib.parse.parse_qs(parsed.query).get("size", [])
        except ValueError:
            return False
        return parsed.path.rstrip("/").endswith("/anchor") and any(
            size.casefold() == "invisible" for size in sizes
        )

    def review(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(challenge, f"Ashby requires human intervention ({challenge})", "review")
        error = self._visible_error_text(page)
        if error:
            raise BlockedHuman("form_error", "Ashby reports a form validation error", "review")

        container = self._container(page, "review")
        entries = container.locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            if not self._required(entry):
                continue
            label = self._label(entry)
            if not self._is_answered(entry):
                raise BlockedHuman(
                    "required_field_unanswered",
                    f"Required Ashby field remains unanswered: {_safe_label(label)}",
                    "review",
                )
            controls = entry.locator("input:not([type=hidden]), textarea, select")
            for control_index in range(controls.count()):
                control = controls.nth(control_index)
                control_type = (control.get_attribute("type") or "").casefold()
                if control_type not in {"radio", "checkbox", "file"} and not control.evaluate(
                    "element => element.checkValidity()"
                ):
                    raise BlockedHuman(
                        "field_invalid",
                        f"Ashby rejected the format of: {_safe_label(label)}",
                        "review",
                    )

        # The pre-submit boundary exists only if the final button belongs to the
        # application form: a submit-looking button elsewhere is not it.
        if page.locator(self.SUBMIT).count() != container.locator(self.SUBMIT).count():
            raise BlockedHuman(
                "submit_outside_form",
                "An Ashby submit button sits outside the application form",
                "review",
            )
        submit = container.locator(self.SUBMIT)
        if submit.count() != 1 or not submit.first.is_visible() or not submit.first.is_enabled():
            raise BlockedHuman(
                "submit_unavailable",
                "Ashby submit button is missing, ambiguous, or disabled",
                "review",
            )

    def submit(self, page) -> None:
        # Called once only.  The checkpoint that makes retries impossible is
        # persisted by ApplicationFlow before entering this method.
        self._container(page, "submit").locator(self.SUBMIT).click(timeout=10_000)


class GreenhouseRecipe:
    """Fail-closed adapter for current and legacy public Greenhouse forms."""

    PLATFORM = "greenhouse"
    FORM = "#application-form.application--form, #application_form"
    FIELD_ENTRY = (
        "#application-form .field-wrapper, "
        "#application-form fieldset.phone-input, "
        "#application_form .field"
    )
    SUBMIT = (
        "#application-form button[type=submit], "
        "#application_form button[type=submit], "
        "#application_form input[type=submit]"
    )
    SUCCESS = (
        ".application--confirmation, .application-confirmation, "
        "#application_confirmation, [data-testid=application-confirmation]"
    )

    _CORE_CONTROLS = {
        "first_name": (("first_name",),),
        "last_name": (("last_name",),),
        "preferred_name": (("preferred_name",),),
        "email": (("contacts", "email"), ("email",)),
        # A telephone country, nationality, and current residence are not
        # interchangeable.  Country therefore needs an exact saved answer.
        "country": (),
        "phone": (("contacts", "phone"),),
        "location": (("location",),),
    }
    _CORE_LABELS = {
        "linkedin": (("contacts", "linkedin"),),
        "linkedin profile": (("contacts", "linkedin"),),
        "website": (("contacts", "website"),),
        "website portfolio": (("contacts", "website"),),
        "portfolio": (("contacts", "website"),),
        "location city": (("location",),),
        "current location": (("location",),),
    }
    _SEMANTIC_ANSWER_KEYS = AshbyRecipe._SEMANTIC_ANSWER_KEYS

    def __init__(self, profile: Mapping[str, Any], cv_path: Path):
        self.profile = profile
        self.cv_path = cv_path
        self.answers = AshbyRecipe._answer_index(profile.get("application_answers"))
        self.answer_origins: Mapping[str, str] = {}
        self.answer_sources: dict[str, str] = {}
        self.last_answer_key = ""

    @staticmethod
    def _profile_value(profile: Mapping[str, Any], path: tuple[str, ...]) -> str | None:
        return AshbyRecipe._profile_value(profile, path)

    @staticmethod
    def _entries(page):
        return page.locator(GreenhouseRecipe.FIELD_ENTRY)

    @staticmethod
    def _label(entry) -> str:
        legend = entry.locator("legend")
        if legend.count():
            return legend.first.inner_text().replace("\u00a0", " ").strip()
        controls = entry.locator(
            "input:not([type=hidden]):not([aria-hidden=true]), textarea, select"
        )
        for index in range(controls.count()):
            control = controls.nth(index)
            label = control.get_attribute("aria-label")
            if label:
                return label.replace("\u00a0", " ").strip()
            labelled_by = control.get_attribute("aria-labelledby")
            if labelled_by:
                labelled = entry.locator(f"#{labelled_by}")
                if labelled.count():
                    return labelled.first.inner_text().replace("\u00a0", " ").strip()
            control_id = control.get_attribute("id")
            if control_id:
                associated = entry.locator(f"label[for='{control_id}']")
                if associated.count():
                    return associated.first.inner_text().replace("\u00a0", " ").strip()
        label = entry.locator("label")
        return label.first.inner_text().replace("\u00a0", " ").strip() if label.count() else ""

    @staticmethod
    def _field_key(entry) -> str:
        fieldset = entry.locator("fieldset[id]")
        if fieldset.count():
            return (fieldset.first.get_attribute("id") or "").removesuffix("[]")
        controls = entry.locator(
            "input:not([type=hidden]):not([aria-hidden=true]), textarea, select"
        )
        if not controls.count():
            return ""
        control = controls.first
        return (
            control.get_attribute("name")
            or control.get_attribute("id")
            or ""
        ).removesuffix("[]")

    @staticmethod
    def _required(entry) -> bool:
        if (
            entry.get_attribute("aria-required") == "true"
            or entry.locator("[aria-required=true], input[required], textarea[required], select[required]").count()
            or entry.locator(".required, .asterisk, .field-required").count()
        ):
            return True
        labels = entry.locator("legend, label")
        return any(
            labels.nth(index).inner_text().replace("\u00a0", " ").strip().endswith("*")
            for index in range(labels.count())
        )

    @staticmethod
    def _is_answered(entry) -> bool:
        if entry.locator("input[type=radio]:checked, input[type=checkbox]:checked").count():
            return True
        if entry.locator(".select__single-value, .select__multi-value__label").count():
            return True
        if entry.locator(".file-upload__filename").count():
            return True
        controls = entry.locator(
            "input:not([type=hidden]):not([aria-hidden=true]), textarea, select"
        )
        for index in range(controls.count()):
            control = controls.nth(index)
            control_type = (control.get_attribute("type") or "").casefold()
            if control_type in {"radio", "checkbox"}:
                continue
            if control_type == "file":
                if control.evaluate("element => element.files.length") > 0:
                    return True
            elif control_type != "search" and control.input_value().strip():
                return True
        return False

    def _answer_for(self, label: str, field_key: str) -> tuple[bool, Any]:
        keys = [_normalise_label(field_key), _normalise_label(label)]
        for pattern, semantic in self._SEMANTIC_ANSWER_KEYS:
            if pattern.search(label):
                keys.append(_normalise_label(semantic))
        for key in keys:
            if key in self.answers:
                self.answer_sources[key] = self.answer_origins.get(key, "profile")
                self.last_answer_key = key
                return True, self.answers[key]
        return False, None

    def _core_value(
        self, control_id: str, label: str, paths: tuple[tuple[str, ...], ...]
    ) -> tuple[bool, Any]:
        # profile_facts rule: the profile (own paths, then aliases), then a
        # saved answer; the caller turns a missing required one into a question.
        for path in paths:
            value = self._profile_value(self.profile, path)
            if value is not None:
                self.answer_sources[_normalise_label(label) or _normalise_label(control_id)] = "profile"
                return True, value
        value = _profile_fact(self.profile, paths)
        if value is not None:
            self.answer_sources[_normalise_label(label) or _normalise_label(control_id)] = "profile"
            return True, value
        return self._answer_for(label, control_id)

    @staticmethod
    def _control_label(scope, control) -> str:
        label = control.get_attribute("aria-label")
        if label:
            return label.strip()
        labelled_by = control.get_attribute("aria-labelledby")
        if labelled_by:
            labelled = scope.locator(f"#{labelled_by}")
            if labelled.count():
                return labelled.first.inner_text().replace("\u00a0", " ").strip()
        control_id = control.get_attribute("id") or ""
        associated = scope.locator(f"label[for='{control_id}']") if control_id else None
        if associated is not None and associated.count():
            return associated.first.inner_text().replace("\u00a0", " ").strip()
        return control_id

    @staticmethod
    def _control_required(control) -> bool:
        if (
            control.get_attribute("aria-required") == "true"
            or control.get_attribute("required") is not None
        ):
            return True
        entry = control.locator(
            "xpath=ancestor::*[contains(@class, 'field-wrapper') or "
            "contains(concat(' ', normalize-space(@class), ' '), ' field ') or self::fieldset][1]"
        )
        return bool(entry.count() and GreenhouseRecipe._required(entry.first))

    @staticmethod
    def _fill_scalar(control, label: str, answer: Any, step: str) -> None:
        if not isinstance(answer, (str, int, float)) or isinstance(answer, bool):
            raise BlockedHuman(
                "answer_type_unknown",
                f"Greenhouse text field has no explicit scalar answer: {_safe_label(label)}",
                step,
            )
        rendered = str(answer).strip()
        if not rendered:
            raise BlockedHuman(
                "required_answer_missing",
                f"Saved answer is empty for: {_safe_label(label)}",
                step,
            )
        control.fill(rendered)
        if control.input_value().strip() != rendered:
            raise BlockedHuman(
                "answer_not_accepted",
                f"Greenhouse did not retain the answer for: {_safe_label(label)}",
                step,
            )

    def form_present(self, page) -> bool:
        return page.locator(self.FORM).count() > 0

    def apply_control_present(self, page) -> bool:
        """The control `open_form` would click; only without it can a closed notice count."""
        pattern = re.compile(r"^(apply|apply for this job|click to apply|submit an application)$", re.I)
        return any(page.get_by_role(role, name=pattern).count() for role in ("button", "link"))

    def open_form(self, page) -> None:
        forms = page.locator(self.FORM)
        if forms.count() == 1:
            return
        if forms.count() > 1:
            raise BlockedHuman(
                "greenhouse_form_ambiguous",
                "More than one Greenhouse application form was found",
                "detect",
            )
        candidates = []
        pattern = re.compile(r"^(apply|apply for this job|click to apply|submit an application)$", re.I)
        for role in ("button", "link"):
            matches = page.get_by_role(role, name=pattern)
            for index in range(matches.count()):
                if matches.nth(index).is_visible():
                    candidates.append(matches.nth(index))
        if len(candidates) != 1:
            raise BlockedHuman(
                "greenhouse_form_missing",
                "Greenhouse application form or a single Apply control was not found",
                "detect",
            )
        candidates[0].click()
        try:
            page.locator(self.FORM).first.wait_for(state="attached", timeout=10_000)
        except Exception as exc:
            raise BlockedHuman(
                "greenhouse_form_missing",
                "Greenhouse Apply control did not open an application form",
                "detect",
            ) from exc

    def fill_core(self, page) -> None:
        form = page.locator(self.FORM)
        if form.count() != 1:
            raise BlockedHuman(
                "greenhouse_form_ambiguous",
                "Greenhouse application form is missing or ambiguous",
                "fill",
            )
        scope = form.first
        for control_id, paths in self._CORE_CONTROLS.items():
            matches = scope.locator(f"#{control_id}")
            if not matches.count():
                continue
            if matches.count() != 1:
                raise BlockedHuman(
                    "unknown_required_control",
                    f"Greenhouse core field is ambiguous: {_safe_label(control_id)}",
                    "fill",
                )
            control = matches.first
            label = self._control_label(scope, control)
            required = self._control_required(control)
            if control_id == "country" and control.evaluate("e => !!e.closest('fieldset.phone-input')"):
                # 1967 (patch 20): this "Country*" is the dialling code of the
                # phone number, not where the candidate lives.
                self._fill_phone_country(page, control, label, required)
                continue
            if control.get_attribute("role") == "combobox" or control.evaluate("e => e.tagName") == "SELECT":
                # A core choice (country, location...): the page's options are
                # the only valid answers. 1967 (14/09) stopped on "Country*"
                # and the CLOSER asked the user, though the profile says where
                # they live. Only an exact saved option fills it; otherwise it
                # is a question with the exact options, and the CLOSER picks
                # the one the profile supports (CL-08).
                self._fill_core_choice(page, control, control_id, label, required)
                continue
            present, value = self._core_value(control_id, label, paths)
            if not present:
                if required:
                    raise _core_fact_missing(
                        "Greenhouse", label, "fill", (control.get_attribute("type") or "text").casefold()
                    )
                continue
            self._fill_scalar(control, label, value, "fill")

        entries = self._entries(page)
        for index in range(entries.count()):
            entry = entries.nth(index)
            label = self._label(entry)
            paths = self._CORE_LABELS.get(_normalise_label(label))
            if not paths or self._is_answered(entry):
                continue
            combo = entry.locator("input[role=combobox]")
            if paths == (("location",),) and combo.count() == 1:
                # "Location (City)": a react-select fed by a geocoder, empty
                # until typed into (location_choice).
                self._fill_location_choice(page, entry, combo.first, label, self._required(entry))
                continue
            present, value = self._core_value(self._field_key(entry), label, paths)
            if present:
                self._fill_answer(page, entry, label, value)
            elif self._required(entry):
                raise _core_fact_missing("Greenhouse", label, "fill")

    def _fill_location_choice(self, page, entry, control, label: str, required: bool) -> None:
        _fill_suggested_location(
            self,
            page,
            platform="Greenhouse",
            control=control,
            options=lambda scope=entry: scope.locator("[role=option]"),
            accepted=lambda text, scope=entry: any(
                " ".join(value.split()) == text
                for value in scope.locator(".select__single-value").all_inner_texts()
            ),
            label=label,
            field_key=control.get_attribute("id") or "location",
            required=required,
            step="fill",
        )

    PHONE_COUNTRY_KEY = "phone country"
    _DIALLING_CODE = re.compile(r"\+\s*(\d[\d\s-]{0,7})\s*$")

    @staticmethod
    def _phone_country_options(page, control) -> tuple[Any, list[tuple[str, str, str]]]:
        """Open the dialling-code menu: (listbox, [(option text, country, code digits)])."""
        control.click()
        listbox = None
        try:
            page.wait_for_function(
                "e => { const id = e.getAttribute('aria-controls');"
                " const box = id && document.getElementById(id);"
                " return !!(box && box.querySelector('[role=option]')); }",
                arg=control.element_handle(),
                timeout=5_000,
            )
            listbox = page.locator(f"#{control.get_attribute('aria-controls')}")
        except Exception:
            return None, []
        options: list[tuple[str, str, str]] = []
        # Only the menu this control owns: the page also carries a hidden
        # intl-tel-input country list with its own role=option items.
        found = listbox.locator("[role=option]")
        for index in range(found.count()):
            text = _exact_form_text(found.nth(index).inner_text(), maximum=200)
            match = GreenhouseRecipe._DIALLING_CODE.search(text)
            if text and match:
                code = re.sub(r"\D", "", match.group(1))
                options.append((text, text[: match.start()].strip(), code))
        return listbox, options

    @staticmethod
    def _phone_country_kept(page, container, chosen: str, code: str) -> bool:
        """Did the menu keep the option?  1967 (patch 21): the chosen value shows
        as a flag and "+39" only, never the option's "Italy +39"; and it renders
        a moment after the click."""
        deadline = time.monotonic() + 3
        while True:
            shown = container.locator(".select__single-value") if container.count() else None
            if shown is not None and shown.count():
                text = _exact_form_text(shown.first.inner_text(), maximum=200)
                if text == chosen or ("+" in text and re.sub(r"\D", "", text) == code):
                    return True
            if time.monotonic() >= deadline:
                return False
            page.wait_for_timeout(200)

    def _fill_phone_country(self, page, control, label: str, required: bool) -> None:
        listbox, options = self._phone_country_options(page, control)
        if not options:
            with contextlib.suppress(Exception):
                page.keyboard.press("Escape")
            if not required:
                return
            raise BlockedHuman(
                "unknown_required_control",
                f"Greenhouse phone country options are not readable: {_safe_label(label)}",
                "fill",
            )
        texts = [text for text, _country, _code in options]
        chosen = ""
        saved = self.answers.get(self.PHONE_COUNTRY_KEY)
        if isinstance(saved, str) and saved in texts:
            chosen = saved
            self.answer_sources[self.PHONE_COUNTRY_KEY] = self.answer_origins.get(self.PHONE_COUNTRY_KEY, "profile")
            self.last_answer_key = self.PHONE_COUNTRY_KEY
        candidates = texts
        if not chosen:
            phone = profile_facts.profile_value(self.profile, "phone") or ""
            compact = re.sub(r"[\s().-]", "", phone)
            digits = compact[1:] if compact.startswith("+") else compact[2:] if compact.startswith("00") else ""
            if digits.isdigit():
                matching = [(text, country, code) for text, country, code in options if digits.startswith(code)]
                longest = max((len(code) for _t, _c, code in matching), default=0)
                matching = [item for item in matching if len(item[2]) == longest]
                if len(matching) > 1:
                    # Several countries share the code (+1, +7, +44): the profile's own place decides.
                    place = " ".join(
                        value.casefold()
                        for value in (profile_facts.profile_value(self.profile, "location"), self.profile.get("country"))
                        if isinstance(value, str)
                    )
                    named = [item for item in matching if item[1] and item[1].casefold() in place]
                    matching = named if len(named) == 1 else matching
                if len(matching) == 1:
                    chosen = matching[0][0]
                    self.answer_sources[self.PHONE_COUNTRY_KEY] = "profile"
                elif matching:
                    candidates = [text for text, _country, _code in matching]
        if not chosen:
            with contextlib.suppress(Exception):
                page.keyboard.press("Escape")
            if not required:
                return
            raise BlockedHuman(
                "required_answer_missing",
                f"Greenhouse phone country needs one of the page's dialling codes: {_safe_label(label)}",
                "fill",
                answer_request={
                    "key": self.PHONE_COUNTRY_KEY,
                    "label": "Phone country (dialling code)",
                    "field_type": "select",
                    "options": candidates,
                },
            )
        option = listbox.get_by_role("option", name=chosen, exact=True)
        if option.count() != 1:
            raise BlockedHuman(
                "answer_option_unknown",
                f"Greenhouse phone country option is ambiguous: {_safe_label(label)}",
                "fill",
            )
        option.first.click()
        container = control.locator("xpath=ancestor::*[contains(@class, 'select__container')][1]")
        code = next(item_code for text, _country, item_code in options if text == chosen)
        if not self._phone_country_kept(page, container, chosen, code):
            raise BlockedHuman(
                "answer_not_accepted",
                f"Greenhouse did not keep the phone country: {_safe_label(label)}",
                "fill",
            )

    def _fill_core_choice(self, page, control, control_id: str, label: str, required: bool) -> None:
        entry = control.locator(
            "xpath=ancestor::*[contains(@class, 'field-wrapper') or self::fieldset][1]"
        )
        if not entry.count():
            raise BlockedHuman(
                "unknown_required_control",
                f"Greenhouse core choice has no recognised container: {_safe_label(label)}",
                "fill",
            )
        if control_id == "location" and control.get_attribute("role") == "combobox":
            self._fill_location_choice(page, entry.first, control, label, required)
            return
        present, value = self._answer_for(label, control_id)
        if not present:
            if not required:
                return
            request = self._answer_request(page, entry.first, label)
            if request is None:
                # A text answer never fills a choice: asking for one would only
                # come back as the same question (1967, 15:19Z).
                raise BlockedHuman(
                    "unknown_required_control",
                    f"Greenhouse choice options not readable: {_safe_label(label)}",
                    "fill",
                )
            raise BlockedHuman(
                "required_answer_missing",
                f"Required Greenhouse choice needs one of the page's options: {_safe_label(label)}",
                "fill",
                answer_request=request,
            )
        try:
            self._fill_answer(page, entry.first, label, value)
        except BlockedHuman as refused:
            raise _inferred_answer_refused(
                self, refused, lambda: self._answer_request(page, entry.first, label)
            ) from None

    def upload_cv(self, page) -> None:
        if not self.cv_path.is_file() or self.cv_path.stat().st_size <= 0:
            raise BlockedHuman("cv_missing", "The selected CV file is missing or empty", "upload_cv")
        form = page.locator(self.FORM)
        resume = form.locator("#resume, input[name='resume'], input[name='job_application[resume]']")
        if resume.count() != 1 or (resume.first.get_attribute("type") or "").casefold() != "file":
            raise BlockedHuman(
                "resume_field_missing",
                "Greenhouse resume upload field was not found unambiguously",
                "upload_cv",
            )
        resume.first.set_input_files(str(self.cv_path))
        page.wait_for_timeout(100)
        # Current Greenhouse replaces the file input with an exact filename
        # and a Remove file button after accepting the upload.  Older forms
        # retain the input.  Verify either observable effect; the vanished
        # input by itself is not proof of acceptance.
        retained = form.locator(
            "#resume, input[name='resume'], input[name='job_application[resume]']"
        )
        upload_scope = None
        if retained.count() == 1:
            if retained.first.evaluate("element => element.files.length") != 1:
                raise BlockedHuman(
                    "upload_rejected",
                    "Greenhouse did not retain the selected CV",
                    "upload_cv",
                )
            upload_scope = retained.first.locator(
                "xpath=ancestor::*[contains(@class, 'field-wrapper') or contains(@class, 'field')][1]"
            )
        else:
            filename = form.get_by_text(self.cv_path.name, exact=True)
            try:
                filename.first.wait_for(state="visible", timeout=5_000)
            except Exception as exc:
                raise BlockedHuman(
                    "upload_rejected",
                    "Greenhouse did not show the selected CV filename",
                    "upload_cv",
                ) from exc
            if filename.count() != 1:
                raise BlockedHuman(
                    "upload_rejected",
                    "Greenhouse did not show the selected CV filename",
                    "upload_cv",
                )
            upload_scope = filename.first.locator(
                "xpath=ancestor::*[contains(@class, 'field-wrapper') or contains(@class, 'field')][1]"
            )
            if not upload_scope.count() or "resume" not in _normalise_label(
                upload_scope.first.inner_text()
            ):
                raise BlockedHuman(
                    "upload_rejected",
                    "Greenhouse showed the filename outside the resume field",
                    "upload_cv",
                )
        if upload_scope.count() and self._visible_error_text(upload_scope.first):
            raise BlockedHuman("upload_rejected", "Greenhouse reported a CV upload error", "upload_cv")

    @staticmethod
    def _answer_request(page, entry, label: str) -> dict[str, Any] | None:
        exact_label = _exact_form_text(label)
        key = _normalise_label(exact_label)
        if not exact_label or not key:
            return None
        radios = entry.locator("input[type=radio]")
        if radios.count():
            options = _control_option_labels(radios)
            if not options:
                return None
            return {"key": key, "label": exact_label, "field_type": "radio", "options": options}
        checkboxes = entry.locator("input[type=checkbox]")
        if checkboxes.count():
            if checkboxes.count() == 1:
                return {
                    "key": key,
                    "label": exact_label,
                    "field_type": "checkbox",
                    "options": ["Yes", "No"],
                }
            options = _control_option_labels(checkboxes)
            if not options:
                return None
            return {"key": key, "label": exact_label, "field_type": "checkboxes", "options": options}
        select = entry.locator("select")
        if select.count() == 1:
            options: list[str] = []
            choices = select.first.locator("option")
            for index in range(choices.count()):
                choice = choices.nth(index)
                text = _exact_form_text(choice.inner_text(), maximum=500)
                value = choice.get_attribute("value")
                if text and value not in {None, ""} and text not in options:
                    options.append(text)
            if not options:
                return None
            return {"key": key, "label": exact_label, "field_type": "select", "options": options}
        combo = entry.locator("[role=combobox]")
        if combo.count() == 1:
            combo.first.click()
            options = []
            visible = page.locator("[role=option]")
            # React boards fetch the options after the click (1967, 14/09: read
            # at once they were none, and Country came back as a text question).
            try:
                page.locator("[role=option]:visible").first.wait_for(state="visible", timeout=5_000)
            except Exception:
                pass
            for index in range(visible.count()):
                option = visible.nth(index)
                if option.is_visible():
                    text = _exact_form_text(option.inner_text(), maximum=500)
                    if text and text not in options:
                        options.append(text)
            if not options:
                return None
            return {"key": key, "label": exact_label, "field_type": "select", "options": options}
        if entry.locator("textarea").count() == 1:
            return {"key": key, "label": exact_label, "field_type": "textarea", "options": []}
        inputs = entry.locator(
            "input:not([type=hidden]):not([aria-hidden=true]):not([type=file])"
        )
        if inputs.count() == 1:
            input_type = (inputs.first.get_attribute("type") or "text").casefold()
            if input_type in {"text", "email", "tel", "url", "number", "date"}:
                return {"key": key, "label": exact_label, "field_type": input_type, "options": []}
        return None

    def fill_screening(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(
                challenge,
                f"Greenhouse requires human intervention ({challenge})",
                "screening",
            )
        entries = self._entries(page)
        core_ids = tuple(self._CORE_CONTROLS) + ("resume",)
        for index in range(entries.count()):
            entry = entries.nth(index)
            if any(entry.locator(f"#{control_id}").count() for control_id in core_ids):
                continue
            label = self._label(entry)
            if _normalise_label(label) in self._CORE_LABELS or self._is_answered(entry):
                continue
            field_key = self._field_key(entry)
            present, answer = self._answer_for(label, field_key)
            if not present:
                if self._required(entry):
                    request = self._answer_request(page, entry, label)
                    if request is None:
                        raise BlockedHuman(
                            "unknown_required_control",
                            f"Greenhouse required question cannot be represented exactly: {_safe_label(label)}",
                            "screening",
                        )
                    raise BlockedHuman(
                        "required_answer_missing",
                        f"Required Greenhouse question needs an answer: {_safe_label(label)}",
                        "screening",
                        answer_request=request,
                    )
                continue
            try:
                self._fill_answer(page, entry, label, answer)
                if not self._is_answered(entry):
                    raise BlockedHuman(
                        "answer_not_accepted",
                        f"Greenhouse did not retain the answer for: {_safe_label(label)}",
                        "screening",
                    )
            except BlockedHuman as refused:
                raise _inferred_answer_refused(self, refused, lambda: self._answer_request(page, entry, label)) from None

    def _fill_answer(self, page, entry, label: str, answer: Any) -> None:
        if not entry.count():
            raise BlockedHuman(
                "unknown_required_control",
                f"Greenhouse field has no recognised container: {_safe_label(label)}",
                "screening",
            )
        radios = entry.locator("input[type=radio]")
        if radios.count():
            wanted = _normalise_label(str(answer))
            matches = []
            for index in range(radios.count()):
                radio = radios.nth(index)
                labels = radio.evaluate(
                    "element => Array.from(element.labels || []).map(label => label.innerText)"
                )
                if any(_normalise_label(str(value)) == wanted for value in labels):
                    matches.append(radio)
            if len(matches) != 1:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"No single Greenhouse option matches the saved answer for: {_safe_label(label)}",
                    "screening",
                )
            matches[0].check()
            return

        checkboxes = entry.locator("input[type=checkbox]")
        if checkboxes.count():
            if checkboxes.count() == 1 and isinstance(answer, bool):
                checkboxes.first.set_checked(answer)
                return
            values = answer if isinstance(answer, list) else [answer]
            if not values or any(not isinstance(value, (str, int, float)) or isinstance(value, bool) for value in values):
                raise BlockedHuman(
                    "answer_type_unknown",
                    f"Greenhouse checkbox question needs explicit option labels: {_safe_label(label)}",
                    "screening",
                )
            wanted = {_normalise_label(str(value)) for value in values}
            matched: dict[str, Any] = {}
            for index in range(checkboxes.count()):
                checkbox = checkboxes.nth(index)
                labels = checkbox.evaluate(
                    "element => Array.from(element.labels || []).map(label => label.innerText)"
                )
                for option_label in labels:
                    normalised = _normalise_label(str(option_label))
                    if normalised in wanted:
                        matched[normalised] = checkbox
            if set(matched) != wanted:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"Greenhouse checkbox options do not exactly match the saved answer for: {_safe_label(label)}",
                    "screening",
                )
            for checkbox in matched.values():
                checkbox.check()
            return

        select = entry.locator("select")
        if select.count() == 1:
            try:
                select.first.select_option(label=str(answer))
            except Exception as exc:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"Greenhouse select has no option matching the saved answer for: {_safe_label(label)}",
                    "screening",
                ) from exc
            return

        comboboxes = entry.locator("input[role=combobox]")
        if comboboxes.count() == 1:
            values = answer if isinstance(answer, list) else [answer]
            if not values or any(not isinstance(value, (str, int, float)) or isinstance(value, bool) for value in values):
                raise BlockedHuman(
                    "answer_type_unknown",
                    f"Greenhouse select needs explicit option labels: {_safe_label(label)}",
                    "screening",
                )
            for value in values:
                comboboxes.first.click()
                option = page.get_by_role("option", name=str(value), exact=True)
                try:
                    option.first.wait_for(state="visible", timeout=3_000)
                except Exception as exc:
                    raise BlockedHuman(
                        "answer_option_unknown",
                        f"Greenhouse select has no option matching the saved answer for: {_safe_label(label)}",
                        "screening",
                    ) from exc
                if option.count() != 1:
                    raise BlockedHuman(
                        "answer_option_unknown",
                        f"Greenhouse select option is ambiguous for: {_safe_label(label)}",
                        "screening",
                    )
                option.first.click()
            selected = entry.locator(".select__single-value, .select__multi-value__label")
            observed = {_normalise_label(selected.nth(i).inner_text()) for i in range(selected.count())}
            wanted = {_normalise_label(str(value)) for value in values}
            if not wanted.issubset(observed):
                raise BlockedHuman(
                    "answer_not_accepted",
                    f"Greenhouse did not retain the selected answer for: {_safe_label(label)}",
                    "screening",
                )
            return

        text = entry.locator(
            "textarea, input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox]):not([role=combobox])"
        )
        if text.count() == 1:
            self._fill_scalar(text.first, label, answer, "screening")
            return
        raise BlockedHuman(
            "unknown_required_control",
            f"Greenhouse field type is not supported safely: {_safe_label(label)}",
            "screening",
        )

    @staticmethod
    def _visible_error_text(scope) -> str:
        selectors = (
            "[role=alert]",
            ".field-error",
            ".error-message",
            "[id$='-error']",
            "[aria-invalid=true]",
        )
        for selector in selectors:
            matches = scope.locator(selector)
            for index in range(matches.count()):
                match = matches.nth(index)
                if match.is_visible():
                    return (match.inner_text() or match.get_attribute("aria-label") or selector).strip()
        return ""

    @staticmethod
    def _challenge_reason(page) -> str:
        common = AshbyRecipe._challenge_reason(page)
        if common:
            return common
        selectors = (
            "#security_code",
            "input[name='security_code']",
            "input[name*='captcha' i]",
        )
        for selector in selectors:
            matches = page.locator(selector)
            for index in range(matches.count()):
                if matches.nth(index).is_visible():
                    return "captcha"
        body = page.locator("body")
        text = body.inner_text().casefold() if body.count() else ""
        if "verification code" in text and "not a robot" in text:
            return "captcha"
        if "flagged as potential bot traffic" in text:
            return "captcha"
        return ""

    def review(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(
                challenge,
                f"Greenhouse requires human intervention ({challenge})",
                "review",
            )
        if self._visible_error_text(page):
            raise BlockedHuman("form_error", "Greenhouse reports a form validation error", "review")

        entries = self._entries(page)
        for index in range(entries.count()):
            entry = entries.nth(index)
            if not self._required(entry):
                continue
            label = self._label(entry)
            if not self._is_answered(entry):
                raise BlockedHuman(
                    "required_field_unanswered",
                    f"Required Greenhouse field remains unanswered: {_safe_label(label)}",
                    "review",
                )
            controls = entry.locator(
                "input:not([type=hidden]):not([aria-hidden=true]), textarea, select"
            )
            for control_index in range(controls.count()):
                control = controls.nth(control_index)
                control_type = (control.get_attribute("type") or "").casefold()
                if control_type not in {"radio", "checkbox", "file"} and not control.evaluate(
                    "element => element.checkValidity()"
                ):
                    raise BlockedHuman(
                        "field_invalid",
                        f"Greenhouse rejected the format of: {_safe_label(label)}",
                        "review",
                    )

        forms = page.locator(self.FORM)
        if forms.count() == 1 and not forms.first.evaluate(
            "form => typeof form.checkValidity !== 'function' || form.checkValidity()"
        ):
            # A required consent or survey control outside the questions: the
            # browser would refuse the click and nothing would be sent (the
            # same hole HQ-FULLSTACK-2 found in the Lever recipe).
            raise BlockedHuman(
                "required_field_unanswered",
                "A required Greenhouse control outside the application questions is empty or invalid",
                "review",
            )

        submit = page.locator(self.SUBMIT)
        if submit.count() != 1 or not submit.first.is_visible() or not submit.first.is_enabled():
            raise BlockedHuman(
                "submit_unavailable",
                "Greenhouse submit button is missing, ambiguous, or disabled",
                "review",
            )

    def submit(self, page) -> None:
        # ApplicationFlow has already persisted submit_started and repeated
        # the authorisation gate before this irreversible click.
        page.locator(self.SUBMIT).click(timeout=10_000)


class LeverRecipe:
    """Fail-closed adapter for the public Lever application form (jobs.lever.co).

    One page, native controls: `li.application-question` entries inside one
    form, the CV in `input[name=resume]`, one submit button.  Every action is
    confined to that form; a newsletter or search form next to it is not the
    application.
    """

    PLATFORM = "lever"
    VENDOR = "Lever"
    FORM = "form:has(li.application-question)"
    FIELD_ENTRY = "li.application-question"
    SUBMIT = "form:has(li.application-question) button[type=submit]"
    SUCCESS = ".application-confirmation, [data-qa=application-confirmation]"
    _CONTROLS = "input:not([type=hidden]):not([aria-hidden=true]), textarea, select"
    _ERRORS = ("[role=alert]", ".application-error", ".error-message", "[aria-invalid=true]")
    # Lever translates the posting's Apply control with the posting's language.
    _APPLY_LABEL = re.compile(
        r"^\s*(apply|postuler|bewerben|jetzt bewerben|candidati|candidatarsi|candidatar-se|"
        r"candidatura|aplicar|solicitar|jelentkez\w*)\b[^\n]{0,40}$",
        re.I,
    )
    # Lever's own field names.  A full name is one field: the profile's own
    # full name, never joined from first and last names nor split (D1).
    # Current company and "other" links are questions, not profile facts.
    _CORE_NAMES = {
        "name": (("name",),),
        "email": (("contacts", "email"), ("email",)),
        "phone": (("contacts", "phone"),),
        "location": (("location",),),
        "urls[LinkedIn]": (("contacts", "linkedin"),),
        "urls[GitHub]": (("contacts", "github"),),
        "urls[Portfolio]": (("contacts", "website"),),
    }
    _SEMANTIC_ANSWER_KEYS = AshbyRecipe._SEMANTIC_ANSWER_KEYS

    def __init__(self, profile: Mapping[str, Any], cv_path: Path):
        self.profile = profile
        self.cv_path = cv_path
        self.answers = AshbyRecipe._answer_index(profile.get("application_answers"))
        self.answer_origins: Mapping[str, str] = {}
        self.answer_sources: dict[str, str] = {}
        self.last_answer_key = ""

    def _form(self, page, step: str):
        forms = page.locator(self.FORM)
        if forms.count() != 1:
            raise BlockedHuman(
                "lever_form_ambiguous",
                "The Lever application form cannot be identified as exactly one form",
                step,
            )
        form = forms.first
        if form.locator(self.FIELD_ENTRY).count() != page.locator(self.FIELD_ENTRY).count():
            raise BlockedHuman(
                "application_field_outside_form",
                "A Lever application field sits outside the application form",
                step,
            )
        return form

    @staticmethod
    def _label(entry) -> str:
        label = entry.locator(".application-label")
        if label.count():
            text = label.first.evaluate(
                "element => { const copy = element.cloneNode(true);"
                " copy.querySelectorAll('.required').forEach(mark => mark.remove());"
                " return copy.textContent; }"
            )
            return " ".join(str(text or "").replace("\u00a0", " ").split()).rstrip("\u2731*").strip()
        controls = entry.locator(LeverRecipe._CONTROLS)
        if controls.count():
            return (controls.first.get_attribute("aria-label") or "").strip()
        return ""

    @staticmethod
    def _field_key(entry) -> str:
        controls = entry.locator(LeverRecipe._CONTROLS)
        return (controls.first.get_attribute("name") or "") if controls.count() else ""

    @staticmethod
    def _required(entry) -> bool:
        return bool(
            entry.locator(".application-label .required, .required-field").count()
            or entry.locator("[required], [aria-required=true]").count()
        )

    @staticmethod
    def _is_answered(entry) -> bool:
        return AshbyRecipe._is_answered(entry)

    def _answer_for(self, label: str, field_key: str) -> tuple[bool, Any]:
        return GreenhouseRecipe._answer_for(self, label, field_key)

    def _core_value(self, name: str, label: str, paths: tuple[tuple[str, ...], ...]) -> tuple[bool, Any]:
        # profile_facts rule, as for Ashby and Greenhouse: the profile (own
        # paths, then aliases), then a saved answer.  No first + last join:
        # "Test" and "Candidate" say nothing about how the person writes the
        # full name; without one the caller asks for it.
        value = None
        for path in paths:
            value = AshbyRecipe._profile_value(self.profile, path)
            if value is not None:
                break
        if value is None:
            value = _profile_fact(self.profile, paths)
        if value is not None:
            self.answer_sources[_normalise_label(label) or _normalise_label(name)] = "profile"
            return True, value
        return self._answer_for(label, name)

    def _apply_controls(self, page) -> list:
        found = []
        for role in ("link", "button"):
            matches = page.get_by_role(role, name=self._APPLY_LABEL)
            for index in range(matches.count()):
                if matches.nth(index).is_visible():
                    found.append(matches.nth(index))
        return found

    def form_present(self, page) -> bool:
        return page.locator(self.FORM).count() > 0

    def apply_control_present(self, page) -> bool:
        """The control `open_form` would click; only without it can a closed notice count."""
        return bool(self._apply_controls(page))

    def open_form(self, page) -> None:
        if page.locator(self.FORM).count():
            self._form(page, "detect")
            return
        controls = self._apply_controls(page)
        # A posting page repeats "Apply for this job" at the top and bottom:
        # links to one and the same address are one control.
        targets = {
            control.evaluate("element => element.tagName === 'A' ? element.href : ''")
            for control in controls
        }
        if not controls or (len(controls) > 1 and (len(targets) != 1 or "" in targets)):
            raise BlockedHuman(
                "lever_form_missing" if not controls else "lever_apply_ambiguous",
                "Lever application form or a single Apply control was not found",
                "detect",
            )
        controls[0].click()
        try:
            page.locator(self.FORM).first.wait_for(state="attached", timeout=10_000)
        except Exception as exc:
            raise BlockedHuman(
                "lever_form_missing",
                "Lever Apply control did not open an application form",
                "detect",
            ) from exc
        self._form(page, "detect")

    def fill_core(self, page) -> None:
        entries = self._form(page, "fill").locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            name = self._field_key(entry)
            paths = self._CORE_NAMES.get(name)
            if not paths or self._is_answered(entry):
                continue
            label = self._label(entry)
            if name == "location" and entry.locator("input[type=hidden]").count():
                # An autocomplete: the typed text is not the value Lever keeps
                # (the hidden selectedLocation a clicked suggestion fills is).
                control = entry.locator("input[name=location]").first
                hidden = entry.locator("input[type=hidden]").first
                _fill_suggested_location(
                    self,
                    page,
                    platform="Lever",
                    control=control,
                    options=lambda scope=entry: scope.locator(".dropdown-location"),
                    accepted=lambda text, c=control, h=hidden: bool(h.input_value().strip())
                    and " ".join(c.input_value().split()) == text,
                    label=label or name,
                    field_key=name,
                    required=self._required(entry),
                    step="fill",
                )
                continue
            present, value = self._core_value(name, label, paths)
            if not present:
                if self._required(entry):
                    control = entry.locator("input, textarea").first
                    kind = (control.get_attribute("type") or "text").casefold() if control.count() else "text"
                    raise _core_fact_missing("Lever", label or name, "fill", kind)
                continue
            self._fill_answer(entry, label or name, value, "fill")

    def upload_cv(self, page) -> None:
        if not self.cv_path.is_file() or self.cv_path.stat().st_size <= 0:
            raise BlockedHuman("cv_missing", "The selected CV file is missing or empty", "upload_cv")
        resume = self._form(page, "upload_cv").locator("input[name='resume']")
        if resume.count() != 1 or (resume.first.get_attribute("type") or "").casefold() != "file":
            raise BlockedHuman(
                "resume_field_missing",
                "Lever resume upload field was not found unambiguously",
                "upload_cv",
            )
        resume.first.set_input_files(str(self.cv_path))
        page.wait_for_timeout(100)
        if resume.first.evaluate("element => element.files.length") != 1:
            raise BlockedHuman("upload_rejected", "Lever did not retain the selected CV", "upload_cv")
        entry = resume.first.locator("xpath=ancestor::li[contains(@class, 'application-question')][1]")
        if entry.count() and self._visible_error_text(entry.first):
            raise BlockedHuman("upload_rejected", "Lever reported a CV upload error", "upload_cv")

    def fill_screening(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(challenge, f"{self.VENDOR} requires human intervention ({challenge})", "screening")
        entries = self._form(page, "screening").locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            field_key = self._field_key(entry)
            if field_key in self._CORE_NAMES or field_key == "resume" or self._is_answered(entry):
                continue
            label = self._label(entry)
            present, answer = self._answer_for(label, field_key)
            if not present:
                if self._required(entry):
                    request = GreenhouseRecipe._answer_request(page, entry, label)
                    if request is None:
                        raise BlockedHuman(
                            "unknown_required_control",
                            f"{self.VENDOR} required question cannot be represented exactly: {_safe_label(label)}",
                            "screening",
                        )
                    raise BlockedHuman(
                        "required_answer_missing",
                        f"Required {self.VENDOR} question needs an answer: {_safe_label(label)}",
                        "screening",
                        answer_request=request,
                    )
                continue
            try:
                self._fill_answer(entry, label, answer, "screening")
                if not self._is_answered(entry):
                    raise BlockedHuman(
                        "answer_not_accepted",
                        f"{self.VENDOR} did not retain the answer for: {_safe_label(label)}",
                        "screening",
                    )
            except BlockedHuman as refused:
                raise _inferred_answer_refused(
                    self, refused, lambda: GreenhouseRecipe._answer_request(page, entry, label)
                ) from None

    @staticmethod
    def _option_matches(controls, values: list[Any]) -> dict[str, Any]:
        wanted = {_normalise_label(str(value)) for value in values}
        matched: dict[str, Any] = {}
        for index in range(controls.count()):
            control = controls.nth(index)
            labels = control.evaluate(
                "element => Array.from(element.labels || []).map(label => label.innerText)"
            )
            for option_label in labels:
                normalised = _normalise_label(str(option_label))
                if normalised in wanted:
                    if normalised in matched:
                        return {}
                    matched[normalised] = control
        return matched if set(matched) == wanted else {}

    def _fill_answer(self, entry, label: str, answer: Any, step: str) -> None:
        scalar = isinstance(answer, (str, int, float)) and not isinstance(answer, bool)
        radios = entry.locator("input[type=radio]")
        if radios.count():
            matched = self._option_matches(radios, [answer]) if scalar else {}
            if len(matched) != 1:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"No single {self.VENDOR} option matches the saved answer for: {_safe_label(label)}",
                    step,
                )
            next(iter(matched.values())).check()
            return

        checkboxes = entry.locator("input[type=checkbox]")
        if checkboxes.count():
            if checkboxes.count() == 1 and isinstance(answer, bool):
                checkboxes.first.set_checked(answer)
                return
            values = answer if isinstance(answer, list) else [answer]
            if not values or any(
                not isinstance(value, (str, int, float)) or isinstance(value, bool) for value in values
            ):
                raise BlockedHuman(
                    "answer_type_unknown",
                    f"{self.VENDOR} checkbox question needs explicit option labels: {_safe_label(label)}",
                    step,
                )
            matched = self._option_matches(checkboxes, values)
            if not matched:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"{self.VENDOR} checkbox options do not exactly match the saved answer for: {_safe_label(label)}",
                    step,
                )
            for checkbox in matched.values():
                checkbox.check()
            return

        select = entry.locator("select")
        if select.count() == 1:
            try:
                if not scalar:
                    raise ValueError("not a single option label")
                select.first.select_option(label=str(answer))
            except Exception as exc:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"{self.VENDOR} select has no option matching the saved answer for: {_safe_label(label)}",
                    step,
                ) from exc
            return

        text = entry.locator("textarea, input:not([type=hidden]):not([type=file])")
        if text.count() == 1:
            GreenhouseRecipe._fill_scalar(text.first, label, answer, step)
            return
        raise BlockedHuman(
            "unknown_required_control",
            f"{self.VENDOR} field type is not supported safely: {_safe_label(label)}",
            step,
        )

    @staticmethod
    def _visible_error_text(scope) -> str:
        for selector in LeverRecipe._ERRORS:
            matches = scope.locator(selector)
            for index in range(matches.count()):
                match = matches.nth(index)
                if match.is_visible():
                    return (match.inner_text() or match.get_attribute("aria-label") or selector).strip()
        return ""

    @staticmethod
    def _challenge_reason(page) -> str:
        # Lever's hCaptcha is invisible until it challenges: only a visible
        # frame counts, which the common check already requires.
        return AshbyRecipe._challenge_reason(page)

    def review(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(challenge, f"Lever requires human intervention ({challenge})", "review")
        form = self._form(page, "review")
        if self._visible_error_text(form):
            raise BlockedHuman("form_error", "Lever reports a form validation error", "review")
        entries = form.locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            if not self._required(entry):
                continue
            label = self._label(entry)
            if not self._is_answered(entry):
                raise BlockedHuman(
                    "required_field_unanswered",
                    f"Required Lever field remains unanswered: {_safe_label(label)}",
                    "review",
                )
            controls = entry.locator(self._CONTROLS)
            for control_index in range(controls.count()):
                control = controls.nth(control_index)
                control_type = (control.get_attribute("type") or "").casefold()
                if control_type not in {"radio", "checkbox", "file"} and not control.evaluate(
                    "element => element.checkValidity()"
                ):
                    raise BlockedHuman(
                        "field_invalid",
                        f"Lever rejected the format of: {_safe_label(label)}",
                        "review",
                    )
        if not form.evaluate("form => form.checkValidity()"):
            # A required consent or survey control outside the questions: the
            # browser would refuse the click and nothing would be sent.
            raise BlockedHuman(
                "required_field_unanswered",
                "A required Lever control outside the application questions is empty or invalid",
                "review",
            )
        submit = form.locator("button[type=submit]")
        if submit.count() != 1 or not submit.first.is_visible() or not submit.first.is_enabled():
            raise BlockedHuman(
                "submit_unavailable",
                "Lever submit button is missing, ambiguous, or disabled",
                "review",
            )

    def submit(self, page) -> None:
        # ApplicationFlow has already persisted submit_started and repeated
        # the authorisation gate before this irreversible click.
        self._form(page, "submit").locator("button[type=submit]").click(timeout=10_000)


def _file_sha256(path: Path) -> str:
    """sha256 of a file, or "" when it cannot be read (the upload step then stops)."""
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 16), b""):
                digest.update(chunk)
    except OSError:
        return ""
    return digest.hexdigest()


def _linkedin_module():
    """`linkedin_apply`, imported only for a LinkedIn position; None when it is absent."""
    try:
        import linkedin_apply
    except ImportError:
        try:
            from shared.skills import linkedin_apply
        except ImportError:
            return None
    return linkedin_apply


def linkedin_vacancy_host(host: str) -> bool:
    """www.linkedin.com, linkedin.com or a two-letter country page such as es.linkedin.com."""
    host = str(host or "").casefold().rstrip(".")
    return host in LINKEDIN_HOSTS or bool(_LINKEDIN_COUNTRY_HOST.match(host))


def _any_linkedin_host(host: str) -> bool:
    host = str(host or "").casefold().rstrip(".")
    return host == "linkedin.com" or host.endswith(".linkedin.com")


def is_linkedin_job(url: str) -> bool:
    """A LinkedIn vacancy page (`/jobs/…`) over HTTPS, on www or a country page."""
    try:
        parsed = urllib.parse.urlsplit(str(url or "").strip())
        port = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and port in {None, 443}
        and linkedin_vacancy_host(parsed.hostname or "")
        and parsed.path.startswith("/jobs/")
    )


def linkedin_job_url(url: str) -> str:
    """The address the flow opens for a LinkedIn vacancy: https://www.linkedin.com/jobs/view/<id>/.

    A country page (es.linkedin.com) or a slug with the id at its end is the
    same vacancy; www is where the sign-in, the session cookies and the
    English controls the recipe knows live.  Anything else is returned as it is.
    """
    if not is_linkedin_job(url):
        return url
    parts = urllib.parse.urlsplit(str(url).strip())
    found = re.fullmatch(r"/jobs/view/(?:[^/]*-)?(\d{6,})/?", parts.path)
    if found:
        return f"https://www.linkedin.com/jobs/view/{found.group(1)}/"
    # A vacancy selected inside a list (/jobs/collections/…, /jobs/search/…).
    current = urllib.parse.parse_qs(parts.query).get("currentJobId", [])
    if len(current) == 1 and re.fullmatch(r"\d{6,}", current[0]):
        return f"https://www.linkedin.com/jobs/view/{current[0]}/"
    return url


def _optional_module(name: str):
    """A sibling skill module imported only when needed; None when it is absent."""
    import importlib

    for qualified in (name, f"shared.skills.{name}"):
        try:
            return importlib.import_module(qualified)
        except ImportError as exc:
            _OPTIONAL_IMPORT_ERRORS[name] = f"{type(exc).__name__}: {exc}"
            continue
    return None


# Why an optional module could not be imported: logged, never a silent downgrade.
_OPTIONAL_IMPORT_ERRORS: dict[str, str] = {}


def _recipe_class(platform: str):
    if platform == "linkedin":
        module = _linkedin_module()
        return module.LinkedInEasyApplyRecipe if module is not None else None
    if platform == "generic":
        # A company's own careers form (HQ-FULLSTACK-2's apply_generic).
        module = _optional_module("apply_generic")
        return module.GenericRecipe if module is not None else None
    return {"ashby": AshbyRecipe, "greenhouse": GreenhouseRecipe, "lever": LeverRecipe}.get(platform)


class ApplicationFlow:
    def __init__(
        self,
        *,
        position_id: int,
        url: str,
        profile: Mapping[str, Any],
        cv_path: str | Path,
        profile_path: str | Path | None = None,
        checkpoint_path: str | Path | None = None,
        receipt_dir: str | Path | None = None,
        db_path: str | Path | None = None,
        gate_checker: Callable[..., Any] | None = None,
        notifier: Callable[..., str] | None = None,
        applied_recorder: Callable[..., None] | None = None,
        essentials_checker: Callable[..., list[str]] | None = None,
        cap_reserver: Callable[..., Any] | None = None,
        cv_checker: Callable[[Path], Mapping[str, Any]] | None = None,
        cv_previewer: Callable[[Path, Path], None] | None = None,
        code_notifier: Callable[..., str] | None = None,
        login_code_timeout_s: float = 300.0,
        confirmation_timeout_ms: int = 20_000,
        headless: bool = True,
        headed_available: Callable[[], bool] | None = None,
    ):
        if isinstance(position_id, bool) or int(position_id) <= 0:
            raise ValueError("position_id must be a positive integer")
        self.position_id = int(position_id)
        self.url = url.strip()
        self.profile = dict(profile)
        self.profile_path = Path(profile_path) if profile_path else None
        self.cv_path = Path(cv_path)
        jht_home = Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))
        self.checkpoint_path = Path(checkpoint_path) if checkpoint_path else (
            jht_home / ".cache" / "apply-flow" / f"{self.position_id}.json"
        )
        self.receipt_dir = Path(receipt_dir) if receipt_dir else (
            jht_home / "application-receipts"
        )
        self.db_path = db_path
        self.gate_checker = gate_checker or _default_gate_checker
        self.notifier = notifier or _default_notifier
        self.applied_recorder = applied_recorder or _default_applied_recorder
        self.essentials_checker = essentials_checker or _default_essentials_checker
        self.cap_reserver = cap_reserver or _default_cap_reserver
        self.cv_checker = cv_checker or _default_cv_checker
        self.cv_previewer = cv_previewer or _default_cv_previewer
        # LinkedIn's login code request; None = the module's own jht-notify-user call.
        self.code_notifier = code_notifier
        self.login_code_timeout_s = float(login_code_timeout_s)
        self.jht_home = jht_home
        self.confirmation_timeout_ms = max(0, int(confirmation_timeout_ms))
        self.headless = headless
        self.headed_available = headed_available or (
            lambda: page_failure.headed_screen_available(_resolve_headless)
        )
        self._headed_retry_used = False
        self._page_managed = False
        # What _navigate saw; read (and cleared) by _check_page_access.
        self._page_access: page_failure.Access | None = None

    def _gate(self):
        try:
            verdict = self.gate_checker(position_id=self.position_id, db_path=self.db_path)
        except Exception as exc:
            verdict = _DeniedVerdict(
                "gate_error",
                f"the authorisation gate could not decide ({type(exc).__name__})",
            )
        if getattr(verdict, "allowed", None) is not True:
            LOG.warning(getattr(verdict, "log_line", lambda: "[apply-gate] DENY invalid_verdict")())
        return verdict

    @contextlib.contextmanager
    def _managed_page(self) -> Iterator[Any]:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise FlowError("playwright is not installed") from exc
        with sync_playwright() as runtime:
            browser = runtime.chromium.launch(
                headless=self.headless,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            try:
                context = browser.new_context(locale="en-US", viewport={"width": 1280, "height": 900})
                yield context.new_page()
            finally:
                browser.close()

    def _navigate(self, page) -> None:
        try:
            from safe_fetch import resolve_public_address
            from url_guard import check_url
        except ImportError:  # pragma: no cover - package import
            from shared.skills.safe_fetch import resolve_public_address
            from shared.skills.url_guard import check_url
        try:
            checked = check_url(self.url)
            parts = urllib.parse.urlsplit(checked)
            resolve_public_address(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
        except Exception as exc:
            raise BlockedHuman("url_refused", "Application URL failed the public-address guard", "detect") from exc
        # A page that does not open is not decided here: _check_page_access
        # reads this record, and classifies the page itself when a caller
        # replaced this method.
        self._page_access = page_failure.visit(page, checked)
        page.wait_for_timeout(500)

    def _check_page_access(
        self, checkpoint: FlowCheckpoint, page, *, navigated: bool, managed: bool
    ) -> FlowResult | None:
        """What the vacancy page answered, before anything reads it.

        None when the page opened.  A gone page or an anti-bot wall raises
        BlockedHuman; a wall in a headless browser first raises _HeadedRetry
        once; a temporary failure returns retry_later without a stop and
        without a notification.  Never called after submit_started.
        """
        access, self._page_access = self._page_access, None
        if not navigated:
            return None
        if access is None:
            access = page_failure.observe(page)
        access = page_failure.settle(page, access)
        checkpoint.http_status = access.status
        checkpoint.final_url = access.final_url
        closed = ""
        if access.kind == page_failure.NOT_FOUND:
            try:
                language = vacancy_closed_evidence(page.locator("body").inner_text(timeout=5_000))
            except Exception:
                language = None
            if language:
                closed = f"notice language: {language}"
            elif vacancy_redirected_away(self.url, page.url):
                closed = "redirected away from the vacancy"
        decision, history, retry_after = page_failure.decide(
            access,
            headless=self.headless,
            headed_available=managed and self.headed_available(),
            headed_retry_used=self._headed_retry_used,
            closed_evidence=closed,
            transient_history=checkpoint.transient_failures,
        )
        checkpoint.transient_failures = history
        if decision.action == page_failure.PROCEED:
            checkpoint.retry_after = ""
            return None
        if decision.action == page_failure.BLOCK:
            checkpoint.retry_after = ""
            raise BlockedHuman(decision.reason, decision.detail, "detect")
        if decision.action == page_failure.RETRY_HEADED:
            raise _HeadedRetry(access.verdict.evidence)
        checkpoint.state = page_failure.RETRY_LATER_STATE
        checkpoint.retry_after = retry_after
        checkpoint.save(self.checkpoint_path)
        LOG.info(
            "application page temporarily unavailable (%s); retry after %s",
            decision.detail,
            retry_after,
        )
        return FlowResult("retry_later", checkpoint.state, "page_retry_later")

    def _notification_message(
        self, blocked: BlockedHuman, source_id: str = "", *, telegram_hint: bool = True
    ) -> str:
        if blocked.answer_request:
            request = blocked.answer_request
            options = request.get("options") or []
            rendered_options = "\n".join(f"- {value}" for value in options)
            options_text = f"\nOptions:\n{rendered_options}" if rendered_options else ""
            return (
                "CLOSER needs one required application answer before it can continue.\n"
                f"Question: {request['label']}\n"
                f"Field type: {request['field_type']}"
                f"{options_text}\n\n"
                "Reply to this request in the dashboard. The answer is saved under the "
                "question's exact normalized key and reused only for an identical key."
                + (
                    "\n" + application_answers.telegram_hint(source_id)
                    if telegram_hint and source_id
                    else ""
                )
            )
        if blocked.reason in {"required_answer_missing", "required_profile_field_missing"}:
            return (
                "CLOSER stopped before submission because a required application field "
                f"has no saved answer. {blocked.detail} Please add the exact answer to "
                "application_answers and resume this application."
            )
        default = (
            "CLOSER stopped before any blind retry. "
            f"Reason: {blocked.reason}. {blocked.detail} Human review is required."
        )
        notices = _optional_module("closer_notices")
        if notices is None:
            return default
        try:
            # In the user's language; the technical detail stays in brackets.
            return notices.stop_message(blocked.reason, blocked.detail, self.position_id, default=default) or default
        except Exception:
            return default

    def _answer_request_record(self, blocked: BlockedHuman) -> dict[str, Any]:
        payload = {
            "version": 1,
            "position_id": self.position_id,
            "key": str(blocked.answer_request["key"]),
            "label": str(blocked.answer_request["label"]),
            "field_type": str(blocked.answer_request["field_type"]),
            "options": list(blocked.answer_request.get("options") or []),
        }
        # The question as the page asks it now: a field that changed type or
        # options is a new request, never the old one's row (1967, 14/09).
        schema = json.dumps([payload["field_type"], payload["options"]], ensure_ascii=False)
        identity = hashlib.sha256(
            f"{self.position_id}\0{self.url}\0{payload['key']}\0{schema}".encode("utf-8")
        ).hexdigest()[:24]
        return {
            "source_id": f"closer-answer:{self.position_id}:{identity}",
            "message_id": "",
            "notification_attempted": False,
            "asked": False,
            "payload": payload,
        }

    def _persist_answer_request(
        self, checkpoint: FlowCheckpoint, message: str, legacy_message: str = ""
    ) -> None:
        request = checkpoint.answer_request
        if not request:
            raise FlowError("answer request checkpoint is missing")
        payload_text = json.dumps(request["payload"], ensure_ascii=False, sort_keys=True)
        db = _resolve_db_path(self.db_path)
        with sqlite3.connect(db) as conn:
            conn.execute(
                "INSERT OR IGNORE INTO pending_user_messages ("
                "agent, body, kind, related_position_id, source_id, source_action, "
                "source_payload, delivered_via, delivered_at) "
                "VALUES ('closer', ?, 'question', ?, ?, 'closer_application_answer', "
                "?, 'web', CURRENT_TIMESTAMP)",
                (message, self.position_id, request["source_id"], payload_text),
            )
            row = conn.execute(
                "SELECT id, agent, body, kind, related_position_id, source_action, source_payload "
                "FROM pending_user_messages WHERE source_id = ?",
                (request["source_id"],),
            ).fetchone()
            conn.commit()
        expected = (
            "closer",
            message,
            "question",
            self.position_id,
            "closer_application_answer",
            payload_text,
        )
        # A request persisted before the Telegram hint existed keeps its body.
        legacy = expected[:1] + (legacy_message,) + expected[2:] if legacy_message else None
        if not row or (row[1:] != expected and row[1:] != legacy):
            raise FlowError("durable answer request could not be verified")
        request["message_id"] = str(row[0])
        checkpoint.save(self.checkpoint_path)

    def _notify_answer_request_once(
        self, checkpoint: FlowCheckpoint, message: str
    ) -> None:
        request = checkpoint.answer_request
        if not request or request.get("notification_attempted"):
            return
        # At-most-once external notification: persist the marker before the
        # optional channel call. The dashboard row above is the durable ask.
        request["notification_attempted"] = True
        checkpoint.save(self.checkpoint_path)
        self.notifier(
            position_id=self.position_id,
            message=message,
            answer_request=request,
        )

    def _block(
        self,
        checkpoint: FlowCheckpoint,
        blocked: BlockedHuman,
        *,
        page: Any | None = None,
        dry_run: bool = False,
    ) -> FlowResult:
        checkpoint.state = "blocked_human"
        checkpoint.resume_state = blocked.step
        checkpoint.blocked_reason = blocked.reason
        checkpoint.blocked_detail = blocked.detail
        previous_screenshot = self._capture_stop_screenshot(checkpoint, blocked.reason, page)
        if blocked.answer_request:
            # A form question never goes to the user on its own: the CLOSER works
            # the answer out from the profile, the CV and the vacancy, saves it
            # and reruns.  Only its explicit `ask` sends the question
            # (`ask_pending_question`).  In a dry run as in an authorised run.
            candidate = self._answer_request_record(blocked)
            current = checkpoint.answer_request
            stale = getattr(self, "_stale_request", None)
            if not current and stale and self._request_schema(stale) == self._request_schema(candidate):
                # Read again after a new authorisation and still the same field:
                # the same request, asked or not, and its row answerable again.
                checkpoint.answer_request = stale
                self._supersede_request_rows(self._request_schema(stale)[0], restore=str(stale.get("source_id", "")))
            elif not current or self._request_schema(current) != self._request_schema(candidate):
                if current and self._request_schema(current)[0] == self._request_schema(candidate)[0]:
                    # Same question, another shape on the page: the saved
                    # request and its refusals describe a field that is gone.
                    checkpoint.answer_refusals.pop(self._request_schema(current)[0], None)
                self._supersede_request_rows(str(candidate["payload"]["key"]), keep=candidate["source_id"])
                checkpoint.answer_request = candidate
            reason = blocked.reason
            digest = getattr(blocked, "refused_digest", "")
            if digest:
                key = str(candidate["payload"]["key"])
                previous = checkpoint.answer_refusals.get(key) or {}
                count = int(previous.get("count", 0)) + 1 if previous.get("digest") == digest else 1
                checkpoint.answer_refusals[key] = {"digest": digest, "count": count}
                if count >= MAX_INFERRED_REFUSALS:
                    # The CLOSER saved the same refused value again: no more
                    # rounds on it.  The question waits for an explicit ask.
                    reason = "answer_not_accepted"
                    checkpoint.blocked_reason = reason
            self._save_stop(checkpoint, previous_screenshot)
            return FlowResult(
                "blocked_human",
                checkpoint.state,
                reason,
                pending_question=self._pending_question(checkpoint.answer_request),
            )
        message = self._notification_message(blocked)
        self._save_stop(checkpoint, previous_screenshot)
        notices = _optional_module("closer_notices")
        if notices is not None:
            # Every stop joins the round's summary (closer_notices flush at the
            # end of the CLOSER's round): one message, never one per position.
            # Live 14/09: eight positions, eight Telegram alerts, because only
            # the site stops (DIGEST_REASONS) were deferred.  A form question
            # never gets here; it is sent only by the CLOSER's explicit ask.
            try:
                notices.defer(self.position_id, blocked.reason, self.url)
                return FlowResult("blocked_human", checkpoint.state, blocked.reason)
            except Exception as exc:
                LOG.error("stop summary unavailable, notifying now: %s", type(exc).__name__)
        try:
            self.notifier(position_id=self.position_id, message=message)
        except Exception as exc:
            LOG.error("blocked_human notification failed: %s", type(exc).__name__)
        return FlowResult("blocked_human", checkpoint.state, blocked.reason)

    @staticmethod
    def _request_schema(request: Mapping[str, Any]) -> tuple[str, str, tuple[str, ...]]:
        payload = request.get("payload") if isinstance(request.get("payload"), Mapping) else {}
        return (
            str(payload.get("key", "")),
            str(payload.get("field_type", "")),
            tuple(str(option) for option in payload.get("options") or []),
        )

    def _request_row_open(self, request: Mapping[str, Any]) -> bool:
        """Is the dashboard/Telegram row of this asked request still waiting for the user?"""
        source_id = str(request.get("source_id") or "")
        if not source_id:
            return False
        try:
            db = _resolve_db_path(self.db_path)
            if not db.is_file():
                return False
            with contextlib.closing(sqlite3.connect(db, timeout=10)) as conn:
                row = conn.execute(
                    "SELECT 1 FROM pending_user_messages WHERE source_id = ? "
                    "AND source_action = 'closer_application_answer' AND user_reply IS NULL "
                    "AND acknowledged_at IS NULL",
                    (source_id,),
                ).fetchone()
        except Exception as exc:  # noqa: BLE001 — unknown counts as closed: ask again, never wait on it
            LOG.error("reading an answer request row failed: %s", type(exc).__name__)
            return False
        return row is not None

    def _supersede_request_rows(self, key: str, *, keep: str = "", restore: str = "") -> None:
        """Close the open dashboard/Telegram rows of an older shape of this question.

        No user_reply is written: the row leaves the answerable requests
        (`closer_application_answer`), so neither the bridge nor the dashboard
        takes an answer for a field the page no longer has.
        """
        try:
            db = _resolve_db_path(self.db_path)
            if not db.is_file():
                return
            with contextlib.closing(sqlite3.connect(db, timeout=10)) as conn:
                if restore:
                    conn.execute(
                        "UPDATE pending_user_messages SET source_action = 'closer_application_answer', acknowledged_at = NULL "
                        "WHERE source_id = ? AND source_action = 'closer_application_answer_superseded' "
                        "AND user_reply IS NULL",
                        (restore,),
                    )
                    conn.commit()
                    return
                conn.execute(
                    "UPDATE pending_user_messages SET source_action = 'closer_application_answer_superseded', "
                    "acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP) "
                    "WHERE agent = 'closer' AND related_position_id = ? AND source_action = 'closer_application_answer' "
                    "AND user_reply IS NULL AND source_id != ? AND json_extract(source_payload, '$.key') = ?",
                    (self.position_id, keep, key),
                )
                conn.commit()
        except Exception as exc:  # noqa: BLE001 — the stale row is a nuisance, never a reason to stop
            LOG.error("superseding an old answer request failed: %s", type(exc).__name__)

    @staticmethod
    def _request_asked(request: Mapping[str, Any]) -> bool:
        # A checkpoint written before `asked` existed was asked when it has a row.
        return bool(request.get("asked")) or bool(str(request.get("message_id") or "").strip())

    @classmethod
    def _pending_question(cls, request: Mapping[str, Any] | None) -> dict[str, Any] | None:
        """The form question for the CLOSER: what to work out, and how to save it."""
        payload = request.get("payload") if isinstance(request, Mapping) else None
        if not isinstance(payload, Mapping):
            return None
        key = str(payload.get("key", ""))
        field_type = str(payload.get("field_type", ""))
        return {
            "key": key,
            "label": str(payload.get("label", "")),
            "field_type": field_type,
            "options": [str(option) for option in payload.get("options") or []],
            "scope": "company" if field_type == "textarea" or key == "salary expectations" else "global",
            "asked": cls._request_asked(request),
        }

    def ask_pending(self, checkpoint: FlowCheckpoint) -> dict[str, str]:
        """Send the stopped form question to the user: a durable row, then one notification."""
        request = checkpoint.answer_request
        if not request or not isinstance(request.get("payload"), Mapping):
            return {"status": "not_pending", "source_id": ""}
        source_id = str(request.get("source_id", ""))
        if self._request_asked(request):
            return {"status": "already_asked", "source_id": source_id}
        blocked = BlockedHuman(
            "required_answer_missing",
            checkpoint.blocked_detail,
            checkpoint.resume_state or "screening",
            answer_request=request["payload"],
        )
        message = self._notification_message(blocked, source_id)
        legacy_message = self._notification_message(blocked, source_id, telegram_hint=False)
        # The request itself does not depend on Telegram or on the notifier
        # executable: it is committed and reread first, then marked asked.
        self._persist_answer_request(checkpoint, message, legacy_message)
        request["asked"] = True
        checkpoint.save(self.checkpoint_path)
        try:
            self._notify_answer_request_once(checkpoint, message)
        except Exception as exc:
            LOG.error("answer request notification failed: %s", type(exc).__name__)
        return {"status": "asked", "source_id": source_id}

    def _email_channel(self, checkpoint: FlowCheckpoint, page) -> FlowResult | None:
        href = mailto_application_href(page)
        if href is None:
            return None
        checkpoint.channel = "email"
        checkpoint.mailto_href = href
        checkpoint.state = EMAIL_CHANNEL_STATE
        checkpoint.blocked_reason = ""
        checkpoint.blocked_detail = ""
        checkpoint.resume_state = ""
        checkpoint.save(self.checkpoint_path)
        return FlowResult(EMAIL_CHANNEL_STATE, EMAIL_CHANNEL_STATE, "mailto_application")

    def _deny(
        self, checkpoint: FlowCheckpoint, verdict: Any, *, page: Any | None = None
    ) -> FlowResult:
        checkpoint.state = "denied"
        checkpoint.blocked_reason = str(getattr(verdict, "reason", "gate_denied"))
        checkpoint.blocked_detail = str(getattr(verdict, "detail", "authorisation denied"))
        previous_screenshot = self._capture_stop_screenshot(checkpoint, checkpoint.blocked_reason, page)
        self._save_stop(checkpoint, previous_screenshot)
        return FlowResult("denied", checkpoint.state, checkpoint.blocked_reason)

    @staticmethod
    def _reauthorised_since(checkpoint: FlowCheckpoint, verdict: Any) -> bool:
        """Did the user authorise the position again after the checkpoint stopped?

        The same rule the queue uses to lift a checkpoint hold.  An instant
        that cannot be read never counts as a new authorisation.
        """

        def instant(value: Any) -> datetime | None:
            try:
                parsed = datetime.fromisoformat(str(value or "").strip().replace("Z", "+00:00"))
            except ValueError:
                return None
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

        context = getattr(verdict, "context", None)
        authorised = instant(context.get("at")) if isinstance(context, Mapping) else None
        stopped = instant(checkpoint.updated_at)
        return bool(authorised and stopped and authorised > stopped)

    def _release_cap_slot(self, slot: Any) -> None:
        """Give back a reserved slot whose click certainly did not happen."""
        context = getattr(slot, "context", None)
        token = context.get("token") if isinstance(context, Mapping) else None
        if not token:
            return
        try:
            from apply_gate import release_daily_slot
        except ImportError:  # pragma: no cover - package import
            from shared.skills.apply_gate import release_daily_slot
        try:
            release_daily_slot(str(token), db_path=str(self.db_path) if self.db_path else None)
        except Exception as exc:
            LOG.error("cap slot release failed: %s", type(exc).__name__)

    def _cv_layout_stop(self, checkpoint: FlowCheckpoint) -> FlowResult | None:
        """blocked_human when the CV PDF fails the shared visual check or cannot be checked.

        A missing file is left to the upload step (`cv_missing`).  The remedy is
        a regenerated CV, never a question: the stop notifies like any
        blocked_human, and page 1 is rendered next to the checkpoint.
        """
        if not self.cv_path.is_file():
            return None
        try:
            report = self.cv_checker(self.cv_path)
        except Exception as exc:
            reason = "cv_pdf_check_unavailable"
            detail = f"The CV PDF could not be checked ({type(exc).__name__}); nothing is sent"
        else:
            if isinstance(report, Mapping) and report.get("ok") is True:
                return None
            if isinstance(report, Mapping):
                raw = report.get("reasons") if isinstance(report.get("reasons"), list) else []
                reasons = [str(item) for item in raw if isinstance(item, str) and _CV_REASON.match(item)]
                reason = "cv_pdf_layout_bad"
                detail = "The CV PDF layout failed the visual check: " + (", ".join(reasons) or "unspecified")
            else:
                reason = "cv_pdf_check_unavailable"
                detail = "The CV PDF check returned no report; nothing is sent"
        checkpoint.cv_preview = self._render_cv_preview() if reason == "cv_pdf_layout_bad" else ""
        return self._block(checkpoint, BlockedHuman(reason, detail, "upload_cv"))

    def _render_cv_preview(self) -> str:
        """Best effort: page 1 of the CV next to the checkpoint, 0600, tmp then rename."""
        target = self.checkpoint_path.with_name(f"{self.checkpoint_path.stem}.cv-page1.png")
        temporary = target.with_name(f".{target.stem}.partial.png")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            self.cv_previewer(self.cv_path, temporary)
            os.chmod(temporary, 0o600)
            os.replace(temporary, target)
            return str(target)
        except Exception as exc:
            LOG.error("CV preview failed: %s", type(exc).__name__)
            with contextlib.suppress(OSError):
                temporary.unlink()
            return ""

    def _stop_screenshot_prefix(self) -> str:
        return f"{self.checkpoint_path.stem}.stop-"

    def _capture_stop_screenshot(
        self, checkpoint: FlowCheckpoint, reason: str, page: Any | None
    ) -> str:
        """Save the page the flow stopped on next to the checkpoint.

        Best effort and never a reason to fail the stop itself.  The file name
        carries only the checkpoint name, a UTC instant and the reason slug —
        nothing from the profile or the page.  Returns the previous screenshot,
        to be removed once the checkpoint naming the new one is saved.
        """
        previous = checkpoint.stop_screenshot
        checkpoint.stop_screenshot = ""
        if page is None:
            return previous
        temporary: Path | None = None
        try:
            if page.is_closed():
                return previous
            directory = self.checkpoint_path.parent
            directory.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            slug = re.sub(r"[^a-z0-9_]+", "_", str(reason).casefold()).strip("_")[:60] or "stop"
            target = directory / f"{self._stop_screenshot_prefix()}{stamp}-{slug}.png"
            temporary = directory / f".{target.name}.partial.png"
            page.screenshot(path=str(temporary), full_page=True, timeout=10_000)
            os.chmod(temporary, 0o600)
            os.replace(temporary, target)
            temporary = None
            checkpoint.stop_screenshot = str(target)
        except Exception as exc:
            LOG.error("stop screenshot failed: %s", type(exc).__name__)
        finally:
            if temporary is not None:
                with contextlib.suppress(OSError):
                    temporary.unlink()
        return previous

    def _save_stop(self, checkpoint: FlowCheckpoint, previous_screenshot: str) -> None:
        """Save the stopped checkpoint; the screenshot it does not name never stays behind."""
        try:
            checkpoint.save(self.checkpoint_path)
        except Exception:
            # The new screenshot is named by no checkpoint: remove it, keep the old one.
            orphan, checkpoint.stop_screenshot = checkpoint.stop_screenshot, previous_screenshot
            self._discard_stop_screenshot(checkpoint, orphan)
            raise
        self._discard_stop_screenshot(checkpoint, previous_screenshot)

    def _discard_stop_screenshot(self, checkpoint: FlowCheckpoint, previous: str) -> None:
        """Keep one stop screenshot per checkpoint: the one it names."""
        if not previous or previous == checkpoint.stop_screenshot:
            return
        old = Path(previous)
        # Only a file this flow wrote: a tampered checkpoint cannot delete others.
        if old.parent != self.checkpoint_path.parent or not old.name.startswith(
            self._stop_screenshot_prefix()
        ) or old.suffix != ".png":
            return
        with contextlib.suppress(OSError):
            old.unlink()

    def _assert_not_redirected_away(self, page, *, navigated: bool) -> None:
        """Stop before any form work when opening the vacancy landed elsewhere."""
        if navigated and vacancy_redirected_away(self.url, page.url):
            raise BlockedHuman(
                "vacancy_closed",
                "The vacancy URL redirected away from the vacancy (job list, careers or home page)",
                "detect",
            )

    @staticmethod
    def _generic_application_controls(page) -> bool:
        """On a page no recipe knows: any form, or a link or button labelled apply."""
        try:
            if page.locator("form").count():
                return True
            for role in ("button", "link"):
                if page.get_by_role(role, name=_MAILTO_APPLY_LABEL).count():
                    return True
        except Exception:
            return True  # unsure: a closed notice proves nothing here
        return False

    @staticmethod
    def _assert_no_closed_notice(page) -> None:
        """Called only where the page has no form, no Apply control and no email channel.

        There a closed notice is positive evidence.  Next to a form it is not:
        job descriptions say "open until filled" and dates of closing.
        """
        try:
            text = page.locator("body").inner_text(timeout=5_000)
        except Exception:
            return
        language = vacancy_closed_evidence(text)
        if language:
            raise BlockedHuman(
                "vacancy_closed",
                f"The page has no application form and says the vacancy is no longer open (notice language: {language})",
                "detect",
            )

    def _recipe(self, platform: str):
        recipe = _recipe_class(platform)
        if recipe is None:
            raise BlockedHuman(
                "ats_unsupported",
                "Application platform is unknown, conflicting, or has no safe recipe",
                "detect",
            )
        built = recipe(self._profile_with_saved_answers(), self.cv_path)
        built.answer_origins = dict(getattr(self, "answer_origins", {}))
        if callable(getattr(built, "attach", None)):
            # A recipe that works with the user's account needs the flow's
            # home, database and notifier (LinkedIn's session and login code).
            built.attach(self)
        return built

    def _log_dry_run_essentials(self) -> None:
        try:
            missing = _read_only_essentials(
                profile=self.profile, position_id=self.position_id, db_path=self.db_path
            )
        except Exception as exc:
            LOG.warning("dry run: essential facts not readable: %s", type(exc).__name__)
            return
        if missing:
            LOG.warning("dry run: %d essential facts unknown, not asked", len(missing))

    def _profile_with_saved_answers(self) -> dict[str, Any]:
        """The profile with every remembered answer; the database wins over the YAML.

        Also records where each answer comes from (`self.answer_origins`): the
        database says user or agent_inferred; an answer only in the profile is
        the profile.
        """
        merged = dict(self.profile)
        answers = AshbyRecipe._answer_index(self.profile.get("application_answers"))
        origins: dict[str, str] = {}
        try:
            db = _resolve_db_path(self.db_path)
        except FlowError:
            db = None
        if db is not None and db.is_file():
            with contextlib.closing(sqlite3.connect(db, timeout=10)) as conn:
                # Only the profile FILE is imported: a mapping handed in by a
                # caller is not the user's profile and must not become memory.
                if self.profile_path is not None:
                    application_answers.import_profile_answers(conn, self.profile)
                    conn.commit()
                answers.update(application_answers.load_answers(conn, self.position_id))
                resolve = getattr(application_answers, "answer_origins", None)
                if callable(resolve):
                    origins = _answer_sources(resolve(conn, self.position_id))
        merged["application_answers"] = answers
        self.answer_origins = origins
        return merged

    @staticmethod
    def _page_url_on_hosts(url: str, hosts: frozenset[str]) -> bool:
        try:
            parsed = urllib.parse.urlsplit(url)
            port = parsed.port
        except ValueError:
            return False
        return bool(
            parsed.scheme == "https"
            and (parsed.hostname or "").casefold() in hosts
            and port in {None, 443}
        )

    @staticmethod
    def _greenhouse_page_url_trusted(url: str) -> bool:
        return ApplicationFlow._page_url_on_hosts(url, GREENHOUSE_HOSTS)

    @staticmethod
    def _assert_recipe_page(
        page, platform: str, step: str, *, allow_injected_blank: bool = False, application_url: str = ""
    ) -> None:
        if platform not in {"greenhouse", "lever", "linkedin", "generic"}:
            return
        if allow_injected_blank and page.url == "about:blank":
            return
        if platform == "generic":
            # A company form stays on the company's site: the recipe's own rule
            # (sibling subdomains of one company, tenants of a shared suffix apart).
            module = _optional_module("apply_generic")
            try:
                secure = urllib.parse.urlsplit(page.url).scheme == "https"
            except ValueError:
                secure = False
            if not (secure and module is not None and module.same_site(page.url, application_url)):
                raise BlockedHuman(
                    "application_redirect_untrusted",
                    "The company application page left the company's site during the flow",
                    step,
                )
            return
        if platform == "linkedin":
            try:
                parsed = urllib.parse.urlsplit(page.url)
                trusted = parsed.scheme == "https" and parsed.port in {None, 443} and linkedin_vacancy_host(
                    parsed.hostname or ""
                )
            except ValueError:
                trusted = False
            if not trusted:
                raise BlockedHuman(
                    "linkedin_redirect_untrusted",
                    "The LinkedIn page left LinkedIn during the flow",
                    step,
                )
            return
        if platform == "lever":
            if not ApplicationFlow._page_url_on_hosts(page.url, LEVER_HOSTS):
                raise BlockedHuman(
                    "lever_redirect_untrusted",
                    "Lever redirected outside its public job board hosts",
                    step,
                )
            return
        if not ApplicationFlow._greenhouse_page_url_trusted(page.url):
            raise BlockedHuman(
                "greenhouse_redirect_untrusted",
                "Greenhouse redirected outside its three trusted public hosts",
                step,
            )

    @staticmethod
    def _same_confirmation_origin(
        application_url: str, confirmation_url: str, platform: str
    ) -> bool:
        try:
            original = urllib.parse.urlsplit(application_url)
            final = urllib.parse.urlsplit(confirmation_url)
            original_port = original.port
            final_port = final.port
        except ValueError:
            return False
        if original.scheme not in {"http", "https"} or final.scheme != "https":
            return False
        default_ports = {"http": 80, "https": 443}
        if (
            original_port not in {None, default_ports[original.scheme]}
            or final_port not in {None, default_ports[final.scheme]}
        ):
            return False
        original_host = (original.hostname or "").casefold()
        final_host = (final.hostname or "").casefold()
        if platform == "greenhouse":
            # boards.greenhouse.io currently redirects to job-boards.*.  All
            # three exact hosts are one trusted public ATS boundary; no other
            # greenhouse-looking suffix is accepted.
            return original_host in GREENHOUSE_HOSTS and final_host in GREENHOUSE_HOSTS
        if platform == "lever":
            return original_host in LEVER_HOSTS and final_host == original_host
        return bool(original_host and final_host == original_host)

    @staticmethod
    def _confirmation(
        page,
        application_url: str,
        platform: str | None = None,
        *,
        pre_submit: bool = False,
    ) -> tuple[str, str] | None:
        platform = platform or detect_ats(application_url).platform
        recipe = _recipe_class(platform)
        if recipe is None:
            return None
        success = page.locator(recipe.SUCCESS) if recipe.SUCCESS else None
        if success is not None and success.count() and success.first.is_visible():
            text = " ".join(success.first.inner_text().split())[:1000]
            if text:
                return "", text

        body = page.locator("body")
        visible = " ".join(body.inner_text().split()) if body.count() else ""
        markers = (
            "thank you for applying",
            "thanks for applying",
            "application submitted",
            "application received",
            "we have received your application",
            "your application has been submitted",
            "your application is on its way",
        ) + tuple(getattr(recipe, "CONFIRMATION_MARKERS", ()))
        lower = visible.casefold()
        submit_present = page.locator(recipe.SUBMIT).count() > 0
        text_rule = getattr(recipe, "confirmation_text", None)
        if callable(text_rule) and not pre_submit and not text_rule(page):
            # A recipe with its own, stricter reading of a thank-you text (the
            # company form: no form still there, no submit phrase next to it)
            # has the last word on text evidence after the click.
            markers = ()
        for marker in markers:
            offset = lower.find(marker)
            # Before a click this evidence deliberately triggers the
            # confirmation_ambiguous guard.  During crash recovery, employer
            # copy on a reloaded form cannot prove an earlier submission.
            if offset >= 0 and (pre_submit or not submit_present):
                return "", visible[offset : offset + 1000]

        final_url = page.url
        # A changed URL is evidence only when it is an HTTP(S) confirmation
        # URL inside the recipe's trusted origin boundary.  A fresh browser
        # starts at about:blank; accepting any different URL plus an absent
        # form turned a blank page into a valid receipt during crash recovery.
        try:
            final = urllib.parse.urlsplit(final_url)
        except ValueError:
            final = urllib.parse.SplitResult("", "", "", "", "")
        confirmation_url_markers = (
            "confirmation",
            "confirmed",
            "success",
            "submitted",
            "thank-you",
            "thank_you",
        )
        if platform == "lever":
            # Lever lands a submitted application on <posting>/thanks.
            confirmation_url_markers += ("/thanks",)
        confirmation_url_markers += tuple(getattr(recipe, "CONFIRMATION_URL_MARKERS", ()))
        final_route = f"{final.path}?{final.query}".casefold()
        if (
            ApplicationFlow._same_confirmation_origin(
                application_url, final_url, platform
            )
            and final_url != application_url
            and any(marker in final_route for marker in confirmation_url_markers)
            and page.locator(recipe.SUBMIT).count() == 0
        ):
            return final_url, ""
        return None

    def _wait_for_confirmation(self, page, platform: str) -> tuple[str, str] | None:
        recipe = _recipe_class(platform)
        deadline = time.monotonic() + self.confirmation_timeout_ms / 1000
        while True:
            found = self._confirmation(page, self.url, platform)
            if found:
                return found
            challenge = recipe._challenge_reason(page)
            if challenge:
                raise BlockedHuman(
                    challenge,
                    f"{platform.title()} requires human intervention after submit ({challenge})",
                    "submit",
                )
            if time.monotonic() >= deadline:
                return None
            page.wait_for_timeout(min(250, max(1, self.confirmation_timeout_ms)))

    def _capture_receipt(self, page, confirmation: tuple[str, str]) -> Receipt:
        self.receipt_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.receipt_dir.chmod(0o700)
        except OSError:
            pass
        slug = hashlib.sha256(self.url.encode("utf-8")).hexdigest()[:12]
        screenshot = self.receipt_dir / f"{self.position_id}-{slug}-{time.time_ns()}.png"
        try:
            page.screenshot(path=str(screenshot), full_page=True)
            screenshot.chmod(0o600)
        except Exception as exc:
            with contextlib.suppress(OSError):
                screenshot.unlink()
            raise BlockedHuman(
                "receipt_screenshot_failed",
                "Submission confirmation was visible but its screenshot could not be saved",
                "submit",
            ) from exc
        receipt = Receipt(
            screenshot_path=screenshot,
            confirmation_url=confirmation[0],
            confirmation_text=confirmation[1],
        )
        if not receipt.is_valid():
            raise BlockedHuman(
                "receipt_incomplete",
                "Submission confirmation did not produce a complete receipt",
                "submit",
            )
        return receipt

    def _record(self, checkpoint: FlowCheckpoint, receipt: Receipt) -> FlowResult:
        if not receipt.is_valid():
            return self._block(
                checkpoint,
                BlockedHuman("receipt_incomplete", "Saved submission receipt is incomplete", "submit"),
            )
        try:
            self.applied_recorder(
                position_id=self.position_id,
                receipt=receipt,
                db_path=self.db_path,
            )
        except Exception as exc:
            return self._block(
                checkpoint,
                BlockedHuman(
                    "applied_record_failed",
                    f"Submission has a receipt but applied state could not be verified ({type(exc).__name__})",
                    "submit",
                ),
            )
        checkpoint.state = "complete"
        checkpoint.complete_step("submit", "complete")
        checkpoint.receipt = receipt.to_dict()
        checkpoint.save(self.checkpoint_path)
        return FlowResult("applied", checkpoint.state, receipt=receipt)

    @staticmethod
    def _decode_answer_reply(request: Mapping[str, Any], reply: str) -> Any:
        payload = request.get("payload")
        if not isinstance(payload, Mapping):
            raise FlowError("answer request payload is missing")
        field_type = payload.get("field_type")
        options = payload.get("options")
        if not isinstance(options, list) or any(not isinstance(v, str) for v in options):
            raise FlowError("answer request options are invalid")
        exact = reply.strip()
        if not exact:
            raise FlowError("dashboard answer is empty")
        if field_type in {"radio", "select"}:
            if exact not in options:
                raise FlowError("dashboard answer is not an exact offered option")
            return exact
        if field_type == "checkbox":
            if exact == "Yes":
                return True
            if exact == "No":
                return False
            raise FlowError("dashboard answer is not an exact boolean option")
        if field_type == "checkboxes":
            try:
                selected = json.loads(exact)
            except (TypeError, ValueError) as exc:
                raise FlowError("dashboard checkbox answer is not a JSON list") from exc
            if (
                not isinstance(selected, list)
                or not selected
                or any(not isinstance(value, str) or value not in options for value in selected)
                or len(set(selected)) != len(selected)
            ):
                raise FlowError("dashboard checkbox answer has unknown or duplicate options")
            return selected
        if field_type in {"textarea", "text", "email", "tel", "url", "number", "date"}:
            return exact
        raise FlowError("answer request field type is unsupported")

    def _save_application_answer(self, key: str, request: Mapping[str, Any], answer: Any) -> None:
        """Remember the answer in jobs.db, where every later run reads it first.

        The YAML profile is not rewritten any more: an answer kept only there
        was invisible to the email channel and lost whenever the profile was
        regenerated, so a new session asked the same question again.
        """
        payload = request.get("payload") if isinstance(request.get("payload"), Mapping) else {}
        db = _resolve_db_path(self.db_path)
        field_type = str(payload.get("field_type") or "text")
        with contextlib.closing(sqlite3.connect(db, timeout=10)) as conn:
            application_answers.save_answer(
                conn,
                key=key,
                label=str(payload.get("label") or key),
                answer=answer,
                field_type=field_type,
                options=list(payload.get("options") or []),
                channel="reply",
                message_id=int(str(request.get("message_id") or 0)) or None,
                scope=application_answers.answer_scope(conn, field_type, self.position_id),
            )
            conn.commit()
            stored = application_answers.load_answers(conn, self.position_id)
        if key not in stored or stored[key] != answer:
            raise FlowError("saved application answer could not be verified")

    def _resume_dashboard_answer(
        self, checkpoint: FlowCheckpoint
    ) -> FlowResult | None:
        request = checkpoint.answer_request
        if not request:
            return None
        if not self._request_asked(request):
            if self._answer_saved_for(request) and not self._refused_again(checkpoint, request):
                # The CLOSER worked it out and saved it: the question is closed.
                return self._close_answer_request(checkpoint)
            return FlowResult(
                "blocked_human",
                checkpoint.state,
                checkpoint.blocked_reason or "required_answer_missing",
                pending_question=self._pending_question(request),
            )
        try:
            blocked = BlockedHuman(
                "required_answer_missing",
                checkpoint.blocked_detail,
                checkpoint.resume_state or "screening",
                answer_request=request.get("payload"),
            )
            source_id = str(request.get("source_id", ""))
            message = self._notification_message(blocked, source_id)
            legacy_message = self._notification_message(blocked, source_id, telegram_hint=False)
            self._persist_answer_request(checkpoint, message, legacy_message)
            message_id = int(str(request.get("message_id", "")))
            db = _resolve_db_path(self.db_path)
            with sqlite3.connect(db) as conn:
                row = conn.execute(
                    "SELECT user_reply, user_reply_at FROM pending_user_messages "
                    "WHERE id = ? AND agent = 'closer' AND related_position_id = ? "
                    "AND source_id = ? AND source_action = 'closer_application_answer'",
                    (message_id, self.position_id, request.get("source_id")),
                ).fetchone()
            if not row or row[0] is None or row[1] is None:
                if self._answer_saved_for(request):
                    # Asked, then saved another way (the CLOSER, or a Telegram answer).
                    return self._close_answer_request(checkpoint)
                return FlowResult(
                    "blocked_human",
                    checkpoint.state,
                    checkpoint.blocked_reason,
                    pending_question=self._pending_question(request),
                )
            answer = self._decode_answer_reply(request, str(row[0]))
            payload = request.get("payload")
            key = str(payload.get("key", "")) if isinstance(payload, Mapping) else ""
            if not key or key != _normalise_label(key):
                raise FlowError("answer request key is not canonical")
            self._save_application_answer(key, request, answer)
            with sqlite3.connect(db) as conn:
                changed = conn.execute(
                    "UPDATE pending_user_messages SET agent_seen_reply_at = CURRENT_TIMESTAMP "
                    "WHERE id = ? AND user_reply_at IS NOT NULL AND agent_seen_reply_at IS NULL",
                    (message_id,),
                ).rowcount
                conn.commit()
                seen = conn.execute(
                    "SELECT agent_seen_reply_at FROM pending_user_messages WHERE id = ?",
                    (message_id,),
                ).fetchone()
            if changed not in {0, 1} or not seen or not seen[0]:
                raise FlowError("dashboard answer acknowledgement could not be verified")
        except Exception as exc:
            return self._block(
                checkpoint,
                BlockedHuman(
                    "required_answer_missing",
                    f"The dashboard answer could not be persisted safely ({type(exc).__name__})",
                    checkpoint.resume_state or "screening",
                ),
            )
        return self._close_answer_request(checkpoint)

    def _refused_again(self, checkpoint: FlowCheckpoint, request: Mapping[str, Any]) -> bool:
        """The saved value is the one the form already refused too many times."""
        payload = request.get("payload")
        key = str(payload.get("key", "")) if isinstance(payload, Mapping) else ""
        entry = checkpoint.answer_refusals.get(key)
        if not entry:
            return False
        try:
            answers = self._profile_with_saved_answers().get("application_answers") or {}
        except Exception:
            return True
        if getattr(self, "answer_origins", {}).get(key) != "agent_inferred":
            # The user's (or the profile's) answer resets the count of the
            # CLOSER's refused guesses, even when it is the same value.
            checkpoint.answer_refusals.pop(key, None)
            return False
        if int(entry.get("count", 0)) < MAX_INFERRED_REFUSALS:
            return False
        return key in answers and _value_digest(answers[key]) == entry.get("digest")

    def _answer_saved_for(self, request: Mapping[str, Any]) -> bool:
        """A saved answer for this key that fits the question's type and exact options."""
        payload = request.get("payload")
        key = str(payload.get("key", "")) if isinstance(payload, Mapping) else ""
        if not key:
            return False
        try:
            answers = self._profile_with_saved_answers().get("application_answers") or {}
        except Exception as exc:
            LOG.error("saved answers unreadable: %s", type(exc).__name__)
            return False
        return key in answers and _answer_fits(payload, answers[key])

    def _close_answer_request(self, checkpoint: FlowCheckpoint) -> None:
        checkpoint.answer_request = None
        checkpoint.state = checkpoint.resume_state or "screening"
        checkpoint.blocked_reason = ""
        checkpoint.blocked_detail = ""
        checkpoint.resume_state = ""
        checkpoint.save(self.checkpoint_path)
        return None

    def _essentials_stop(self, checkpoint: FlowCheckpoint, mode: str) -> FlowResult | None:
        """The facts almost every form asks for, before the first fill of a position.

        Each missing one is asked once, on Telegram first, and nothing is saved
        in the checkpoint: the position is not held, it waits until the
        answers exist.
        """
        try:
            if mode == "dry_run":
                # A dry run only looks: it never sends the user a question
                # and never stops on a fact it would have asked.
                self._log_dry_run_essentials()
                missing = []
            else:
                missing = self.essentials_checker(
                    profile=self.profile, position_id=self.position_id, db_path=self.db_path
                )
        except Exception as exc:
            LOG.error("essential facts check failed: %s", type(exc).__name__)
            return FlowResult("blocked_human", checkpoint.state, "essential_facts_unavailable")
        if missing:
            return FlowResult(
                "blocked_human",
                checkpoint.state,
                "essential_facts_missing",
                missing=tuple(str(key) for key in missing),
            )
        return None

    def _linkedin_pause(self, checkpoint: FlowCheckpoint) -> FlowResult | None:
        """The pause between LinkedIn applications, before any browser opens.

        Inside the recipe alone, a throttled run still opened LinkedIn with the
        account at every turn of the queue, only to be told to wait.  The
        checkpoint is not touched: nothing happened to the application.  A run
        after submit_started is recovery, never throttled (its own click just
        started the pause).
        """
        if checkpoint.submit_started or not is_linkedin_job(self.url):
            return None
        module = _linkedin_module()
        if module is None:
            return None
        try:
            module.LinkedInSession(
                jht_home=self._jht_home(), db_path=self.db_path, position_id=self.position_id
            ).assert_interval()
        except FlowDeferred as deferred:
            LOG.warning("[apply-flow] DENY %s", deferred.reason)
            return FlowResult("denied", checkpoint.state, deferred.reason)
        return None

    GENERIC_RENDER_WAIT_MS = 10_000

    def _wait_for_company_form(self, page, recipe) -> None:
        """A company page may build its form or its Apply control after load: give it time.

        Bounded, and nothing is clicked while waiting.  The recipe's own checks
        decide afterwards, exactly as on a page that rendered at once.
        """
        deadline = time.monotonic() + self.GENERIC_RENDER_WAIT_MS / 1000
        while True:
            try:
                if recipe.form_present(page) or recipe.apply_control_present(page):
                    return
            except Exception:
                return  # an unreadable page: the recipe's checks say why
            if time.monotonic() >= deadline:
                return
            page.wait_for_timeout(500)

    def _jht_home(self) -> Path:
        return Path(self.jht_home) if self.jht_home else Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))

    def _open_application(self, checkpoint: FlowCheckpoint, page, *, navigate: bool):
        """Detect the platform and open its form: (detection, recipe, injected_blank) or a FlowResult."""
        if is_linkedin_job(self.url):
            detection = replace(detect_ats(self.url), platform="linkedin")
        else:
            detection = detect_ats(self.url, page.content())
        if detection.platform not in SUPPORTED_PLATFORMS:
            email = self._email_channel(checkpoint, page)
            if email is not None:
                return email
            if not detection.url_match and not detection.conflict:
                # The host is no known ATS (a vendor name in the markup is not
                # the host): the company-form recipe always gets its turn and
                # says why when it cannot apply.  2071 (14/09): a quick look
                # right after load saw no form on a page that renders it later,
                # and the recipe was never tried.  A known ATS host without a
                # recipe (Workday, SmartRecruiters…) stays unsupported.
                if _recipe_class("generic") is not None:
                    detection = replace(detection, platform="generic")
                else:
                    LOG.error("[apply-flow] company-form recipe unavailable: %s", _OPTIONAL_IMPORT_ERRORS.get("apply_generic", "absent"))
        if detection.platform not in SUPPORTED_PLATFORMS:
            if not self._generic_application_controls(page):
                self._assert_no_closed_notice(page)
            reason = "ats_conflict" if detection.conflict else "ats_unsupported"
            raise BlockedHuman(
                reason,
                "Application platform is unknown, conflicting, or has no safe recipe",
                "detect",
            )
        checkpoint.platform = detection.platform
        recipe = self._recipe(detection.platform)
        if detection.platform == "generic":
            self._wait_for_company_form(page, recipe)
        # Before any click: an Apply control that opens a mail client is
        # the application channel.  Clicking it would open nothing in
        # the browser and read as a missing form.  A recognised form on
        # the page still wins over an "email us" link next to it.
        if not recipe.form_present(page):
            email = self._email_channel(checkpoint, page)
            if email is not None:
                return email
            if not recipe.apply_control_present(page) and not (
                # On a company page any form or apply-labelled control keeps a
                # notice from counting (a newsletter under "applications closed
                # for this round" proves nothing), as before the recipe existed.
                detection.platform == "generic" and self._generic_application_controls(page)
            ):
                # No Apply control found is not a closed vacancy (a
                # localised board, a slow render): only a notice is.
                self._assert_no_closed_notice(page)
        injected_blank = not navigate and page.url == "about:blank"
        self._assert_recipe_page(page, detection.platform, "detect", allow_injected_blank=injected_blank, application_url=self.url)
        try:
            recipe.open_form(page)
        except BlockedHuman as refused:
            if detection.platform == "generic" and refused.reason == "generic_form_missing":
                # The company-form recipe found nothing to apply with either:
                # the page stays unsupported, with the recipe's own finding.
                raise BlockedHuman(
                    "ats_unsupported",
                    f"No known ATS and no company application form: {refused.detail} (generic_form_missing)",
                    "detect",
                ) from None
            raise
        self._assert_recipe_page(page, detection.platform, "detect", allow_injected_blank=injected_blank, application_url=self.url)
        # Confirm the rendered form too.  URL-only detection is not
        # enough to interact when a block/error page owns that URL.
        if callable(getattr(recipe, "dom_match", None)):
            recognised = bool(recipe.dom_match(page))
        else:
            rendered = detect_ats(self.url, page.content())
            recognised = rendered.platform == detection.platform and rendered.dom_match
        if not recognised:
            raise BlockedHuman(
                f"{detection.platform}_dom_unrecognised",
                f"URL is {detection.platform} but the rendered application form is not recognised",
                "detect",
            )
        return detection, recipe, injected_blank

    def _follow_handoff(
        self, checkpoint: FlowCheckpoint, page, handoff: PlatformHandoff, count: int
    ) -> FlowResult | None:
        """Go on to the site a recipe handed over to, once, or stop."""
        target = handoff.url.strip()
        try:
            parsed = urllib.parse.urlsplit(target)
        except ValueError:
            parsed = urllib.parse.SplitResult("", "", "", "", "")
        host = (parsed.hostname or "").casefold()
        if count > 1:
            allowed, why = False, "a second handoff in one run (handoff_loop)"
        elif parsed.scheme != "https" or not host or _any_linkedin_host(host):
            allowed, why = False, "the handed-over address is not an HTTPS page outside the board"
        elif checkpoint.platform == "linkedin":
            # A board's "apply on company website": any public site, whose
            # recipe detection picks (a known ATS or the company form).
            allowed, why = True, ""
        else:
            platform = detect_ats(target).platform
            allowed = platform in SUPPORTED_PLATFORMS and platform not in {"generic", "linkedin"}
            why = "" if allowed else "the handed-over address is not a platform with a recipe"
        if not allowed:
            raise BlockedHuman("application_redirect_untrusted", f"Handoff refused: {why}", "detect")
        checkpoint.handoff_url = target
        checkpoint.platform = ""
        checkpoint.save(self.checkpoint_path)
        self.url = target
        self._navigate(page)
        # The site handed over to is a page like any other: gone, walled or down.
        waiting = self._check_page_access(
            checkpoint, page, navigated=True, managed=self._page_managed
        )
        if waiting is not None:
            return waiting
        self._assert_not_redirected_away(page, navigated=True)
        return None

    def run(self, *, page: Any | None = None, navigate: bool = True) -> FlowResult:
        # The queue's address names the checkpoint.  self.url is where the
        # browser goes (www for a LinkedIn country page, the company site after
        # a handoff): a second run of this same flow must not compare that.
        queue_url = getattr(self, "_queue_url", "") or self.url
        self._queue_url = queue_url
        try:
            checkpoint = FlowCheckpoint.load(
                self.checkpoint_path, self.position_id, queue_url
            )
            # A multi-step recipe saves its step on the checkpoint of this run.
            self._live_checkpoint = checkpoint
            # A LinkedIn vacancy is opened on www (see linkedin_job_url).
            self.url = linkedin_job_url(queue_url)
        except FlowError as exc:
            checkpoint = FlowCheckpoint.new(self.position_id, queue_url)
            return self._block(
                checkpoint,
                BlockedHuman("checkpoint_invalid", str(exc), "detect"),
            )

        if checkpoint.state == "complete" and checkpoint.receipt:
            receipt = Receipt.from_dict(checkpoint.receipt)
            if receipt.is_valid():
                return FlowResult("applied", "complete", receipt=receipt)

        first_gate = self._gate()
        if getattr(first_gate, "allowed", None) is not True:
            return self._deny(checkpoint, first_gate)
        mode = getattr(first_gate, "context", {}).get("mode")
        if mode not in {"authorised", "dry_run"}:
            return self._deny(
                checkpoint,
                _DeniedVerdict("gate_mode_unknown", "gate returned no recognised application mode"),
            )
        # A recipe that works with the user's account reads it (no sign-in in a dry run).
        self._mode = mode

        if checkpoint.state == EMAIL_CHANNEL_STATE:
            # Detection already handed this position to the email channel; a
            # rerun must not reopen the page and "find" a form again.
            return FlowResult(EMAIL_CHANNEL_STATE, EMAIL_CHANNEL_STATE, "mailto_application")

        if (
            checkpoint.state == "blocked_human"
            and checkpoint.blocked_reason == "vacancy_closed"
            and not self._reauthorised_since(checkpoint, first_gate)
        ):
            # A closed vacancy does not reopen by retrying: no browser, no new
            # notification.  Only the user authorising the position again after
            # this stop makes the next run look at the page once more.
            return FlowResult("blocked_human", checkpoint.state, "vacancy_closed")

        if checkpoint.state == page_failure.RETRY_LATER_STATE:
            if page_failure.retry_pending(
                {"state": checkpoint.state, "retry_after": checkpoint.retry_after}
            ):
                # A temporary page failure: not before retry_after, no browser.
                return FlowResult("retry_later", checkpoint.state, "page_retry_later")
            checkpoint.state = "detect"
        if (
            checkpoint.state == "blocked_human"
            and checkpoint.blocked_reason == "page_temporarily_unavailable"
            and self._reauthorised_since(checkpoint, first_gate)
        ):
            # The user authorised the position again after the third failure:
            # a new series of tries, not a stop at the first 503.
            checkpoint.transient_failures = []

        if (
            checkpoint.answer_request
            and not checkpoint.submit_started
            and self._reauthorised_since(checkpoint, first_gate)
        ):
            # The user authorised the position again after the stop: the page
            # is read again (the field's type and options as they are now),
            # and the old question's rows close without an answer.
            # Kept to come back only while it can still be answered: a question
            # never asked, or one whose row is still open.  1967 (patch 20): the
            # row had been closed (acknowledged) and the same text shape came
            # back as "asked", a question nobody could answer any more.
            stale = checkpoint.answer_request
            self._stale_request = stale if (
                not self._request_asked(stale) or self._request_row_open(stale)
            ) else None
            self._supersede_request_rows(self._request_schema(checkpoint.answer_request)[0])
            self._close_answer_request(checkpoint)

        fresh = (
            checkpoint.state == "detect"
            and not checkpoint.completed_steps
            and not checkpoint.submit_started
            and not checkpoint.answer_request
        )
        waiting = self._resume_dashboard_answer(checkpoint)
        if waiting is not None:
            return waiting

        if not checkpoint.submit_started:
            # The CV that would be attached, checked before the page is touched:
            # a squeezed or unreadable PDF is never sent, and filling a form
            # with it would only have to be undone.
            cv_stop = self._cv_layout_stop(checkpoint)
            if cv_stop is not None:
                return cv_stop

        if checkpoint.submit_started and checkpoint.receipt:
            receipt = Receipt.from_dict(checkpoint.receipt)
            if receipt.is_valid():
                return self._record(checkpoint, receipt)

        # After the answers and the CV, right before the browser: a pending
        # question stays visible to the CLOSER during the pause.
        throttled = self._linkedin_pause(checkpoint)
        if throttled is not None:
            return throttled

        managed = self._page_managed = page is None
        manager = contextlib.nullcontext(page) if page is not None else self._managed_page()
        headed_retry = False
        with manager as active_page:
            if checkpoint.submit_started:
                try:
                    # Production recovery owns a fresh about:blank page.  It
                    # must first observe the real application URL; otherwise
                    # an absent form says nothing about the previous submit.
                    # Reloading will normally show the form again even when
                    # the remote submit succeeded.  Blocking in that case is
                    # intentional: uncertainty cannot authorise a second click.
                    if checkpoint.handoff_url:
                        # The click happened on the site the board handed over to.
                        self.url = checkpoint.handoff_url
                    elif is_linkedin_job(self.url):
                        # Easy Apply's outcome shows only to the signed-in account.
                        module = _linkedin_module()
                        if module is not None:
                            module.restore_session(active_page.context, self._jht_home())
                    if navigate:
                        self._navigate(active_page)
                    recovery_platform = checkpoint.platform or detect_ats(self.url).platform
                    if recovery_platform not in SUPPORTED_PLATFORMS:
                        raise BlockedHuman(
                            "ats_unsupported",
                            "Saved submission has no safe recovery recipe",
                            "submit",
                        )
                    confirmation = self._confirmation(
                        active_page, self.url, recovery_platform
                    )
                    if confirmation:
                        receipt = replace(
                            self._capture_receipt(active_page, confirmation),
                            answer_sources=dict(checkpoint.answer_sources),
                            cv_sha256=checkpoint.cv_sha256,
                        )
                        checkpoint.receipt = receipt.to_dict()
                        checkpoint.save(self.checkpoint_path)
                        return self._record(checkpoint, receipt)
                except Exception:
                    # Navigation failure is still an unknown external outcome,
                    # never permission to retry the irreversible click.
                    pass
                return self._block(
                    checkpoint,
                    BlockedHuman(
                        "submit_outcome_unknown",
                        "A previous process started submit but left no receipt; it will not be clicked again",
                        "submit",
                    ),
                    page=active_page,
                )

            try:
                if is_linkedin_job(self.url):
                    # The saved session goes in before the first request, so the
                    # vacancy page already shows the signed-in apply controls.
                    module = _linkedin_module()
                    if module is not None:
                        module.restore_session(active_page.context, self._jht_home())
                if navigate:
                    self._navigate(active_page)
                waiting = self._check_page_access(
                    checkpoint, active_page, navigated=navigate, managed=managed
                )
                if waiting is not None:
                    return waiting
                self._assert_not_redirected_away(active_page, navigated=navigate)
                handoffs = 0
                while True:
                    try:
                        opened = self._open_application(checkpoint, active_page, navigate=navigate)
                        break
                    except PlatformHandoff as handoff:
                        handoffs += 1
                        waiting = self._follow_handoff(checkpoint, active_page, handoff, handoffs)
                        if waiting is not None:
                            return waiting
                        navigate = True
                if isinstance(opened, FlowResult):
                    return opened
                detection, recipe, injected_blank = opened
                if fresh:
                    # Only now that the page is an application the flow can
                    # really send (a recipe opened its form; not unsupported,
                    # closed or email) are the essential facts worked out.
                    waiting_facts = self._essentials_stop(checkpoint, mode)
                    if waiting_facts is not None:
                        return waiting_facts
                checkpoint.complete_step("detect", "fill")
                # The bytes the recipe is about to upload (a multi-step form
                # uploads while it fills), for the receipt.
                checkpoint.cv_sha256 = _file_sha256(self.cv_path)
                checkpoint.save(self.checkpoint_path)

                recipe.fill_core(active_page)
                checkpoint.answer_sources = dict(recipe.answer_sources)
                self._assert_recipe_page(
                    active_page,
                    detection.platform,
                    "fill",
                    allow_injected_blank=injected_blank,
                    application_url=self.url,
                )
                checkpoint.complete_step("fill", "upload_cv")
                checkpoint.save(self.checkpoint_path)

                recipe.upload_cv(active_page)
                self._assert_recipe_page(
                    active_page,
                    detection.platform,
                    "upload_cv",
                    allow_injected_blank=injected_blank,
                    application_url=self.url,
                )
                checkpoint.complete_step("upload_cv", "screening")
                checkpoint.save(self.checkpoint_path)

                recipe.fill_screening(active_page)
                checkpoint.answer_sources = dict(recipe.answer_sources)
                self._assert_recipe_page(
                    active_page,
                    detection.platform,
                    "screening",
                    allow_injected_blank=injected_blank,
                    application_url=self.url,
                )
                checkpoint.complete_step("screening", "review")
                checkpoint.save(self.checkpoint_path)

                recipe.pre_submit_screenshot_path = str(
                    self.checkpoint_path.parent / f"{self.position_id}-pre-submit-{time.time_ns()}.png"
                )
                recipe.review(active_page)
                if Path(recipe.pre_submit_screenshot_path).is_file():
                    checkpoint.pre_submit_screenshot = recipe.pre_submit_screenshot_path
                self._assert_recipe_page(
                    active_page,
                    detection.platform,
                    "review",
                    allow_injected_blank=injected_blank,
                    application_url=self.url,
                )
                checkpoint.complete_step("review", "submit")
                checkpoint.save(self.checkpoint_path)

                # Confirmation words already visible before the click cannot
                # prove that this click succeeded.  Stop instead of reusing a
                # footer, stale banner, or employer-authored sentence as a
                # receipt after submit.
                if self._confirmation(
                    active_page,
                    self.url,
                    detection.platform,
                    pre_submit=True,
                ):
                    raise BlockedHuman(
                        "confirmation_ambiguous",
                        "Confirmation evidence is already visible before submit",
                        "review",
                    )

                if mode == "dry_run":
                    checkpoint.state = "dry_run"
                    checkpoint.save(self.checkpoint_path)
                    return FlowResult("dry_run", checkpoint.state)

                final_gate = self._gate()
                if getattr(final_gate, "allowed", None) is not True:
                    return self._deny(checkpoint, final_gate, page=active_page)
                if getattr(final_gate, "context", {}).get("mode") != "authorised":
                    return self._deny(
                        checkpoint,
                        _DeniedVerdict(
                            "gate_mode_changed",
                            "application mode changed before submit; refusing the click",
                        ),
                        page=active_page,
                    )

                # The cap, atomically, as the last decision before the click:
                # another run with the last slot waits for this commit and is
                # refused.  The slot counts for the day whatever happens next.
                try:
                    slot = self.cap_reserver(position_id=self.position_id, db_path=self.db_path)
                except Exception as exc:
                    slot = _DeniedVerdict("cap_unreadable", f"the daily cap could not be reserved ({type(exc).__name__})")
                if getattr(slot, "allowed", None) is not True:
                    return self._deny(checkpoint, slot, page=active_page)

                checkpoint.state = "submit"
                checkpoint.submit_started = True
                checkpoint.submit_started_at = _utc_now()
                try:
                    checkpoint.save(self.checkpoint_path)
                except Exception:
                    # No durable submit marker, so no click: the slot goes back.
                    checkpoint.submit_started = False
                    checkpoint.submit_started_at = ""
                    self._release_cap_slot(slot)
                    raise
                recipe.submit(active_page)
                confirmation = self._wait_for_confirmation(active_page, detection.platform)
                if not confirmation and detection.platform == "generic":
                    # A company site has no known confirmation: the outcome is unknown.
                    raise BlockedHuman(
                        "submit_outcome_unknown",
                        "Submit was clicked once on a company site and no confirmation was recognised",
                        "submit",
                    )
                if not confirmation:
                    raise BlockedHuman(
                        "receipt_missing",
                        "Submit was clicked once but no confirmation URL or text appeared",
                        "submit",
                    )
                receipt = replace(
                    self._capture_receipt(active_page, confirmation),
                    answer_sources=dict(checkpoint.answer_sources),
                    cv_sha256=checkpoint.cv_sha256,
                )
                checkpoint.receipt = receipt.to_dict()
                checkpoint.save(self.checkpoint_path)
                return self._record(checkpoint, receipt)
            except _HeadedRetry:
                headed_retry = True
            except BlockedHuman as blocked:
                return self._block(checkpoint, blocked, page=active_page, dry_run=mode == "dry_run")
            except FlowDeferred as deferred:
                return self._deny(checkpoint, _DeniedVerdict(deferred.reason, deferred.detail), page=active_page)
            except Exception as exc:
                step = checkpoint.state if checkpoint.state in STEP_ORDER else "review"
                return self._block(
                    checkpoint,
                    BlockedHuman(
                        "browser_uncertainty",
                        f"Browser interaction stopped with {type(exc).__name__}; no blind retry is allowed",
                        step,
                    ),
                    page=active_page,
                )
        if not headed_retry:  # pragma: no cover - every other path returns
            raise FlowError("application flow ended without a result")
        # An anti-bot wall seen before any form work: the headless browser is
        # closed; the page is opened once more, headed.
        self._headed_retry_used = True
        self.url = queue_url
        previous_headless, self.headless = self.headless, False
        try:
            return self.run(page=None, navigate=navigate)
        finally:
            self.headless = previous_headless


def _load_profile(path: Path) -> Mapping[str, Any]:
    try:
        import yaml
    except ImportError as exc:
        raise FlowError("pyyaml is not installed") from exc
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise FlowError(f"candidate profile cannot be read: {exc}") from exc
    if not isinstance(value, Mapping):
        raise FlowError("candidate profile is not a mapping")
    return value


def ask_pending_question(
    position_id: int,
    key: str | None = None,
    *,
    db_path: str | Path | None = None,
    checkpoint_path: str | Path | None = None,
    notifier: Callable[..., str] | None = None,
) -> dict[str, str]:
    """The CLOSER's explicit ask: send the form question its flow stopped on.

    The flow never asks by itself.  When the CLOSER finds no basis for an
    answer in the profile, the CV or the vacancy, this creates the durable
    dashboard row and notifies the user once (Telegram first).  `key` must be
    the pending question's key when given.  Returns `{status, source_id}` with
    status asked · already_asked · not_pending; raises FlowError when the
    checkpoint cannot be read or the row cannot be verified.
    """
    pid = int(position_id)
    jht_home = Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))
    path = Path(checkpoint_path) if checkpoint_path else jht_home / ".cache" / "apply-flow" / f"{pid}.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"status": "not_pending", "source_id": ""}
    except (OSError, ValueError) as exc:
        raise FlowError(f"checkpoint cannot be read: {type(exc).__name__}") from exc
    url = raw.get("url") if isinstance(raw, dict) else None
    if not isinstance(url, str) or not url:
        raise FlowError("checkpoint has no application url")
    checkpoint = FlowCheckpoint.load(path, pid, url)
    request = checkpoint.answer_request
    payload = request.get("payload") if isinstance(request, Mapping) else None
    pending_key = str(payload.get("key", "")) if isinstance(payload, Mapping) else ""
    if not pending_key or (key is not None and _normalise_label(key) != pending_key):
        return {"status": "not_pending", "source_id": ""}
    flow = ApplicationFlow(
        position_id=pid,
        url=url,
        profile={},
        cv_path=Path(os.devnull),
        checkpoint_path=path,
        db_path=db_path,
        notifier=notifier,
    )
    return flow.ask_pending(checkpoint)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--position-id", type=int, required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--cv", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--receipt-dir", type=Path)
    parser.add_argument("--db", type=Path)
    browser_mode = parser.add_mutually_exclusive_group()
    browser_mode.add_argument(
        "--headful", dest="headless", action="store_false", help="Force a visible browser."
    )
    browser_mode.add_argument(
        "--headless", dest="headless", action="store_true", help="Force a hidden browser."
    )
    parser.set_defaults(headless=None)
    parser.add_argument(
        "--ask",
        action="store_true",
        help="Send the form question this position stopped on to the user (the CLOSER found no basis).",
    )
    args = parser.parse_args(argv)

    if args.ask:
        try:
            asked = ask_pending_question(
                args.position_id, db_path=args.db, checkpoint_path=args.checkpoint
            )
        except (FlowError, ValueError, sqlite3.Error) as exc:
            print(json.dumps({"status": "error", "reason": type(exc).__name__}))
            return 2
        print(json.dumps(asked, sort_keys=True))
        return 0 if asked["status"] == "asked" else 3

    try:
        flow = ApplicationFlow(
            position_id=args.position_id,
            url=args.url,
            profile=_load_profile(args.profile),
            profile_path=args.profile,
            cv_path=args.cv,
            checkpoint_path=args.checkpoint,
            receipt_dir=args.receipt_dir,
            db_path=args.db,
            headless=_resolve_headless(args.headless),
        )
        result = flow.run()
    except (FlowError, ValueError) as exc:
        print(json.dumps({"status": "error", "reason": str(exc)}))
        return 2
    print(json.dumps(result.to_dict(), ensure_ascii=False, sort_keys=True))
    if result.status in {"applied", "dry_run"}:
        return 0
    if result.status == "denied":
        return 1
    if result.status == EMAIL_CHANNEL_STATE:
        # Not a failure and not a human block: the email channel takes over
        # from the checkpoint's channel/mailto_href.
        return 4
    if result.status == page_failure.RETRY_LATER_STATE:
        # Not a stop: the page did not answer for now; the queue gives the
        # position back after the checkpoint's retry_after.
        return RETRY_LATER_EXIT
    return 3


if __name__ == "__main__":
    sys.exit(main())
