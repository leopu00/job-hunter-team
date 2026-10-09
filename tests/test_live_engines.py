"""Live tests never reach Podman's default connection (tests/live_engines.py).

On a Mac the default connection is a machine (JHT's, or another product's):
a live test that ran `podman info` on it, then containers, would start and use
a machine nobody gave it. In CI (Linux, local Podman) nothing changes.
"""

import re
import subprocess
import sys
from pathlib import Path

import pytest

import live_engines

ROOT = Path(__file__).resolve().parent


@pytest.fixture
def no_engine_calls(monkeypatch):
    calls = []

    def fake_run(argv, **_):
        calls.append(list(argv))
        return subprocess.CompletedProcess(argv, 0)

    monkeypatch.setattr(live_engines.subprocess, "run", fake_run)
    monkeypatch.setattr(live_engines.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.delenv(live_engines.CONNECTION_ENV, raising=False)
    return calls


def test_on_a_mac_without_a_connection_podman_is_skipped_and_never_called(monkeypatch, no_engine_calls):
    monkeypatch.setattr(sys, "platform", "darwin")
    assert live_engines.engine_argv("podman") is None
    params = live_engines.live_engines()
    assert params[0] == "docker"
    skipped = params[1]
    assert skipped.values == ("podman",)
    assert live_engines.CONNECTION_ENV in skipped.marks[0].kwargs["reason"]
    assert no_engine_calls == [["docker", "info"]]


def test_a_named_connection_is_used_by_the_test_and_by_its_children(monkeypatch, no_engine_calls):
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setenv(live_engines.CONNECTION_ENV, "test-machine")
    assert live_engines.engine_argv("podman") == ["podman", "--connection", "test-machine"]
    assert live_engines.engine_env("podman") == {"CONTAINER_CONNECTION": "test-machine"}
    assert live_engines.engine_env("docker") == {}
    assert live_engines.live_engines() == ["docker", "podman"]
    assert ["podman", "--connection", "test-machine", "info"] in no_engine_calls


def test_on_linux_ci_podman_stays_plain(monkeypatch, no_engine_calls):
    monkeypatch.setattr(sys, "platform", "linux")
    assert live_engines.engine_argv("podman") == ["podman"]
    assert live_engines.engine_env("podman") == {}
    assert live_engines.live_engines() == ["docker", "podman"]
    assert no_engine_calls == [["docker", "info"], ["podman", "info"]]


def test_every_live_test_picks_its_engines_through_live_engines():
    users = []
    for path in sorted(ROOT.glob("test_*.py")):
        if path.name == Path(__file__).name:
            continue
        text = path.read_text(encoding="utf-8")
        if "from live_engines import" in text:
            users.append(path.name)
            assert not re.search(r"\[engine,\s*\*args\]", text), path.name
        # Its own list of engines to probe would reach the default connection.
        assert not re.search(r"""for \w+ in \(["']docker["'], ["']podman["']\)""", text), path.name
    assert users == ["test_broker_socket_live.py", "test_telegram_pairing_live.py"]
