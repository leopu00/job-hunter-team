# 0004 — Subscription-only: no pay-per-use API keys

**Status:** Accepted
**Date:** 2026-04-17

## Context

JHT runs a team of multiple AI agents continuously. A single job-hunting session triggers thousands of agent turns: researching postings, shortlisting, drafting CVs, writing cover letters, critiquing, iterating. Run over days, a realistic user would burn **thousands of dollars** on pay-per-use API pricing (e.g. per-token Anthropic API, OpenAI API) before producing meaningful output.

This is unacceptable both as a product (users would churn on the first bill) and as a default posture (a friend could rack up a four-digit bill in a weekend by accident).

## Decision

**JHT does not support pay-per-use API keys as its primary authentication path.** The agents run exclusively under **subscription plans** — Claude Pro/Max, ChatGPT Plus/Pro, Kimi subscription — where the user pays a flat monthly fee with usage caps enforced by the vendor, not by metered billing.

The mechanism is **tmux**: each agent runs as an interactive CLI session (`claude`, `codex`, `kimi`) inside a tmux pane. These CLIs authenticate once via browser / OAuth / stored credentials and preserve the session across many turns, which is exactly how subscriptions are designed to be consumed. An API-key-based call would bypass the subscription entitlement and go through the metered billing path instead.

## Consequences

- ✅ Cost is a flat, predictable monthly subscription. No surprise bills.
- ✅ Usage caps are enforced by the provider, not by us. We don't need a cost-tracking layer.
- ✅ The tmux-based runtime is the *reason* the product is viable for individual users, not a legacy choice — breaking it breaks the cost model.
- ⚠️ Setup friction: each user must log into each CLI they want to use (one-time per CLI). We can guide this from the launcher but cannot automate a vendor OAuth.
- ⚠️ Env vars like `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `MOONSHOT_API_KEY` remain allowed as **power-user escape hatches** (so scripted / server-side use cases still work) but are never the default, never surfaced in onboarding, and never required to use the product.
- ⚠️ If a supported CLI is discontinued or its subscription policy changes, we need to replace it with another subscription-based CLI (not silently fall back to API keys).

## Alternatives considered

- **Pay-per-use API keys as default** — rejected. A typical JHT run would cost USD 500–2000 per week. No individual user would accept that.
- **BYO API key with a cost ceiling in JHT** — rejected. Enforcing a ceiling at JHT level is brittle (providers don't expose real-time spend) and leaks cost-model complexity into the product. The subscription model shifts that responsibility to the vendor, where it belongs.
- **Self-hosted open-source models** — out of scope. The quality gap for agentic use today still favors frontier commercial models; revisit when local models reliably match Claude/GPT-class output for multi-turn agent loops.

## Related

- [ADR 0002](./0002-three-supported-agent-clis.md) — the three subscription CLIs we support (Claude Code, Codex, Kimi)
- Onboarding flow (desktop): sets up Docker → container → tmux session; users `claude login` / equivalent inside the session, never type API keys into a form.
