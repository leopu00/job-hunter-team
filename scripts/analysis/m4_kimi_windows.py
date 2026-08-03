#!/usr/bin/env python3
"""Analyse Kimi 5-hour-window exports without treating fixtures as evidence.

The input is the ``sentinel-data.jsonl`` written by the runtime (a JSON array is
accepted too).  Samples are grouped by ``reset_at_unix``: unlike ``session_id``,
that boundary survives bridge restarts and telemetry gaps.

This tool measures projection variance and historical forecast error.  It does
*not* simulate the causal effect of changing the controller target.  Therefore
the 88/92 result is reported as historical headroom compatibility, never as a
rollout recommendation.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from datetime import datetime
from pathlib import Path
from typing import Iterable


SCHEMA_VERSION = 1
KIMI_NAMES = {"kimi", "moonshot"}


class AnalysisError(ValueError):
    """Input is not usable for a reproducible analysis."""


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _timestamp(value: object) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.timestamp()


def load_records(path: Path) -> list[dict]:
    """Load a JSON array or JSONL file, rejecting malformed records loudly."""
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise AnalysisError(f"cannot read {path}: {exc}") from exc
    if not raw.strip():
        raise AnalysisError("input is empty")
    records: list[object]
    if raw.lstrip().startswith("["):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise AnalysisError(f"invalid JSON: {exc}") from exc
        if not isinstance(parsed, list):
            raise AnalysisError("top-level JSON must be an array")
        records = parsed
    else:
        records = []
        for line_no, line in enumerate(raw.splitlines(), 1):
            if not line.strip():
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise AnalysisError(f"invalid JSONL at line {line_no}: {exc}") from exc
    if not all(isinstance(record, dict) for record in records):
        raise AnalysisError("every record must be a JSON object")
    return records  # type: ignore[return-value]


def _percentile_nearest_rank(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(percentile * len(ordered)))
    return ordered[rank - 1]


def analyse(
    records: Iterable[dict],
    *,
    dataset_id: str,
    evidence: str,
    targets: tuple[float, ...] = (88.0, 92.0),
    min_windows: int = 5,
    completion_max_lead_min: float = 20.0,
    decision_lead_min: float = 60.0,
    decision_tolerance_min: float = 20.0,
    variance_min_lead_min: float = 15.0,
    variance_max_lead_min: float = 240.0,
) -> dict:
    if not dataset_id.strip():
        raise AnalysisError("dataset_id is required")
    if evidence not in {"live", "fixture", "unclassified"}:
        raise AnalysisError("evidence must be live, fixture, or unclassified")
    if min_windows < 2:
        raise AnalysisError("min_windows must be at least 2")
    if any(target < 0 or target > 100 for target in targets):
        raise AnalysisError("targets must be percentages between 0 and 100")

    windows: dict[int, list[dict]] = {}
    rejected = {"not_kimi": 0, "missing_boundary": 0, "invalid_sample": 0}
    total = 0
    for record in records:
        total += 1
        provider = str(record.get("provider") or "").strip().lower()
        if provider not in KIMI_NAMES:
            rejected["not_kimi"] += 1
            continue
        ts = _timestamp(record.get("ts"))
        reset = _number(record.get("reset_at_unix"))
        usage = _number(record.get("usage"))
        if reset is None:
            rejected["missing_boundary"] += 1
            continue
        if ts is None or usage is None or reset < ts:
            rejected["invalid_sample"] += 1
            continue
        projection = _number(record.get("projection"))
        windows.setdefault(round(reset), []).append(
            {"ts": ts, "reset": reset, "usage": usage, "projection": projection}
        )

    summaries: list[dict] = []
    forecast_errors: list[float] = []
    variances: list[float] = []
    for boundary, samples in sorted(windows.items()):
        samples.sort(key=lambda sample: sample["ts"])
        first, final = samples[0], samples[-1]
        span_min = (final["ts"] - first["ts"]) / 60.0
        final_lead_min = (final["reset"] - final["ts"]) / 60.0
        complete = (
            len(samples) >= 3
            and span_min >= 30.0
            and 0.0 <= final_lead_min <= completion_max_lead_min
        )
        eligible = [
            sample
            for sample in samples
            if sample["projection"] is not None
            and variance_min_lead_min
            <= (sample["reset"] - sample["ts"]) / 60.0
            <= variance_max_lead_min
        ]
        projections = [sample["projection"] for sample in eligible]
        projection_variance = (
            statistics.variance(projections) if len(projections) >= 2 else None
        )
        decision_sample = None
        if complete:
            candidates = [
                sample
                for sample in samples
                if sample["projection"] is not None
                and abs((sample["reset"] - sample["ts"]) / 60.0 - decision_lead_min)
                <= decision_tolerance_min
            ]
            if candidates:
                decision_sample = min(
                    candidates,
                    key=lambda sample: abs(
                        (sample["reset"] - sample["ts"]) / 60.0 - decision_lead_min
                    ),
                )
                forecast_errors.append(final["usage"] - decision_sample["projection"])
        if complete and projection_variance is not None:
            variances.append(projection_variance)
        summaries.append(
            {
                "reset_at_unix": boundary,
                "samples": len(samples),
                "observed_span_min": round(span_min, 3),
                "final_lead_min": round(final_lead_min, 3),
                "final_usage_pct": round(final["usage"], 3),
                "complete": complete,
                "projection_samples_in_variance_band": len(projections),
                "projection_variance_pct2": (
                    round(projection_variance, 6)
                    if projection_variance is not None
                    else None
                ),
                "projection_stddev_pct": (
                    round(math.sqrt(projection_variance), 6)
                    if projection_variance is not None
                    else None
                ),
                "decision_projection_pct": (
                    round(decision_sample["projection"], 3) if decision_sample else None
                ),
                "decision_actual_minus_projection_pct": (
                    round(final["usage"] - decision_sample["projection"], 3)
                    if decision_sample
                    else None
                ),
            }
        )

    completed = sum(1 for window in summaries if window["complete"])
    enough = len(forecast_errors) >= min_windows
    worst_underprediction = max([0.0, *forecast_errors]) if forecast_errors else None
    target_results = []
    for target in targets:
        headroom = 100.0 - target
        compatible = (
            worst_underprediction is not None and worst_underprediction <= headroom
        )
        if evidence != "live":
            status = "inconclusive_non_live_evidence"
        elif not enough:
            status = "inconclusive_insufficient_windows"
        else:
            status = (
                "historical_headroom_compatible"
                if compatible
                else "historical_headroom_exceeded"
            )
        target_results.append(
            {
                "target_pct": target,
                "headroom_to_100_pct_points": round(headroom, 3),
                "worst_observed_underprediction_pct_points": (
                    round(worst_underprediction, 3)
                    if worst_underprediction is not None
                    else None
                ),
                "status": status,
            }
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "dataset": {"id": dataset_id, "evidence": evidence},
        "method": {
            "window_boundary": "reset_at_unix",
            "completion_max_lead_min": completion_max_lead_min,
            "decision_lead_min": decision_lead_min,
            "decision_tolerance_min": decision_tolerance_min,
            "variance_lead_band_min": [variance_min_lead_min, variance_max_lead_min],
            "forecast_error_unit": "percentage_points (final_usage - projection)",
            "variance_unit": "percentage_points_squared",
            "target_test": "target + worst observed underprediction <= 100",
            "causal_claim": False,
        },
        "data_quality": {
            "records_seen": total,
            "records_accepted": sum(len(samples) for samples in windows.values()),
            "rejected": rejected,
            "windows_seen": len(summaries),
            "windows_complete": completed,
            "windows_with_decision_observation": len(forecast_errors),
            "minimum_windows_required": min_windows,
        },
        "aggregate": {
            "mean_intra_window_projection_variance_pct2": (
                round(statistics.mean(variances), 6) if variances else None
            ),
            "mean_intra_window_projection_stddev_pct": (
                round(statistics.mean(math.sqrt(value) for value in variances), 6)
                if variances
                else None
            ),
            "median_forecast_error_pct_points": (
                round(statistics.median(forecast_errors), 3)
                if forecast_errors
                else None
            ),
            "p95_forecast_error_pct_points_nearest_rank": (
                round(_percentile_nearest_rank(forecast_errors, 0.95), 3)
                if forecast_errors
                else None
            ),
            "worst_underprediction_pct_points": (
                round(worst_underprediction, 3)
                if worst_underprediction is not None
                else None
            ),
        },
        "targets": target_results,
        "windows": summaries,
        "limitations": [
            "Historical forecast error is not a counterfactual controller simulation.",
            "Only samples near the configured decision lead contribute one error per window.",
            "Fixture and unclassified inputs can never produce a rollout conclusion.",
        ],
    }


def render_markdown(report: dict) -> str:
    quality = report["data_quality"]
    aggregate = report["aggregate"]
    lines = [
        f"# Kimi window analysis — {report['dataset']['id']}",
        "",
        f"Evidence: **{report['dataset']['evidence']}**. "
        f"Complete windows: **{quality['windows_complete']}**; decision observations: "
        f"**{quality['windows_with_decision_observation']}**.",
        "",
        "| Metric | Value | Unit |",
        "|---|---:|---|",
        f"| Mean intra-window projection variance | {aggregate['mean_intra_window_projection_variance_pct2']} | percentage points² |",
        f"| Mean intra-window projection standard deviation | {aggregate['mean_intra_window_projection_stddev_pct']} | percentage points |",
        f"| Worst observed underprediction | {aggregate['worst_underprediction_pct_points']} | percentage points |",
        "",
        "| Candidate target | Headroom | Historical test |",
        "|---:|---:|---|",
    ]
    for target in report["targets"]:
        lines.append(
            f"| {target['target_pct']}% | {target['headroom_to_100_pct_points']} pp | "
            f"{target['status']} |"
        )
    lines.extend(
        [
            "",
            "> This is a historical headroom check, not a causal simulation or rollout recommendation.",
            "",
        ]
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="sentinel-data JSONL or JSON array")
    parser.add_argument("--dataset-id", required=True, help="stable non-secret run label")
    parser.add_argument(
        "--evidence",
        choices=("live", "fixture", "unclassified"),
        default="unclassified",
        help="only explicitly live data may produce a historical headroom verdict",
    )
    parser.add_argument("--targets", nargs="+", type=float, default=[88.0, 92.0])
    parser.add_argument("--min-windows", type=int, default=5)
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    args = parser.parse_args(argv)
    try:
        report = analyse(
            load_records(args.input),
            dataset_id=args.dataset_id,
            evidence=args.evidence,
            targets=tuple(args.targets),
            min_windows=args.min_windows,
        )
    except AnalysisError as exc:
        print(f"m4-kimi-windows: {exc}", file=sys.stderr)
        return 2
    if args.format == "markdown":
        print(render_markdown(report))
    else:
        print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
