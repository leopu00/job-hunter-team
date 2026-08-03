"""Contract tests for the reproducible Mission M4 analysis tools."""
from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
ANALYSIS_DIR = REPO_ROOT / "scripts" / "analysis"
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "m4"
sys.path.insert(0, str(ANALYSIS_DIR))

import m4_cost_compare  # noqa: E402
import m4_evidence_bundle  # noqa: E402
import m4_kimi_windows  # noqa: E402


def _kimi_records():
    return m4_kimi_windows.load_records(FIXTURES / "kimi-windows.synthetic.json")


def _cost_scenario():
    return m4_cost_compare.load_scenario(FIXTURES / "cost-scenario.synthetic.json")


def _bundle_manifest():
    return json.loads((FIXTURES / "evidence-bundle.synthetic.json").read_text())


def _write_manifest(tmp_path, manifest):
    for analysis, filename in (
        ("kimi_windows", "kimi-windows.synthetic.json"),
        ("cost_comparison", "cost-scenario.synthetic.json"),
    ):
        current = Path(manifest["analyses"][analysis]["input"]["path"])
        if not current.is_absolute():
            manifest["analyses"][analysis]["input"]["path"] = str(FIXTURES / filename)
    path = tmp_path / "bundle.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    return path


def test_fixture_can_never_become_a_rollout_conclusion():
    report = m4_kimi_windows.analyse(
        _kimi_records(), dataset_id="synthetic-test", evidence="fixture"
    )
    assert report["data_quality"]["windows_with_decision_observation"] == 5
    assert {result["status"] for result in report["targets"]} == {
        "inconclusive_non_live_evidence"
    }


def test_headroom_algorithm_distinguishes_88_from_92():
    report = m4_kimi_windows.analyse(
        _kimi_records(), dataset_id="algorithm-test", evidence="live"
    )
    assert report["aggregate"]["worst_underprediction_pct_points"] == 9
    assert report["aggregate"]["mean_intra_window_projection_variance_pct2"] is not None
    by_target = {result["target_pct"]: result for result in report["targets"]}
    assert by_target[88.0]["status"] == "historical_headroom_compatible"
    assert by_target[92.0]["status"] == "historical_headroom_exceeded"
    assert report["method"]["causal_claim"] is False


def test_missing_reset_boundary_is_rejected_not_guessed():
    records = _kimi_records() + [
        {
            "ts": "2026-08-06T01:00:00+00:00",
            "provider": "kimi",
            "usage": 10,
            "projection": 50,
        }
    ]
    report = m4_kimi_windows.analyse(
        records, dataset_id="missing-boundary", evidence="live"
    )
    assert report["data_quality"]["rejected"]["missing_boundary"] == 1
    assert report["data_quality"]["windows_seen"] == 5


def test_cost_ledger_keeps_token_classes_and_units_explicit():
    report = m4_cost_compare.compare(_cost_scenario())
    assert report["units"] == {
        "workload": "tokens/day",
        "rates": "EUR/1,000,000 tokens",
        "costs": "EUR",
    }
    assert report["costs"]["pay_per_use_components"] == {
        "uncached_input": 60,
        "cached_input": 12,
        "output": 120,
    }
    assert report["costs"]["pay_per_use_total"] == 192
    assert report["costs"]["subscription_total"] == 20
    assert report["comparison"] == {
        "status": "conditional_on_input_assumptions",
        "cheaper": "subscription",
    }


def test_unknown_subscription_capacity_blocks_a_cheaper_claim():
    scenario = copy.deepcopy(_cost_scenario())
    scenario["subscription"]["capacity_assumption"] = "unknown"
    report = m4_cost_compare.compare(scenario)
    assert report["comparison"]["status"] == "inconclusive_subscription_capacity"
    assert report["comparison"]["cheaper"] is None


def test_cost_input_rejects_implicit_or_invalid_units():
    scenario = copy.deepcopy(_cost_scenario())
    del scenario["workload"]["output_tokens_per_day"]
    with pytest.raises(m4_cost_compare.CostInputError, match="output_tokens_per_day"):
        m4_cost_compare.compare(scenario)


def test_evidence_bundle_fixture_is_deterministic_and_visibly_non_live():
    manifest = FIXTURES / "evidence-bundle.synthetic.json"
    first = m4_evidence_bundle.assemble(manifest)
    second = m4_evidence_bundle.assemble(manifest)

    assert first == second
    assert first["evidence_boundary"] == {
        "classification": "fixture",
        "reproducibility": "input_hashes_and_tool_implementations_recorded",
        "external_validation": "not_established_fixture",
        "fixture_can_support_live_claims": False,
    }
    assert first["findings"]["kimi_windows"]["classification"] == "fixture"
    assert {
        target["status"]
        for target in first["findings"]["kimi_windows"]["report"]["targets"]
    } == {"inconclusive_non_live_evidence"}
    assert first["tools"]["m4_kimi_windows"]["version"] == "1.0.0"
    assert first["tools"]["m4_cost_compare"]["version"] == "1.0.0"


def test_evidence_bundle_one_command_renders_fixture():
    completed = subprocess.run(
        [
            sys.executable,
            str(ANALYSIS_DIR / "m4_evidence_bundle.py"),
            str(FIXTURES / "evidence-bundle.synthetic.json"),
            "--format",
            "markdown",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr
    assert "Evidence classification: **FIXTURE**" in completed.stdout
    assert "External validation: **not_established_fixture**" in completed.stdout
    assert "not a live price claim" in completed.stdout


def test_evidence_bundle_accepts_scrubbed_kimi_jsonl(tmp_path):
    manifest = _bundle_manifest()
    source = tmp_path / "scrubbed.jsonl"
    source.write_text(
        "\n".join(json.dumps(record) for record in _kimi_records()) + "\n",
        encoding="utf-8",
    )
    manifest["analyses"]["kimi_windows"]["input"] = {
        "path": str(source),
        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    }
    report = m4_evidence_bundle.assemble(_write_manifest(tmp_path, manifest))
    assert report["findings"]["kimi_windows"]["report"]["data_quality"] == {
        "records_seen": 20,
        "records_accepted": 20,
        "rejected": {"not_kimi": 0, "missing_boundary": 0, "invalid_sample": 0},
        "windows_seen": 5,
        "windows_complete": 5,
        "windows_with_decision_observation": 5,
        "minimum_windows_required": 5,
    }


def test_evidence_bundle_rejects_tampered_input_hash(tmp_path):
    manifest = _bundle_manifest()
    manifest["analyses"]["kimi_windows"]["input"]["sha256"] = "0" * 64
    path = _write_manifest(tmp_path, manifest)
    with pytest.raises(m4_evidence_bundle.BundleError, match="hash mismatch"):
        m4_evidence_bundle.assemble(path)


def test_evidence_bundle_rejects_missing_provenance(tmp_path):
    manifest = _bundle_manifest()
    del manifest["analyses"]["kimi_windows"]["provenance"]
    path = _write_manifest(tmp_path, manifest)
    with pytest.raises(m4_evidence_bundle.BundleError, match="missing required fields: provenance"):
        m4_evidence_bundle.assemble(path)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda manifest: manifest.update(schema_version=2), "schema_version must be 1"),
        (lambda manifest: manifest.update(unexpected=True), "schema drift"),
    ],
)
def test_evidence_bundle_rejects_schema_drift(tmp_path, mutation, message):
    manifest = _bundle_manifest()
    mutation(manifest)
    path = _write_manifest(tmp_path, manifest)
    with pytest.raises(m4_evidence_bundle.BundleError, match=message):
        m4_evidence_bundle.assemble(path)


def test_evidence_bundle_rejects_fixture_relabelled_as_live(tmp_path):
    manifest = _bundle_manifest()
    manifest["bundle_id"] = "m4-attested-live-bundle"
    for provenance in (
        manifest["provenance"],
        manifest["analyses"]["kimi_windows"]["provenance"],
        manifest["analyses"]["cost_comparison"]["provenance"],
    ):
        provenance["classification"] = "live"
        provenance["source_type"] = "scrubbed_live_export"
    manifest["analyses"]["kimi_windows"]["dataset_id"] = "kimi-window-export"
    manifest["analyses"]["cost_comparison"]["dataset_id"] = "cost-export"
    path = _write_manifest(tmp_path, manifest)
    with pytest.raises(m4_evidence_bundle.BundleError, match="cannot be labelled live"):
        m4_evidence_bundle.assemble(path)


@pytest.mark.parametrize("unsafe_field", ["email", "api_key", "session_id"])
def test_evidence_bundle_rejects_secret_or_identifying_source_fields(
    tmp_path, unsafe_field
):
    manifest = _bundle_manifest()
    records = _kimi_records()
    records[0][unsafe_field] = "redacted-value"
    source = tmp_path / "scrubbed.json"
    source.write_text(json.dumps(records), encoding="utf-8")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    manifest["analyses"]["kimi_windows"]["input"] = {
        "path": str(source),
        "sha256": digest,
    }
    path = _write_manifest(tmp_path, manifest)
    with pytest.raises(m4_evidence_bundle.BundleError, match="secret or raw identifying field"):
        m4_evidence_bundle.assemble(path)


@pytest.mark.parametrize(
    "sensitive_value",
    ["sk-" + ("x" * 24), "operator" + "@example.test"],
)
def test_evidence_bundle_rejects_sensitive_values(tmp_path, sensitive_value):
    manifest = _bundle_manifest()
    manifest["provenance"]["description"] = sensitive_value
    path = _write_manifest(tmp_path, manifest)
    with pytest.raises(m4_evidence_bundle.BundleError, match="raw identifying material"):
        m4_evidence_bundle.assemble(path)
