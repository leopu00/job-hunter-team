# 0005 — Provider risk and mitigation

**Status:** Accepted
**Date:** 2026-05-12

## Context

JHT runs on third-party LLM subscriptions (Claude Max, Codex Plus/Pro, Kimi Pro) consumed by autonomous agents in **near-continuous mode**. A realistic team draws ~400M tokens/month spread across thousands of agent turns — a usage pattern that is technically allowed under each provider's plan but sits at the edge of what those plans were designed for.

This creates a **strategic single-point-of-failure** that ADR-0002 (three CLIs) and ADR-0004 (subscription-only) do not address:

- 🚨 **Terms-of-Service drift** — any provider may unilaterally tighten its "fair use" clauses for agentic / scripted consumption.
- 🚨 **Account-level enforcement** — automated detection may flag a dedicated JHT account as "abuse" and rate-limit, throttle, or suspend it.
- 🚨 **Pricing changes** — a tier renamed, repriced, or sunset (precedent: Gemini CLI throttling that made it unusable for sustained sessions and led us to drop it).
- 🚨 **Capability regressions** — model swap, context-window reduction, or CLI behavior changes that silently degrade the team.

The risk is not hypothetical. It is the single largest non-technical threat to the product.

## Decision

JHT acknowledges provider risk **explicitly** and ships a layered mitigation, not a single hedge:

1. **Multi-CLI by design.** Three independent providers are supported as peers (ADR-0002). Users can switch teams between providers without rewriting their profile or losing state.
2. **Sentinel + Bridge usage governance.** The monitoring stack actively projects per-window token consumption and throttles the Captain before any provider rate-limit fires. This keeps the team's footprint defensible under "normal use" framing.
3. **Dedicated-account convention.** Documentation (README, onboarding, BACKLOG) instructs users to dedicate a fresh subscription to the team — not the shared work/personal account. A dedicated account is easier for the user to monitor, easier to argue about with the provider, and isolates blast radius if suspended.
4. **Local-LLM fallback on the roadmap.** OpenCode integration (BACKLOG: planned) targets open-source local models as a degraded-mode backstop. Quality today still favors frontier commercial models for multi-turn agent loops, but the path is opened so the team is not architecturally trapped on commercial subscriptions.
5. **Legal posture.** The provider relationship is between the user and the provider. JHT does not proxy traffic, does not store provider credentials server-side, does not advertise circumvention of any TOS clause. The product is a local orchestrator of CLIs the user has lawfully signed up for.

## Consequences

- ✅ **No single provider can kill the product** — if Claude Max changes its TOS tomorrow, Codex and Kimi tiers absorb the migration with documented playbooks.
- ✅ **Sentinel is load-bearing** — it is not just a cost-tracking nicety; it is the mechanism that keeps the team's behavior inside the envelope each provider tolerates.
- ✅ **Honesty is a feature** — contributors, beta testers, and reviewers see provider risk documented openly. This builds trust and frames future incidents as known-risk-materialized, not surprises.
- ⚠️ **Adds permanent engineering surface** — three providers must stay supported in parallel; dropping one without a replacement re-creates the single-point-of-failure.
- ⚠️ **Quality variance** — Kimi/Codex parity with Claude is still being calibrated (BACKLOG: `±5% Claude, ±10-15% Kimi` from 5h test). The mitigation is real only when Kimi €40 reaches mass-market quality.
- ⚠️ **No insurance against simultaneous tightening** — if all three providers move against agentic use in the same quarter, only the local-LLM fallback remains, and it is not production-ready today.

## Alternatives considered

- **Pick one provider and hope** — rejected. Single-vendor lock-in on a usage pattern the vendor did not design for is the textbook definition of bad strategic risk.
- **Build on API keys with cost ceiling instead** — rejected by ADR-0004 on cost grounds; would also not solve TOS risk (API TOS are stricter than subscription TOS in several places).
- **Ship local-LLM-only mode now** — rejected. Frontier-model quality gap on agentic multi-turn loops is still real in 2026; shipping a degraded experience as default would lose the credibility we have from the original 200/20/5 build.
- **Don't document the risk** — rejected explicitly. The risk exists whether or not we name it; naming it lets us design around it and tells contributors what we are betting on.

## Related

- [ADR 0002](./0002-three-supported-agent-clis.md) — multi-CLI support is the structural mitigation
- [ADR 0004](./0004-subscription-only-no-api-keys.md) — subscription model that makes the agentic pattern affordable but TOS-exposed
- [`docs/about/MONITORING.md`](../about/MONITORING.md) — Sentinel + Bridge governance
- [`docs/about/PROVIDERS.md`](../about/PROVIDERS.md) — per-provider tier and status matrix
