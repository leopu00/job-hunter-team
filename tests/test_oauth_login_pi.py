"""`jht oauth-login` follows the harness: with `harness: pi` it is the sign-in of pi, not `codex login`.

The wrappers (scripts/jht-wrapper.sh and .ps1) are single files on the host and do not grow: for the openai/codex
provider they hand over to `.launcher/oauth-login-openai.sh` inside the container, which picks Codex or Pi by the
`harness` key of the config. The onboarding snapshot reads the login of pi (`.pi/agent/auth.json`) when the harness is
pi: only that it exists, is a regular non-empty file and belongs to the user or to root, never what is in it.
"""

from __future__ import annotations

import json
import os
import pty
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".launcher" / "oauth-login-openai.sh"
WRAPPER_SH = ROOT / "scripts" / "jht-wrapper.sh"
WRAPPER_PS1 = ROOT / "scripts" / "jht-wrapper.ps1"
WIZARD_LOGIN = ROOT / "cli" / "wizard" / "pi-login.js"

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the container side runs on Linux")


def _bash() -> str:
    for candidate in ("/opt/homebrew/bin/bash", "/usr/local/bin/bash", "/bin/bash"):
        if Path(candidate).exists():
            return candidate
    return "bash"


def _pinned() -> str:
    return subprocess.run(
        [_bash(), "-c", f'source "{ROOT}/.launcher/spawn-lib.sh"; printf %s "$JHT_PI_VERSION"'],
        capture_output=True, text=True, check=True,
    ).stdout


def _fakes(tmp_path: Path, *, logs_in: bool = True, login: str = '{"openai":{"type":"oauth"}}') -> dict[str, str]:
    """A `pi` and a `codex` on the PATH that only record how they were called; pi saves a login when asked."""
    bindir = tmp_path / "bin"
    bindir.mkdir()
    calls = tmp_path / "calls.log"
    (bindir / "pi").write_text(
        "#!/usr/bin/env bash\n"
        f'if [ "$1" = "--version" ]; then echo {_pinned()}; exit 0; fi\n'
        f'echo "pi $* | dir=$PI_CODING_AGENT_DIR skipcheck=$PI_SKIP_VERSION_CHECK telemetry=$PI_TELEMETRY" >> "{calls}"\n'
        + (f'mkdir -p "$PI_CODING_AGENT_DIR"; echo \'{login}\' > "$PI_CODING_AGENT_DIR/auth.json"\n' if logs_in else ""),
        encoding="utf-8",
    )
    (bindir / "codex").write_text(f'#!/usr/bin/env bash\necho "codex $*" >> "{calls}"\n', encoding="utf-8")
    for tool in bindir.iterdir():
        tool.chmod(0o755)
    home = tmp_path / "home"
    home.mkdir()
    env = {k: v for k, v in os.environ.items() if not k.startswith("JHT_")}
    env.update(PATH=f"{bindir}:{os.environ.get('PATH', '')}", JHT_HOME=str(home))
    return env


def _config(env: dict[str, str], document: dict | None) -> None:
    if document is not None:
        (Path(env["JHT_HOME"]) / "jht.config.json").write_text(json.dumps(document), encoding="utf-8")


def _run(env: dict[str, str], *, terminal: bool) -> subprocess.CompletedProcess[str]:
    """The script as the wrapper runs it; with `terminal` its stdin and stdout are a pseudo terminal."""
    if not terminal:
        return subprocess.run([_bash(), str(SCRIPT)], capture_output=True, text=True, check=False, env=env,
                              stdin=subprocess.DEVNULL, timeout=60)
    master, slave = pty.openpty()
    chunks: list[bytes] = []

    def drain() -> None:
        try:
            while True:
                data = os.read(master, 4096)
                if not data:
                    break
                chunks.append(data)
        except OSError:
            pass

    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    proc = subprocess.Popen([_bash(), str(SCRIPT)], stdin=slave, stdout=slave, stderr=subprocess.PIPE,
                            text=True, env=env)
    os.close(slave)
    _, err = proc.communicate(timeout=60)
    reader.join(timeout=5)
    os.close(master)
    return subprocess.CompletedProcess(proc.args, proc.returncode, b"".join(chunks).decode("utf-8", "replace"), err)


def _calls(env: dict[str, str]) -> list[str]:
    path = Path(env["JHT_HOME"]).parent / "calls.log"
    return path.read_text(encoding="utf-8").splitlines() if path.exists() else []


@pytest.mark.parametrize("document", [None, {"active_provider": "openai"}, {"harness": "codex"}])
def test_without_the_pi_harness_the_login_is_the_one_of_codex(tmp_path: Path, document: dict | None) -> None:
    env = _fakes(tmp_path)
    _config(env, document)
    done = _run(env, terminal=False)
    assert done.returncode == 0, done.stderr
    assert _calls(env) == ["codex login --device-auth"]


def test_with_the_pi_harness_the_login_is_the_one_of_pi_and_not_codex(tmp_path: Path) -> None:
    env = _fakes(tmp_path)
    _config(env, {"active_provider": "openai", "harness": "pi"})
    done = _run(env, terminal=True)
    assert done.returncode == 0, done.stderr
    calls = _calls(env)
    assert len(calls) == 1 and calls[0].startswith("pi -nc -na -ns -ne --no-mcp |"), calls
    assert f"dir={tmp_path}/home/.pi/agent skipcheck=1 telemetry=0" in calls[0]
    assert not any(line.startswith("codex") for line in calls)
    assert "/login" in done.stdout and "Pi login found" in done.stdout
    assert (tmp_path / "home" / ".pi" / "agent" / "auth.json").is_file()


def test_the_person_is_told_what_to_do_in_pi_before_it_opens_and_what_was_found_after(tmp_path: Path) -> None:
    env = _fakes(tmp_path)
    _config(env, {"active_provider": "openai", "harness": "pi"})
    done = _run(env, terminal=True)
    assert done.returncode == 0, done.stderr
    before = done.stdout.split("Pi login found")[0]
    for words in ("type /login and choose ChatGPT (OpenAI)", "not Anthropic", "leave Pi with Ctrl+C (or type /quit)",
                  "This operation was aborted", "--auth-method api_key"):
        assert words in before, words
    assert "Pi login found: openai (" in done.stdout


def test_a_login_with_only_anthropic_is_not_found_and_says_what_it_holds(tmp_path: Path) -> None:
    env = _fakes(tmp_path, login='{"anthropic":{"type":"oauth","access":"synthetic"}}')
    _config(env, {"active_provider": "openai", "harness": "pi"})
    done = _run(env, terminal=True)
    assert done.returncode == 1
    assert "Pi login found" not in done.stdout
    assert "sign-in of: anthropic" in done.stderr and "may be billed per token" in done.stderr
    assert "synthetic" not in done.stdout + done.stderr


def test_the_login_arguments_are_the_ones_of_the_wizard() -> None:
    wizard = re.search(r"PI_LOGIN_ARGS = \[([^\]]*)\]", WIZARD_LOGIN.read_text(encoding="utf-8"))
    assert wizard is not None
    assert re.findall(r"'([^']+)'", wizard.group(1)) == re.search(
        r'JHT_PI_LOGIN_ARGS="([^"]*)"', SCRIPT.read_text(encoding="utf-8")).group(1).split()


def test_pi_without_a_terminal_is_refused_and_not_started(tmp_path: Path) -> None:
    env = _fakes(tmp_path)
    _config(env, {"active_provider": "openai", "harness": "pi"})
    done = _run(env, terminal=False)
    assert done.returncode == 1
    assert "needs a terminal" in done.stderr and "jht oauth-login" in done.stderr
    assert _calls(env) == []


def test_a_login_that_pi_did_not_save_is_said_and_fails(tmp_path: Path) -> None:
    env = _fakes(tmp_path, logs_in=False)
    _config(env, {"active_provider": "openai", "harness": "pi"})
    done = _run(env, terminal=True)
    assert done.returncode == 1
    assert "no pi login was saved" in done.stderr
    assert "Pi login found" not in done.stdout


def test_an_unknown_harness_in_the_config_stops_the_login(tmp_path: Path) -> None:
    env = _fakes(tmp_path)
    _config(env, {"active_provider": "openai", "harness": "opencode"})
    done = _run(env, terminal=False)
    assert done.returncode == 1
    assert "not a known agent harness" in done.stderr
    assert _calls(env) == []


def test_another_pi_version_is_refused_before_the_login(tmp_path: Path) -> None:
    env = _fakes(tmp_path)
    (tmp_path / "bin" / "pi").write_text("#!/usr/bin/env bash\necho 0.1.0\n", encoding="utf-8")
    _config(env, {"active_provider": "openai", "harness": "pi"})
    done = _run(env, terminal=True)
    assert done.returncode == 1
    assert "this release needs pi" in done.stderr


# ── the wrappers hand over to the script, and do not grow ─────────────────────

def test_both_wrappers_hand_the_openai_login_to_the_script_and_keep_the_old_command_as_the_fallback() -> None:
    for wrapper in (WRAPPER_SH, WRAPPER_PS1):
        text = wrapper.read_text(encoding="utf-8")
        line = next(l for l in text.splitlines() if "oauth-login-openai.sh" in l)
        assert "[ -f /app/.launcher/oauth-login-openai.sh ] && exec bash /app/.launcher/oauth-login-openai.sh;" in line
        assert "; exec codex login --device-auth'" in line, line   # the old command, when the image has no script
        assert "docker exec" in line and "bash -c" in line


# ── the snapshot reads the login of the harness ───────────────────────────────

def _snapshot_script(wrapper: Path) -> str:
    text = wrapper.read_text(encoding="utf-8")
    mark = text.index("profile/welcomed.flag")
    start = text.rindex('const fs=require("fs");', 0, mark)
    end = text.index(");", mark) + 2   # through the write of the three words
    return text[start:end].replace("/jht_home", "@HOME@")


def _snapshot(wrapper: Path, home: Path) -> str:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    script = _snapshot_script(wrapper).replace("@HOME@", str(home))
    done = subprocess.run([node, "-e", script, ""], capture_output=True, text=True, check=False, timeout=30)
    assert done.returncode == 0, done.stderr
    return done.stdout


def _home(tmp_path: Path, config: dict, *, codex: bool = False, pi: str | None = None) -> Path:
    home = tmp_path / "jht_home"
    home.mkdir()
    (home / "jht.config.json").write_text(json.dumps(config), encoding="utf-8")
    if codex:
        (home / ".codex").mkdir()
        (home / ".codex" / "auth.json").write_text("{}", encoding="utf-8")
    if pi is not None:
        (home / ".pi" / "agent").mkdir(parents=True)
        (home / ".pi" / "agent" / "auth.json").write_text(pi, encoding="utf-8")
    return home


@pytest.mark.parametrize("wrapper", [WRAPPER_SH, WRAPPER_PS1], ids=lambda p: p.name)
def test_the_snapshot_reads_the_login_of_pi_when_the_harness_is_pi(tmp_path: Path, wrapper: Path) -> None:
    config = {"active_provider": "openai", "harness": "pi", "providers": {"openai": {"auth_method": "subscription"}}}
    assert _snapshot(wrapper, _home(tmp_path, config, pi="{}")) == "1 1 0"


@pytest.mark.parametrize("wrapper", [WRAPPER_SH, WRAPPER_PS1], ids=lambda p: p.name)
def test_a_codex_login_is_not_a_login_for_the_pi_harness(tmp_path: Path, wrapper: Path) -> None:
    config = {"active_provider": "openai", "harness": "pi", "providers": {"openai": {"auth_method": "subscription"}}}
    assert _snapshot(wrapper, _home(tmp_path, config, codex=True)) == "1 0 0"


@pytest.mark.parametrize("wrapper", [WRAPPER_SH, WRAPPER_PS1], ids=lambda p: p.name)
@pytest.mark.parametrize("config", [
    {"active_provider": "openai", "providers": {"openai": {"auth_method": "subscription"}}},
    {"active_provider": "openai", "harness": "codex", "providers": {"openai": {"auth_method": "subscription"}}},
])
def test_without_the_pi_harness_the_snapshot_still_reads_the_login_of_codex(
        tmp_path: Path, wrapper: Path, config: dict) -> None:
    assert _snapshot(wrapper, _home(tmp_path, config, codex=True, pi="{}")) == "1 1 0"
    other = tmp_path / "other"
    other.mkdir()
    assert _snapshot(wrapper, _home(other, config, pi="{}")) == "1 0 0"


@pytest.mark.parametrize("wrapper", [WRAPPER_SH, WRAPPER_PS1], ids=lambda p: p.name)
def test_an_empty_or_linked_pi_login_does_not_count(tmp_path: Path, wrapper: Path) -> None:
    config = {"active_provider": "openai", "harness": "pi", "providers": {"openai": {"auth_method": "subscription"}}}
    assert _snapshot(wrapper, _home(tmp_path, config, pi="")) == "1 0 0"
    linked = tmp_path / "linked"
    linked.mkdir()
    home = _home(linked, config)
    (home / ".pi" / "agent").mkdir(parents=True)
    elsewhere = linked / "elsewhere.json"
    elsewhere.write_text("{}", encoding="utf-8")
    (home / ".pi" / "agent" / "auth.json").symlink_to(elsewhere)
    assert _snapshot(wrapper, home) == "1 0 0"


def test_the_owner_of_the_pi_login_is_the_user_or_root_in_both_wrappers() -> None:
    for wrapper in (WRAPPER_SH, WRAPPER_PS1):
        script = _snapshot_script(wrapper)
        assert "s.uid===process.getuid()||s.uid===0" in script and "lstatSync" in script
        assert "readFileSync(p" not in script and "readFileSync(\"/jht_home/.pi" not in script   # the login is never opened
