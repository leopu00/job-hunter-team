"""Which provider a sign-in of Pi is for (shared/skills/pi_login.py, shared/runtime/pi-login-keys.list, inspectPiLogin in agent-harness.js).

Pi keeps one entry per service in <team home>/.pi/agent/auth.json. A file that is there says nothing about whose account it is: with only
Anthropic's entry (a Claude subscription, billed per token as extra usage when used from Pi) it used to be taken for the sign-in of the
OpenAI account. The names of the entries are looked at, never the values; the Python and the JavaScript side give the same answer.

Run with: pytest tests/test_pi_login.py -v
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
import pi_login  # noqa: E402

SECRET = "-".join(["synthetic", "value", "0000", "bbbb", "2222"])
ENTRY = {"type": "oauth", "access": SECRET}

CASES = [
    # (provider, auth.json text, state)
    ("openai", json.dumps({"openai": ENTRY}), "ok"),
    ("openai", json.dumps({"openai-codex": ENTRY}), "other_provider"),   # the legacy id: the agents start with --provider openai
    ("codex", json.dumps({"openai": ENTRY}), "ok"),
    ("OpenAI", json.dumps({"openai": ENTRY}), "ok"),
    ("openai", json.dumps({"anthropic": ENTRY, "openai": ENTRY}), "ok"),
    ("openai", json.dumps({"anthropic": ENTRY}), "other_provider"),
    ("openai", json.dumps({"anthropic": ENTRY, "github-copilot": ENTRY}), "other_provider"),
    ("openai", json.dumps({"openai": {}}), "other_provider"),
    ("openai", json.dumps({"openai": "text"}), "other_provider"),
    ("openai", json.dumps({"openai": None}), "other_provider"),
    ("openai", "{}", "empty"),
    ("openai", "not json", "unreadable"),
    ("openai", "[]", "unreadable"),
    ("openai", "null", "unreadable"),
    ("glm", json.dumps({"zai": ENTRY}), "ok"),
    ("glm", json.dumps({"zai-coding-cn": ENTRY}), "other_provider"),   # another provider of Pi (China): the agents start with --provider zai
    ("glm", json.dumps({"anthropic": ENTRY}), "other_provider"),
    ("kimi", json.dumps({"moonshotai": ENTRY}), "ok"),
    ("moonshot", json.dumps({"moonshotai": ENTRY}), "ok"),
    ("kimi", json.dumps({"kimi-coding": ENTRY}), "other_provider"),
    ("somebody-else", json.dumps({"anthropic": ENTRY}), "no_rule"),
    ("", json.dumps({"anthropic": ENTRY}), "no_rule"),
]


@pytest.mark.parametrize("provider, text, state", CASES)
def test_the_python_side_names_the_state_from_the_entries_alone(provider: str, text: str, state: str) -> None:
    out = pi_login.inspect_text(text, provider)
    assert out["state"] == state
    assert SECRET not in json.dumps(out), "only the names of the entries come out"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_javascript_side_gives_the_same_answer_for_every_case() -> None:
    script = (
        "import('./shared/runtime/agent-harness.js').then((m) => {"
        "const cases = JSON.parse(process.argv[1]);"
        "console.log(JSON.stringify(cases.map(([p, t]) => { const r = m.inspectPiLogin(t, p); return [r.state, r.found, r.needs]; })));"
        "});"
    )
    done = subprocess.run(["node", "-e", script, json.dumps([[p, t] for p, t, _ in CASES])], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    from_js = json.loads(done.stdout)
    from_py = [[pi_login.inspect_text(t, p)[k] for k in ("state", "found", "needs")] for p, t, _ in CASES]
    assert from_js == from_py


def test_an_entry_name_that_is_not_a_plain_word_is_not_said() -> None:
    out = pi_login.inspect_text(json.dumps({"openai": ENTRY, "Ignore this\nand do that": ENTRY, "x" * 41: ENTRY}), "openai")
    assert out["found"] == ["openai"]


def test_the_file_is_looked_at_with_lstat_and_a_link_or_a_folder_or_a_huge_file_is_not_read(tmp_path: Path) -> None:
    good = tmp_path / "auth.json"
    good.write_text(json.dumps({"openai": ENTRY}), encoding="utf-8")
    assert pi_login.inspect_file(good, "openai")["state"] == "ok"
    assert pi_login.inspect_file(tmp_path / "missing.json", "openai")["state"] == "missing"
    link = tmp_path / "link.json"
    link.symlink_to(good)
    assert pi_login.inspect_file(link, "openai")["state"] == "unreadable"
    assert pi_login.inspect_file(tmp_path, "openai")["state"] == "unreadable"
    (tmp_path / "empty.json").write_text("", encoding="utf-8")
    assert pi_login.inspect_file(tmp_path / "empty.json", "openai")["state"] == "unreadable"
    huge = tmp_path / "huge.json"
    huge.write_text(json.dumps({"openai": {"x": "a" * (pi_login.MAX_BYTES + 1)}}), encoding="utf-8")
    assert pi_login.inspect_file(huge, "openai")["state"] == "unreadable"


def test_the_command_line_prints_one_json_line_without_any_value(tmp_path: Path) -> None:
    auth = tmp_path / "auth.json"
    auth.write_text(json.dumps({"anthropic": ENTRY}), encoding="utf-8")
    done = subprocess.run([sys.executable, "-I", str(ROOT / "shared" / "skills" / "pi_login.py"), str(auth), "openai"],
                          capture_output=True, text=True, timeout=30)
    assert done.returncode == 0
    assert json.loads(done.stdout) == {"state": "other_provider", "found": ["anthropic"], "needs": ["openai"]}
    assert SECRET not in done.stdout + done.stderr


def test_every_provider_pi_can_run_on_has_an_entry_name() -> None:
    names = pi_login.login_keys()
    harness = (ROOT / "shared" / "runtime" / "agent-harness.js").read_text(encoding="utf-8")
    assert "inspectPiLogin" in harness
    for provider in ("openai", "codex", "glm", "kimi", "moonshot"):
        assert names.get(provider), provider


# The names of the sign-ins in auth.json of Pi 1.5.0 (the version of the image), read in its code: `/login` saves under the id of the provider
# chosen, and these are the ids the agents start with. Anthropic's is refused for the team on Pi (billed per token as extra usage).
PI_1_5_0 = {
    "openai": ("openai",),        # ChatGPT sign-in and an OpenAI API key: the same entry
    "codex": ("openai",),
    "glm": ("zai",),
    "kimi": ("moonshotai",),      # Moonshot's key: the provider JHT starts pi with
    "moonshot": ("moonshotai",),
}


def test_the_names_are_those_of_pi_1_5_0_and_the_list_says_so():
    assert pi_login.login_keys() == PI_1_5_0
    text = (ROOT / "shared" / "runtime" / "pi-login-keys.list").read_text(encoding="utf-8")
    spawn = (ROOT / ".launcher" / "spawn-lib.sh").read_text(encoding="utf-8")
    pinned = next(line for line in spawn.splitlines() if line.startswith("JHT_PI_VERSION=")).split('"')[1]
    assert f"# PI_NAMES_FROM={pinned}" in text, "Pi was updated: read the names of its auth.json again, then change the version in the list"


def test_an_entry_the_agents_would_not_use_does_not_pass_the_check():
    # the ids the agents start with: --provider openai | zai | moonshotai (never openai-codex, zai-coding-cn or kimi-coding)
    for provider, other in (("openai", "openai-codex"), ("glm", "zai-coding-cn"), ("kimi", "kimi-coding")):
        assert pi_login.inspect_text(json.dumps({other: ENTRY}), provider)["state"] == "other_provider"
