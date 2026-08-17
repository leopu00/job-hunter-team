"""O-84: raw feedback is machine input, display feedback is sanitized."""

from __future__ import annotations

import io
import json
import sys
import urllib.error
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import feedback_display as display  # noqa: E402
import feedback_query as feedback  # noqa: E402


SYNTHETIC_INTERNALS = (
    "good role /synthetic/private/jobs.db "
    r"C:\Synthetic\Private\cloud.json "
    "'/synthetic/path with spaces/private.db' "
    r"'C:\Synthetic Path\Private\cloud.json' "
    "host synthetic.internal.test session_id=SYNTHETIC-SESSION-9 "
    '"token": "synthetic-json-token-24680" '
    "192.0.2.84:2222 "
    "Authorization: Bearer synthetic-bearer-value-12345 "
    "token=synthetic-token-value-67890 "
    "JHT_HOME=/synthetic/jht-home/profile"
)


def _assert_display_safe(value: str) -> None:
    lowered = value.lower()
    for forbidden in (
        "/synthetic/",
        "c:\\synthetic",
        "synthetic.internal.test",
        "synthetic-session-9",
        "synthetic-bearer-value",
        "synthetic-token-value",
        "synthetic-json-token",
        "192.0.2.84",
        "/profile",
    ):
        assert forbidden not in lowered
    assert len(value) <= display.DISPLAY_TEXT_MAX_CHARS


def _assert_theme_display_safe(value: str) -> None:
    _assert_display_safe(value)
    lowered = value.lower()
    for fragment in ("synthetic", "private", "cloud", "session-9"):
        assert fragment not in lowered


def test_shared_sanitizer_redacts_infra_and_bounds(monkeypatch):
    monkeypatch.setenv("JHT_HOME", "/synthetic/jht-home")
    rendered = display.sanitize_feedback_display(
        SYNTHETIC_INTERNALS + " " + ("z" * 500)
    )
    _assert_display_safe(rendered)
    assert "good role" in rendered
    assert "[path]" in rendered
    assert "[redacted]" in rendered


def test_check_recent_and_themes_share_the_raw_display_boundary(monkeypatch):
    event = {
        "action": "dislike",
        "created_at": "2026-08-13T10:00:00Z",
        "reason": SYNTHETIC_INTERNALS,
        "comment": SYNTHETIC_INTERNALS,
        "score": 2,
        "direction": "less_like_this",
    }

    check = feedback._shape_events("84", [event], source="local")
    action = check["actions"][0]
    assert action["reason"] == SYNTHETIC_INTERNALS
    assert action["comment"] == SYNTHETIC_INTERNALS
    _assert_display_safe(action["display_reason"])
    _assert_display_safe(action["display_comment"])

    monkeypatch.setattr(
        feedback,
        "_api_get",
        lambda *a, **k: (
            True,
            {"feedback": [{"position_legacy_id": "84", **event}]},
        ),
    )
    recent = feedback.recent_feedback(days=30, text_chars=0)
    item = recent["items"][0]
    assert item["reason"] == SYNTHETIC_INTERNALS
    _assert_display_safe(item["display_reason"])

    themes = feedback.themes_report(days=30, min_positions=1)
    assert themes["themes"]
    for theme in themes["themes"]:
        _assert_theme_display_safe(theme["label"])
        for example in theme["examples"]:
            _assert_theme_display_safe(example)


def test_recent_full_raw_text_keeps_display_bounded(monkeypatch):
    raw = "useful feedback " + ("z" * 500)
    monkeypatch.setattr(
        feedback,
        "fetch_events",
        lambda **_kwargs: ([{"legacy_id": "84", "reason": raw}], None),
    )
    item = feedback.recent_feedback(text_chars=0)["items"][0]
    assert item["reason"] == raw
    assert len(item["display_reason"]) == display.DISPLAY_TEXT_MAX_CHARS


def test_no_signal_notes_are_a_closed_enum_and_exception_details_stay_off_json(
    monkeypatch, capsys
):
    for internal_reason in (
        "cloud-disabled",
        "missing-credentials",
        "http-500: /synthetic/private token=synthetic-token-value-67890",
        "network: host=synthetic.internal.test session_id=SYNTHETIC-SESSION-9",
    ):
        monkeypatch.setattr(
            feedback, "_api_get", lambda *a, _r=internal_reason, **k: (False, _r)
        )
        reports = (
            feedback.check_position("84"),
            feedback.recent_feedback(days=30),
            feedback.themes_report(days=30),
        )
        for report in reports:
            assert report["note"] in feedback.NO_SIGNAL_NOTES
            encoded = json.dumps(report)
            assert "/synthetic/" not in encoded
            assert "synthetic.internal.test" not in encoded
            assert "synthetic-token-value" not in encoded

    monkeypatch.setattr(
        feedback.urllib.request,
        "urlopen",
        lambda *a, **k: (_ for _ in ()).throw(
            urllib.error.URLError(
                "host=synthetic.internal.test /synthetic/private"
            )
        ),
    )
    monkeypatch.setattr(
        feedback,
        "_load_cloud_config",
        lambda: {
            "enabled": True,
            "base_url": "https://synthetic.invalid",
            "token": "synthetic-token-value-67890",
        },
    )
    ok, reason = feedback.api_request("GET", "/synthetic")
    captured = capsys.readouterr()
    assert (ok, reason) == (False, "network-error")
    assert captured.out == ""
    assert "URLError" in captured.err
    assert "synthetic.internal.test" not in captured.err
    assert "/synthetic/private" not in captured.err


def test_http_error_body_is_log_only_metadata_not_display_content(
    monkeypatch, capsys
):
    error = urllib.error.HTTPError(
        "https://synthetic.invalid/api/feedback",
        500,
        "synthetic failure",
        {},
        io.BytesIO(
            b"host=synthetic.internal.test token=synthetic-token-value-67890"
        ),
    )
    monkeypatch.setattr(
        feedback.urllib.request,
        "urlopen",
        lambda *a, **k: (_ for _ in ()).throw(error),
    )
    monkeypatch.setattr(
        feedback,
        "_load_cloud_config",
        lambda: {
            "enabled": True,
            "base_url": "https://synthetic.invalid",
            "token": "synthetic-token-value-67890",
        },
    )
    assert feedback.api_request("GET", "/synthetic") == (False, "http-error")
    captured = capsys.readouterr()
    assert "http-error:500" in captured.err
    assert "synthetic.internal.test" not in captured.err
    assert "synthetic-token-value" not in captured.err


def test_all_localized_agent_channels_forbid_raw_relay():
    suffixes = ("", ".it", ".es", ".fr", ".de", ".hu", ".pt")
    families = (
        "agents/_skills/feedback-query/SKILL{suffix}.md",
        "agents/_skills/mentor-patterns/SKILL{suffix}.md",
        "agents/mentor/mentor{suffix}.md",
        "agents/scorer/scorer{suffix}.md",
    )
    for template in families:
        for suffix in suffixes:
            source = (ROOT / template.format(suffix=suffix)).read_text()
            assert "RAW_DISPLAY_BOUNDARY" in source
            assert "display_reason" in source
            assert "display_comment" in source
