"""Contract tests for the reproducible Mission M4 analysis tools."""
from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
ANALYSIS_DIR = REPO_ROOT / "scripts" / "analysis"
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "m4"
sys.path.insert(0, str(ANALYSIS_DIR))

import m4_cost_compare  # noqa: E402
import m4_kimi_windows  # noqa: E402


def _kimi_records():
    return m4_kimi_windows.load_records(FIXTURES / "kimi-windows.synthetic.json")


def _cost_scenario():
    return m4_cost_compare.load_scenario(FIXTURES / "cost-scenario.synthetic.json")


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
