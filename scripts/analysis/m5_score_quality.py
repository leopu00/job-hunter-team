#!/usr/bin/env python3
"""Compare local Scorer outputs with distributions or paired references."""

from __future__ import annotations

import argparse
import json
import math
import statistics
from pathlib import Path
from typing import Any


def summary(scores: list[float]) -> dict[str, Any]:
    if not scores:
        raise ValueError("score list cannot be empty")
    return {
        "n": len(scores),
        "mean": round(statistics.fmean(scores), 3),
        "median": round(statistics.median(scores), 3),
        "stddev": round(statistics.pstdev(scores), 3),
        "share_gte_70": round(sum(v >= 70 for v in scores) / len(scores), 4),
        "share_gte_80": round(sum(v >= 80 for v in scores) / len(scores), 4),
    }


def ks_distance(left: list[float], right: list[float]) -> float:
    points = sorted(set(left + right))
    maximum = 0.0
    for point in points:
        l_cdf = sum(v <= point for v in left) / len(left)
        r_cdf = sum(v <= point for v in right) / len(right)
        maximum = max(maximum, abs(l_cdf - r_cdf))
    return round(maximum, 4)


def compare_distribution(local_scores: list[float], baseline: dict[str, Any]) -> dict[str, Any]:
    baseline_scores = [float(v) for v in baseline["match"]["scores"]]
    return {
        "status": "distribution_only_not_quality_validation",
        "local": summary(local_scores),
        "baseline_source": baseline.get("source", "unknown"),
        "baseline": summary(baseline_scores),
        "ks_distance": ks_distance(local_scores, baseline_scores),
        "limitations": [
            "The samples are not the same positions scored for the same candidate.",
            "Distribution similarity cannot establish decision or ranking quality.",
        ],
    }


def compare_paired(rows: list[dict[str, Any]], provenance: str = "unvalidated") -> dict[str, Any]:
    if not rows:
        raise ValueError("paired fixture cannot be empty")
    errors = [abs(float(row["local_total"]) - float(row["reference_total"])) for row in rows]
    threshold_matches = [
        (float(row["local_total"]) < 40) == (float(row["reference_total"]) < 40)
        for row in rows
    ]
    status = (
        "paired_hardware_provenance_not_independently_validated"
        if provenance == "hardware"
        else "fixture_only_not_hardware_validated"
    )
    return {
        "status": status,
        "n": len(rows),
        "mae": round(statistics.fmean(errors), 3),
        "rmse": round(math.sqrt(statistics.fmean(error * error for error in errors)), 3),
        "within_5": round(sum(error <= 5 for error in errors) / len(errors), 4),
        "within_10": round(sum(error <= 10 for error in errors) / len(errors), 4),
        "exclude_threshold_agreement": round(sum(threshold_matches) / len(rows), 4),
        "provenance": provenance,
    }


def _read(path: str) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    distribution = sub.add_parser("distribution")
    distribution.add_argument("--local", required=True, help="JSON array of local total scores")
    distribution.add_argument("--baseline", required=True, help="JHT case-study run JSON")
    paired = sub.add_parser("paired")
    paired.add_argument("--input", required=True, help="JSON rows with local_total/reference_total")
    paired.add_argument("--provenance", choices=["fixture", "hardware"], default="fixture")
    args = parser.parse_args()
    if args.mode == "distribution":
        result = compare_distribution([float(v) for v in _read(args.local)], _read(args.baseline))
    else:
        result = compare_paired(_read(args.input), args.provenance)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
