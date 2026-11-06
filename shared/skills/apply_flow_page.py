"""Vacancy, page text and secret controls — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import contextlib
import os
import re
import time
import urllib.parse
from dataclasses import field, replace
from pathlib import Path
from typing import Any, Mapping


try:
    from apply_flow_errors import BlockedHuman
    from apply_flow_constants import (
        LOG, LINKEDIN_HOSTS, _LINKEDIN_COUNTRY_HOST, _MAILTO_CONTROLS_JS,
        _MAILTO_APPLY_LABEL, _VACANCY_CLOSED_PATTERNS, _NOTICE_CONDITION, _NOTICE_DATE_AFTER,
        _optional_module, application_answers,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_errors import BlockedHuman
    from shared.skills.apply_flow_constants import (
        LOG, LINKEDIN_HOSTS, _LINKEDIN_COUNTRY_HOST, _MAILTO_CONTROLS_JS,
        _MAILTO_APPLY_LABEL, _VACANCY_CLOSED_PATTERNS, _NOTICE_CONDITION, _NOTICE_DATE_AFTER,
        _optional_module, application_answers,
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


def _fill_secret(control: Any, value: str) -> None:
    """Type a one-time code or a password and mark the field as a secret.

    A stop can fire with the code still in the box, and the stop screenshot is
    taken from the live page: a field nobody marked is a field `_secrets_hidden`
    does not hide. The marking comes first — a page that
    cannot be marked is a page nothing is typed into.
    """
    module = _optional_module("ats_account")
    attribute = getattr(module, "SECRET_ATTR", "data-jht-secret")
    control.evaluate("(element, attr) => element.setAttribute(attr, '1')", attribute)
    control.fill(value)


@contextlib.contextmanager
def _secrets_hidden(page: Any, *, required: bool = False):
    """No screenshot ever shows a portal password (ats_account's rule).

    The fields are hidden for the duration of the screenshot. When that fails
    (receipt, pre-submit), the screenshot is still taken only if the page is
    proven to have no password field at all — every reachable frame asked,
    within a short deadline (`ats_account.no_secret_fields`). That is the
    normal case of a confirmation page, and its receipt stays as it was. A
    password field, or a page that cannot answer in time, is a page that is
    not photographed: the caller's screenshot fails (receipt_screenshot_failed,
    pre_submit_screenshot_failed) rather than a password in clear in a file.
    Without the module nothing can be hidden or checked: no screenshot.

    `required`: the stop screenshot. There the hiding itself comes first — a
    page that cannot hide its fields is not photographed and the stop is saved
    without its picture.
    """
    module = _optional_module("ats_account")
    if module is None:
        raise RuntimeError("secrets_unhideable")
    if required:
        with module.secrets_hidden(page):
            yield
        return
    try:
        with module.secrets_hidden(page):
            yield
    except module.AccountStop:
        if not module.no_secret_fields(page):
            LOG.warning("[apply-flow] password fields could not be hidden and the page may have some: no screenshot")
            raise
        LOG.warning("[apply-flow] password fields could not be hidden; the page has none, the screenshot goes on")
        yield
