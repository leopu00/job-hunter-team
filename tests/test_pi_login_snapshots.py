"""The onboarding snapshot of the app and of the wrappers counts Pi's sign-in only when it is for the provider of the setup.

The snapshot says «provider authenticated» from a marker file in the team's home. With Pi in charge of the OpenAI account the marker is Pi's
auth.json, which has one entry per service: a file with only Anthropic's entry (a Claude subscription, which Pi warns may be billed per token)
used to count, and the app went on to the team's start. The same expression is in five places that run in the container (onboarding.rs,
existing_team_runtime.rs twice, scripts/jht-wrapper.sh and .ps1); each is read from its source, `/jht_home` is pointed at a temporary folder,
and the real script runs under node on synthetic files.

Run with: pytest tests/test_pi_login_snapshots.py -v
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ONBOARDING = (ROOT / "desktop/src-tauri/src/onboarding.rs").read_text(encoding="utf-8")
EXISTING = (ROOT / "desktop/src-tauri/src/existing_team_runtime.rs").read_text(encoding="utf-8")
WRAPPER_SH = (ROOT / "scripts/jht-wrapper.sh").read_text(encoding="utf-8")
WRAPPER_PS1 = (ROOT / "scripts/jht-wrapper.ps1").read_text(encoding="utf-8")

pytestmark = [pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed"),
              pytest.mark.skipif(os.name == "nt", reason="the container side runs on Linux")]

SECRET = "-".join(["synthetic", "value", "3333", "cccc"])
OPENAI = {"openai": {"type": "oauth", "access": SECRET}}
ANTHROPIC = {"anthropic": {"type": "oauth", "access": SECRET}}


def _unrust(text: str) -> str:
    """A Rust string literal's text as the string it makes (only the escapes these two lines use)."""
    return text.replace("\\\\", "\0").replace('\\"', '"').replace("\0", "\\")


def onboarding_script() -> str:
    return re.search(r"const METADATA: &\[u8\] = br#\"(.*?)\"#;", ONBOARDING, re.S).group(1)


def wrapper_sh_script() -> str:
    return re.search(r"metadata=\"\$\(docker exec \"\$container_id\" node -e '\n(.*?)\n' \"\$expected_team\"", WRAPPER_SH, re.S).group(1)


def wrapper_ps1_script() -> str:
    return re.search(r"\$metadataScript = @'\n(.*?)\n'@", WRAPPER_PS1, re.S).group(1)


def team_probe_script() -> str:
    return re.search(r"\| \"\$JHT_ENGINE\" exec -i \"\$JHT_CID\" node -e '\n(.*?)\n' \|\| exit \$\?", EXISTING, re.S).group(1)


def snapshot_command_script() -> str:
    literal = re.search(r'command\(target, "(\\"\$JHT_ENGINE\\" exec \\"\$JHT_CID\\" node -e \'.*?\')"\)', EXISTING, re.S).group(1)
    return re.search(r"node -e '(.*)'$", _unrust(literal), re.S).group(1)


def run(script: str, home: Path, *, stdin: str = "", args: tuple[str, ...] = ()) -> str:
    done = subprocess.run(["node", "-e", script.replace("/jht_home", str(home)), *args], input=stdin, capture_output=True, text=True, timeout=30)
    assert done.returncode == 0, done.stderr
    return done.stdout


def authenticated(kind: str, home: Path) -> bool:
    """The `authenticated` word of the snapshot, whichever script says it."""
    if kind == "onboarding":
        return run(onboarding_script(), home).split()[1] == "1"
    if kind == "wrapper-sh":
        return run(wrapper_sh_script(), home, args=("",)).split()[1] == "1"
    if kind == "wrapper-ps1":
        return run(wrapper_ps1_script(), home).split()[1] == "1"
    if kind == "team-probe":
        (home / "cloud.json").write_text(json.dumps({"user_id": "expected-team-0123456789"}), encoding="utf-8")
        out = run(team_probe_script(), home, stdin="expected-team-0123456789\n")
        return "providerAuthenticated=1" in out.splitlines()
    out = run(snapshot_command_script(), home)
    return "providerAuthenticated=1" in out.splitlines()


KINDS = ["onboarding", "wrapper-sh", "wrapper-ps1", "team-probe", "snapshot-command"]


def team(tmp_path: Path, *, harness: str | None, provider: str = "openai", pi: object = None, raw: str | None = None, codex: bool = False) -> Path:
    home = tmp_path / "jht_home"
    home.mkdir(parents=True)
    config = {"active_provider": provider, "providers": {provider: {"auth_method": "subscription"}}}
    if harness:
        config["harness"] = harness
    (home / "jht.config.json").write_text(json.dumps(config), encoding="utf-8")
    if pi is not None or raw is not None:
        (home / ".pi" / "agent").mkdir(parents=True)
        (home / ".pi" / "agent" / "auth.json").write_text(raw if raw is not None else json.dumps(pi), encoding="utf-8")
    if codex:
        (home / ".codex").mkdir()
        (home / ".codex" / "auth.json").write_text("{}", encoding="utf-8")
    return home


@pytest.mark.parametrize("kind", KINDS)
def test_the_scripts_are_found_in_the_sources_and_run(kind, tmp_path):
    assert authenticated(kind, team(tmp_path, harness="pi", pi=OPENAI)) is True


@pytest.mark.parametrize("kind", KINDS)
def test_a_pi_file_with_only_anthropic_is_not_the_sign_in_of_the_openai_account(kind, tmp_path):
    assert authenticated(kind, team(tmp_path, harness="pi", pi=ANTHROPIC)) is False


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("pi, raw", [({}, None), ({"openai": {}}, None), ({"openai": "x"}, None), (None, "not json"), (None, "[]"),
                                      ({"openai-codex": {"type": "oauth"}}, None)],
                         ids=["empty-object", "empty-entry", "entry-not-an-object", "not-json", "a-list", "legacy-id"])
def test_a_pi_file_with_no_usable_entry_of_the_provider_is_not_a_sign_in(kind, pi, raw, tmp_path):
    assert authenticated(kind, team(tmp_path, harness="pi", pi=pi, raw=raw)) is False


@pytest.mark.parametrize("kind", KINDS)
def test_the_entry_of_the_provider_counts_among_other_services(kind, tmp_path):
    assert authenticated(kind, team(tmp_path, harness="pi", pi={**ANTHROPIC, **OPENAI})) is True


@pytest.mark.parametrize("kind", KINDS)
def test_a_pi_login_file_that_is_a_fifo_or_huge_is_not_read_and_not_a_sign_in(kind, tmp_path):
    home = team(tmp_path, harness="pi", pi={})
    target = home / ".pi" / "agent" / "auth.json"
    target.unlink()
    os.mkfifo(target)
    assert authenticated(kind, home) is False
    target.unlink()
    target.write_text(json.dumps({"openai": {"x": "a" * (300 * 1024)}}), encoding="utf-8")
    assert authenticated(kind, home) is False


@pytest.mark.parametrize("kind", KINDS)
def test_the_codex_harness_and_the_other_providers_are_judged_as_they_always_were(kind, tmp_path):
    # Codex in charge: Codex's file, whatever Pi's file holds
    assert authenticated(kind, team(tmp_path / "a", harness=None, pi=ANTHROPIC, codex=True)) is True
    assert authenticated(kind, team(tmp_path / "b", harness=None, pi=OPENAI)) is False
    # another provider with Pi's file lying there: its own marker decides
    other = team(tmp_path / "c", harness="pi", provider="claude", pi=OPENAI)
    assert authenticated(kind, other) is False
    (other / ".claude").mkdir()
    (other / ".claude" / ".credentials.json").write_text("{}", encoding="utf-8")
    assert authenticated(kind, other) is True


@pytest.mark.parametrize("kind", KINDS)
def test_nothing_of_the_file_reaches_the_output(kind, tmp_path):
    home = team(tmp_path, harness="pi", pi=ANTHROPIC)
    if kind == "wrapper-sh":
        out = run(wrapper_sh_script(), home, args=("",))
    elif kind == "onboarding":
        out = run(onboarding_script(), home)
    elif kind == "wrapper-ps1":
        out = run(wrapper_ps1_script(), home)
    elif kind == "snapshot-command":
        out = run(snapshot_command_script(), home)
    else:
        (home / "cloud.json").write_text(json.dumps({"user_id": "expected-team-0123456789"}), encoding="utf-8")
        out = run(team_probe_script(), home, stdin="expected-team-0123456789\n")
    assert SECRET not in out


def test_the_names_in_the_five_scripts_are_the_ones_of_the_shared_list():
    listed = next(line for line in (ROOT / "shared/runtime/pi-login-keys.list").read_text(encoding="utf-8").splitlines() if line.startswith("openai|"))
    names = listed.split("|")[1].split(",")
    assert names == ["openai"]
    for script in (onboarding_script(), wrapper_sh_script(), wrapper_ps1_script(), team_probe_script(), snapshot_command_script()):
        assert re.search(r"\[[\"']openai[\"']\]\.some\(", script), "each script names the entries of the shared list"
