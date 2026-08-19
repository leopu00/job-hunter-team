# Scout API worker prototype — design

**Date:** 2026-08-19
**Status:** prototype implemented outside the production runtime

## Decision

The prototype lives in a new executable package, `api-worker/`. It does not
live in `shared/`: that directory is a library imported by existing product
surfaces, while this worker is a new runtime entry point. It does not live in
`agents/scout/` either: that directory remains the provider-CLI role prompt and
operational contract used by the production launcher.

The package has three boundaries:

1. a provider-neutral worker contract and guardrail layer;
2. a Scout role definition plus a narrow, injected tool registry;
3. provider adapters (deterministic mock by default, AI SDK only behind an
   explicit live gate).

Future tmux/protocol and SQLite adapters belong outside the role and provider
layers. They will translate the stable worker input/outcome contract to the
existing team protocol and will decide whether a proposal may be deduplicated
and persisted.

## Existing architecture that remains unchanged

- tmux remains the production session, identity and message bus;
- `jobs.db` remains the source of truth and the existing role-specific write
  boundaries remain authoritative;
- Bridge and Sentinel continue to monitor and control the subscription runtime;
- the canonical launcher continues to select provider CLI and role model from
  configuration;
- Scout coordination, source claims, hierarchical pre-insert deduplication,
  pull-first hand-off and the `SC-01..SC-09` rules remain the production
  contract;
- no existing agent role, launcher path, credential store or database helper is
  modified by this prototype.

The current Scout writes `positions(status=new)` after coordination and dedup.
The prototype deliberately stops one boundary earlier: its result contains
`disposition: "proposed"` and `persistence: "none"`. Therefore it cannot claim
to have completed the production Scout hand-off.

## Initial prototype scope

- one Scout run at a time, enforced by an exclusive local lock;
- versioned Zod schemas for input, proposal result, tool event, audit event and
  public error;
- provider/model profiles that declare tool-calling and structured-output
  capabilities instead of inferring equivalence from a provider name;
- a deterministic synthetic catalog exposed through only `search_jobs` and
  `read_job`; tool implementations are injected and can later be replaced;
- provider-independent prompt and output schema derived from the current Scout
  role: permissive upstream discovery, complete job descriptions, freshness,
  one candidate at a time and no scoring;
- sanitized JSONL audit records containing identifiers and measurements, never
  prompts, tool arguments/results, job content, environment values or raw
  provider errors;
- hard limits for serialized input, provider steps, tool calls, per-step and
  total output tokens, result bytes, timeout and USD budget;
- an AI SDK adapter for Anthropic, OpenAI and Kimi/Moonshot. It is unreachable
  without an explicit live flag, an environment-only API key and a positive
  budget with explicit pricing.

## Safety and budget behavior

The default command uses the mock profile and synthetic fixture. It opens no
network connection, reads no JHT profile or credential store, and has no
database or tmux dependency.

For live execution the caller must provide all of:

- `--live`;
- a non-mock provider profile;
- the provider's fixed environment variable (`ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY` or `MOONSHOT_API_KEY`);
- a positive per-run USD budget and explicit per-million-token prices.

Before every provider step, the adapter estimates the serialized request and
reserves the worst-case cost of that step using the configured output cap. If
the remaining run budget cannot cover it, no request is sent. Reported usage is
then used for the run cost; absent usage is accounted at the reserved ceiling.
This is intentionally conservative.

The provider profile is configuration, not prompt text, matching ADR-0007.
Custom base URLs are accepted only for the Kimi/Moonshot OpenAI-compatible
adapter; Anthropic and OpenAI keys cannot be redirected to arbitrary hosts.

## Deferred integration

Before production use, JHT still needs:

- a launcher mode that starts this process inside the existing tmux identity;
- a protocol adapter for Scout coordination, feedback and blocked/esaurito
  messages;
- a read-only dedup/query adapter followed by a separately authorized,
  single-writer persistence adapter for `positions`;
- Bridge/Sentinel accounting that aggregates API USD spend alongside the
  existing subscription-window metrics;
- real-source tools with explicit network policy, hostile-content fencing,
  rate limits and source-specific evidence tests;
- provider/model capability and pricing evidence for each live profile;
- end-to-end tests in an isolated JHT home before any production launcher path
  is changed.

MCP, LangGraph/LangChain, RAG, automatic provider routing/fallback, other roles
and any write to the real database remain out of scope.
