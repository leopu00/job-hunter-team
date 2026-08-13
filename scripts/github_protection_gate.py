#!/usr/bin/env python3
"""Read-only gate for the repository's GitHub protection policy."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPOSITORY = "leopu00/job-hunter-team"
BRANCH = "master"
MASTER_REF = f"refs/heads/{BRANCH}"
GITHUB_ACTIONS_APP_ID = 15368
ADMIN_REPOSITORY_ROLE_ID = 5
MAX_JSON_BYTES = 512 * 1024
MAX_RULESETS = 100

EXPECTED_CHECKS = (
    "Build Web",
    "Gitleaks — secrets check",
    "Lint & Type-check",
    "SAST — Semgrep",
    "npm audit",
    "vitest — tests/js",
)

SAFE_CODES = frozenset(
    {
        "admin_always_bypass",
        "admins_not_enforced",
        "codeowner_review_not_required",
        "delete_allowed",
        "dismiss_stale_reviews_not_required",
        "force_push_allowed",
        "input_invalid",
        "live_read_failed",
        "required_checks_drift",
        "review_count_drift",
        "signatures_not_required",
        "status_checks_not_strict",
    }
)

Runner = Callable[..., subprocess.CompletedProcess[str]]


class GateError(Exception):
    """Expected failure whose message is safe to print."""

    def __init__(self, code: str) -> None:
        if code not in SAFE_CODES:
            raise ValueError("unsafe gate error code")
        super().__init__(code)
        self.code = code


class SafeArgumentParser(argparse.ArgumentParser):
    """Convert argument errors into finite, sanitized gate errors."""

    def error(self, message: str) -> None:
        raise GateError("input_invalid")


@dataclass(frozen=True)
class GateResult:
    issues: tuple[str, ...]

    @property
    def ok(self) -> bool:
        return not self.issues


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _decode_json(raw: str, error_code: str) -> Any:
    if not isinstance(raw, str):
        raise GateError(error_code)
    try:
        if len(raw.encode("utf-8")) > MAX_JSON_BYTES:
            raise GateError(error_code)
        return json.loads(raw, object_pairs_hook=_reject_duplicate_keys)
    except GateError:
        raise
    except (TypeError, UnicodeError, ValueError) as exc:
        raise GateError(error_code) from exc


def load_snapshot(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise GateError("input_invalid") from exc

    snapshot = _decode_json(raw, "input_invalid")
    if not isinstance(snapshot, dict):
        raise GateError("input_invalid")
    if snapshot.get("schema_version") != 1:
        raise GateError("input_invalid")
    if not isinstance(snapshot.get("protection"), dict):
        raise GateError("input_invalid")
    if not isinstance(snapshot.get("rulesets"), list):
        raise GateError("input_invalid")
    return snapshot


def _gh_get(endpoint: str, runner: Runner) -> Any:
    command = [
        "gh",
        "api",
        "--method",
        "GET",
        "--header",
        "Accept: application/vnd.github+json",
        "--header",
        "X-GitHub-Api-Version: 2022-11-28",
        endpoint,
    ]
    try:
        completed = runner(
            command,
            capture_output=True,
            check=False,
            text=True,
            timeout=30,
        )
    except (OSError, UnicodeError, subprocess.SubprocessError) as exc:
        raise GateError("live_read_failed") from exc
    if completed.returncode != 0:
        raise GateError("live_read_failed")
    return _decode_json(completed.stdout, "live_read_failed")


def load_live_snapshot(runner: Runner = subprocess.run) -> dict[str, Any]:
    protection = _gh_get(
        f"repos/{REPOSITORY}/branches/{BRANCH}/protection",
        runner,
    )
    summaries = _gh_get(
        f"repos/{REPOSITORY}/rulesets?includes_parents=false&per_page={MAX_RULESETS}",
        runner,
    )
    if not isinstance(protection, dict) or not isinstance(summaries, list):
        raise GateError("live_read_failed")
    if len(summaries) > MAX_RULESETS:
        raise GateError("live_read_failed")

    rulesets: list[dict[str, Any]] = []
    for summary in summaries:
        if not isinstance(summary, dict):
            raise GateError("live_read_failed")
        ruleset_id = summary.get("id")
        if not isinstance(ruleset_id, int) or isinstance(ruleset_id, bool):
            raise GateError("live_read_failed")
        if ruleset_id <= 0:
            raise GateError("live_read_failed")
        detail = _gh_get(f"repos/{REPOSITORY}/rulesets/{ruleset_id}", runner)
        if not isinstance(detail, dict):
            raise GateError("live_read_failed")
        rulesets.append(detail)

    return {"schema_version": 1, "protection": protection, "rulesets": rulesets}


def _enabled(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return isinstance(value, dict) and value.get("enabled") is True


def _targets_master(ruleset: dict[str, Any]) -> bool:
    conditions = ruleset.get("conditions")
    if not isinstance(conditions, dict):
        return False
    ref_name = conditions.get("ref_name")
    if not isinstance(ref_name, dict):
        return False
    include = ref_name.get("include")
    exclude = ref_name.get("exclude")
    return include == [MASTER_REF] and exclude == []


def _expected_checks() -> set[tuple[str, int]]:
    return {(name, GITHUB_ACTIONS_APP_ID) for name in EXPECTED_CHECKS}


def _actual_checks(protection: dict[str, Any]) -> set[tuple[str, int]] | None:
    status_checks = protection.get("required_status_checks")
    if not isinstance(status_checks, dict):
        return None
    checks = status_checks.get("checks")
    if not isinstance(checks, list):
        return None

    result: set[tuple[str, int]] = set()
    for check in checks:
        if not isinstance(check, dict):
            return None
        context = check.get("context")
        app_id = check.get("app_id")
        if not isinstance(context, str):
            return None
        if not isinstance(app_id, int) or isinstance(app_id, bool):
            return None
        result.add((context, app_id))
    if len(result) != len(checks):
        return None
    return result


def evaluate(snapshot: dict[str, Any]) -> GateResult:
    protection = snapshot["protection"]
    rulesets = snapshot["rulesets"]
    issues: set[str] = set()

    status_checks = protection.get("required_status_checks")
    if not isinstance(status_checks, dict) or status_checks.get("strict") is not True:
        issues.add("status_checks_not_strict")
    if _actual_checks(protection) != _expected_checks():
        issues.add("required_checks_drift")
    if not _enabled(protection.get("enforce_admins")):
        issues.add("admins_not_enforced")
    if not _enabled(protection.get("required_signatures")):
        issues.add("signatures_not_required")
    if _enabled(protection.get("allow_force_pushes")):
        issues.add("force_push_allowed")
    if _enabled(protection.get("allow_deletions")):
        issues.add("delete_allowed")

    review_counts: list[int] = []
    codeowner_review = False
    dismiss_stale_reviews = False
    for ruleset in rulesets:
        if not isinstance(ruleset, dict):
            issues.add("review_count_drift")
            continue
        if ruleset.get("target") != "branch" or ruleset.get("enforcement") != "active":
            continue

        bypass_actors = ruleset.get("bypass_actors", [])
        if not isinstance(bypass_actors, list):
            issues.add("admin_always_bypass")
        else:
            for actor in bypass_actors:
                if not isinstance(actor, dict):
                    issues.add("admin_always_bypass")
                    continue
                actor_type = actor.get("actor_type")
                actor_id = actor.get("actor_id")
                if (
                    actor_type == "RepositoryRole"
                    and actor_id == ADMIN_REPOSITORY_ROLE_ID
                    and actor.get("bypass_mode") == "always"
                ):
                    issues.add("admin_always_bypass")

        if not _targets_master(ruleset):
            continue

        rule_list = ruleset.get("rules", [])
        if not isinstance(rule_list, list):
            issues.add("review_count_drift")
            continue
        for rule in rule_list:
            if not isinstance(rule, dict) or rule.get("type") != "pull_request":
                continue
            parameters = rule.get("parameters")
            if not isinstance(parameters, dict):
                issues.add("review_count_drift")
                continue
            review_count = parameters.get("required_approving_review_count")
            if not isinstance(review_count, int) or isinstance(review_count, bool):
                issues.add("review_count_drift")
            else:
                review_counts.append(review_count)
            codeowner_review |= parameters.get("require_code_owner_review") is True
            dismiss_stale_reviews |= parameters.get("dismiss_stale_reviews_on_push") is True

    if not review_counts or max(review_counts) != 1:
        issues.add("review_count_drift")
    if not codeowner_review:
        issues.add("codeowner_review_not_required")
    if not dismiss_stale_reviews:
        issues.add("dismiss_stale_reviews_not_required")

    return GateResult(tuple(sorted(issues)))


def render(result: GateResult) -> str:
    if result.ok:
        return (
            "GITHUB-PROTECTION PASS checks=6 reviews=1 signatures=required "
            "admins=enforced force=off delete=off"
        )
    return f"GITHUB-PROTECTION FAIL codes={','.join(result.issues)}"


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = SafeArgumentParser(prog="github_protection_gate.py", description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--live", action="store_true", help="read policy with GET requests")
    source.add_argument("--snapshot", type=Path, help="read a versioned JSON snapshot")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None, runner: Runner = subprocess.run) -> int:
    try:
        args = parse_args(argv)
        snapshot = load_live_snapshot(runner) if args.live else load_snapshot(args.snapshot)
        result = evaluate(snapshot)
    except GateError as exc:
        print(f"GITHUB-PROTECTION ERROR code={exc.code}", file=sys.stderr)
        return 2

    print(render(result))
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
