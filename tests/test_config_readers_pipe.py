"""JHT-T137, the other readers: the readers that run on their own in the container and protect the budget or the
actions read jht.config.json through plain_file, so a named pipe, a link or a huge file that an agent puts in its
place cannot hold them (a read of a pipe waits for ever and nothing raises).

Each reader is taken from its own file (the functions, by name, from the source) and run against a real pipe in a
thread with a limit; a normal configuration is read as before.  The command line is not here: a person starts it.
"""
from __future__ import annotations

import ast
import importlib.util
import json
import os
import sys
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import plain_file  # noqa: E402

pytestmark = pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="no named pipes here")


def within(seconds, call):
    box = {}

    def target():
        try:
            box["value"] = call()
        except BaseException as error:      # noqa: BLE001
            box["error"] = error

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(seconds)
    assert not thread.is_alive(), "the reader is stuck on a named pipe"
    if "error" in box:
        raise box["error"]
    return box["value"]


def functions(relative, names, extra=None):
    """The named functions of a source file, run in a namespace of their own."""
    source = (ROOT / relative).read_text(encoding="utf-8")
    tree = ast.parse(source)
    namespace = {"__file__": str(ROOT / relative), "json": json, "os": os, "Path": Path, "importlib": importlib,
                 "sys": sys, **(extra or {})}
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in names:
            exec(compile(ast.Module([node], []), relative, "exec"), namespace)
    missing = [n for n in names if n not in namespace]
    assert not missing, f"{relative}: {missing} not found"
    return namespace


@pytest.fixture()
def config(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    return tmp_path / "jht.config.json"


GOOD = {"active_provider": "claude"}


# ── plain_file itself ──────────────────────────────────────────────────────────────────────────────

def test_plain_file_reads_a_plain_file_and_refuses_a_pipe_a_link_two_names_and_a_big_file(tmp_path):
    good = tmp_path / "a.json"
    good.write_text(json.dumps(GOOD), encoding="utf-8")
    assert plain_file.read_json(good) == GOOD
    pipe = tmp_path / "pipe.json"
    os.mkfifo(pipe)
    with pytest.raises(plain_file.NotPlain):
        within(5, lambda: plain_file.read_json(pipe))
    link = tmp_path / "link.json"
    link.symlink_to(good)
    with pytest.raises(plain_file.NotPlain):
        plain_file.read_json(link)
    os.link(good, tmp_path / "second-name.json")
    with pytest.raises(plain_file.NotPlain):
        plain_file.read_json(good)
    big = tmp_path / "big.json"
    big.write_text(json.dumps({"pad": "x" * 100}), encoding="utf-8")
    with pytest.raises(plain_file.NotPlain):
        plain_file.read_json(big, max_size=10)
    with pytest.raises(FileNotFoundError):
        plain_file.read_json(tmp_path / "missing.json")


# ── the reader of the apply gate (closed when the file cannot be read) ─────────────────────────────

def test_the_apply_gate_reads_a_pipe_as_unreadable_and_a_normal_file_as_before(config):
    import apply_gate
    assert apply_gate._load_config(config) == (None, "config_missing")
    config.write_text(json.dumps(GOOD), encoding="utf-8")
    assert apply_gate._load_config(config) == (GOOD, "")
    config.unlink()
    os.mkfifo(config)
    assert within(5, lambda: apply_gate._load_config(config)) == (None, "config_unreadable")
    assert within(5, lambda: apply_gate.consent_verdict(path=config)).allowed is False
    config.unlink()
    config.write_text("{not json", encoding="utf-8")
    assert apply_gate._load_config(config) == (None, "config_malformed")


# ── the sentinel's bridge ──────────────────────────────────────────────────────────────────────────

def test_the_sentinel_bridge_reads_a_pipe_as_unreadable_and_goes_on(config):
    namespace = functions(".launcher/sentinel-bridge.py", {"read_config", "_read_config_json", "_load_skill_module"},
                          {"CONFIG_PATH": config, "_PLAIN_FILE_MOD": None, "tempfile": __import__("tempfile")})
    namespace["datetime"] = __import__("datetime").datetime
    config.write_text(json.dumps({"active_provider": "kimi", "sentinella_tick_minutes": 0.5}), encoding="utf-8")
    assert namespace["read_config"]() == (0.5, "kimi")
    config.unlink()
    os.mkfifo(config)
    assert within(5, namespace["read_config"]) == (None, "openai"), "the answer for a config that cannot be read"


def test_every_read_of_the_configuration_in_the_sentinel_bridge_goes_through_the_one_reader():
    source = (ROOT / ".launcher" / "sentinel-bridge.py").read_text(encoding="utf-8")
    assert "CONFIG_PATH.open(" not in source and "CONFIG_PATH.read_text(" not in source
    assert source.count("_read_config_json()") >= 4


# ── the pacing bridge ──────────────────────────────────────────────────────────────────────────────

def test_the_pacing_bridge_reads_a_pipe_as_unreadable_and_a_normal_file_as_before(config):
    namespace = functions(".launcher/pacing-bridge.py", {"_read_active_provider_for_target", "_read_config_plain"})
    assert namespace["_read_active_provider_for_target"]() == "openai", "no file"
    config.write_text(json.dumps(GOOD), encoding="utf-8")
    assert namespace["_read_active_provider_for_target"]() == "claude"
    config.unlink()
    os.mkfifo(config)
    assert within(5, namespace["_read_active_provider_for_target"]) == "openai"
    config.unlink()
    config.write_text(json.dumps({"pad": "x" * (2 * 1024 * 1024)}), encoding="utf-8")
    assert namespace["_read_active_provider_for_target"]() == "openai"


# ── the step-cap watchdog ──────────────────────────────────────────────────────────────────────────

def test_the_stepcap_watchdog_reads_a_pipe_as_unreadable(config, tmp_path):
    namespace = functions(".launcher/stepcap-watchdog.py", {"_active_provider", "_load_shared", "_home"},
                          {"_MODULE_CACHE": {}, "_log": lambda *_: None})
    config.write_text(json.dumps(GOOD), encoding="utf-8")
    assert namespace["_active_provider"]() == "claude"
    config.unlink()
    os.mkfifo(config)
    assert within(5, namespace["_active_provider"]) == ""


# ── the Telegram bridge ────────────────────────────────────────────────────────────────────────────

def test_the_telegram_bridge_reads_its_configuration_through_the_one_reader():
    source = (ROOT / ".launcher" / "tg-bridge.py").read_text(encoding="utf-8")
    assert "from plain_file import read_json" in source and "cfg = read_json(CONFIG_PATH)" in source
    assert "CONFIG_PATH.read_text(" not in source


def test_the_one_reader_is_the_same_function_for_the_hours_and_the_statistics():
    import work_stats
    import working_hours
    assert working_hours.read_plain is plain_file.read_plain and work_stats.read_plain is plain_file.read_plain
    text = (SKILLS / "plain_file.py").read_text(encoding="utf-8")
    assert "O_NONBLOCK" in text and "O_NOFOLLOW" in text and "st_nlink" in text
