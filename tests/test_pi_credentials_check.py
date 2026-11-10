"""The start of a pi agent with no way to talk to the provider is refused, with what is missing and how to fix it.

Without a key and without a pi login pi starts and fails at its first message ("No API key found"). The real code
of the launcher (.launcher/spawn-pi-credentials.sh, the check of start-agent.sh and of the Dottore and Mantenitore
spawners), each case on its own, with synthetic credentials built from parts. The check looks at whether the
credentials exist, never at what is in them.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from test_agent_model_override import _bash
from test_pi_harness import SPAWN_LIB, START_AGENT, _block, _clean_env, _workdir

ROOT = Path(__file__).resolve().parents[1]
CHECKER = ROOT / ".launcher" / "spawn-pi-credentials.sh"

pytestmark = pytest.mark.skipif(
    sys.platform == "win32", reason="the launcher runs in the Linux container"
)

# A key-shaped value built from parts: it must never reach an output.
SECRET = "-".join(["synthetic", "key", "0000", "aaaa", "1111"])
# What Pi writes after a sign-in, one entry per service (synthetic values): the ChatGPT account is `openai`, Anthropic's is `anthropic`.
OPENAI_LOGIN = json.dumps({"openai": {"type": "oauth", "access": SECRET}})
ANTHROPIC_LOGIN = json.dumps({"anthropic": {"type": "oauth", "access": SECRET, "refresh": SECRET}})


def _home(tmp_path: Path, *, config: dict | None = None, login: str | None = None) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    if config is not None:
        (home / "jht.config.json").write_text(json.dumps(config), encoding="utf-8")
    if login is not None:
        agent = home / ".pi" / "agent"
        agent.mkdir(parents=True)
        (agent / "auth.json").write_text(login, encoding="utf-8")
    return home


def _check(home: Path, **env: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [_bash(), "-c", f'source "{SPAWN_LIB}"; jht_pi_credentials_check "{home}/jht.config.json"'],
        capture_output=True, text=True, check=False,
        env=_env(home, **env),
    )


def _env(home: Path, **extra: str) -> dict[str, str]:
    """The environment of a launcher start: no key file unless the case gives one."""
    env = _clean_env(JHT_HOME=str(home), **extra)
    if "JHT_API_KEY_FILE" not in extra:
        env.pop("JHT_API_KEY_FILE", None)
    return env


def test_nothing_at_all_is_refused_and_says_what_is_missing_and_how_to_fix(tmp_path: Path) -> None:
    home = _home(tmp_path, config={"active_provider": "openai", "providers": {"openai": {"auth_method": "subscription"}}})
    result = _check(home)
    assert result.returncode == 1
    assert result.stdout == ""
    for words in ("no credentials", "No API key found", "JHT_API_KEY_FILE", f"{home}/.pi/agent/auth.json",
                  "jht setup", "jht providers list", "jht providers harness codex"):
        assert words in result.stderr, words


def test_a_missing_config_and_no_login_is_refused(tmp_path: Path) -> None:
    result = _check(_home(tmp_path))
    assert result.returncode == 1
    assert "no credentials" in result.stderr


def test_a_key_file_is_enough(tmp_path: Path) -> None:
    home = _home(tmp_path, config={"active_provider": "openai", "providers": {"openai": {"auth_method": "subscription"}}})
    result = _check(home, JHT_API_KEY_FILE="/dev/shm/jht-run-key")
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""


def test_the_key_of_the_active_provider_in_the_config_is_enough(tmp_path: Path) -> None:
    home = _home(tmp_path, config={"active_provider": "openai",
                                   "providers": {"openai": {"auth_method": "api_key", "api_key": SECRET}}})
    result = _check(home)
    assert result.returncode == 0, result.stderr
    assert SECRET not in result.stdout + result.stderr


@pytest.mark.parametrize("provider", [
    {"auth_method": "api_key", "api_key": ""},
    {"auth_method": "api_key", "api_key": "   "},
    {"auth_method": "api_key"},
    {"auth_method": "subscription", "api_key": SECRET},   # a key left from another mode is not used by the launcher
])
def test_a_config_without_a_usable_key_is_refused_and_never_prints_the_key(tmp_path: Path, provider: dict) -> None:
    home = _home(tmp_path, config={"active_provider": "openai", "providers": {"openai": provider}})
    result = _check(home)
    assert result.returncode == 1
    assert SECRET not in result.stdout + result.stderr


def test_the_key_of_another_provider_does_not_count(tmp_path: Path) -> None:
    home = _home(tmp_path, config={"active_provider": "openai", "providers": {
        "openai": {"auth_method": "subscription"}, "claude": {"auth_method": "api_key", "api_key": SECRET}}})
    assert _check(home).returncode == 1


def test_an_unreadable_config_without_a_login_is_refused(tmp_path: Path) -> None:
    home = _home(tmp_path)
    (home / "jht.config.json").write_text("{not json", encoding="utf-8")
    assert _check(home).returncode == 1


OPENAI_CONFIG = {"active_provider": "openai", "providers": {"openai": {"auth_method": "subscription"}}}


def test_a_pi_login_for_the_provider_of_the_setup_is_enough_and_no_value_is_printed(tmp_path: Path) -> None:
    result = _check(_home(tmp_path, config=OPENAI_CONFIG, login=OPENAI_LOGIN))
    assert result.returncode == 0, result.stderr
    assert result.stderr == "" and SECRET not in result.stdout


def test_the_entry_of_the_provider_counts_wherever_it_is_and_whatever_else_is_there(tmp_path: Path) -> None:
    login = json.dumps({"anthropic": {"type": "api_key", "key": SECRET}, "openai": {"type": "oauth"}})  # more services: ours is there
    assert _check(_home(tmp_path, config=OPENAI_CONFIG, login=login)).returncode == 0


def test_the_legacy_openai_codex_entry_is_not_the_login_the_agents_use(tmp_path: Path) -> None:
    """Pi 1.5.0 saves the ChatGPT sign-in as `openai`; the agents start with --provider openai and would not find `openai-codex`."""
    assert _check(_home(tmp_path, config=OPENAI_CONFIG, login=json.dumps({"openai-codex": {"type": "oauth"}}))).returncode == 1


def test_a_login_with_only_anthropic_is_not_the_login_of_the_openai_setup(tmp_path: Path) -> None:
    """The file that was there made the team start on a Claude subscription billed per token (extra usage)."""
    result = _check(_home(tmp_path, config=OPENAI_CONFIG, login=ANTHROPIC_LOGIN))
    assert result.returncode == 1
    assert result.stdout == ""
    for words in ("not a login for the provider of the setup (openai)", "sign-in of: anthropic", "may be billed per token",
                  "jht oauth-login", "nothing starts on it"):
        assert words in result.stderr, words
    assert SECRET not in result.stdout + result.stderr, "the names of the entries are said, never a value"


@pytest.mark.parametrize("login", ["{}", "not even json", "[]", '{"openai": {}}', '{"openai": "oops"}', '{"openai": null}'])
def test_a_login_file_with_no_usable_entry_of_the_provider_is_refused(tmp_path: Path, login: str) -> None:
    result = _check(_home(tmp_path, config=OPENAI_CONFIG, login=login))
    assert result.returncode == 1
    assert "not a login for the provider of the setup (openai)" in result.stderr


def test_the_provider_that_has_no_entry_name_in_this_release_keeps_the_old_rule_the_file_is_there(tmp_path: Path) -> None:
    config = {"active_provider": "somebody-else", "providers": {}}
    assert _check(_home(tmp_path, config=config, login=ANTHROPIC_LOGIN)).returncode == 0


def test_the_provider_name_in_the_message_is_plain_lowercase_words_only(tmp_path: Path) -> None:
    # spelled with capitals and spaces in the config, said as `openai` (and the filter is in the script: only [a-z0-9._-], 40 characters)
    result = _check(_home(tmp_path, config={"active_provider": "  OpenAI ", "providers": {}}, login=ANTHROPIC_LOGIN))
    assert result.returncode == 1
    assert "provider of the setup (openai)" in result.stderr
    assert "tr -cd 'a-z0-9._-' | cut -c1-40" in CHECKER.read_text(encoding="utf-8")


def test_the_login_file_is_looked_at_with_lstat_first_and_only_its_entry_names_are_read() -> None:
    text = CHECKER.read_text(encoding="utf-8")
    assert "os.lstat" in text
    assert "open(" not in text.split("jht_pi_config_key_present()")[0]
    assert "pi_login.py" in text


def test_an_empty_login_file_is_refused(tmp_path: Path) -> None:
    assert _check(_home(tmp_path, login="")).returncode == 1


def test_a_login_that_is_a_folder_is_refused(tmp_path: Path) -> None:
    home = _home(tmp_path)
    (home / ".pi" / "agent" / "auth.json").mkdir(parents=True)
    assert _check(home).returncode == 1


def test_a_login_that_is_a_link_is_refused_even_to_a_good_file(tmp_path: Path) -> None:
    home = _home(tmp_path)
    good = tmp_path / "elsewhere.json"
    good.write_text("{}", encoding="utf-8")
    agent = home / ".pi" / "agent"
    agent.mkdir(parents=True)
    (agent / "auth.json").symlink_to(good)
    assert _check(home).returncode == 1


def test_the_owner_of_the_login_is_the_user_or_root() -> None:
    # The container may run as root or as the owner of the bind mount: root's file is as trusted as the user's own.
    # A file of ANOTHER unprivileged user cannot be made without root: this case is read from the code, not run.
    text = CHECKER.read_text(encoding="utf-8")
    assert "info.st_uid in (os.geteuid(), 0)" in text


def test_the_refusal_comes_before_anything_is_made(tmp_path: Path) -> None:
    """In start-agent.sh the check sits beside the version check, ahead of the workdir, the skills and the pane."""
    source = START_AGENT.read_text(encoding="utf-8")
    block = _block(source, 'if [ "$CLI_BIN" = "pi" ] && {', "\nfi\n")
    assert "jht_pi_version_check" in block and 'jht_pi_credentials_check "$JHT_CONFIG_FILE"' in block
    assert source.index(block) < source.index("jht_spawn_copy_skills")
    assert source.index(block) < source.index('tmux new-session -d -x 220 -y 50 -s "$SESSION"')


def _run_gate(tmp_path: Path, home: Path, *, cli: str = "pi", **env: str) -> subprocess.CompletedProcess[str]:
    """The real `if` of start-agent.sh, with the version check made true and a marker for what would follow."""
    source = START_AGENT.read_text(encoding="utf-8")
    block = _block(source, 'if [ "$CLI_BIN" = "pi" ] && {', "\nfi\n") + "\nfi\n"
    script = "\n".join([
        "set -euo pipefail",
        f'source "{SPAWN_LIB}"',
        "jht_pi_version_check() { return 0; }",
        f'CLI_BIN={cli}',
        f"JHT_CONFIG_FILE='{home}/jht.config.json'",
        block,
        'echo STARTED',
    ])
    return subprocess.run([_bash(), "-c", script], capture_output=True, text=True, check=False,
                          env=_env(home, **env))


def test_start_agent_stops_a_pi_agent_with_no_credentials_before_it_starts(tmp_path: Path) -> None:
    result = _run_gate(tmp_path, _home(tmp_path, config={"active_provider": "openai"}))
    assert result.returncode == 1
    assert "STARTED" not in result.stdout
    assert "no credentials" in result.stderr


def test_start_agent_lets_a_pi_agent_with_a_login_start(tmp_path: Path) -> None:
    result = _run_gate(tmp_path, _home(tmp_path, config={"active_provider": "openai"}, login=OPENAI_LOGIN))
    assert result.returncode == 0, result.stderr
    assert "STARTED" in result.stdout


def test_start_agent_lets_a_pi_agent_with_a_key_file_start(tmp_path: Path) -> None:
    result = _run_gate(tmp_path, _home(tmp_path, config={"active_provider": "openai"}),
                       JHT_API_KEY_FILE="/dev/shm/jht-run-key")
    assert result.returncode == 0, result.stderr
    assert "STARTED" in result.stdout


def test_start_agent_asks_nothing_of_an_agent_that_does_not_run_pi(tmp_path: Path) -> None:
    result = _run_gate(tmp_path, _home(tmp_path, config={"active_provider": "openai"}), cli="codex")
    assert result.returncode == 0, result.stderr
    assert "STARTED" in result.stdout


def test_the_service_agents_stop_without_credentials_for_pi(tmp_path: Path) -> None:
    home = _home(tmp_path, config={"active_provider": "openai"})
    workdir = _workdir(tmp_path)
    script = (f'source "{SPAWN_LIB}"; jht_pi_version_check() {{ return 0; }}; '
              f'jht_spawn_pi_repl_cmd "{workdir}" gpt-5.6-sol')
    result = subprocess.run([_bash(), "-c", script], capture_output=True, text=True, check=False,
                            env=_env(home))
    assert result.returncode == 2
    assert result.stdout == ""
    assert "no credentials" in result.stderr
    assert not (home / ".pi" / "agent" / "settings.json").exists()   # nothing was written before the refusal


def test_the_service_agents_get_their_pi_command_with_a_login(tmp_path: Path) -> None:
    home = _home(tmp_path, config={"active_provider": "openai"}, login=OPENAI_LOGIN)
    workdir = _workdir(tmp_path)
    script = (f'source "{SPAWN_LIB}"; jht_pi_version_check() {{ return 0; }}; '
              f'jht_spawn_pi_repl_cmd "{workdir}" gpt-5.6-sol')
    result = subprocess.run([_bash(), "-c", script], capture_output=True, text=True, check=False,
                            env=_env(home))
    assert result.returncode == 0, result.stderr
    assert "--provider openai" in result.stdout
