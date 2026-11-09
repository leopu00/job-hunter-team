"""model_pricing.py + shared/config/model-prices.json: the cost of a call from ITS model's price, exact.

All token counts and prices in the cases are made up (the real list is only checked for shape and against the
harness catalog). Nothing is read from a real session, no network.
"""
import copy
import json
import re
import sys
from decimal import Decimal
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared/skills"))
import model_pricing as mp  # noqa: E402

LIST = {
    "currency": "USD",
    "providers": {
        "openai": {
            "web_search_per_call": {"usd": 0.01},
            "models": {
                # two models with different prices, one with cache-write and long-context rules, one without
                "alpha": {"input": 2, "cached_input": 0.2, "cache_write": 2.5, "output": 12,
                          "long_context": {"above_input_tokens": 1000, "input_multiplier": 2, "output_multiplier": 1.5}},
                "beta": {"input": 0.5, "cached_input": 0.05, "output": 4},
            },
        },
        "kimi": {"models": {}},
    },
}


def book(changes=None):
    raw = copy.deepcopy(LIST)
    for (provider, model), fields in (changes or {}).items():
        raw["providers"][provider]["models"][model].update(fields)
    return mp.load_prices(write(raw))


def write(raw):
    import tempfile
    path = Path(tempfile.mkdtemp()) / "prices.json"
    path.write_text(json.dumps(raw), encoding="utf-8")
    return path


def usd(value):
    return float(Decimal(str(value)))


# ── the real list ───────────────────────────────────────────────────────

def test_the_real_list_loads_and_prices_the_models_we_run_on_openai():
    real = mp.load_prices()
    for model in ("gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5-mini", "gpt-5"):
        price = mp.price_of(real, "openai", model)
        assert price and price["output"] > price["input"] > price["cached_input"] > 0, model
    assert real["openai"]["web_search_per_call"] == Decimal("0.01")
    assert real["openai"]["read_on"] and real["openai"]["source"].startswith("https://")
    assert mp.price_of(real, "codex", "gpt-5.6-terra") == mp.price_of(real, "openai", "gpt-5.6-terra")
    assert mp.price_of(real, "openai", "a-model-nobody-priced") is None


def test_the_list_is_the_one_of_the_harness_catalog():
    """agent-harness/runtime/src/core/provider/catalog.ts holds the prices its spend cap uses, checked against the
    invoice: the two must not drift."""
    source = (ROOT / "agent-harness/runtime/src/core/provider/catalog.ts").read_text(encoding="utf-8")
    entries = re.findall(r'"(gpt-[^"]+)":\s*\{[^{}]*?pricing:\s*usd\(\{\s*input:\s*([\d.]+),\s*cachedInput:\s*([\d.]+),'
                         r'\s*output:\s*([\d.]+)(,\s*cacheWrites:\s*true)?(,\s*longContext:\s*\w+)?', source, re.S)
    assert len(entries) >= 5
    real = mp.load_prices()
    for model, inp, cached, out, writes, long in entries:
        price = mp.price_of(real, "openai", model)
        assert price, model
        assert (price["input"], price["cached_input"], price["output"]) == (Decimal(inp), Decimal(cached), Decimal(out)), model
        assert (price["cache_write"] == price["input"] * Decimal("1.25")) == bool(writes), model
        assert ("long_context" in price) == bool(long), model
    assert Decimal(re.search(r"WEB_SEARCH_PER_CALL_USD = ([\d.]+)", source).group(1)) == real["openai"]["web_search_per_call"]


@pytest.mark.parametrize("change", [
    {"input": -1}, {"output": True}, {"cached_input": "cheap"},
    {"long_context": {"above_input_tokens": 10}},
])
def test_a_list_with_something_that_is_not_a_price_is_refused(change):
    raw = copy.deepcopy(LIST)
    raw["providers"]["openai"]["models"]["beta"].update(change)
    with pytest.raises(mp.PriceListError):
        mp.load_prices(write(raw))
    raw = copy.deepcopy(LIST)
    del raw["providers"]["openai"]["models"]["beta"]["output"]
    with pytest.raises(mp.PriceListError):
        mp.load_prices(write(raw))


# ── the cost of one call ────────────────────────────────────────────────

def test_every_kind_of_input_token_is_billed_once_at_its_own_price():
    alpha = mp.price_of(book(), "openai", "alpha")
    # 100 fresh*2 + 300 cached*0.2 + 50 written*2.5 + 40 output*12 = 200 + 60 + 125 + 480 = 865 per million
    assert mp.call_cost(alpha, fresh=100, cached=300, written=50, output=40) == Decimal("865") / 1_000_000


def test_a_model_without_a_cache_write_price_bills_a_write_as_input():
    beta = mp.price_of(book(), "openai", "beta")
    assert mp.call_cost(beta, written=1000) == mp.call_cost(beta, fresh=1000) == Decimal("500") / 1_000_000


def test_a_call_over_the_long_context_threshold_is_billed_whole_at_the_multipliers():
    alpha = mp.price_of(book(), "openai", "alpha")
    below = mp.call_cost(alpha, fresh=500, cached=500, output=100)           # 1000 input: not OVER 1000
    assert below == Decimal(500 * 2 + 500 * 0.2 + 100 * 12) / 1_000_000
    over = mp.call_cost(alpha, fresh=500, cached=500, written=1, output=100)  # 1001: over, the whole call
    assert over == (Decimal(500) * 2 + 500 * Decimal("0.2") + 1 * Decimal("2.5")) * 2 / 1_000_000 + Decimal(100 * 12) * Decimal("1.5") / 1_000_000


def test_long_context_is_decided_per_call_never_on_summed_tokens():
    alpha = mp.price_of(book(), "openai", "alpha")
    two_small = 2 * mp.call_cost(alpha, fresh=600, output=10)          # each under the threshold: short rates
    one_big = mp.call_cost(alpha, fresh=1200, output=20)               # the same tokens in one call: long rates
    assert two_small == Decimal(2 * (600 * 2 + 10 * 12)) / 1_000_000
    assert one_big == Decimal(1200 * 2 * 2 + 20 * 12 * Decimal("1.5")) / 1_000_000
    assert one_big > two_small


# ── the kinds of token of each CLI ──────────────────────────────────────

def test_codex_counts_cached_and_written_tokens_inside_the_input():
    got = mp.from_codex({"input_tokens": 1000, "cached_input_tokens": 600, "cache_write_input_tokens": 100,
                         "output_tokens": 50, "reasoning_output_tokens": 20, "last_usage_includes_reasoning": True})
    assert got == {"fresh": 300, "cached": 600, "written": 100, "output": 50, "reasoning": 20}


def test_codex_output_gets_the_reasoning_only_when_it_does_not_include_it():
    base = {"input_tokens": 10, "output_tokens": 50, "reasoning_output_tokens": 20}
    assert mp.from_codex({**base, "last_usage_includes_reasoning": True})["output"] == 50
    assert mp.from_codex({**base, "last_usage_includes_reasoning": False})["output"] == 70


def test_codex_counts_that_make_no_sense_are_clipped_never_billed_twice():
    got = mp.from_codex({"input_tokens": 100, "cached_input_tokens": 500, "cache_write_input_tokens": 50})
    assert got["fresh"] + got["cached"] + got["written"] == 100 and got["cached"] == 100
    assert mp.from_codex({"input_tokens": "many", "output_tokens": -3}) == \
        {"fresh": 0, "cached": 0, "written": 0, "output": 0, "reasoning": 0}


def test_pi_input_is_what_was_neither_read_from_the_cache_nor_written_to_it():
    got = mp.from_pi({"input": 3, "cache_read": 10, "cache_write": 20, "output": 7, "reasoning": 2})
    assert got == {"fresh": 3, "cached": 10, "written": 20, "output": 7, "reasoning": 2}


# ── the ledger: per model and per agent, the same for Codex and Pi ──────

def filled(prices=None):
    ledger = mp.Ledger(prices or book())
    ledger.add("scout-1", "openai", "alpha", fresh=100, cached=300, written=50, output=40, reasoning=10)
    ledger.add("scout-1", "codex", "beta", fresh=1000, cached=0, written=0, output=100)
    ledger.add("analista-1", "openai", "alpha", fresh=200, cached=0, written=0, output=20)
    return ledger


def test_cost_and_tokens_per_agent_and_per_model():
    out = filled().summary()
    alpha_1 = 865e-6
    alpha_2 = (200 * 2 + 20 * 12) / 1e6
    beta_1 = (1000 * 0.5 + 100 * 4) / 1e6
    assert out["models"]["alpha"]["usd"] == pytest.approx(alpha_1 + alpha_2, abs=1e-9)
    assert out["models"]["alpha"]["calls"] == 2 and out["models"]["alpha"]["cache_write"] == 50
    assert out["models"]["beta"]["usd"] == pytest.approx(beta_1, abs=1e-9)
    assert out["agents"]["scout-1"]["usd"] == pytest.approx(alpha_1 + beta_1, abs=1e-9)
    assert out["agents"]["scout-1"]["models"]["alpha"]["usd"] == pytest.approx(alpha_1, abs=1e-9)
    assert out["agents"]["analista-1"]["usd"] == pytest.approx(alpha_2, abs=1e-9)
    assert out["usd"] == pytest.approx(alpha_1 + alpha_2 + beta_1, abs=1e-9) and out["price"] == "known"
    assert out["calls"] == 3 and out["unknown_models"] == []


def test_changing_the_price_of_one_model_changes_only_its_cost():
    before = filled().summary()
    after = filled(book({("openai", "beta"): {"input": 1.5, "output": 8}})).summary()
    assert after["models"]["alpha"] == before["models"]["alpha"]
    assert after["agents"]["analista-1"] == before["agents"]["analista-1"]
    assert after["models"]["beta"]["usd"] == pytest.approx((1000 * 1.5 + 100 * 8) / 1e6, abs=1e-9)
    assert after["models"]["beta"]["usd"] != before["models"]["beta"]["usd"]
    assert after["agents"]["scout-1"]["models"]["alpha"] == before["agents"]["scout-1"]["models"]["alpha"]
    assert after["agents"]["scout-1"]["usd"] != before["agents"]["scout-1"]["usd"]


def test_a_model_without_a_price_is_unknown_never_zero():
    ledger = filled()
    ledger.add("scout-1", "openai", "gamma", fresh=5000, output=300)
    ledger.add("critico-1", "openai", "gamma", fresh=10, output=1)
    out = ledger.summary()
    assert out["models"]["gamma"]["usd"] is None and out["models"]["gamma"]["price"] == "unknown"
    assert out["models"]["gamma"]["input_fresh"] == 5010, "its tokens are counted"
    assert out["agents"]["critico-1"]["usd"] is None and out["agents"]["critico-1"]["price"] == "unknown"
    assert out["agents"]["scout-1"]["usd"] is None and out["agents"]["scout-1"]["price"] == "partial"
    assert out["agents"]["scout-1"]["usd_known"] > 0, "what is known stays visible"
    assert out["usd"] is None and out["price"] == "partial" and out["unknown_models"] == ["gamma"]
    assert out["models"]["alpha"]["usd"] is not None, "the other models keep their cost"


def test_a_call_with_no_model_name_is_unknown_too():
    ledger = mp.Ledger(book())
    ledger.add("scout-1", "openai", None, fresh=10, output=1)
    out = ledger.summary()
    assert out["usd"] is None and out["unknown_models"] == ["?unknown"]


def test_a_web_search_costs_its_flat_fee_on_top():
    ledger = filled()
    ledger.add_searches("scout-1", "openai", 3)
    out = ledger.summary()
    assert out["web_search"] == {"searches": 3, "usd": 0.03}
    assert out["agents"]["scout-1"]["usd"] == pytest.approx(865e-6 + (1000 * 0.5 + 100 * 4) / 1e6 + 0.03, abs=1e-9)
    assert out["models"]["alpha"]["usd"] == filled().summary()["models"]["alpha"]["usd"], "the fee is no model's"


def test_a_search_at_a_provider_with_no_fee_is_unknown_not_free():
    ledger = mp.Ledger(book())
    ledger.add_searches("scout-1", "kimi", 2)
    out = ledger.summary()
    assert out["web_search"] == {"searches": 2, "usd": None}
    assert out["usd"] is None and out["price"] == "partial"


def test_the_sum_is_exact_to_the_micro_dollar_over_many_calls():
    ledger = mp.Ledger(book())
    for _ in range(100_000):
        ledger.add("scout-1", "openai", "beta", fresh=1, output=1)   # 4.5e-6 each: a float sum would drift
    assert ledger.summary()["usd"] == 0.45


def test_cost_usd_prices_one_call_by_its_model_name():
    prices = book()
    assert mp.cost_usd("alpha", 100, 300, 40, written_in=50, book=prices) == 0.000865
    assert mp.cost_usd("alpha", 100, 300, 40, searches=2, written_in=50, book=prices) == pytest.approx(0.020865, abs=1e-9)
    assert mp.cost_usd("gamma", 100, 300, 40, book=prices) is None, "no price: unknown, not 0"
    assert mp.cost_usd("alpha", 1, 0, 1, searches=1, provider="kimi", book=prices) is None, "the model is not priced at that provider"
    assert mp.cost_usd("beta", 0, 0, 0, book=prices) == 0.0, "no tokens at a priced model is a real zero"


# ── the real list, as the official pages read it on 09/11/2026 ──────────

def test_the_list_carries_the_prices_the_pages_gave_on_the_day_they_were_read():
    real = mp.load_prices()
    assert real["openai"]["read_on"] == "2026-11-09"
    got = {m: (p["input"], p["cached_input"], p["cache_write"], p["output"])
           for m, p in real["openai"]["models"].items()}
    D = Decimal
    assert got["gpt-5.6-terra"] == (D(2), D("0.2"), D("2.5"), D(12))
    assert got["gpt-5.6-sol"] == (D(4), D("0.4"), D(5), D(20))
    assert got["gpt-5.6-luna"] == (D("0.2"), D("0.02"), D("0.25"), D("1.2"))
    assert got["gpt-6.1-sol"] == (D(2), D("0.1"), D("2.5"), D(10))
    assert got["gpt-6.1-terra"] == (D(1), D("0.05"), D("1.25"), D(5))
    assert got["gpt-6-sol"] == (D(2), D("0.2"), D("2.5"), D(10))
    assert got["gpt-6-luna"] == (D("0.1"), D("0.01"), D("0.125"), D("0.5"))
    assert got["gpt-6-astra"] == (D(10), D(1), D("12.5"), D(50))
    # the models whose page gives no cache-write price charge a write as input
    assert got["gpt-5-mini"][2] == got["gpt-5-mini"][0] and got["gpt-5"][2] == got["gpt-5"][0]


def test_every_cache_write_the_pages_price_is_one_and_a_quarter_times_the_input():
    for model, price in mp.load_prices()["openai"]["models"].items():
        if price["cache_write"] != price["input"]:
            assert price["cache_write"] == price["input"] * Decimal("1.25"), model


def test_the_models_with_a_long_context_rule_have_the_pages_numbers():
    for model, price in mp.load_prices()["openai"]["models"].items():
        if model in ("gpt-5-mini", "gpt-5"):
            assert "long_context" not in price, model
        else:
            assert price["long_context"] == {"above_input_tokens": 272000, "input_multiplier": 2, "output_multiplier": Decimal("1.5")}, model


def test_a_price_announced_to_end_is_carried_to_the_summary():
    ledger = mp.Ledger(mp.load_prices())
    ledger.add("scout-1", "openai", "gpt-5.6-sol", fresh=1000, output=100)
    ledger.add("scout-1", "openai", "gpt-5.6-terra", fresh=1000, output=100)
    out = ledger.summary()
    assert out["models"]["gpt-5.6-sol"]["valid_until"] == "2026-11-30"
    assert out["models"]["gpt-5.6-terra"]["valid_until"] is None
    assert out["agents"]["scout-1"]["models"]["gpt-5.6-sol"]["valid_until"] == "2026-11-30"
