"""What a call to a model costs: the one price list of the product (shared/config/model-prices.json) and the one
calculation, for every harness.

Codex writes, per call, the tokens it used (rollout `token_count`); Pi writes them in its session (`usage`). Neither
CLI's own figure is the amount charged: Pi's `cost.total` is an estimate by Pi's catalog, Codex writes none. The cost is computed
HERE, from the tokens of each call and the price of THE MODEL THAT ANSWERED, with the rules of the provider's page:

  * every input token is billed once, at one of three prices: not cached (`input`), served from the cache
    (`cached_input`), written to the cache (`cache_write`, in place of `input`; a model whose page gives none bills a
    write as input);
  * output includes the reasoning (never added again);
  * a call whose input (all three kinds) is over `long_context.above_input_tokens` is billed at the multipliers for the
    WHOLE call, so the cost is computed per call and then summed, never on summed tokens;
  * a web search costs a flat fee on top of the tokens it brings in (`web_search_per_call`).

A model with no price in the list is "unknown": its tokens are counted, its cost is None, and so is every total that
contains it. A cost is never a zero because nothing was known. Arithmetic is Decimal, rounded to the micro-dollar only
when it is written out.

The summary shape is the same for every harness:

    {"currency", "calls", "usd", "usd_known", "price", "unknown_models": [...],
     "models": {<model>: BUCKET}, "agents": {<agent>: BUCKET + {"models": {<model>: BUCKET}}},
     "web_search": {"searches", "usd"}}
    BUCKET = {"provider", "valid_until" (the date the model's price is announced to end, or None), "calls", "input_fresh", "cached_input", "cache_write", "output", "reasoning",
              "usd" (None if not all known), "usd_known", "price": "known" | "partial" | "unknown"}
"""
from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

PRICES_FILE = Path(__file__).resolve().parent.parent / "config" / "model-prices.json"
MILLION = Decimal(1_000_000)
MICRO = Decimal("0.000001")
UNKNOWN_MODEL = "?unknown"
PROVIDER_OF = {"codex": "openai", "claude": "anthropic", "moonshot": "kimi"}


class PriceListError(ValueError):
    """The price list cannot be trusted: a number that is not a price, a model without its two basic prices."""


def _dec(value, where):
    if isinstance(value, bool) or not isinstance(value, (Decimal, int)) or value < 0:
        raise PriceListError(f"{where}: {value!r} is not a price")
    return Decimal(value)


def _model(raw, where):
    if not isinstance(raw, dict) or "input" not in raw or "output" not in raw:
        raise PriceListError(f"{where}: a model needs at least input and output")
    price = {"input": _dec(raw["input"], where + ".input"), "output": _dec(raw["output"], where + ".output")}
    price["cached_input"] = _dec(raw["cached_input"], where + ".cached_input") if "cached_input" in raw else price["input"]
    price["cache_write"] = _dec(raw["cache_write"], where + ".cache_write") if "cache_write" in raw else price["input"]
    price["valid_until"] = str(raw["valid_until"]) if raw.get("valid_until") else None
    long = raw.get("long_context")
    if long is not None:
        if not isinstance(long, dict) or not {"above_input_tokens", "input_multiplier", "output_multiplier"} <= set(long):
            raise PriceListError(f"{where}.long_context: needs above_input_tokens and both multipliers")
        price["long_context"] = {key: _dec(long[key], f"{where}.long_context.{key}") for key in
                                 ("above_input_tokens", "input_multiplier", "output_multiplier")}
    return price


def load_prices(path=None) -> dict:
    """The price list as `{provider: {"models": {model: price}, "web_search_per_call": Decimal | None, ...}}`."""
    raw = json.loads(Path(path or PRICES_FILE).read_text(encoding="utf-8"), parse_float=Decimal)
    if raw.get("currency") != "USD" or not isinstance(raw.get("providers"), dict):
        raise PriceListError("the price list is in USD and has providers")
    book = {}
    for provider, entry in raw["providers"].items():
        models = entry.get("models") if isinstance(entry, dict) else None
        if not isinstance(models, dict):
            raise PriceListError(f"{provider}: models must be an object")
        fee = entry.get("web_search_per_call")
        book[provider] = {
            "source": entry.get("source", ""), "read_on": entry.get("read_on", ""),
            "web_search_per_call": _dec(fee["usd"], provider + ".web_search_per_call") if isinstance(fee, dict) else None,
            "models": {name: _model(price, f"{provider}.{name}") for name, price in models.items()},
        }
    return book


def price_of(book, provider, model):
    """The price of `model` at `provider`, or None: the model is not in the list."""
    entry = book.get(PROVIDER_OF.get(provider, provider)) or {}
    return (entry.get("models") or {}).get(model)


def call_cost(price, fresh=0, cached=0, written=0, output=0) -> Decimal:
    """USD of ONE call: `fresh` input tokens neither cached nor written, `cached` served from the cache, `written`
    written to it, `output` (reasoning included)."""
    fresh, cached, written, output = (Decimal(max(0, n)) for n in (fresh, cached, written, output))
    long = price.get("long_context")
    over = long is not None and fresh + cached + written > long["above_input_tokens"]
    into = long["input_multiplier"] if over else Decimal(1)
    outo = long["output_multiplier"] if over else Decimal(1)
    tokens = (fresh * price["input"] + cached * price["cached_input"] + written * price["cache_write"]) * into
    return (tokens + output * price["output"] * outo) / MILLION


def cost_usd(model, uncached_in, cached_in, out, searches=0, written_in=0, provider="openai", book=None):
    """USD of one call by the name of its model: `uncached_in` input tokens neither cached nor written, `cached_in`
    served from the cache, `written_in` written to it, `out` output (reasoning included), `searches` web searches it
    made. None when the model (or, for a search, the provider's fee) is not in the list: unknown, never zero."""
    book = book if book is not None else load_prices()
    price = price_of(book, provider, model)
    fee = (book.get(PROVIDER_OF.get(provider, provider)) or {}).get("web_search_per_call")
    if price is None or (searches and fee is None):
        return None
    total = call_cost(price, uncached_in, cached_in, written_in, out) + (fee * searches if searches else 0)
    return float(total.quantize(MICRO))


def from_codex(last_token_usage) -> dict:
    """The kinds of token of one Codex call. Codex counts the cached and the written tokens INSIDE `input_tokens`."""
    def n(key):
        value = last_token_usage.get(key)
        return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0 else 0
    total = n("input_tokens")
    cached = min(total, n("cached_input_tokens"))
    written = min(total - cached, n("cache_write_input_tokens"))
    output = n("output_tokens")
    if last_token_usage.get("last_usage_includes_reasoning") is False:
        output += n("reasoning_output_tokens")
    return {"fresh": total - cached - written, "cached": cached, "written": written, "output": output,
            "reasoning": n("reasoning_output_tokens")}


def from_pi(event) -> dict:
    """The kinds of token of one Pi call (an event of pi_sessions.usage_events): `input` is what was neither read from
    the cache nor written to it, and `output` already includes the reasoning."""
    return {"fresh": event["input"], "cached": event["cache_read"], "written": event["cache_write"],
            "output": event["output"], "reasoning": event.get("reasoning", 0)}


def _bucket(provider="", valid_until=None):
    return {"provider": provider, "valid_until": valid_until, "calls": 0, "input_fresh": 0, "cached_input": 0, "cache_write": 0, "output": 0,
            "reasoning": 0, "_usd": Decimal(0), "_unknown": 0}


def _write(bucket):
    out = {key: value for key, value in bucket.items() if not key.startswith("_")}
    known = bucket["_unknown"] == 0
    out["price"] = "known" if known else ("unknown" if bucket["_unknown"] == bucket["calls"] else "partial")
    out["usd"] = float(bucket["_usd"].quantize(MICRO)) if known else None
    out["usd_known"] = float(bucket["_usd"].quantize(MICRO))
    return out


class Ledger:
    """The calls of a window, added one by one and summed per model and per agent."""

    def __init__(self, book=None):
        self.book = book if book is not None else load_prices()
        self.total, self.models, self.agents = _bucket(), {}, {}
        self.searches, self.search_usd, self.search_unknown = 0, Decimal(0), 0

    def add(self, agent, provider, model, fresh=0, cached=0, written=0, output=0, reasoning=0):
        provider = PROVIDER_OF.get(provider, provider or "")
        model = model or UNKNOWN_MODEL
        price = price_of(self.book, provider, model)
        usd = call_cost(price, fresh, cached, written, output) if price else None
        agent = agent or "?unknown"
        agent_row = self.agents.setdefault(agent, {"all": _bucket(), "models": {}})
        until = price["valid_until"] if price else None
        for bucket in (self.total, self.models.setdefault(model, _bucket(provider, until)), agent_row["all"],
                       agent_row["models"].setdefault(model, _bucket(provider, until))):
            bucket["calls"] += 1
            bucket["input_fresh"] += fresh
            bucket["cached_input"] += cached
            bucket["cache_write"] += written
            bucket["output"] += output
            bucket["reasoning"] += reasoning
            if usd is None:
                bucket["_unknown"] += 1
            else:
                bucket["_usd"] += usd

    def add_searches(self, agent, provider, count):
        """`count` web searches by `agent`: a flat fee each; no fee in the list for the provider = unknown."""
        fee = (self.book.get(PROVIDER_OF.get(provider, provider)) or {}).get("web_search_per_call")
        agent_row = self.agents.setdefault(agent or "?unknown", {"all": _bucket(), "models": {}})
        self.searches += count
        if fee is None:
            self.search_unknown += count
            return
        self.search_usd += fee * count
        for bucket in (self.total, agent_row["all"]):
            bucket["_usd"] += fee * count

    def summary(self) -> dict:
        total = _write(self.total)
        unknown = sorted(name for name, bucket in self.models.items() if bucket["_unknown"])
        complete = total["usd"] is not None and not self.search_unknown
        return {
            "currency": "USD", "calls": total["calls"],
            "usd": total["usd"] if complete else None, "usd_known": total["usd_known"],
            "price": "known" if complete else "unknown" if total["price"] == "unknown" else "partial",
            "unknown_models": unknown,
            "models": {name: _write(bucket) for name, bucket in sorted(self.models.items())},
            "agents": {name: {**_write(row["all"]), "models": {m: _write(b) for m, b in sorted(row["models"].items())}}
                       for name, row in sorted(self.agents.items())},
            "web_search": {"searches": self.searches,
                           "usd": None if self.search_unknown else float(self.search_usd.quantize(MICRO))},
        }
