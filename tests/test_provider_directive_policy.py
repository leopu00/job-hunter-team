"""O-77 prompt boundary: provider instructions stay auditable but inert."""

from __future__ import annotations

import importlib.util
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"


def _load(name: str):
    path = SKILLS / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_DB", raising=False)
    return tmp_path


def _directive(home: Path, body: str) -> None:
    env = dict(os.environ, JHT_HOME=str(home))
    env.pop("JHT_DB", None)
    result = subprocess.run(
        [sys.executable, "team_directives.py", "add", body, "--by", "user"],
        cwd=SKILLS,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "body",
    [
        "Launch Critico with /usr/bin/claude",
        "usa codex --yolo per questa revisione",
        "switch the Writer to OpenAI GPT-5.5",
        "fai partire il Critico con Kimi",
        "use Anthropic Sonnet for the next CV",
    ],
)
def test_provider_instruction_is_neutralized_before_mode_banner_prompt(home: Path, body: str) -> None:
    _directive(home, body)
    banner = _load("mode_banner").banner()
    assert body not in banner
    assert "provider/model/CLI selection ignored" in banner
    assert "ACTIVE DIRECTIVES (1)" in banner

    # Audit/edit surfaces retain the exact original body; only the prompt
    # renderer neutralizes it.
    conn = sqlite3.connect(home / "jobs.db")
    assert conn.execute("SELECT body FROM team_directives").fetchone()[0] == body


def test_provider_selection_is_removed_but_work_intent_is_preserved(home: Path) -> None:
    body = "Review CV 42 with /usr/bin/claude --dangerously-skip-permissions"
    _directive(home, body)
    banner = _load("mode_banner").banner()
    assert "Review CV 42" in banner
    assert "/usr/bin/claude" not in banner
    assert "--dangerously-skip-permissions" not in banner
    assert "IGNORED CONFIG SELECTION" in banner
    assert "canonical launcher win" in banner


def test_non_provider_directive_remains_actionable(home: Path) -> None:
    body = "stop scouting until Friday"
    _directive(home, body)
    banner = _load("mode_banner").banner()
    assert body in banner
    assert "configuration-only" not in banner


def test_handoff_active_command_is_safe_but_show_keeps_original(home: Path) -> None:
    body = "run Critico with claude from /opt/bin"
    _directive(home, body)
    env = dict(os.environ, JHT_HOME=str(home))
    env.pop("JHT_DB", None)
    active = subprocess.run(
        [sys.executable, "team_directives.py", "active"], cwd=SKILLS,
        env=env, capture_output=True, text=True, timeout=30,
    )
    shown = subprocess.run(
        [sys.executable, "team_directives.py", "show", "1"], cwd=SKILLS,
        env=env, capture_output=True, text=True, timeout=30,
    )
    assert active.returncode == shown.returncode == 0
    assert body not in active.stdout
    assert "provider/model/CLI selection ignored" in active.stdout
    assert body in shown.stdout


def test_team_rule_is_present_in_all_locales_and_inherited_by_all_role_prompts() -> None:
    team_rules = [
        ROOT / "agents" / "_team" / "team-rules.md",
        *(ROOT / "agents" / "_team" / f"team-rules.{loc}.md"
          for loc in ("it", "es", "de", "fr", "pt", "hu")),
    ]
    assert all("RULE-T19" in path.read_text(encoding="utf-8") for path in team_rules)
    prompts = [
        path for path in (ROOT / "agents").glob("*/*.md")
        if path.parent.name not in {"_team", "_manual", "_skills"}
    ]
    assert prompts
    assert all("T01..T19" in path.read_text(encoding="utf-8") for path in prompts)
