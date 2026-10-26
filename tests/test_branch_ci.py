"""Tests runs on every developer branch, with a precheck of the range it adds.

A merge request used to reach master-arthur without a run of its own, because
Tests started only on the three protected branches.  Two things are pinned here:
what a developer branch gets and does not get in test.yml, and what
scripts/ci/precheck-sha.sh refuses, on a real git repository built for the test.
"""
import os
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
TEST_YML = ROOT / ".github" / "workflows" / "test.yml"
PRECHECK = ROOT / "scripts" / "ci" / "precheck-sha.sh"

PROTECTED = ["refs/heads/master", "refs/heads/hq-master", "refs/heads/master-arthur"]
OWNER = "Owner Name <owner@example.com>"
# A stand-in for the real list, which lives in a secret and never in the repository.
NAMES = "alice|bob"


def _workflow() -> dict:
    # BaseLoader keeps the YAML key `on` as a string (SafeLoader turns it into True).
    return yaml.load(TEST_YML.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)


def _on_developer_branch(condition: str) -> bool:
    """Evaluate the `if:` of a job for a push to a developer branch.

    The conditions are built from three terms only, so they are evaluated by
    substitution instead of by a GitHub expression engine.
    """
    cond = " ".join(condition.split())
    cond = cond.replace("github.repository == 'leopu00/job-hunter-team'", "true")
    cond = cond.replace("github.event_name != 'schedule'", "true")
    protected = "!contains(fromJSON('" + '["' + '","'.join(PROTECTED) + '"]' + "'), github.ref)"
    cond = cond.replace("github.event_name == 'push' && " + protected, "true")
    # What is left is only `true`, `&&`, `!` and parentheses.
    cond = cond.replace("&&", " and ").replace("!(", "not (")
    assert set(cond.replace("true", "").replace("and", "").replace("not", "")) <= set(" ()"), (
        f"condition not understood: {condition}"
    )
    return bool(eval(cond.replace("true", "True"), {"__builtins__": {}}))  # noqa: S307 - the text was checked above


def test_tests_start_on_every_branch_push():
    assert _workflow()["on"]["push"]["branches"] == ["**", "!dependabot/**"]


def test_a_developer_branch_gets_the_precheck_and_not_the_non_blocking_or_real_project_jobs():
    jobs = _workflow()["jobs"]
    assert _on_developer_branch(jobs["precheck"]["if"])
    for name in ("compose-provider-parity", "e2e"):
        assert not _on_developer_branch(jobs[name]["if"]), name
    # The blocking set keeps running there: no job condition, or one that does not mention the branch.
    for name in ("api-worker", "vitest", "desktop", "desktop-rust", "agent-harness", "migration-gate", "pytest"):
        assert "refs/heads" not in jobs[name].get("if", ""), name


def test_the_rust_job_leaves_windows_out_of_a_developer_branch_only():
    expression = _workflow()["jobs"]["desktop-rust"]["strategy"]["matrix"]["os"]
    # fromJSON(<developer branch> && '[...two...]' || '[...three...]')
    branch_only, everything = expression.split(" && '", 1)[1].split("' || '")
    assert "windows-latest" not in branch_only
    assert "ubuntu-latest" in branch_only and "macos-latest" in branch_only
    assert "windows-latest" in everything.rstrip("') }}")


def test_a_newer_push_replaces_the_run_of_a_developer_branch_but_not_of_a_protected_one():
    group = _workflow()["concurrency"]["group"]
    assert "|| 'branch'" in group
    assert all(branch in group for branch in PROTECTED)


def test_the_precheck_job_reads_the_names_from_secrets_and_never_from_the_repository():
    steps = _workflow()["jobs"]["precheck"]["steps"]
    env = next(step["env"] for step in steps if "precheck-sha.sh" in step.get("run", ""))
    assert env == {
        "PRECHECK_NAMES": "${{ secrets.PRECHECK_NAMES }}",
        "PRECHECK_OWNER": "${{ secrets.PRECHECK_OWNER }}",
    }
    assert "owner@" not in PRECHECK.read_text(encoding="utf-8")


# ---- scripts/ci/precheck-sha.sh on a real repository -------------------------

pytestmark_git = pytest.mark.skipif(shutil.which("git") is None, reason="git is needed")


def _git(repo: Path, *args: str, author: str = OWNER) -> str:
    name, email = author.rstrip(">").split(" <")
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email,
        "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email,
        "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null",
    }
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True, env=env
    ).stdout


def _repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "base")
    (repo / "readme.txt").write_text("hello\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", "base")
    _git(repo, "switch", "-q", "-c", "work")
    return repo


def _commit(repo: Path, text: str, message: str = "add a note", author: str = OWNER) -> str:
    (repo / "note.txt").write_text(text, encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", message, author=author)
    return _git(repo, "rev-parse", "HEAD").strip()


def _precheck(repo: Path, sha: str, names: str | None = NAMES, owner: str | None = OWNER):
    env = {k: v for k, v in os.environ.items() if not k.startswith("PRECHECK_")}
    if names is not None:
        env["PRECHECK_NAMES"] = names
    if owner is not None:
        env["PRECHECK_OWNER"] = owner
    result = subprocess.run(
        ["sh", str(PRECHECK), sha, "base"], cwd=repo, capture_output=True, text=True, env=env
    )
    return result.returncode, result.stdout + result.stderr


@pytestmark_git
def test_a_clean_range_passes(tmp_path):
    repo = _repo(tmp_path)
    code, out = _precheck(repo, _commit(repo, "a plain line\n"))
    assert code == 0, out
    assert "OK    6" in out and "OK    7" in out


@pytest.mark.parametrize("word", ["alice", "Bob"])
@pytestmark_git
def test_a_forbidden_name_in_an_added_line_is_refused_without_printing_the_line(tmp_path, word):
    repo = _repo(tmp_path)
    code, out = _precheck(repo, _commit(repo, f"ask {word} to look\n"))
    assert code == 1, out
    assert "FAIL  7" in out
    assert "to look" not in out


@pytestmark_git
def test_a_forbidden_name_in_a_commit_message_is_refused(tmp_path):
    repo = _repo(tmp_path)
    code, out = _precheck(repo, _commit(repo, "a plain line\n", message="fix for alice"))
    assert code == 1, out
    assert "FAIL  6" in out


@pytestmark_git
def test_another_author_is_refused(tmp_path):
    repo = _repo(tmp_path)
    code, out = _precheck(repo, _commit(repo, "a plain line\n", author="Someone Else <else@example.com>"))
    assert code == 1, out
    assert "FAIL  5" in out


@pytestmark_git
def test_without_the_secrets_the_checks_are_skipped_never_passed(tmp_path):
    repo = _repo(tmp_path)
    code, out = _precheck(repo, _commit(repo, "ask alice\n"), names=None, owner=None)
    assert code == 0, out
    assert "SKIPPED, not passed" in out
    assert "OK    6" not in out and "OK    7" not in out and "OK    5" not in out


@pytestmark_git
def test_a_conflicting_range_is_refused(tmp_path):
    repo = _repo(tmp_path)
    sha = _commit(repo, "work side\n")
    _git(repo, "switch", "-q", "base")
    (repo / "note.txt").write_text("base side\n", encoding="utf-8")
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", "base moves")
    code, out = _precheck(repo, sha)
    assert code == 1, out
    assert "FAIL  2" in out


@pytestmark_git
def test_a_wrong_sha_is_refused(tmp_path):
    repo = _repo(tmp_path)
    code, out = _precheck(repo, "0" * 40)
    assert code == 1, out
