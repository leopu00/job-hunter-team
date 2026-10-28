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
    assert "first_run.py ask-plan" in out["hint"] and "plan_registry.py set <provider>:<id>" in out["hint"], out
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
    # the plans are listed by the card (ask-plan), never by the agent in its own words: no `list`
    assert registry == [f"{REGISTRY} get", f"{REGISTRY} set *"], registry


@pytest.mark.parametrize("lang", LANGS)
def test_the_assistente_asks_suggests_and_writes_only_what_the_user_chose(lang: str):
    text = (ROOT / "agents" / "_skills" / "onboarding-flow" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    for needed in (f"{REGISTRY} get", f"{REGISTRY} set codex:<id>", "PLAN_MISSING", "first_run.py ask-plan --agent assistente"):
        assert needed in text, f"SKILL{SUFFIX[lang]}.md lacks {needed!r}"


@pytest.mark.parametrize("lang", LANGS)
def test_the_capitano_skill_tells_what_to_do_when_the_burst_refuses(lang: str):
    text = (ROOT / "agents" / "_skills" / "first-run-burst" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    for needed in ("first_run.py ask-plan", f"{REGISTRY} set <provider>:<id>", "Codex reports:", "begin-burst"):
        assert needed in text, f"SKILL{SUFFIX[lang]}.md lacks {needed!r}"


# ── a burst that runs with no plan declared is told, not left silent ─────────────────────────

def _state(home: Path, phase: str) -> None:
    (home / "state").mkdir(exist_ok=True)
    (home / "state" / "first-run.json").write_text(json.dumps({
        "phase": phase, "created_at": "2026-10-26T07:29:00+00:00", "burst_started_at": "2026-10-26T07:29:00+00:00",
        "completed_at": None, "completed_reason": None, "scored_at_start": 0,
    }), encoding="utf-8")


@pytest.mark.parametrize("command", ["status", "begin-burst"])
@pytest.mark.parametrize("lang", LANGS)
def test_a_burst_without_a_plan_says_so_and_how_to_declare_it(home: Path, command: str, lang: str):
    _state(home, "burst")
    done = _run("first_run.py", command, home=home, lang=lang)
    out = json.loads(done.stdout)
    assert done.returncode == 0 and out["phase"] == "burst", (done.returncode, out)
    assert out["plan_missing"] is True
    assert "first_run.py ask-plan" in out["hint"] and "plan_registry.py set <provider>:<id>" in out["hint"]
    if command == "begin-burst":
        assert out["note"] == "burst already in progress"  # the burst is not stopped by it


@pytest.mark.parametrize("command", ["status", "begin-burst"])
def test_a_burst_with_a_declared_plan_says_nothing_about_it(home: Path, command: str):
    _state(home, "burst")
    assert _run("plan_registry.py", "set", "codex:plus", home=home).returncode == 0
    out = json.loads(_run("first_run.py", command, home=home).stdout)
    assert "plan_missing" not in out and "hint" not in out


@pytest.mark.parametrize("phase", ["awaiting_profile", "steady"])
def test_the_other_phases_are_not_touched(home: Path, phase: str):
    _state(home, phase)
    assert "plan_missing" not in json.loads(_run("first_run.py", "status", home=home).stdout)


def test_declaring_the_plan_ends_the_warning(home: Path):
    _state(home, "burst")
    assert json.loads(_run("first_run.py", "status", home=home).stdout)["plan_missing"] is True
    assert _run("plan_registry.py", "set", "codex:pro", home=home).returncode == 0
    assert "plan_missing" not in json.loads(_run("first_run.py", "status", home=home).stdout)


@pytest.mark.parametrize("lang", LANGS)
def test_the_capitano_skill_reads_plan_missing_as_a_plan_to_declare(lang: str):
    text = (ROOT / "agents" / "_skills" / "first-run-burst" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    assert "plan_missing: true" in text and "first_run.py status" in text
    assert text.count(f"{REGISTRY} set <provider>:<id>") >= 2  # begin-burst refusing, and a burst that lost its plan


# ── a configuration that cannot be read is never replaced by the one key ───────────────────────

BROKEN_CONFIGS = {
    "not json": b"{ not json",
    "empty file": b"",
    "a list": b'["active_provider", "codex"]',
    "a string": b'"codex"',
    "not text": b'{"active_provider": "codex\xff"}',
    "cut short": b'{"active_provider": "codex", "providers": {"openai": {"api_key": "x"',
}


@pytest.mark.parametrize("case", BROKEN_CONFIGS)
@pytest.mark.parametrize("lang", ["en", "it"])
def test_set_refuses_a_configuration_it_cannot_read_and_leaves_the_file_as_it_is(home: Path, case: str, lang: str):
    path = home / "jht.config.json"
    path.write_bytes(BROKEN_CONFIGS[case])
    done = _run("plan_registry.py", "set", "codex:plus", home=home, lang=lang)
    assert done.returncode == 1 and done.stdout == ""
    assert str(path) in done.stderr, done.stderr
    assert path.read_bytes() == BROKEN_CONFIGS[case]
    assert not (home / "jht.config.json.tmp").exists()


def test_set_refuses_a_configuration_that_is_not_a_file(home: Path):
    path = home / "jht.config.json"
    path.unlink()
    path.mkdir()
    done = _run("plan_registry.py", "set", "codex:plus", home=home)
    assert done.returncode == 1 and str(path) in done.stderr
    assert path.is_dir() and list(path.iterdir()) == []


def test_set_still_creates_the_configuration_when_there_is_none_and_keeps_what_is_in_it(home: Path):
    (home / "jht.config.json").unlink()
    assert _run("plan_registry.py", "set", "codex:plus", home=home).returncode == 0
    assert json.loads((home / "jht.config.json").read_text(encoding="utf-8")) == {"providers": {"openai": {"plan": "plus"}}}
    (home / "jht.config.json").write_text(json.dumps({"active_provider": "codex", "keep": {"me": 1}}), encoding="utf-8")
    assert _run("plan_registry.py", "set", "codex:pro", home=home).returncode == 0
    assert json.loads((home / "jht.config.json").read_text(encoding="utf-8")) == {
        "active_provider": "codex", "keep": {"me": 1}, "providers": {"openai": {"plan": "pro"}}}


def test_reading_the_plan_still_treats_a_broken_configuration_as_no_plan(home: Path):
    (home / "jht.config.json").write_bytes(b"{ not json")
    assert _run("plan_registry.py", "get", home=home).stdout.strip() == "PLAN_MISSING"


# ── the configuration can hold the Telegram bot_token: it is written privately ─────────────────

def _mode(path: Path) -> int:
    return path.stat().st_mode & 0o777


def _set_under_umask(home: Path, umask: int, *args: str) -> subprocess.CompletedProcess:
    code = (
        "import os, runpy, sys\n"
        f"os.umask({umask})\n"
        "sys.argv = sys.argv[1:]\n"
        "runpy.run_path(sys.argv[0], run_name='__main__')\n"
    )
    env = {
        "PATH": os.environ.get("PATH", ""), "JHT_HOME": str(home), "JHT_LANG": "en",
        "JHT_HOST_ENV_FILE": "/nonexistent/jht-host.env", "PYTHONDONTWRITEBYTECODE": "1",
    }
    return subprocess.run(
        [sys.executable, "-I", "-c", code, str(SKILLS / "plan_registry.py"), *args],
        capture_output=True, text=True, timeout=60, env=env, check=False,
    )


posix_only = pytest.mark.skipif(os.name == "nt", reason="POSIX permission bits")


@posix_only
def test_a_new_configuration_is_private_even_under_a_loose_umask(tmp_path: Path):
    home = tmp_path / "jht"
    done = _set_under_umask(home, 0o000, "set", "codex:plus")
    assert done.returncode == 0, done.stderr
    assert _mode(home / "jht.config.json") == 0o600
    assert _mode(home) == 0o700  # created by the write, not by the umask


@posix_only
@pytest.mark.parametrize("existing", [0o600, 0o640, 0o644])
def test_an_existing_configuration_keeps_the_mode_it_has(home: Path, existing: int):
    path = home / "jht.config.json"
    os.chmod(path, existing)
    assert _set_under_umask(home, 0o077, "set", "codex:pro").returncode == 0
    assert _mode(path) == existing
    assert json.loads(path.read_text(encoding="utf-8"))["providers"]["openai"]["plan"] == "pro"


@posix_only
def test_the_folder_it_finds_is_left_as_it_is(home: Path):
    os.chmod(home, 0o755)
    assert _set_under_umask(home, 0o000, "set", "codex:plus").returncode == 0
    assert _mode(home) == 0o755


@posix_only
def test_the_temp_file_has_no_fixed_name_and_a_planted_one_is_not_followed(home: Path):
    secret = home.parent / "victim.txt"
    secret.write_text("untouched", encoding="utf-8")
    for fixed in ("jht.config.json.tmp", ".jht.config.json.tmp"):
        (home / fixed).symlink_to(secret)
    assert _run("plan_registry.py", "set", "codex:plus", home=home).returncode == 0
    assert secret.read_text(encoding="utf-8") == "untouched"
    assert json.loads((home / "jht.config.json").read_text(encoding="utf-8"))["providers"]["openai"]["plan"] == "plus"


def test_the_token_never_travels_in_a_file_left_behind(home: Path):
    path = home / "jht.config.json"
    path.write_text(json.dumps({"active_provider": "codex", "telegram": {"bot_token": "123:SECRET"}}), encoding="utf-8")
    assert _run("plan_registry.py", "set", "codex:plus", home=home).returncode == 0
    assert json.loads(path.read_text(encoding="utf-8"))["telegram"] == {"bot_token": "123:SECRET"}
    assert sorted(p.name for p in home.iterdir()) == ["jht.config.json"]  # no temp file left


def test_a_failed_write_leaves_the_old_file_and_no_temp_file(home: Path):
    sys.path.insert(0, str(SKILLS))
    try:
        import importlib
        registry = importlib.import_module("plan_registry")
    finally:
        sys.path.remove(str(SKILLS))
    path = home / "jht.config.json"
    before = path.read_bytes()

    class Boom(Exception):
        pass

    real_replace = os.replace

    def refuse(*_a, **_k):
        raise Boom()

    os.replace = refuse
    try:
        with pytest.raises(Boom):
            registry._write_config_privately(path, {"x": 1})
    finally:
        os.replace = real_replace
    assert path.read_bytes() == before
    assert sorted(p.name for p in home.iterdir()) == ["jht.config.json"]


# ── the plan is asked once: a second trigger while the question is open does not ask it again ───

ASK_ONCE = {
    "en": "**Ask the plan once.**", "it": "**Il piano si chiede una volta sola.**",
    "es": "**El plan se pregunta una sola vez.**", "fr": "**La formule se demande une seule fois.**",
    "de": "**Das Abonnement wird nur einmal erfragt.**", "hu": "**A csomagot csak egyszer kérdezd meg.**",
    "pt": "**O plano pergunta-se uma só vez.**",
}


@pytest.mark.parametrize("lang", LANGS)
def test_the_capitano_does_not_ask_the_plan_again_while_the_question_is_open(lang: str):
    text = (ROOT / "agents" / "_skills" / "first-run-burst" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    assert text.count(ASK_ONCE[lang]) == 1
    paragraph = text.split(ASK_ONCE[lang], 1)[1].split("\n\n", 1)[0]
    # the three things that start a second pass while the first question is still open
    assert "plan_missing" in paragraph and "`status`" in paragraph
    # it comes after both places where the plan is asked, and before the roster is spawned
    asked = text.index(f"{REGISTRY} set <provider>:<id>`")
    spawn = text.index("\n**2. ")
    assert asked < text.index(ASK_ONCE[lang]) < spawn
