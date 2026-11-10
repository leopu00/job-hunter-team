"""NOT_INSTALLED: a tool absent on purpose (core image tier, or an integration the user
has not asked for yet) is reported as such, never as BROKEN, and never makes the
sweep exit non-zero. A tool that is meant to be there and is not working stays BROKEN."""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "shared" / "skills"))

import tool_health  # noqa: E402


def test_core_tier_reports_the_full_image_tools_as_not_installed():
    for name in tool_health.TOOLS_OF_THE_FULL_IMAGE:
        evidence = tool_health.not_installed(name, tier="core")
        assert evidence and "not installed" in evidence


def test_full_tier_runs_the_checks_as_always():
    for name in tool_health.TOOLS_OF_THE_FULL_IMAGE:
        assert tool_health.not_installed(name, tier="full") is None
    # Any value that is not exactly `core` (typo, empty) keeps the checks on.
    assert tool_health.not_installed("playwright_browser", tier="") is None


def test_manual_login_browser_is_a_tool_of_the_full_image_too():
    assert "not installed" in tool_health.not_installed("manual_login_browser", tier="core")
    # On a full image (or with no tier) a missing browser is a fault, whatever is on the PATH.
    assert tool_health.not_installed("manual_login_browser", tier="full") is None


def test_a_core_image_sweep_is_clean_and_exits_zero(monkeypatch, capsys):
    monkeypatch.setenv("JHT_IMAGE_TIER", "core")
    ran = []
    monkeypatch.setitem(tool_health.CHECKS, "playwright_browser", lambda: ran.append(1) or ("BROKEN", "x"))
    assert tool_health.main(["--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert not ran, "a tool that is not installed must not be probed"
    assert out["any_broken"] is False and out["broken"] == []
    assert {t["status"] for t in out["tools"].values()} == {"NOT_INSTALLED"}


def test_a_broken_tool_of_the_full_image_is_still_broken(monkeypatch):
    monkeypatch.setenv("JHT_IMAGE_TIER", "full")
    monkeypatch.setitem(tool_health.CHECKS, "playwright_browser", lambda: ("BROKEN", "missing .so"))
    out = tool_health.collect(only={"playwright_browser"})
    assert out["broken"] == ["playwright_browser"] and out["any_broken"] is True


def test_extras_tier_has_the_manual_login_browser_and_not_the_scout_or_the_cv_pdf_tools():
    for name in ("playwright_browser", "linkedin_check", "cv_pdf_render"):
        assert "not in the extras image" in tool_health.not_installed(name, tier="extras")
    # the browser of the manual sign-in IS in the extras image: it is checked as always, and a missing one is BROKEN there
    assert tool_health.not_installed("manual_login_browser", tier="extras") is None


def test_an_extras_image_sweep_probes_the_manual_login_browser_only(monkeypatch):
    monkeypatch.setenv("JHT_IMAGE_TIER", "extras")
    ran = []
    for name in tool_health.CHECKS:
        monkeypatch.setitem(tool_health.CHECKS, name, lambda n=name: ran.append(n) or ("OK", "x"))
    out = tool_health.collect()
    assert ran == ["manual_login_browser"]
    assert {n for n, t in out["tools"].items() if t["status"] == "NOT_INSTALLED"} == {"playwright_browser", "linkedin_check", "cv_pdf_render"}
