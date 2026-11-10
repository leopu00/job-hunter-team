"""Before the first download of the helpers (no .runtime-helpers yet) the read-only commands the app reads answer «not installed yet»,
in the shape the helper uses, instead of failing with `jht upgrade`: `jht tools status --json`, `jht integration list|status`.

The wrapper is run as a program on a signed fake runtime that has no helpers manifest, with a Docker spy that records every call."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from test_cli_help_never_starts_docker import calls, make_docker_spy, run_wrapper, write_trusted_runtime

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
LIBRARY = ROOT / "scripts" / "jht-integration.sh"
IDS = ["google", "telegram", "mail", "linkedin-login", "screen", "media"]


@pytest.fixture()
def host(tmp_path):
    env = write_trusted_runtime(tmp_path)
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=False)
    assert not (Path(env["JHT_RUNTIME_DIR"]) / ".runtime-helpers").exists()

    def run(*args: str):
        done = run_wrapper(list(args), fake_bin, tmp_path, extra_env=env)
        return done

    return type("Host", (), {"run": run, "log": log, "runtime": Path(env["JHT_RUNTIME_DIR"])})


def test_tools_status_json_is_a_valid_state_not_an_error(host):
    done = host.run("tools", "status", "--json")
    assert done.returncode == 0, done.stderr
    assert json.loads(done.stdout) == {"ok": True, "state": "none", "tier": "full", "reason": "not_installed"}
    assert done.stdout.count("\n") == 1


def test_integration_list_json_names_every_integration_as_not_installed(host):
    done = host.run("integration", "list", "--json")
    assert done.returncode == 0, done.stderr
    rows = json.loads(done.stdout)["integrations"]
    assert [row["id"] for row in rows] == IDS
    assert {row["state"] for row in rows} == {"not_installed"} and {row["reason"] for row in rows} == {"non ancora installato"}


def test_integration_list_in_words_has_one_line_per_integration(host):
    done = host.run("integration", "list")
    assert done.returncode == 0, done.stderr
    lines = done.stdout.splitlines()
    assert [line.split()[0] for line in lines] == IDS and all("non installato" in line for line in lines)


@pytest.mark.parametrize("flag", [True, False])
def test_integration_status_of_one_id_and_of_all(host, flag):
    args = ["integration", "status", "mail"] + (["--json"] if flag else [])
    one = host.run(*args)
    assert one.returncode == 0, one.stderr
    if flag:
        assert json.loads(one.stdout) == {"id": "mail", "state": "not_installed", "reason": "non ancora installato"}
    else:
        assert one.stdout.split()[0] == "mail" and "non installato" in one.stdout
    everyone = host.run("integration", "status", "--json")
    assert [row["id"] for row in json.loads(everyone.stdout)["integrations"]] == IDS


@pytest.mark.parametrize("args", [
    ("integration", "status", "bogus", "--json"),   # an id outside the closed list: the usage error of the helper, not an answer
    ("integration", "list", "--bogus"),
    ("integration", "list", "mail"),
    ("tools", "status"),                            # no --json: not a contract the app reads
    ("tools", "pull"),                              # never downloads, never answers for the person
    ("tools", "switch"),
])
def test_everything_else_keeps_the_old_path_and_its_error(host, args):
    done = host.run(*args)
    assert done.returncode == 1 and "non ancora installato" in done.stderr and "jht upgrade" in done.stderr, (done.stdout, done.stderr)
    assert done.stdout == ""


def test_the_answer_touches_no_engine_and_writes_nothing(host):
    for args in (("tools", "status", "--json"), ("integration", "list", "--json"), ("integration", "status", "--json")):
        assert host.run(*args).returncode == 0
    assert set(calls(host.log)) <= {"info"}, calls(host.log)
    # the wrapper's own start writes host-values; the answers add no helpers manifest, no helper and no markers folder
    assert set(p.name for p in host.runtime.iterdir()) <= {"docker-compose.yml", "host-setup.sh", ".runtime-integrity", "host-values"}


def test_the_ids_of_the_answer_are_the_ones_of_the_helper():
    wrapper = WRAPPER.read_text(encoding="utf-8")
    library = LIBRARY.read_text(encoding="utf-8")
    theirs = re.search(r'^INTEGRATION_IDS="([^"]*)"', library, re.M).group(1)
    ours = re.search(r'^INTEGRATION_IDS_ABSENT="([^"]*)"', wrapper, re.M).group(1)
    assert ours == theirs, "two lists, one meaning: the wrapper answers for the ids the helper knows"
