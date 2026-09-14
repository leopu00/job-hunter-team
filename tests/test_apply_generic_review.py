"""Red probes from HQ-BACKEND's review of apply_generic.py / closer_notices.py (6ccf8543a). Synthetic only."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shared" / "skills"))
import apply_generic as g  # noqa: E402
import closer_notices  # noqa: E402


def q(label, type="text", required=True):
    return {"id": "0-0", "type": type, "label": label, "name": "", "required": required, "answered": False, "options": []}


# R1 · a form with a CV upload that is not THIS application
@pytest.mark.parametrize("heading, submit, text", [
    ("Join our talent community", "Join talent pool", "Not found the right role? Upload your CV to our talent pool"),
    ("Job alerts", "Subscribe", "Get job alerts by email"),
    ("Refer a friend", "Refer a friend", "Know someone great? Upload their CV"),
])
def test_r1_a_cv_upload_alone_does_not_make_an_application_form(heading, submit, text):
    form = {"questions": [q("First name"), q("Last name"), q("Email", "email"), q("CV / Resume", "file")],
            "submits": [submit], "heading": heading, "text": text, "visible": True}
    assert g.classify_form(form) != "application"


# R2 · a label that only mentions a profile fact is not that fact
@pytest.mark.parametrize("label", [
    "How did you hear about us? (LinkedIn, Indeed, other)",
    "Referee email",
    "Emergency contact phone",
    "Website where you found this job",
])
def test_r2_a_question_mentioning_a_fact_is_not_filled_from_the_profile(label):
    assert g.core_field(q(label)) is None


# R3 · two tenants of a shared hosting suffix are not the same site
def test_r3_shared_hosting_tenants_are_not_one_site():
    assert not g.same_site("https://acme.github.io/careers", "https://other.github.io/apply")
    assert not g.same_site("https://acme.notion.site/jobs", "https://other.notion.site/form")


# R4 · a marker already on the page before the submit is not a confirmation
class _Body:
    def __init__(self, text):
        self._text = text

    def count(self):
        return 1

    def inner_text(self):
        return self._text


class _Page:
    def __init__(self, text):
        self._text = text

    def locator(self, _selector):
        return _Body(self._text)


def test_r4_confirmation_text_is_not_fooled_by_copy_on_the_form_page():
    page = _Page("Apply now First name Email Submit application FAQ: what happens after I apply? "
                 "We send an email: thank you for applying, we will be in touch.")
    assert g.GenericRecipe.confirmation_text(page) == ""


# R5 · page text in a user notice is cleaned of bidi/control characters
def test_r5_stop_detail_from_the_page_is_cleaned(monkeypatch, tmp_path):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    message = closer_notices.stop_message(
        "required_answer_missing", "Required question needs an answer: Salary‮ txt.exe", 7, default="x"
    )
    assert "‮" not in message
