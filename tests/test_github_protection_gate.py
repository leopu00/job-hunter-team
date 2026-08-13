from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "github_protection_gate.py"
FIXTURES = ROOT / "tests" / "fixtures" / "github-protection"

spec = importlib.util.spec_from_file_location("github_protection_gate", SCRIPT)
assert spec is not None and spec.loader is not None
gate = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = gate
spec.loader.exec_module(gate)


def _snapshot(name: str) -> dict[str, Any]:
    return gate.load_snapshot(FIXTURES / name)


def test_current_fixture_reports_only_known_bootstrap_gaps() -> None:
    result = gate.evaluate(_snapshot("current-fail.json"))

    assert result.issues == (
        "admin_always_bypass",
        "admins_not_enforced",
        "signatures_not_required",
    )


def test_target_fixture_passes_exact_policy() -> None:
    result = gate.evaluate(_snapshot("target-pass.json"))

    assert result.ok
    assert gate.render(result) == (
        "GITHUB-PROTECTION PASS checks=6 reviews=1 signatures=required "
        "admins=enforced force=off delete=off"
    )


def test_drift_fixture_fails_with_finite_codes() -> None:
    result = gate.evaluate(_snapshot("drift-fail.json"))

    assert result.issues == (
        "admin_always_bypass",
        "codeowner_review_not_required",
        "delete_allowed",
        "dismiss_stale_reviews_not_required",
        "force_push_allowed",
        "required_checks_drift",
        "review_count_drift",
        "signatures_not_required",
        "status_checks_not_strict",
    )
    assert set(result.issues) <= gate.SAFE_CODES


def test_live_reader_uses_only_get_and_fetches_ruleset_details() -> None:
    commands: list[list[str]] = []
    responses = [
        _snapshot("target-pass.json")["protection"],
        [{"id": 42}],
        _snapshot("target-pass.json")["rulesets"][0],
    ]

    def fake_runner(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        commands.append(command)
        return subprocess.CompletedProcess(command, 0, json.dumps(responses.pop(0)), "")

    snapshot = gate.load_live_snapshot(fake_runner)

    assert gate.evaluate(snapshot).ok
    assert len(commands) == 3
    assert all(command[:4] == ["gh", "api", "--method", "GET"] for command in commands)
    assert all("--input" not in command for command in commands)
    assert commands[-1][-1] == f"repos/{gate.REPOSITORY}/rulesets/42"


def test_invalid_snapshot_output_does_not_echo_path_or_contents(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    synthetic_secret = "github_pat_SYNTHETIC_DO_NOT_PRINT"
    snapshot_path = tmp_path / f"private-{synthetic_secret}.json"
    snapshot_path.write_text(f'{{"token":"{synthetic_secret}",', encoding="utf-8")

    assert gate.main(["--snapshot", str(snapshot_path)]) == 2
    captured = capsys.readouterr()

    assert captured.out == ""
    assert captured.err == "GITHUB-PROTECTION ERROR code=input_invalid\n"
    assert synthetic_secret not in captured.err
    assert str(snapshot_path) not in captured.err


def test_live_error_does_not_echo_transport_details(
    capsys: pytest.CaptureFixture[str],
) -> None:
    synthetic_secret = "Bearer SYNTHETIC_DO_NOT_PRINT"

    def fake_runner(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(command, 1, synthetic_secret, synthetic_secret)

    assert gate.main(["--live"], runner=fake_runner) == 2
    captured = capsys.readouterr()

    assert captured.out == ""
    assert captured.err == "GITHUB-PROTECTION ERROR code=live_read_failed\n"
    assert synthetic_secret not in captured.err


def test_argument_error_does_not_echo_untrusted_argument(
    capsys: pytest.CaptureFixture[str],
) -> None:
    synthetic_secret = "github_pat_SYNTHETIC_DO_NOT_PRINT"

    assert gate.main(["--unknown", synthetic_secret]) == 2
    captured = capsys.readouterr()

    assert captured.out == ""
    assert captured.err == "GITHUB-PROTECTION ERROR code=input_invalid\n"
    assert synthetic_secret not in captured.err


@pytest.mark.parametrize(
    ("fixture", "expected_exit"),
    (("target-pass.json", 0), ("current-fail.json", 1), ("drift-fail.json", 1)),
)
def test_cli_fixture_exit_status(
    fixture: str,
    expected_exit: int,
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert gate.main(["--snapshot", str(FIXTURES / fixture)]) == expected_exit
    captured = capsys.readouterr()

    assert captured.err == ""
    assert captured.out.startswith("GITHUB-PROTECTION ")
