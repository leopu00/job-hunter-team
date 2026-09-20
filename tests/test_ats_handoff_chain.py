"""A board, a company site, then the company's ATS: the chain of 1843 and 1944 (14/09).

1843: LinkedIn → careers.axa.com → iCIMS (careers-es-axa.icims.com).
1944: LinkedIn → jobs.dnv.com → Oracle Recruiting Cloud (…oraclecloud.com/hcmUI/CandidateExperience/…).
Both stopped as application_redirect_untrusted: Oracle's candidate site was no
known platform, and the company page's hand-over to its ATS was a second handoff.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import apply_flow  # noqa: E402
import apply_generic  # noqa: E402
from apply_flow import ApplicationFlow, BlockedHuman, FlowCheckpoint, PlatformHandoff  # noqa: E402
from ats_detect import detect_ats  # noqa: E402

ICIMS = "https://careers-es-example.icims.com/jobs/24335/login"
ORACLE = "https://ecyq.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/7406/apply/email"
COMPANY = "https://careers.example.com/jobs/24335"


@pytest.mark.parametrize(
    ("url", "platform", "url_match"),
    [
        (ORACLE, "oracle_ce", True),
        ("https://abcd.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/it/sites/CX/job/1", "oracle_ce", True),
        ("https://abcd.fa.us2.oraclecloud.com/fscmUI/faces/FuseWelcome", "unknown", False),  # the cloud, not its candidate site
        ("https://oraclecloud.com.attacker.example/hcmUI/CandidateExperience/x", "unknown", False),
        (ICIMS, "icims", True),
    ],
)
def test_the_ats_behind_1843_and_1944_is_named(url, platform, url_match):
    detection = detect_ats(url)
    assert (detection.platform, detection.url_match) == (platform, url_match)


@dataclass(frozen=True)
class GateVerdict:
    allowed: bool = True
    reason: str = "apply_allowed"
    context: dict = field(default_factory=lambda: {"mode": "authorised"})

    def log_line(self) -> str:
        return "[apply-gate] ALLOW"


def build_flow(tmp_path: Path, url: str = COMPANY) -> ApplicationFlow:
    cv = tmp_path / "synthetic-profile.pdf"
    cv.write_bytes(b"%PDF-1.4\n% synthetic test fixture only\n")
    return ApplicationFlow(
        essentials_checker=lambda **_kwargs: [],
        cap_reserver=lambda **_kwargs: GateVerdict(True, "cap_reserved"),
        cv_checker=lambda _path: {"ok": True, "reasons": []},
        position_id=93,
        url=url,
        profile={"name": "Jane Example", "contacts": {"email": "jane@example.invalid"}},
        cv_path=cv,
        checkpoint_path=tmp_path / "93.json",
        receipt_dir=tmp_path / "receipts",
        gate_checker=lambda **_kwargs: GateVerdict(),
        notifier=lambda **_kwargs: "1",
        applied_recorder=lambda **_kwargs: None,
    )


def follow(flow, checkpoint, target, count, monkeypatch):
    visited: list[str] = []
    monkeypatch.setattr(flow, "_navigate", lambda page: visited.append(flow.url))
    monkeypatch.setattr(flow, "_check_page_access", lambda *a, **k: None)
    monkeypatch.setattr(flow, "_assert_not_redirected_away", lambda *a, **k: None)
    flow._follow_handoff(checkpoint, page=None, handoff=PlatformHandoff(target), count=count)
    return visited


@pytest.mark.parametrize("target", [ICIMS, ORACLE])
def test_a_company_site_hands_over_to_its_ats_as_the_second_handoff(tmp_path, monkeypatch, target):
    flow = build_flow(tmp_path)
    saved = FlowCheckpoint.new(93, COMPANY)
    saved.platform = "generic"

    assert follow(flow, saved, target, 2, monkeypatch) == [target]
    assert saved.handoff_url == target


@pytest.mark.parametrize(
    ("platform", "target", "count"),
    [
        ("generic", "https://other.example.net/form", 2),  # a second hop to no known ATS
        ("generic", ICIMS, 3),  # never a third hop
        ("linkedin", ICIMS, 2),  # the board itself hands over once
        ("lever", ICIMS, 2),  # an ATS never hands over to another
    ],
)
def test_the_chain_stops_at_the_company_ats(tmp_path, monkeypatch, platform, target, count):
    flow = build_flow(tmp_path)
    saved = FlowCheckpoint.new(93, COMPANY)
    saved.platform = platform

    with pytest.raises(BlockedHuman) as stop:
        follow(flow, saved, target, count, monkeypatch)

    assert stop.value.reason == "application_redirect_untrusted"


def test_a_company_site_hands_over_to_a_known_ats_on_the_first_hop(tmp_path, monkeypatch):
    flow = build_flow(tmp_path)
    saved = FlowCheckpoint.new(93, COMPANY)
    saved.platform = "generic"

    assert follow(flow, saved, ORACLE, 1, monkeypatch) == [ORACLE]


@pytest.mark.parametrize("target", [ICIMS, ORACLE])
def test_the_company_recipe_hands_over_to_a_known_ats_instead_of_refusing(target):
    recipe = apply_generic.GenericRecipe({}, None)
    with pytest.raises(PlatformHandoff) as handed:
        recipe._handoff_or_refuse(target, "detect")
    assert handed.value.url == target


def test_the_company_recipe_still_refuses_an_unknown_site():
    recipe = apply_generic.GenericRecipe({}, None)
    with pytest.raises(BlockedHuman) as stop:
        recipe._handoff_or_refuse("https://other.example.net/form", "detect")
    assert stop.value.reason == "application_redirect_untrusted"


# ── end to end: the company page, its Apply, the ATS page ─────────────────────


@pytest.fixture
def browser():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        launched = runtime.chromium.launch(headless=True)
        yield launched
        launched.close()


def test_the_company_apply_to_an_ats_without_a_recipe_stops_naming_it(browser, tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(apply_generic, "guard_public_url", lambda url: url)
    import safe_fetch

    monkeypatch.setattr(safe_fetch, "resolve_public_address", lambda *_a, **_k: None)
    pages = {
        COMPANY: f'<html><body><h1>Engineer</h1><a href="{ICIMS}">Apply</a></body></html>',
        ICIMS: '<html><body><iframe id="icims_content_iframe" src="about:blank"></iframe></body></html>',
    }
    page = browser.new_page()
    page.route("**/*", lambda route: route.fulfill(
        status=200, content_type="text/html", body=pages.get(route.request.url.split("?")[0], "<html></html>")))
    page.goto(COMPANY)
    flow = build_flow(tmp_path)

    result = flow.run(page=page, navigate=False)

    # Not application_redirect_untrusted: the ATS is reached and named.
    assert result.status == "blocked_human"
    assert result.reason == "ats_unsupported", result
    import json

    saved = json.loads((tmp_path / "93.json").read_text())
    assert saved["handoff_url"] == ICIMS
