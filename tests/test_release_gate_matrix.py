"""Contratto fra la release desktop e la matrice canonica dei gate Godot."""

from copy import deepcopy
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
RELEASE_WORKFLOW = ROOT / ".github" / "workflows" / "release.yml"
TEST_MATRIX = ROOT / "game" / "tools" / "test-matrix.txt"

WINDOWS_OS = "windows-2022"
POSIX_OS = {"macos-14", "ubuntu-22.04"}
RELEASE_OS = {WINDOWS_OS, *POSIX_OS}
POSIX_COMMAND = "bash game/tools/run.sh test gate"
WINDOWS_COMMAND = "./game/tools/run.ps1 test gate"


def _load_release() -> dict:
    # BaseLoader conserva `on` come testo e le espressioni Actions intatte.
    return yaml.load(RELEASE_WORKFLOW.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)


def _gate_rows(matrix_text: str) -> list[dict[str, str]]:
    rows = []
    for line in matrix_text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split("|")
        assert len(fields) == 7, line
        test_id, kind, tier, platform, env, target, marker = fields
        if tier == "gate":
            rows.append(
                {
                    "id": test_id,
                    "kind": kind,
                    "platform": platform,
                    "env": env,
                    "target": target,
                    "marker": marker,
                }
            )
    assert rows
    assert len({row["id"] for row in rows}) == len(rows)
    return rows


def _step_with_exact_command(steps: list[dict], command: str) -> dict:
    matches = [
        step
        for step in steps
        if command in str(step.get("run", "")).splitlines()
    ]
    assert len(matches) == 1, f"canonical release command missing or duplicated: {command}"
    return matches[0]


def _assert_canonical_release_contract(workflow: dict) -> None:
    job = workflow["jobs"]["build-game"]
    configured_os = {entry["os"] for entry in job["strategy"]["matrix"]["include"]}
    assert configured_os == RELEASE_OS

    steps = job["steps"]
    posix = _step_with_exact_command(steps, POSIX_COMMAND)
    assert posix.get("if") == "runner.os != 'Windows'"
    assert "continue-on-error" not in posix

    windows = _step_with_exact_command(steps, WINDOWS_COMMAND)
    assert windows.get("if") == "runner.os == 'Windows'"
    assert windows.get("shell") == "pwsh"
    assert "continue-on-error" not in windows
    assert "$env:JHT_GODOT_BIN = $GodotExe.FullName" in windows["run"]


def _release_coverage(workflow: dict, rows: list[dict[str, str]]) -> dict[str, set[str]]:
    _assert_canonical_release_contract(workflow)
    coverage = {os_name: set() for os_name in RELEASE_OS}
    for row in rows:
        assert row["platform"] in {"any", "posix"}, (
            f"release gate {row['id']} has no causal platform policy: {row['platform']}"
        )
        applicable_os = RELEASE_OS if row["platform"] == "any" else POSIX_OS
        for os_name in applicable_os:
            coverage[os_name].add(row["id"])
    return coverage


def test_release_consumes_every_applicable_gate_from_the_canonical_matrix():
    workflow = _load_release()
    rows = _gate_rows(TEST_MATRIX.read_text(encoding="utf-8"))
    coverage = _release_coverage(workflow, rows)

    all_gate_ids = {row["id"] for row in rows}
    posix_gate_ids = {row["id"] for row in rows if row["platform"] == "posix"}
    assert coverage["macos-14"] == all_gate_ids
    assert coverage["ubuntu-22.04"] == all_gate_ids
    assert coverage[WINDOWS_OS] == all_gate_ids - posix_gate_ids

    # Un target copiato nel workflow ricreerebbe la lista manuale divergente.
    release_source = RELEASE_WORKFLOW.read_text(encoding="utf-8")
    for row in rows:
        # I target generici dei gate `run` (per esempio `--quit-after 3`)
        # possono comparire legittimamente negli smoke dell'artefatto. Sono i
        # path dei selftest a costituire una seconda lista della suite.
        if "tools/" in row["target"]:
            assert row["target"] not in release_source, row["id"]


def test_a_new_gate_enters_all_applicable_release_jobs_without_workflow_changes():
    expanded_matrix = (
        TEST_MATRIX.read_text(encoding="utf-8")
        + "\nfuture_release_gate|script|gate|any|-|"
        + "tools/future_release_gate_selftest.gd|FUTURE-RELEASE-GATE PASS\n"
    )

    # Il workflow resta quello reale e immutato: cambia soltanto la matrice.
    coverage = _release_coverage(_load_release(), _gate_rows(expanded_matrix))
    assert all("future_release_gate" in coverage[os_name] for os_name in RELEASE_OS)


@pytest.mark.parametrize(
    ("good_command", "wrong_command"),
    [
        (POSIX_COMMAND, "bash game/tools/run.sh test watch"),
        (WINDOWS_COMMAND, "./game/tools/run.ps1 test watch"),
    ],
    ids=("posix-wrong-tier", "windows-wrong-tier"),
)
def test_release_rejects_a_different_runner_subcommand(good_command, wrong_command):
    workflow = deepcopy(_load_release())
    for step in workflow["jobs"]["build-game"]["steps"]:
        if good_command in str(step.get("run", "")):
            step["run"] = step["run"].replace(good_command, wrong_command)
            break
    else:
        pytest.fail(f"fixture command not found: {good_command}")

    with pytest.raises(AssertionError, match="canonical release command missing"):
        _assert_canonical_release_contract(workflow)
