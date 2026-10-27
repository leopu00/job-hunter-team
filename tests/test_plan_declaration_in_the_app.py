"""A user who only uses the app declares the subscription plan in the chat.

The app has no screen for the plan, and the Capitano's first run refuses to open without one. So the
person who is talking to the user declares it with them: the Assistente during the introduction, the
Capitano as the net when `begin-burst` refuses. Both only ask, show, suggest what Codex reports, and
write what the user chose, with the registry's own commands (`get`, `list <provider>`, `set <provider>:<id>`).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
LANGS = ("en", "it", "es", "fr", "de", "hu", "pt")
SUFFIX = {"en": "", "it": ".it", "es": ".es", "fr": ".fr", "de": ".de", "hu": ".hu", "pt": ".pt"}
REGISTRY = "python3 /app/shared/skills/plan_registry.py"


def _run(script: str, *args: str, home: Path, lang: str = "en") -> subprocess.CompletedProcess:
    env = {
        "PATH": os.environ.get("PATH", ""), "JHT_HOME": str(home), "JHT_LANG": lang,
        "JHT_HOST_ENV_FILE": "/nonexistent/jht-host.env", "PYTHONDONTWRITEBYTECODE": "1",
    }
    return subprocess.run(
        [sys.executable, "-I", str(SKILLS / script), *args],
        capture_output=True, text=True, timeout=60, env=env, check=False,
    )


def _frontmatter_tools(path: Path) -> list[str]:
    line = next(l for l in path.read_text(encoding="utf-8").splitlines() if l.startswith("allowed-tools:"))
    return re.findall(r"Bash\(([^)]*)\)", line)


@pytest.fixture()
def home(tmp_path: Path) -> Path:
    (tmp_path / "jht.config.json").write_text(json.dumps({"active_provider": "codex"}), encoding="utf-8")
    return tmp_path


# ── what the Assistente runs, exactly as its skill writes it ───────────────────

def test_the_walk_through_of_the_assistente_declares_the_plan_the_user_chose(home: Path):
    missing = _run("plan_registry.py", "get", home=home)
    assert (missing.returncode, missing.stdout.strip()) == (1, "PLAN_MISSING")

    listing = _run("plan_registry.py", "list", "codex", home=home)
    assert listing.returncode == 0 and "pro-max" in listing.stdout
    assert "Codex reports" not in listing.stdout  # no reading yet: nothing to suggest

    chosen = _run("plan_registry.py", "set", "codex:plus", home=home)
    assert chosen.returncode == 0, chosen.stderr
    declared = _run("plan_registry.py", "get", home=home)
    assert declared.returncode == 0 and json.loads(declared.stdout)["id"] == "plus"


def test_what_codex_reports_is_a_suggestion_that_writes_nothing(home: Path):
    (home / "logs").mkdir()
    (home / "logs" / "codex-plan-reading.json").write_text(
        json.dumps({"plan_type": "prolite", "single_weekly": True, "observed_at": time.time()}), encoding="utf-8")
    listing = _run("plan_registry.py", "list", "codex", home=home)
    assert listing.stdout.rstrip().splitlines()[-1].strip() == "Codex reports: prolite → Pro 100 $"
    # Listing and reading the reading never declare a plan.
    assert _run("plan_registry.py", "get", home=home).returncode == 1
    assert json.loads((home / "jht.config.json").read_text(encoding="utf-8")) == {"active_provider": "codex"}


def test_a_plan_that_is_not_in_the_table_is_refused_and_nothing_is_written(home: Path):
    bad = _run("plan_registry.py", "set", "codex:made-up", home=home)
    assert bad.returncode == 1
    assert _run("plan_registry.py", "get", home=home).returncode == 1


# ── the Capitano as the net ─────────────────────────────────────────────────────

@pytest.mark.parametrize("lang", LANGS)
def test_begin_burst_refuses_and_tells_how_to_declare_the_plan(home: Path, lang: str):
    done = _run("first_run.py", "begin-burst", home=home, lang=lang)
    out = json.loads(done.stdout)
    assert out["ok"] is False
    assert "plan_registry.py list <provider>" in out["hint"] and "plan_registry.py set <provider>:<id>" in out["hint"], out
    assert "subscription step in setup" not in out["hint"]


def test_after_the_user_chose_begin_burst_opens(home: Path):
    assert _run("plan_registry.py", "set", "codex:pro", home=home).returncode == 0
    out = json.loads(_run("first_run.py", "begin-burst", home=home).stdout)
    assert out["ok"] is True and out["plan"]["plan"] == "pro"


# ── the skills, in the seven languages ──────────────────────────────────────────

@pytest.mark.parametrize("lang", LANGS)
def test_the_assistentes_permission_on_the_registry_is_narrow(lang: str):
    tools = _frontmatter_tools(ROOT / "agents" / "_skills" / "onboarding-flow" / f"SKILL{SUFFIX[lang]}.md")
    registry = [t for t in tools if "plan_registry" in t]
    assert registry == [f"{REGISTRY} get", f"{REGISTRY} list *", f"{REGISTRY} set *"], registry


@pytest.mark.parametrize("lang", LANGS)
def test_the_assistente_asks_suggests_and_writes_only_what_the_user_chose(lang: str):
    text = (ROOT / "agents" / "_skills" / "onboarding-flow" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    for needed in (f"{REGISTRY} get", f"{REGISTRY} list codex", f"{REGISTRY} set codex:<id>", "PLAN_MISSING", "Codex reports:"):
        assert needed in text, f"SKILL{SUFFIX[lang]}.md lacks {needed!r}"


@pytest.mark.parametrize("lang", LANGS)
def test_the_capitano_skill_tells_what_to_do_when_the_burst_refuses(lang: str):
    text = (ROOT / "agents" / "_skills" / "first-run-burst" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    for needed in (f"{REGISTRY} list <provider>", f"{REGISTRY} set <provider>:<id>", "Codex reports:", "begin-burst"):
        assert needed in text, f"SKILL{SUFFIX[lang]}.md lacks {needed!r}"


# ── `plan_registry.py suggest`: what the app proposes, never what it writes ─────────────────

def _reading(home: Path, plan_type: str, age: float = 60) -> None:
    (home / "logs").mkdir(exist_ok=True)
    (home / "logs" / "codex-plan-reading.json").write_text(
        json.dumps({"plan_type": plan_type, "single_weekly": True, "observed_at": time.time() - age}), encoding="utf-8")


def test_suggest_names_the_plan_codex_reports_and_declares_nothing(home: Path):
    _reading(home, "prolite")
    done = _run("plan_registry.py", "suggest", "codex", home=home)
    assert (done.returncode, done.stdout.strip()) == (0, "pro")
    assert _run("plan_registry.py", "get", home=home).returncode == 1
    assert json.loads((home / "jht.config.json").read_text(encoding="utf-8")) == {"active_provider": "codex"}


@pytest.mark.parametrize("case", ["no reading", "a plan the table does not know", "a reading older than 30 days", "another provider"])
def test_suggest_says_nothing_when_there_is_nothing_to_suggest(home: Path, case: str):
    provider = "codex"
    if case == "a plan the table does not know":
        _reading(home, "enterprise")
    elif case == "a reading older than 30 days":
        _reading(home, "prolite", age=31 * 86400)
    elif case == "another provider":
        _reading(home, "prolite")
        provider = "kimi"
    done = _run("plan_registry.py", "suggest", provider, home=home)
    assert (done.returncode, done.stdout.strip()) == (1, "")
