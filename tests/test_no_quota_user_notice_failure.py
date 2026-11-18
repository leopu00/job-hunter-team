"""The no-quota notice to the person failed with «exit 2» 69 times in a round and the log never said why (giro Mac 18/11)."""
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
import quota_data  # noqa: E402


def _tool(monkeypatch, rc, err):
    monkeypatch.setattr(quota_data.subprocess, "run",
                        lambda *a, **k: subprocess.CompletedProcess(a, rc, stdout="", stderr=err))


def test_the_reason_the_tool_gave_is_in_the_error(monkeypatch):
    _tool(monkeypatch, 2, "jht-notify-user: DB non trovato: /jht_home/jobs.db\n")
    with pytest.raises(RuntimeError, match="DB non trovato"):
        quota_data._notify_user("text", "api_key")


def test_a_reason_already_told_in_other_words_is_not_a_failure(monkeypatch):
    _tool(monkeypatch, 2, "jht-notify-user: insert fallita: source-id collision with different notification data\n")
    quota_data._notify_user("text in another language", "api_key")


def test_a_notice_that_went_is_quiet(monkeypatch):
    _tool(monkeypatch, 0, "")
    quota_data._notify_user("text", "api_key")
