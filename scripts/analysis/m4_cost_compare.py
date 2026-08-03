#!/usr/bin/env python3
"""Compare pay-per-use and subscription costs from explicit assumptions.

There are deliberately no built-in vendor prices.  The JSON input carries the
currency, token units, period, rates, subscription count and capacity
assumption so a result can be reproduced later without relying on a mutable
pricing page or an undocumented default.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path


SCHEMA_VERSION = 1
TOKEN_KEYS = ("uncached_input", "cached_input", "output")


class CostInputError(ValueError):
    """Scenario violates the documented unit contract."""


def _finite_non_negative(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CostInputError(f"{field} must be a number")
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise CostInputError(f"{field} must be finite and non-negative")
    return result


def _positive(value: object, field: str) -> float:
    result = _finite_non_negative(value, field)
    if result <= 0:
        raise CostInputError(f"{field} must be greater than zero")
    return result


def load_scenario(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise CostInputError(f"cannot read {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise CostInputError(f"invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise CostInputError("scenario must be a JSON object")
    return data


def compare(scenario: dict) -> dict:
    if scenario.get("schema_version") != SCHEMA_VERSION:
        raise CostInputError(f"schema_version must be {SCHEMA_VERSION}")
    scenario_id = str(scenario.get("scenario_id") or "").strip()
    currency = str(scenario.get("currency") or "").strip().upper()
    if not scenario_id:
        raise CostInputError("scenario_id is required")
    if not currency or len(currency) != 3:
        raise CostInputError("currency must be a three-letter code")
    period_days = _positive(scenario.get("period_days"), "period_days")
    workload = scenario.get("workload")
    payg = scenario.get("pay_per_use")
    subscription = scenario.get("subscription")
    if not all(isinstance(value, dict) for value in (workload, payg, subscription)):
        raise CostInputError("workload, pay_per_use and subscription must be objects")

    daily_tokens = {
        key: _finite_non_negative(
            workload.get(f"{key}_tokens_per_day"),
            f"workload.{key}_tokens_per_day",
        )
        for key in TOKEN_KEYS
    }
    rates = {
        key: _finite_non_negative(
            payg.get(f"{key}_currency_per_million_tokens"),
            f"pay_per_use.{key}_currency_per_million_tokens",
        )
        for key in TOKEN_KEYS
    }
    payg_fixed = _finite_non_negative(
        payg.get("fixed_currency_per_period", 0),
        "pay_per_use.fixed_currency_per_period",
    )
    subscription_price = _finite_non_negative(
        subscription.get("price_currency_per_billing_period"),
        "subscription.price_currency_per_billing_period",
    )
    billing_days = _positive(
        subscription.get("billing_period_days"),
        "subscription.billing_period_days",
    )
    subscriptions_required = _positive(
        subscription.get("subscriptions_required", 1),
        "subscription.subscriptions_required",
    )
    if not subscriptions_required.is_integer():
        raise CostInputError("subscription.subscriptions_required must be an integer")
    capacity = subscription.get("capacity_assumption")
    if capacity not in {"workload_fits", "unknown", "workload_exceeds"}:
        raise CostInputError(
            "subscription.capacity_assumption must be workload_fits, unknown, or workload_exceeds"
        )

    token_totals = {key: value * period_days for key, value in daily_tokens.items()}
    components = {
        key: token_totals[key] / 1_000_000.0 * rates[key] for key in TOKEN_KEYS
    }
    payg_total = sum(components.values()) + payg_fixed
    subscription_total = (
        subscription_price * (period_days / billing_days) * subscriptions_required
    )
    difference = payg_total - subscription_total
    if capacity != "workload_fits":
        status = "inconclusive_subscription_capacity"
        cheaper = None
    else:
        status = "conditional_on_input_assumptions"
        if math.isclose(payg_total, subscription_total, rel_tol=1e-12, abs_tol=1e-12):
            cheaper = "equal"
        else:
            cheaper = "pay_per_use" if payg_total < subscription_total else "subscription"

    return {
        "schema_version": SCHEMA_VERSION,
        "scenario_id": scenario_id,
        "currency": currency,
        "period_days": period_days,
        "units": {
            "workload": "tokens/day",
            "rates": f"{currency}/1,000,000 tokens",
            "costs": currency,
        },
        "assumptions": {
            "daily_tokens": daily_tokens,
            "pay_per_use_rates_per_million_tokens": rates,
            "pay_per_use_fixed_currency_per_period": payg_fixed,
            "subscription_price_currency_per_billing_period": subscription_price,
            "subscription_billing_period_days": billing_days,
            "subscriptions_required": int(subscriptions_required),
            "subscription_capacity": capacity,
        },
        "normalized_workload_tokens": token_totals,
        "costs": {
            "pay_per_use_components": {
                key: round(value, 6) for key, value in components.items()
            },
            "pay_per_use_total": round(payg_total, 6),
            "subscription_total": round(subscription_total, 6),
            "pay_per_use_minus_subscription": round(difference, 6),
            "pay_per_use_over_subscription_ratio": (
                round(payg_total / subscription_total, 6)
                if subscription_total > 0
                else None
            ),
        },
        "comparison": {"status": status, "cheaper": cheaper},
        "limitations": [
            "Prices and workload are inputs, not vendor facts embedded in this tool.",
            "A cheaper verdict is conditional on workload_fits and all supplied assumptions.",
            "Token classes are separate because providers may price cache reads differently.",
        ],
    }


def render_markdown(report: dict) -> str:
    costs = report["costs"]
    comparison = report["comparison"]
    return "\n".join(
        [
            f"# Cost comparison — {report['scenario_id']}",
            "",
            f"Period: **{report['period_days']} days**. Currency: **{report['currency']}**.",
            "",
            "| Mode | Cost |",
            "|---|---:|",
            f"| Pay per use | {costs['pay_per_use_total']} {report['currency']} |",
            f"| Subscription | {costs['subscription_total']} {report['currency']} |",
            "",
            f"Status: **{comparison['status']}**; cheaper: **{comparison['cheaper']}**.",
            "",
            "> The comparison is conditional on the explicit JSON assumptions; it is not a live price claim.",
            "",
        ]
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="scenario JSON")
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    args = parser.parse_args(argv)
    try:
        report = compare(load_scenario(args.input))
    except CostInputError as exc:
        print(f"m4-cost-compare: {exc}", file=sys.stderr)
        return 2
    print(render_markdown(report) if args.format == "markdown" else json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
