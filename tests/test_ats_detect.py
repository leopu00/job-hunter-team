"""Detection contracts for the CLOSER application recipes."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

from ats_detect import detect_ats  # noqa: E402


@pytest.mark.parametrize(
    ("url", "platform"),
    [
        ("https://jobs.ashbyhq.com/example/role", "ashby"),
        ("https://job-boards.greenhouse.io/example/jobs/1", "greenhouse"),
        ("https://job-boards.eu.greenhouse.io/example/jobs/1", "greenhouse"),
        ("https://boards.greenhouse.io/example/jobs/1", "greenhouse"),
        ("https://jobs.lever.co/example/role", "lever"),
        ("https://example.wd3.myworkdayjobs.com/jobs/role", "workday"),
        ("https://jobs.smartrecruiters.com/Example/role", "smartrecruiters"),
        ("https://example.taleo.net/careersection/jobdetail.ftl", "taleo"),
        ("https://careers.example.icims.com/jobs/1/job", "icims"),
        ("https://example.recruitee.com/o/role", "recruitee"),
        ("https://career5.successfactors.eu/career?company=example", "successfactors"),
    ],
)
def test_known_ats_hosts_are_detected(url: str, platform: str):
    result = detect_ats(url)

    assert result.platform == platform
    assert result.url_match is True


def test_greenhouse_lookalike_host_is_not_trusted():
    result = detect_ats("https://job-boards.greenhouse.io.attacker.invalid/jobs/1")

    assert result.platform == "unknown"


@pytest.mark.parametrize(
    ("dom", "platform"),
    [
        ('<form class="ashby-application-form-form"></form>', "ashby"),
        ('<div id="grnhse_app"></div>', "greenhouse"),
        ('<form class="application-form lever"></form>', "lever"),
        ('<button aria-label="Easy Apply to Example"></button>', "linkedin_easy_apply"),
    ],
)
def test_dom_markers_detect_the_recipe_without_a_known_host(dom: str, platform: str):
    result = detect_ats("https://careers.example.invalid/role", dom)

    assert result.platform == platform
    assert result.dom_match is True


def test_current_greenhouse_react_form_marker_is_detected():
    result = detect_ats(
        "https://careers.example.invalid/role",
        '<form id="application-form" class="application--form"></form>',
    )

    assert result.platform == "greenhouse"
    assert result.dom_match is True


def test_generic_application_form_does_not_claim_greenhouse():
    result = detect_ats(
        "https://careers.example.invalid/role",
        '<form id="application-form" class="application-form"></form>',
    )

    assert result.platform == "unknown"
    assert result.dom_match is False


def test_conflicting_url_and_dom_fail_closed():
    result = detect_ats(
        "https://jobs.ashbyhq.com/example/role",
        '<div id="grnhse_app"></div>',
    )

    assert result.platform == "unknown"
    assert result.conflict is True


def test_linkedin_url_without_easy_apply_dom_is_unknown():
    result = detect_ats("https://www.linkedin.com/jobs/view/123")

    assert result.platform == "unknown"
    assert result.url_match is False


def test_cli_emits_structured_json():
    result = subprocess.run(
        [
            sys.executable,
            str(SKILLS / "ats_detect.py"),
            "https://job-boards.eu.greenhouse.io/example/jobs/1",
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["platform"] == "greenhouse"
    assert payload["evidence"] == ["url:job-boards.eu.greenhouse.io"]
