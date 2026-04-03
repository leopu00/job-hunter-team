"""Test CLI: jht config get/set — verifica lettura e scrittura configurazione."""

import json
import os
import subprocess
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
JHT_BIN = str(REPO_ROOT / "cli" / "bin" / "jht.js")


def run_jht(*args, env=None):
    """Esegue jht CLI e restituisce (returncode, stdout, stderr)."""
    full_env = {**os.environ, **(env or {})}
    result = subprocess.run(
        ["node", JHT_BIN, *args],
        capture_output=True,
        text=True,
        env=full_env,
    )
    return result.returncode, result.stdout, result.stderr


def make_config(tmp_dir: Path, data: dict) -> Path:
    """Crea jht.config.json nella directory temporanea."""
    config_file = tmp_dir / "jht.config.json"
    config_file.write_text(json.dumps(data, indent=2))
    return config_file


@pytest.fixture
def jht_home(tmp_path, monkeypatch):
    """Redirige $HOME su una directory temporanea per isolare la config."""
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    monkeypatch.setenv("HOME", str(fake_home))
    return fake_home


# ── config get ──────────────────────────────────────────────────────────────


def test_config_get_no_config_exits_with_error(jht_home):
    code, out, err = run_jht("config", "get", env={"HOME": str(jht_home)})
    assert code != 0
    assert "setup" in err.lower() or "setup" in out.lower()


def test_config_get_all_returns_json(jht_home):
    jht_dir = jht_home / ".jht"
    jht_dir.mkdir()
    make_config(jht_dir, {"active_provider": "claude", "workspace": "/tmp"})

    code, out, err = run_jht("config", "get", env={"HOME": str(jht_home)})
    assert code == 0
    parsed = json.loads(out)
    assert parsed["active_provider"] == "claude"


def test_config_get_key_returns_value(jht_home):
    jht_dir = jht_home / ".jht"
    jht_dir.mkdir()
    make_config(jht_dir, {"active_provider": "openai", "workspace": "/tmp"})

    code, out, err = run_jht("config", "get", "active_provider", env={"HOME": str(jht_home)})
    assert code == 0
    assert "openai" in out


def test_config_get_nested_key(jht_home):
    jht_dir = jht_home / ".jht"
    jht_dir.mkdir()
    make_config(jht_dir, {
        "active_provider": "claude",
        "providers": {"claude": {"model": "claude-opus-4-6"}},
    })

    code, out, err = run_jht("config", "get", "providers.claude.model", env={"HOME": str(jht_home)})
    assert code == 0
    assert "claude-opus-4-6" in out


def test_config_get_missing_key_exits_with_error(jht_home):
    jht_dir = jht_home / ".jht"
    jht_dir.mkdir()
    make_config(jht_dir, {"active_provider": "claude"})

    code, out, err = run_jht("config", "get", "providers.openai.model", env={"HOME": str(jht_home)})
    assert code != 0


# ── config set ──────────────────────────────────────────────────────────────


def test_config_set_creates_key(jht_home):
    jht_dir = jht_home / ".jht"
    jht_dir.mkdir()
    make_config(jht_dir, {"active_provider": "claude"})

    code, out, err = run_jht("config", "set", "workspace", "/tmp/jht", env={"HOME": str(jht_home)})
    assert code == 0

    saved = json.loads((jht_dir / "jht.config.json").read_text())
    assert saved["workspace"] == "/tmp/jht"


def test_config_set_updates_existing_key(jht_home):
    jht_dir = jht_home / ".jht"
    jht_dir.mkdir()
    make_config(jht_dir, {"active_provider": "claude"})

    run_jht("config", "set", "active_provider", "openai", env={"HOME": str(jht_home)})

    saved = json.loads((jht_dir / "jht.config.json").read_text())
    assert saved["active_provider"] == "openai"


def test_config_set_nested_key(jht_home):
    jht_dir = jht_home / ".jht"
    jht_dir.mkdir()
    make_config(jht_dir, {"active_provider": "claude", "providers": {}})

    code, out, err = run_jht(
        "config", "set", "providers.claude.model", "claude-haiku-4-5",
        env={"HOME": str(jht_home)}
    )
    assert code == 0

    saved = json.loads((jht_dir / "jht.config.json").read_text())
    assert saved["providers"]["claude"]["model"] == "claude-haiku-4-5"


def test_config_set_outputs_result(jht_home):
    jht_dir = jht_home / ".jht"
    jht_dir.mkdir()
    make_config(jht_dir, {})

    code, out, err = run_jht("config", "set", "workspace", "/tmp", env={"HOME": str(jht_home)})
    assert code == 0
    assert "workspace" in out
    assert "/tmp" in out


def test_config_set_no_args_exits_with_error(jht_home):
    code, out, err = run_jht("config", "set", env={"HOME": str(jht_home)})
    assert code != 0


def test_config_set_boolean_value(jht_home):
    jht_dir = jht_home / ".jht"
    jht_dir.mkdir()
    make_config(jht_dir, {})

    run_jht("config", "set", "debug", "true", env={"HOME": str(jht_home)})

    saved = json.loads((jht_dir / "jht.config.json").read_text())
    assert saved["debug"] is True
