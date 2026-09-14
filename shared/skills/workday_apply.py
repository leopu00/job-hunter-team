#!/usr/bin/env python3
"""workday_apply.py — the CLOSER on Workday career sites (myworkdayjobs.com). [JHT-CLOSER-WORKDAY]

Position 1817 (14/09): a LinkedIn vacancy handed over to a Workday posting and
stopped as ats_unsupported with a blank screenshot.  Workday is a single-page
app: when the flow looked (DOM loaded, half a second later) nothing was drawn.

Read on a real posting, nothing typed and nothing sent: every application
starts with a mandatory "Create Account/Sign In" step (email, password, a box
consenting to the employer's terms), one account per employer.  The CLOSER
does not create accounts or accept terms for the user, so this module does
not apply yet: it waits for the page to render, then tells a closed posting
from an open one, without clicking anything.

- open posting (its Apply control is there)  → account_creation
- no Apply control and a closed-vacancy notice → vacancy_closed
- no Apply control, no notice                 → ats_unsupported (named detail)
- nothing rendered in time                    → page_unavailable

The selectors are Workday's own data-automation-id attributes, stable across
tenants; the classes are generated.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from apply_flow import BlockedHuman, vacancy_closed_evidence  # noqa: E402

RENDER_WAIT_MS = 15_000
_RENDERED = (
    "[data-automation-id='jobPostingHeader'], [data-automation-id='jobPostingPage'], "
    "[data-automation-id='applyFlowPage'], [data-automation-id='signInContent'], "
    "[data-automation-id='errorMessage']"
)
_APPLY = "[data-automation-id='adventureButton'], [data-automation-id='applyManually']"
_ACCOUNT = "[data-automation-id='signInContent'], [data-automation-id='createAccountSubmitButton']"


def stop_for(page, *, wait_ms: int = RENDER_WAIT_MS) -> BlockedHuman:
    """Why the CLOSER stops on this Workday page.  Never clicks, never types."""
    try:
        page.locator(_RENDERED).first.wait_for(state="visible", timeout=wait_ms)
    except Exception:
        return BlockedHuman(
            "page_unavailable",
            f"The Workday page did not render its posting within {wait_ms // 1000} s",
            "detect",
        )
    if page.locator(_ACCOUNT).count():
        return _account_creation()
    if page.locator(_APPLY).count():
        return _account_creation()
    try:
        text = page.locator("body").inner_text(timeout=5_000)
    except Exception:
        text = ""
    language = vacancy_closed_evidence(text)
    if language:
        return BlockedHuman(
            "vacancy_closed",
            f"The Workday posting has no Apply control and says it is closed (notice language: {language})",
            "detect",
        )
    return BlockedHuman("ats_unsupported", "The Workday posting shows no Apply control", "detect")


def _account_creation() -> BlockedHuman:
    return BlockedHuman(
        "account_creation",
        "Workday asks to create an account on the employer's site, and to accept its terms, before any application: "
        "the CLOSER does not create accounts",
        "detect",
    )
