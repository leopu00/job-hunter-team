import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts/analysis/m5_score_quality.py"
SPEC = importlib.util.spec_from_file_location("m5_score_quality", MODULE_PATH)
quality = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(quality)


def test_distribution_comparison_is_explicitly_not_quality_validation():
    baseline = json.loads((ROOT / "web/data/case-studies/betaB-kimi-run.json").read_text())
    result = quality.compare_distribution([36, 70, 77], baseline)
    assert result["status"] == "distribution_only_not_quality_validation"
    assert result["baseline_source"] == "betaB-kimi"
    assert 0 <= result["ks_distance"] <= 1
    assert len(result["limitations"]) == 2


def test_paired_fixture_metrics_are_deterministic_and_not_hardware_validated():
    rows = json.loads((ROOT / "tests/fixtures/m5-paired-scores.json").read_text())
    result = quality.compare_paired(rows, provenance="fixture")
    assert result == {
        "status": "fixture_only_not_hardware_validated",
        "n": 3,
        "mae": 3.667,
        "rmse": 4.359,
        "within_5": 0.6667,
        "within_10": 1.0,
        "exclude_threshold_agreement": 1.0,
        "provenance": "fixture",
    }
