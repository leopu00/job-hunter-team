"""A drop-down click never sends the form.

Review of c45133af9 (14/09): the custom listbox of the 1800 contact form was
opened with a click to read its options. A <button> inside a form with no
type="button" is the form's submit: on a form without browser validation the
click sent it, empty, during open_form, before the gate, the cap and
submit_started. The same holds for an option written as a button, and for a
location suggestion. Synthetic pages; the 1800 structure with one attribute
changed each time.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "tests"))

from test_apply_generic import BASE, LOCATION_COMBO, PROFILE, _recipe, _site_page, browser, cv_path  # noqa: E402,F401
from test_contact_and_instruction_channels import (  # noqa: E402,F401
    CAREERS,
    CONTACT,
    LETTER,
    ROLE,
    WITH_APPLICATION,
    build_flow,
    home,
    site,
)

import pytest  # noqa: E402
from apply_flow import BlockedHuman  # noqa: E402


def _contact(browser, html: str):
    careers = CAREERS.format(roles=ROLE.format(title="AI Engineer"))
    page = site(browser, {"/careers": careers, "/contact": html})
    page.goto(f"{BASE}/careers")
    return page


def _unvalidated(html: str) -> str:
    return html.replace('<form id="contact">', '<form id="contact" novalidate>')


def _nothing_sent(page) -> None:
    assert page.evaluate("window.submitCount || 0") == 0
    assert page.evaluate("localStorage.getItem('sent')") is None


def test_a_listbox_toggle_that_would_submit_is_never_clicked(browser, cv_path, tmp_path):
    html = _unvalidated(CONTACT.replace("__OPTIONS__", WITH_APPLICATION)).replace(
        '<button id="subject" type="button" aria-haspopup', '<button id="subject" aria-haspopup'
    )
    page = _contact(browser, html)

    result = build_flow(tmp_path, cv_path, f"{BASE}/careers", answers={"Message": LETTER}).run(page=page, navigate=False)

    assert result.status == "blocked_human", result
    assert result.reason == "generic_form_missing"  # its options were never read
    _nothing_sent(page)
    assert page.locator("#subject").get_attribute("aria-expanded") == "false"


def test_an_option_that_would_submit_is_never_clicked(browser, cv_path, tmp_path):
    html = _unvalidated(CONTACT.replace("__OPTIONS__", WITH_APPLICATION)).replace("option.type = 'button'; ", "")
    page = _contact(browser, html)

    result = build_flow(tmp_path, cv_path, f"{BASE}/careers", answers={"Message": LETTER}).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "unknown_required_control"), result
    _nothing_sent(page)


def test_a_location_suggestion_that_would_submit_is_never_clicked(browser, cv_path):
    html = LOCATION_COMBO.replace('<form class="application">', '<form class="application" novalidate>').replace(
        "const li = document.createElement('li');", "const li = document.createElement('button');"
    )
    assert "createElement('button')" in html
    page = _site_page(browser, {"/jobs/9": html})
    page.goto(f"{BASE}/jobs/9")
    recipe = _recipe(cv_path, {**PROFILE, "location": "Lyon, France"})
    recipe.open_form(page)

    with pytest.raises(BlockedHuman) as stop:
        recipe.fill_core(page)

    assert stop.value.reason == "answer_not_accepted"
    assert page.evaluate("window.submitCount") == 0
