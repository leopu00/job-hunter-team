"""feedback_query.api_request asks sync_switch before every request to the website.

A paused sync, a cloud.json with the sync off and JHT_CLOUD_SYNC=0 all stop the request before the
network is touched; JHT_CLOUD_SYNC=0 wins over `enabled: true`. Synthetic data only, offline: urlopen
is replaced by a function that fails the test when it is called while the sync is off.
"""
import json
import os
import sys

import pytest

SKILLS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "shared", "skills")
sys.path.insert(0, SKILLS_DIR)
import feedback_query as fq  # noqa: E402

BASE = {"base_url": "https://example.invalid", "token": "jht_sync_exampleexampleexample"}
PAUSED = {**BASE, "enabled": False, "paused_at": "2026-11-24T10:00:00.000Z", "paused_by": "cli"}
ENABLED = {**BASE, "enabled": True}


class _Reply:
    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self):
        return b'{"ok": true}'


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_CLOUD_SYNC", raising=False)

    def write(config):
        (tmp_path / "cloud.json").write_text(json.dumps(config), encoding="utf-8")

    return write


@pytest.fixture
def calls(monkeypatch):
    seen = []

    def urlopen(request, timeout=None):
        seen.append(request.full_url)
        return _Reply()

    monkeypatch.setattr(fq.urllib.request, "urlopen", urlopen)
    return seen


def test_paused_sync_makes_no_request(home, calls):
    home(PAUSED)
    assert fq.api_request("GET", "/api/x") == (False, "cloud-disabled")
    assert calls == []


def test_disabled_file_makes_no_request(home, calls):
    home({**BASE, "enabled": False})
    assert fq.api_request("GET", "/api/x") == (False, "cloud-disabled")
    assert calls == []


def test_resumed_sync_makes_exactly_one_request(home, calls):
    home(PAUSED)
    assert fq.api_request("GET", "/api/x")[0] is False
    home(ENABLED)  # the pause can end while the process runs: the file is read again at every request
    assert fq.api_request("GET", "/api/x") == (True, {"ok": True})
    assert calls == ["https://example.invalid/api/x"]


def test_env_zero_wins_over_an_enabled_file(home, calls, monkeypatch):
    home(ENABLED)
    monkeypatch.setenv("JHT_CLOUD_SYNC", "0")
    assert fq.api_request("GET", "/api/x") == (False, "cloud-disabled")
    assert calls == []


def test_env_one_with_a_token_keeps_the_rule_of_the_helper(home, calls, monkeypatch):
    home(PAUSED)
    monkeypatch.setenv("JHT_CLOUD_SYNC", "1")
    assert fq.api_request("GET", "/api/x")[0] is True
    assert len(calls) == 1


def test_absent_file_makes_no_request(home, calls):
    assert fq.api_request("GET", "/api/x") == (False, "cloud-disabled")
    assert calls == []
