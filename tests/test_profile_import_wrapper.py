"""`jht profile import FILE` and `jht profile validate FILE` hand the person's file to the CLI of the attested container, and nothing else."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from test_desktop_chat_wrapper import _runtime

PROFILE = b"name: Test Candidate\ntarget_role: Backend Engineer\n"
LIMIT = 64 * 1024


def _run(tmp_path: Path, *args: str) -> tuple[subprocess.CompletedProcess, list[str], Path]:
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    copy = tmp_path / "stdin-copy"
    env["JHT_TEST_STDIN_COPY"] = str(copy)
    done = subprocess.run([str(wrapper), *args], env=env, text=True, capture_output=True, timeout=20, check=False)
    return done, log.read_text(encoding="utf-8").splitlines(), copy


def _imports(calls: list[str]) -> list[str]:
    return [line for line in calls if "profile import" in line]


def _sub(tmp_path: Path, name: str) -> Path:
    # a runtime of its own per run: each _run builds one in the folder it is given
    path = tmp_path / name
    path.mkdir()
    return path


def _file(tmp_path: Path, content: bytes = PROFILE, name: str = "profile.yml") -> Path:
    path = tmp_path / name
    path.write_bytes(content)
    return path


def test_the_file_goes_to_the_attested_container_on_stdin_and_its_flags_with_it(tmp_path: Path):
    source = _file(tmp_path)
    done, calls, copy = _run(tmp_path, "profile", "import", str(source), "--replace", "--json")
    assert done.returncode == 0, done.stderr
    (call,) = _imports(calls)
    assert call.startswith("docker exec -i aaaaaaaaaaaa node ") and call.endswith("profile import --stdin --replace --json")
    assert str(source) not in call, "the container is never given a host path"
    assert copy.read_bytes() == PROFILE


def test_the_flags_may_come_before_the_file(tmp_path: Path):
    source = _file(tmp_path)
    done, calls, copy = _run(tmp_path, "profile", "import", "--replace", str(source))
    assert done.returncode == 0, done.stderr
    assert _imports(calls)[0].endswith("profile import --stdin --replace")
    assert copy.read_bytes() == PROFILE


def test_a_file_of_exactly_the_limit_goes_and_one_byte_more_does_not(tmp_path: Path):
    ok = _file(tmp_path, b"a" * LIMIT, "limit.yml")
    done, calls, copy = _run(tmp_path, "profile", "import", str(ok))
    assert done.returncode == 0 and len(_imports(calls)) == 1 and copy.stat().st_size == LIMIT

    over = _sub(tmp_path, "over")
    big = _file(over, b"a" * (LIMIT + 1), "big.yml")
    done, calls, _ = _run(over, "profile", "import", str(big))
    assert done.returncode == 1 and "64 KiB" in done.stderr
    assert _imports(calls) == []


def test_a_missing_file_or_a_link_never_reaches_the_container(tmp_path: Path):
    done, calls, _ = _run(tmp_path, "profile", "import", str(tmp_path / "missing.yml"))
    assert done.returncode == 1 and "file regolare" in done.stderr
    assert _imports(calls) == []

    other = _sub(tmp_path, "link")
    target = _file(other, PROFILE, "real.yml")
    link = other / "link.yml"
    link.symlink_to(target)
    done, calls, _ = _run(other, "profile", "import", str(link))
    assert done.returncode == 1 and "link" in done.stderr
    assert _imports(calls) == []


@pytest.mark.parametrize(
    "args",
    (
        ("profile", "import"),
        ("profile", "import", "a.yml", "b.yml"),
        ("profile", "import", "a.yml", "--nope"),
    ),
)
def test_a_wrong_ask_answers_2_and_runs_nothing(tmp_path: Path, args: tuple):
    done, calls, _ = _run(tmp_path, *args)
    assert done.returncode == 2, done.stderr
    assert _imports(calls) == []


def test_validate_and_help_keep_going_to_the_cli_unchanged(tmp_path: Path):
    done, calls, _ = _run(tmp_path, "profile", "validate", "--strict")
    assert done.returncode == 0, done.stderr
    assert any(line.endswith("profile validate --strict") for line in calls)
    done, calls, _ = _run(_sub(tmp_path, "help"), "profile", "import", "--help")
    assert done.returncode == 0, done.stderr
    assert any(line.endswith("profile import --help") for line in calls)
    assert all("--stdin" not in line for line in calls)


def _validates(calls: list[str]) -> list[str]:
    return [line for line in calls if "profile validate" in line]


def test_validate_hands_the_file_over_like_import_and_its_flags_with_it(tmp_path: Path):
    source = _file(tmp_path)
    done, calls, copy = _run(tmp_path, "profile", "validate", str(source), "--strict", "--json")
    assert done.returncode == 0, done.stderr
    (call,) = _validates(calls)
    assert call.startswith("docker exec -i aaaaaaaaaaaa node ") and call.endswith("profile validate --stdin --strict --json")
    assert str(source) not in call, "the container is never given a host path"
    assert copy.read_bytes() == PROFILE

    before = _sub(tmp_path, "before")
    done, calls, copy = _run(before, "profile", "validate", "--json", str(_file(before)))
    assert done.returncode == 0, done.stderr
    assert _validates(calls)[0].endswith("profile validate --stdin --json")
    assert copy.read_bytes() == PROFILE


def test_validate_has_the_same_limits_as_import(tmp_path: Path):
    ok = _file(tmp_path, b"a" * LIMIT, "limit.yml")
    done, calls, copy = _run(tmp_path, "profile", "validate", str(ok))
    assert done.returncode == 0 and len(_validates(calls)) == 1 and copy.stat().st_size == LIMIT

    over = _sub(tmp_path, "over")
    done, calls, _ = _run(over, "profile", "validate", str(_file(over, b"a" * (LIMIT + 1), "big.yml")))
    assert done.returncode == 1 and "64 KiB" in done.stderr
    assert _validates(calls) == []

    missing = _sub(tmp_path, "missing")
    done, calls, _ = _run(missing, "profile", "validate", str(missing / "nope.yml"))
    assert done.returncode == 1 and "file regolare" in done.stderr
    assert _validates(calls) == []

    other = _sub(tmp_path, "link")
    link = other / "link.yml"
    link.symlink_to(_file(other, PROFILE, "real.yml"))
    done, calls, _ = _run(other, "profile", "validate", str(link))
    assert done.returncode == 1 and "link" in done.stderr
    assert _validates(calls) == []


@pytest.mark.parametrize(
    "args",
    (
        ("profile", "validate", "a.yml", "b.yml"),
        ("profile", "validate", "a.yml", "--nope"),
    ),
)
def test_validate_with_a_wrong_ask_answers_2_and_runs_nothing(tmp_path: Path, args: tuple):
    done, calls, _ = _run(tmp_path, *args)
    assert done.returncode == 2, done.stderr
    assert _validates(calls) == []


@pytest.mark.parametrize("args", (("--strict", "--json"), ("--help",), ("-h",)))
def test_validate_without_a_file_still_goes_to_the_cli_as_it_is(tmp_path: Path, args: tuple):
    done, calls, _ = _run(tmp_path, "profile", "validate", *args)
    assert done.returncode == 0, done.stderr
    (call,) = _validates(calls)
    assert call.endswith("profile validate " + " ".join(args))
    assert "--stdin" not in call
