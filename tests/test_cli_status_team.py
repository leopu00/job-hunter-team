"""Test CLI: jht status e jht team list/status."""

import json
import os
import subprocess
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


@pytest.fixture
def jht_home(tmp_path, monkeypatch):
    """HOME isolato per ogni test."""
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    monkeypatch.setenv("HOME", str(fake_home))
    return fake_home


@pytest.fixture
def jht_home_with_config(jht_home):
    """HOME con jht.config.json valido."""
    jht_dir = jht_home / ".jht"
    jht_dir.mkdir()
    config = {
        "version": 1,
        "active_provider": "openai",
        "providers": {
            "openai": {
                "name": "openai",
                "auth_method": "api_key",
                "api_key": "sk-test-xxx",
                "model": "gpt-4o",
            }
        },
        "workspace": "/tmp/jht-test",
    }
    (jht_dir / "jht.config.json").write_text(json.dumps(config, indent=2))
    return jht_home


# ── jht status ──────────────────────────────────────────────────────────────


def test_status_no_config_shows_setup_hint(jht_home):
    code, out, err = run_jht("status", env={"HOME": str(jht_home)})
    assert code == 0
    combined = out + err
    assert "setup" in combined.lower()


def test_status_with_config_shows_provider(jht_home_with_config):
    code, out, err = run_jht("status", env={"HOME": str(jht_home_with_config)})
    assert code == 0
    assert "openai" in out


def test_status_with_config_shows_model(jht_home_with_config):
    code, out, err = run_jht("status", env={"HOME": str(jht_home_with_config)})
    assert code == 0
    assert "gpt-4o" in out


def test_status_with_config_shows_auth_method(jht_home_with_config):
    code, out, err = run_jht("status", env={"HOME": str(jht_home_with_config)})
    assert code == 0
    assert "api_key" in out


def test_status_with_config_shows_workspace(jht_home_with_config):
    code, out, err = run_jht("status", env={"HOME": str(jht_home_with_config)})
    assert code == 0
    assert "/tmp/jht-test" in out


def test_status_exits_zero(jht_home):
    code, out, err = run_jht("status", env={"HOME": str(jht_home)})
    assert code == 0


# ── jht team list ───────────────────────────────────────────────────────────


def test_team_list_exits_zero(jht_home):
    code, out, err = run_jht("team", "list", env={"HOME": str(jht_home)})
    assert code == 0


def test_team_list_shows_agents(jht_home):
    code, out, err = run_jht("team", "list", env={"HOME": str(jht_home)})
    assert code == 0
    # Verifica che siano elencati almeno i ruoli chiave
    assert "scout" in out.lower()
    assert "capitano" in out.lower()
    assert "sentinella" in out.lower()


def test_team_list_shows_all_expected_roles(jht_home):
    code, out, err = run_jht("team", "list", env={"HOME": str(jht_home)})
    assert code == 0
    expected_roles = ["capitano", "scout", "analista", "scorer", "scrittore", "critico", "sentinella"]
    for role in expected_roles:
        assert role in out.lower(), f"Ruolo '{role}' mancante nel team list"


def test_team_list_shows_default_team(jht_home):
    code, out, err = run_jht("team", "list", env={"HOME": str(jht_home)})
    assert code == 0
    assert "default" in out.lower() or "team" in out.lower()


# ── jht team status ─────────────────────────────────────────────────────────


def test_team_status_exits_zero(jht_home):
    code, out, err = run_jht("team", "status", env={"HOME": str(jht_home)})
    assert code == 0


def test_team_status_no_agents_shows_hint(jht_home):
    code, out, err = run_jht("team", "status", env={"HOME": str(jht_home)})
    assert code == 0
    # Con nessun agente attivo deve mostrare un messaggio informativo
    combined = out + err
    assert len(combined.strip()) > 0


# ── jht --version ───────────────────────────────────────────────────────────


def test_version_flag(jht_home):
    code, out, err = run_jht("--version", env={"HOME": str(jht_home)})
    assert code == 0
    combined = out + err
    # Deve contenere un numero di versione
    import re
    assert re.search(r"\d+\.\d+", combined), f"Nessuna versione trovata in: {combined!r}"
