"""O-84: raw feedback is machine input, display feedback is sanitized."""

from __future__ import annotations

import io
import json
import sys
import urllib.error
from datetime import datetime, timedelta, timezone
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


def test_check_recent_and_themes_carry_a_code_never_the_text(monkeypatch):
    """JHT-T05: il confine non è più «ripulire il testo»: il testo non passa."""
    event = {
        "action": "dislike",
        "created_at": (datetime.now(timezone.utc) - timedelta(days=1)).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        ),
        "reason": SYNTHETIC_INTERNALS,
        "comment": SYNTHETIC_INTERNALS,
        "note": SYNTHETIC_INTERNALS,
        "score": 2,
        "direction": "less_like_this",
    }

    check = feedback._shape_events("84", [event], source="local")
    action = check["actions"][0]
    assert action["reason"] == "other"
    assert not ({"comment", "note", "display_reason", "display_comment"} & set(action))

    monkeypatch.setattr(
        feedback,
        "_api_get",
        lambda *a, **k: (
            True,
            {"feedback": [{"position_legacy_id": "84", **event}]},
        ),
    )
    recent = feedback.recent_feedback(days=30)
    item = recent["items"][0]
    assert item["reason"] == "other"
    assert "synthetic" not in json.dumps(recent).lower()

    themes = feedback.themes_report(days=30, min_positions=1)
    assert [t["key"] for t in themes["themes"]] == ["other"]
    assert "synthetic" not in json.dumps(themes).lower()
    assert all("examples" not in theme for theme in themes["themes"])


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
            # JHT-T05: nessun campo di testo dell'utente esiste più da leggere.
            for gone in ("display_reason", "display_comment",
                         "events_with_text", "positions_with_text"):
                assert gone not in source, f"{template.format(suffix=suffix)}: {gone}"
