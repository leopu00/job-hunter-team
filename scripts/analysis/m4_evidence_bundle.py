#!/usr/bin/env python3
"""Validate and assemble a reproducible M4 evidence bundle.

The bundle proves which scrubbed inputs and analyzer versions produced a set
of findings.  It deliberately does not turn fixture provenance into live
evidence, or reproducibility into external validation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

import m4_cost_compare
import m4_kimi_windows


SCHEMA_VERSION = 1
TOOL_VERSION = "1.0.0"
SCHEMA_ID = "https://jobhunterteam.ai/schemas/m4-evidence-bundle-v1.schema.json"
REPO_ROOT = Path(__file__).resolve().parents[2]
CLASSIFICATIONS = {"fixture", "unclassified", "live"}
SOURCE_TYPE_BY_CLASSIFICATION = {
    "fixture": "synthetic_fixture",
    "unclassified": "scrubbed_export",
    "live": "scrubbed_live_export",
}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,127}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
FIXTURE_MARKER_RE = re.compile(r"(?:^|[._/-])(fixture|fixtures|synthetic)(?:[._/-]|$)", re.I)
SENSITIVE_KEY_RE = re.compile(
    r"(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|"
    r"passwd|secret|cookie|private[_-]?key|email|e-mail|full[_-]?name|username|"
    r"user[_-]?id|account[_-]?id|candidate[_-]?id|session[_-]?id|ip[_-]?address|hostname)",
    re.I,
)
SECRET_VALUE_RES = (
    re.compile(r"\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{12,}", re.I),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"https?://[^\s/:]+:[^\s/@]+@", re.I),
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I),
)


class BundleError(ValueError):
    """Bundle or source data violates the evidence boundary."""


def _exact_keys(value: Any, expected: set[str], field: str) -> dict:
    if not isinstance(value, dict):
        raise BundleError(f"{field} must be an object")
    actual = set(value)
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if missing:
        raise BundleError(f"{field} is missing required fields: {', '.join(missing)}")
    if extra:
        raise BundleError(f"{field} has unsupported fields (schema drift): {', '.join(extra)}")
    return value


def _nonempty_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise BundleError(f"{field} must be a non-empty string")
    return value.strip()


def _reject_sensitive_content(value: Any, field: str = "bundle") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if SENSITIVE_KEY_RE.search(str(key)):
                raise BundleError(f"{field}.{key} is a secret or raw identifying field")
            _reject_sensitive_content(child, f"{field}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_sensitive_content(child, f"{field}[{index}]")
    elif isinstance(value, str):
        for pattern in SECRET_VALUE_RES:
            if pattern.search(value):
                raise BundleError(f"{field} contains secret-like or raw identifying material")


def _validate_provenance(value: Any, field: str) -> dict:
    provenance = _exact_keys(
        value,
        {"classification", "source_type", "scrubbed_export", "description"},
        field,
    )
    classification = provenance["classification"]
    if classification not in CLASSIFICATIONS:
        raise BundleError(f"{field}.classification must be fixture, unclassified, or live")
    expected_source_type = SOURCE_TYPE_BY_CLASSIFICATION[classification]
    if provenance["source_type"] != expected_source_type:
        raise BundleError(
            f"{field}.source_type must be {expected_source_type} for {classification} provenance"
        )
    if provenance["scrubbed_export"] is not True:
        raise BundleError(f"{field}.scrubbed_export must be true")
    description = _nonempty_string(provenance["description"], f"{field}.description")
    if len(description) > 500:
        raise BundleError(f"{field}.description must be at most 500 characters")
    return provenance


def _read_json(path: Path, field: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise BundleError(f"cannot read {field} {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise BundleError(f"invalid JSON in {field} {path}: {exc}") from exc


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise BundleError(f"cannot hash {path}: {exc}") from exc
    return digest.hexdigest()


def _known_fixture_hashes() -> set[str]:
    fixture_dir = REPO_ROOT / "tests" / "fixtures" / "m4"
    return {_sha256(path) for path in fixture_dir.glob("*") if path.is_file()}


def _looks_like_fixture(path: Path, digest: str, source: Any) -> bool:
    if FIXTURE_MARKER_RE.search(path.as_posix()) or digest in _known_fixture_hashes():
        return True

    def has_marker(value: Any) -> bool:
        if isinstance(value, dict):
            return any(has_marker(child) for child in value.values())
        if isinstance(value, list):
            return any(has_marker(child) for child in value)
        return isinstance(value, str) and bool(FIXTURE_MARKER_RE.search(value))

    return has_marker(source)


def _resolve_input(manifest_path: Path, value: Any, field: str) -> tuple[Path, str]:
    input_spec = _exact_keys(value, {"path", "sha256"}, field)
    raw_path = _nonempty_string(input_spec["path"], f"{field}.path")
    if "\x00" in raw_path:
        raise BundleError(f"{field}.path contains a NUL byte")
    expected_hash = input_spec["sha256"]
    if not isinstance(expected_hash, str) or not SHA256_RE.fullmatch(expected_hash):
        raise BundleError(f"{field}.sha256 must be a lowercase SHA-256 digest")
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = manifest_path.parent / path
    path = path.resolve()
    actual_hash = _sha256(path)
    if actual_hash != expected_hash:
        raise BundleError(
            f"{field} hash mismatch: expected {expected_hash}, got {actual_hash}"
        )
    return path, actual_hash


def _validate_dataset_entry(
    value: Any,
    *,
    field: str,
    manifest_path: Path,
    bundle_classification: str,
    parameter_keys: set[str],
) -> tuple[dict, Path, str]:
    entry = _exact_keys(
        value, {"dataset_id", "provenance", "input", "parameters"}, field
    )
    dataset_id = _nonempty_string(entry["dataset_id"], f"{field}.dataset_id")
    if not ID_RE.fullmatch(dataset_id):
        raise BundleError(f"{field}.dataset_id must be a stable lowercase identifier")
    provenance = _validate_provenance(entry["provenance"], f"{field}.provenance")
    if provenance["classification"] != bundle_classification:
        raise BundleError(
            f"{field}.provenance.classification must match bundle provenance"
        )
    parameters = _exact_keys(entry["parameters"], parameter_keys, f"{field}.parameters")
    path, digest = _resolve_input(manifest_path, entry["input"], f"{field}.input")
    return entry, path, digest


def _validate_kimi_source(value: Any) -> list[dict]:
    if not isinstance(value, list) or not value:
        raise BundleError("analyses.kimi_windows input must be a non-empty JSON array")
    allowed = {"ts", "provider", "usage", "projection", "reset_at_unix"}
    records: list[dict] = []
    for index, record in enumerate(value):
        if not isinstance(record, dict):
            raise BundleError(f"kimi input record {index} must be an object")
        extra = sorted(set(record) - allowed)
        if extra:
            raise BundleError(
                f"kimi input record {index} contains raw/unsupported fields: {', '.join(extra)}"
            )
        records.append(record)
    return records


def _validate_cost_source(value: Any) -> dict:
    scenario = _exact_keys(
        value,
        {
            "schema_version",
            "scenario_id",
            "currency",
            "period_days",
            "workload",
            "pay_per_use",
            "subscription",
        },
        "cost input",
    )
    _exact_keys(
        scenario["workload"],
        {
            "uncached_input_tokens_per_day",
            "cached_input_tokens_per_day",
            "output_tokens_per_day",
        },
        "cost input.workload",
    )
    _exact_keys(
        scenario["pay_per_use"],
        {
            "uncached_input_currency_per_million_tokens",
            "cached_input_currency_per_million_tokens",
            "output_currency_per_million_tokens",
            "fixed_currency_per_period",
        },
        "cost input.pay_per_use",
    )
    _exact_keys(
        scenario["subscription"],
        {
            "price_currency_per_billing_period",
            "billing_period_days",
            "subscriptions_required",
            "capacity_assumption",
        },
        "cost input.subscription",
    )
    return scenario


def _tool_record(module: Any) -> dict:
    return {
        "version": module.TOOL_VERSION,
        "report_schema_version": module.SCHEMA_VERSION,
        "implementation_sha256": _sha256(Path(module.__file__).resolve()),
    }


def assemble(manifest_path: Path) -> dict:
    manifest_path = manifest_path.resolve()
    manifest = _read_json(manifest_path, "manifest")
    _reject_sensitive_content(manifest)
    manifest = _exact_keys(
        manifest,
        {"$schema", "schema_version", "bundle_id", "tested_commit", "provenance", "analyses"},
        "bundle",
    )
    if manifest["$schema"] != SCHEMA_ID:
        raise BundleError(f"bundle.$schema must be {SCHEMA_ID}")
    if manifest["schema_version"] != SCHEMA_VERSION:
        raise BundleError(f"bundle.schema_version must be {SCHEMA_VERSION}")
    bundle_id = _nonempty_string(manifest["bundle_id"], "bundle.bundle_id")
    if not ID_RE.fullmatch(bundle_id):
        raise BundleError("bundle.bundle_id must be a stable lowercase identifier")
    tested_commit = manifest["tested_commit"]
    if not isinstance(tested_commit, str) or not COMMIT_RE.fullmatch(tested_commit):
        raise BundleError("bundle.tested_commit must be a full lowercase Git commit SHA")
    provenance = _validate_provenance(manifest["provenance"], "bundle.provenance")
    classification = provenance["classification"]
    if classification == "fixture" and not FIXTURE_MARKER_RE.search(bundle_id):
        raise BundleError("fixture bundle_id must visibly include fixture or synthetic")

    analyses = _exact_keys(
        manifest["analyses"], {"kimi_windows", "cost_comparison"}, "bundle.analyses"
    )
    kimi, kimi_path, kimi_hash = _validate_dataset_entry(
        analyses["kimi_windows"],
        field="analyses.kimi_windows",
        manifest_path=manifest_path,
        bundle_classification=classification,
        parameter_keys={"targets", "min_windows"},
    )
    cost, cost_path, cost_hash = _validate_dataset_entry(
        analyses["cost_comparison"],
        field="analyses.cost_comparison",
        manifest_path=manifest_path,
        bundle_classification=classification,
        parameter_keys=set(),
    )

    try:
        kimi_source = m4_kimi_windows.load_records(kimi_path)
    except m4_kimi_windows.AnalysisError as exc:
        raise BundleError(str(exc)) from exc
    cost_source = _read_json(cost_path, "cost source")
    _reject_sensitive_content(kimi_source, "kimi source")
    _reject_sensitive_content(cost_source, "cost source")
    kimi_records = _validate_kimi_source(kimi_source)
    cost_scenario = _validate_cost_source(cost_source)

    if classification == "fixture":
        for field, entry in (("kimi_windows", kimi), ("cost_comparison", cost)):
            if not FIXTURE_MARKER_RE.search(entry["dataset_id"]):
                raise BundleError(
                    f"fixture {field}.dataset_id must visibly include fixture or synthetic"
                )
    if classification == "live":
        for field, path, digest, source in (
            ("kimi_windows", kimi_path, kimi_hash, kimi_source),
            ("cost_comparison", cost_path, cost_hash, cost_source),
        ):
            if _looks_like_fixture(path, digest, source):
                raise BundleError(
                    f"{field} is a fixture/synthetic input and cannot be labelled live"
                )

    targets = kimi["parameters"]["targets"]
    min_windows = kimi["parameters"]["min_windows"]
    if (
        not isinstance(targets, list)
        or not targets
        or any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in targets)
    ):
        raise BundleError(
            "analyses.kimi_windows.parameters.targets must be a non-empty number array"
        )
    if isinstance(min_windows, bool) or not isinstance(min_windows, int) or min_windows < 2:
        raise BundleError("analyses.kimi_windows.parameters.min_windows must be an integer >= 2")

    try:
        kimi_report = m4_kimi_windows.analyse(
            kimi_records,
            dataset_id=kimi["dataset_id"],
            evidence=classification,
            targets=tuple(float(item) for item in targets),
            min_windows=min_windows,
        )
        cost_report = m4_cost_compare.compare(cost_scenario)
    except (m4_kimi_windows.AnalysisError, m4_cost_compare.CostInputError) as exc:
        raise BundleError(str(exc)) from exc

    external_status = (
        "not_established_fixture"
        if classification == "fixture"
        else "not_established_unclassified"
        if classification == "unclassified"
        else "live_input_attested_not_independently_validated"
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "bundle_id": bundle_id,
        "tested_commit": tested_commit,
        "provenance": provenance,
        "evidence_boundary": {
            "classification": classification,
            "reproducibility": "input_hashes_and_tool_implementations_recorded",
            "external_validation": external_status,
            "fixture_can_support_live_claims": False,
        },
        "tools": {
            "m4_evidence_bundle": {
                "version": TOOL_VERSION,
                "manifest_schema_version": SCHEMA_VERSION,
                "implementation_sha256": _sha256(Path(__file__).resolve()),
            },
            "m4_kimi_windows": _tool_record(m4_kimi_windows),
            "m4_cost_compare": _tool_record(m4_cost_compare),
        },
        "inputs": {
            "kimi_windows": {
                "dataset_id": kimi["dataset_id"],
                "provenance": kimi["provenance"],
                "sha256": kimi_hash,
                "parameters": kimi["parameters"],
            },
            "cost_comparison": {
                "dataset_id": cost["dataset_id"],
                "provenance": cost["provenance"],
                "sha256": cost_hash,
                "parameters": cost["parameters"],
            },
        },
        "findings": {
            "kimi_windows": {
                "classification": classification,
                "external_validation": external_status,
                "report": kimi_report,
            },
            "cost_comparison": {
                "classification": classification,
                "external_validation": external_status,
                "report": cost_report,
            },
        },
        "limitations": [
            "A valid bundle proves reproducibility, not independent external validation.",
            (
                "Fixture and unclassified bundles cannot substantiate live price, "
                "performance, or rollout claims."
            ),
            (
                "Live classification is an operator provenance attestation, not "
                "third-party verification."
            ),
        ],
    }


def render_markdown(report: dict) -> str:
    boundary = report["evidence_boundary"]
    inputs = report["inputs"]
    kimi = inputs["kimi_windows"]
    cost = inputs["cost_comparison"]
    return "\n".join(
        [
            f"# M4 evidence bundle — {report['bundle_id']}",
            "",
            f"Evidence classification: **{boundary['classification'].upper()}**.",
            f"External validation: **{boundary['external_validation']}**.",
            f"Tested commit: `{report['tested_commit']}`.",
            "",
            (
                "> A valid bundle proves reproducibility. It does not by itself prove "
                "live prices, performance, or month-long outcomes."
            ),
            "",
            "| Analysis | Dataset | Provenance | SHA-256 |",
            "|---|---|---|---|",
            (
                f"| Kimi windows | {kimi['dataset_id']} | "
                f"{kimi['provenance']['classification']} | `{kimi['sha256']}` |"
            ),
            (
                f"| Cost comparison | {cost['dataset_id']} | "
                f"{cost['provenance']['classification']} | `{cost['sha256']}` |"
            ),
            "",
            f"## Kimi-window finding — {boundary['classification'].upper()}",
            "",
            f"External validation: **{boundary['external_validation']}**.",
            "",
            m4_kimi_windows.render_markdown(report["findings"]["kimi_windows"]["report"]).rstrip(),
            "",
            f"## Cost-comparison finding — {boundary['classification'].upper()}",
            "",
            f"External validation: **{boundary['external_validation']}**.",
            "",
            m4_cost_compare.render_markdown(
                report["findings"]["cost_comparison"]["report"]
            ).rstrip(),
            "",
            "## Limits",
            "",
            *(f"- {item}" for item in report["limitations"]),
            "",
        ]
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="M4 evidence-bundle manifest JSON")
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    args = parser.parse_args(argv)
    try:
        report = assemble(args.manifest)
    except BundleError as exc:
        print(f"m4-evidence-bundle: {exc}", file=sys.stderr)
        return 2
    if args.format == "markdown":
        print(render_markdown(report))
    else:
        print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
