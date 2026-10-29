"""JHT-T140 — the team's language is told to the agent by name, not left to be read off the conversation.

RULE-T14 says «the user's language»; the agents deduced it from the messages they were answering, so two
messages in Italian from an operator moved the analysts and scorers of an English team, and Swedish ads
dragged Swedish into the notes on companies. The language the team has chosen (i18n-prefs.json, then
JHT_LANG) is now said by name in the line `[TEAM-LANGUAGE]` of every kickoff and resume message, and the
rule of every prompt points at it. The line is written in three places (python, bash, the harness): this
file holds the first two together and the harness's own test the third.
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
sys.path.insert(0, str(ROOT / "shared" / "skills"))
import text_language  # noqa: E402

SPAWN_LIB = ROOT / ".launcher" / "spawn-lib.sh"
START_AGENT = ROOT / ".launcher" / "start-agent.sh"
WATCHDOG = ROOT / ".launcher" / "agent-watchdog.sh"
LANGS = ("en", "it", "hu", "es", "de", "fr", "pt")
NAMES = {"en": "English", "it": "Italian", "hu": "Hungarian", "es": "Spanish", "de": "German", "fr": "French", "pt": "Portuguese"}
ROLES = sorted(p.name for p in (ROOT / "agents").iterdir() if p.is_dir() and not p.name.startswith("_"))
ITALIAN_MESSAGE = "[@utente -> @analista] [MSG] Ciao, per favore scrivimi in italiano le note sui punteggi."


def _bash(script: str, home: Path, **env: str) -> subprocess.CompletedProcess[str]:
    base = {k: v for k, v in os.environ.items() if k not in ("JHT_LANG", "JHT_HOME", "JHT_HOST_ENV_FILE")}
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env={**base, "JHT_HOME": str(home), **env}, check=False)


def _written(path: Path, timeout: float = 15.0) -> str:
    """What the stubbed `setsid` wrote. The library starts it in the background and lets go of it (`&`, then
    `disown`) on purpose, so the shell is back before the stub has run: on a busy machine the file is not there yet
    when the test looks. Wait for it, with a ceiling, instead of reading at once; nothing in the product changes."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            text = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            text = ""
        if text:
            return text
        time.sleep(0.02)
    pytest.fail(f"{path.name} was not written within {timeout:.0f} s")


def _prefs(home: Path, locale: str) -> None:
    home.mkdir(parents=True, exist_ok=True)
    (home / "i18n-prefs.json").write_text(json.dumps({"locale": locale}), encoding="utf-8")


def _function(source: str, name: str) -> str:
    found = re.search(rf"^{re.escape(name)}\(\) \{{.*?^\}}", source, re.DOTALL | re.MULTILINE)
    assert found, f"{name} is no longer in the source"
    return found.group(0)


# --- the line ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("lang", LANGS)
def test_the_python_and_the_bash_line_are_the_same_words(tmp_path, lang):
    _prefs(tmp_path, lang)
    shell = _bash(f". '{SPAWN_LIB}'; jht_team_language_line", tmp_path)
    assert shell.returncode == 0, shell.stderr
    assert shell.stdout == text_language.team_language_line(lang)
    assert shell.stdout.startswith(f"[TEAM-LANGUAGE] {NAMES[lang]} ({lang}). Write in {NAMES[lang]} ")


def test_the_line_says_the_language_by_name_and_that_no_message_changes_it():
    line = text_language.team_language_line("en")
    assert "English (en)" in line and "never changes it" in line
    assert "job ad" in line and "stay as they are" in line
    # one line: it travels in a tmux send-keys, where a newline is an Enter
    assert "\n" not in line


def test_an_unknown_language_is_english_never_a_blank(tmp_path):
    (tmp_path / "i18n-prefs.json").write_text(json.dumps({"locale": "sv"}), encoding="utf-8")
    shell = _bash(f". '{SPAWN_LIB}'; jht_team_language_line", tmp_path)
    assert shell.stdout.startswith("[TEAM-LANGUAGE] English (en).")


def test_a_change_of_language_is_followed_by_the_next_message(tmp_path):
    _prefs(tmp_path, "en")
    script = f". '{SPAWN_LIB}'; jht_team_language_line; echo; echo '{{\"locale\":\"it\"}}' > '{tmp_path}/i18n-prefs.json'; jht_team_language_line"
    first, second = _bash(script, tmp_path).stdout.split("\n")
    assert "English (en)" in first and "Italian (it)" in second


def test_the_prefs_file_decides_before_the_environment(tmp_path):
    _prefs(tmp_path, "en")
    shell = _bash(f". '{SPAWN_LIB}'; jht_team_language_line", tmp_path, JHT_LANG="it")
    assert "English (en)" in shell.stdout
    other = tmp_path / "other"
    other.mkdir()
    assert "Italian (it)" in _bash(f". '{SPAWN_LIB}'; jht_team_language_line", other, JHT_LANG="it").stdout


# --- the messages that carry it -----------------------------------------------------------------------


def _kickoff_message(tmp_path: Path, msg: str) -> str:
    """What start-agent.sh's _kickoff would paste into the agent, with the sender and the logger stubbed."""
    out = tmp_path / "pasted.txt"
    script = "\n".join(
        [
            f". '{SPAWN_LIB}'",
            "jht_daemon_log() { echo /dev/null; }",
            f'setsid() {{ printf "%s" "$JHT_KICKOFF_MSG" > "{out}"; }}',
            _function(START_AGENT.read_text(encoding="utf-8"), "_kickoff"),
            '_kickoff SESS "$TEST_MESSAGE"',
        ]
    )
    shell = _bash(script, tmp_path, TEST_MESSAGE=msg)
    assert shell.returncode == 0, shell.stderr
    return _written(out)


def test_the_kickoff_says_english_by_name_with_an_italian_message(tmp_path):
    _prefs(tmp_path, "en")
    pasted = _kickoff_message(tmp_path, ITALIAN_MESSAGE)
    assert pasted.startswith(ITALIAN_MESSAGE)
    assert "[TEAM-LANGUAGE] English (en)." in pasted
    assert "Italian" not in pasted.split("[TEAM-LANGUAGE]")[1]


def test_a_welcome_kickoff_keeps_its_header_first_and_the_line_right_after_it(tmp_path):
    _prefs(tmp_path, "de")
    pasted = _kickoff_message(tmp_path, "[@system -> @assistente] [WELCOME-USER]\n\nUser welcome protocol.\n1. Do it.")
    lines = pasted.split("\n")
    assert lines[0] == "[@system -> @assistente] [WELCOME-USER]"
    assert lines[1].startswith("[TEAM-LANGUAGE] German (de).")
    assert lines[2:] == ["", "User welcome protocol.", "1. Do it."]


def test_the_doctor_and_maintainer_kickoff_carries_the_line_in_one_line(tmp_path):
    _prefs(tmp_path, "fr")
    out = tmp_path / "prompt.txt"
    script = f". '{SPAWN_LIB}'; setsid() {{ printf '%s' \"$JHT_SPAWN_PROMPT\" > '{out}'; }}; jht_spawn_kickoff SESS 'Read AGENTS.md and run the cycle.'"
    assert _bash(script, tmp_path).returncode == 0
    pasted = _written(out)
    assert pasted.startswith("Read AGENTS.md and run the cycle. [TEAM-LANGUAGE] French (fr).")
    assert "\n" not in pasted


def test_the_watchdog_resume_after_a_respawn_carries_the_line(tmp_path):
    _prefs(tmp_path, "en")
    source = WATCHDOG.read_text(encoding="utf-8")
    sent = tmp_path / "sent.txt"
    script = "\n".join(
        [
            f"export JHT_SPAWN_LIB_DIR='{SPAWN_LIB.parent}'",
            "sleep() { :; }",
            f'jht-tmux-send() {{ printf "%s" "$2" > "{sent}"; }}',
            _function(source, "worker_kickoff"),
            "worker_kickoff SCOUT-1 scout",
            "wait",
        ]
    )
    assert _bash(script, tmp_path).returncode == 0
    pasted = sent.read_text(encoding="utf-8")
    assert pasted.startswith("[@watchdog -> @scout-1] [MSG] [TEAM-LANGUAGE] English (en). ")
    assert "Session recreated by the watchdog. Resume the main loop" in pasted


def test_the_watchdog_resume_still_goes_without_the_library(tmp_path):
    sent = tmp_path / "sent.txt"
    script = "\n".join(
        [
            f"export JHT_SPAWN_LIB_DIR='{tmp_path}/no-library-here'",
            "sleep() { :; }",
            f'jht-tmux-send() {{ printf "%s" "$2" > "{sent}"; }}',
            _function(WATCHDOG.read_text(encoding="utf-8"), "worker_kickoff"),
            "worker_kickoff ANALISTA-1 analista",
            "wait",
        ]
    )
    assert _bash(script, tmp_path).returncode == 0
    assert sent.read_text(encoding="utf-8").startswith("[@watchdog -> @analista-1] [MSG] Session recreated by the watchdog.")


def test_the_doctors_resume_template_asks_for_the_line_in_every_language():
    # the line comes before the Capitano's mode section, which stays the end of the message (test_mode_injection)
    for path in sorted((ROOT / "agents" / "_skills" / "session-refresh").glob("SKILL*.md")):
        text = path.read_text(encoding="utf-8")
        assert "text_language.py line" in text, path.name
        send = [ln for ln in text.splitlines() if "[RESUME]" in ln and "jht-tmux-send" in ln]
        assert len(send) == 1 and send[0].rstrip().endswith('$LANGUAGE$MODE"'), path.name


# --- the rule ----------------------------------------------------------------------------------------


@pytest.mark.parametrize("lang", LANGS)
@pytest.mark.parametrize("role", ROLES)
def test_the_rule_of_every_prompt_points_at_the_line_and_at_the_command(role, lang):
    name = f"{role}.md" if lang == "en" else f"{role}.{lang}.md"
    rule = [ln for ln in (ROOT / "agents" / role / name).read_text(encoding="utf-8").splitlines() if ln.startswith("> 🌍") and "RULE-T14" in ln]
    assert len(rule) == 1, f"{role}.{lang}"
    assert "`[TEAM-LANGUAGE]`" in rule[0] and "`python3 text_language.py lang`" in rule[0], f"{role}.{lang}"
