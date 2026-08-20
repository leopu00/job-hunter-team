# JHT API worker — Scout prototype

This package is the first API-backed agent engine for Job Hunter Team. It is a
proposal-only Scout and is not wired into the production launcher, tmux, Bridge,
Sentinel or `jobs.db`.

The architectural rationale and unchanged boundaries are recorded in
[`docs/internal/prototypes/2026-08-19-scout-api-worker-design.md`](../docs/internal/prototypes/2026-08-19-scout-api-worker-design.md).

## Structure

```text
src/contract.ts             versioned input/result/tool/error/event schemas
src/model-profile.ts        provider, model, capability and pricing profile
src/role/scout.ts           provider-independent Scout prompt
src/tools.ts                narrow injected search/read tools
src/guardrails.ts           step, tool, I/O, timeout and USD limits
src/run-lock.ts             one-run-at-a-time lock
src/audit.ts                schema-validated sanitized JSONL audit
src/providers/mock.ts       deterministic offline provider
src/providers/ai-sdk.ts     gated Anthropic/OpenAI/Kimi adapter
src/worker.ts               stable worker boundary
fixtures/                   synthetic input, model and job catalog
tests/                      offline automated tests
```

## Safe default

Install and run from this directory:

```bash
npm ci
npm run demo
```

The default command uses only checked-in synthetic fixtures. It makes no network
request and never reads a JHT profile, credential store, database, tmux session,
email inbox or user directory. Audit metadata is appended to
`api-worker/.runs/scout-runs.jsonl`; prompts, tool inputs/results, job content,
environment values and raw provider errors are deliberately absent.

The outcome is versioned and explicit:

```json
{
  "ok": true,
  "result": {
    "contractVersion": "1",
    "role": "scout",
    "disposition": "proposal_only",
    "persistence": "none"
  }
}
```

Every proposal also carries `disposition: "proposed"` and
`persistence: "none"`. No code in this package imports SQLite helpers.

## Provider/model profile

A profile names the provider and model separately and declares capabilities.
The Scout refuses profiles without tool calling or structured output. Capability
declarations are evidence/configuration supplied for that exact model; they are
not inferred from the provider brand.

```json
{
  "profileVersion": "1",
  "provider": "anthropic",
  "model": "REPLACE_WITH_A_VERIFIED_MODEL_ID",
  "capabilities": {
    "toolCalling": { "supported": true, "parallel": false },
    "structuredOutput": { "supported": true, "mode": "native" }
  },
  "pricing": {
    "inputUsdPerMillionTokens": 0.0,
    "outputUsdPerMillionTokens": 0.0
  }
}
```

Valid providers are `mock`, `anthropic`, `openai` and `kimi`. Kimi uses the AI
SDK OpenAI-compatible adapter and additionally requires an explicit HTTPS
`baseUrl`. A compatible transport does not imply identical tool or structured
output behavior; those capabilities still have to be declared for the selected
model. Anthropic and OpenAI do not accept custom base URLs, so their keys cannot
be redirected through profile configuration.

Pricing values above are placeholders and intentionally fail the live budget
gate. Before a live experiment, replace them with currently verified prices.

## Explicit future live experiment

No live call is made during this prototype's tests. A future operator must:

1. copy the synthetic input and set a small positive `limits.maxCostUsd`;
2. create a non-mock profile with a current model ID, evidenced capabilities and
   current non-zero pricing;
3. export only the provider's fixed environment variable:
   `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `MOONSHOT_API_KEY`;
4. pass both files and the explicit live flag:

```bash
ANTHROPIC_API_KEY="..." npm run demo -- \
  --live \
  --input /absolute/path/to/scout-input.json \
  --profile /absolute/path/to/model-profile.json \
  --runtime-dir /absolute/path/to/isolated-run-dir
```

The CLI refuses `--live` unless both input and profile paths are explicit. The
worker refuses a non-mock profile without the live flag, a positive budget,
explicit pricing or the fixed environment key. It never reads keys from
`jht.config.json` or the JHT credential vault and never records the key.
The flag makes only the model transport live: Scout tools still read the local
synthetic catalog by default (or another explicitly supplied local `--jobs`
fixture), never real job sites or the public network.

Before each provider step, the worker estimates the current serialized input and
reserves the worst-case price of the configured per-step output limit. If the
remaining USD budget cannot cover that request, the request is not sent. Missing
or non-priceable provider usage is charged at the reserved ceiling. Step and
tool-call limits are checked before execution; output and timeout limits stop the
run with a typed error.

## Contract and extension seams

`ScoutApiWorker.run(unknown)` returns a `ScoutWorkerOutcome` rather than throwing
provider details across the boundary. Provider failures are reduced to typed,
sanitized public errors. `ScoutJobSource` and `ScoutProviderAdapter` are injected,
so real-source tools and additional model transports can replace the fixtures
without changing the worker input/result contract.

The next production slice must add separate adapters for:

- existing tmux identity, source claims, feedback and blocked messages;
- read-only SQLite dedup followed by an explicitly authorized `positions`
  writer;
- Bridge/Sentinel accounting of API USD spend;
- hostile-content-fenced real network sources and their rate limits.

Until those adapters and isolated end-to-end tests exist, a proposal is not a
production Scout hand-off and must not be written to `jobs.db`.

The prototype lock is intentionally fail-closed: an ungraceful process crash can
leave `scout.lock` behind. Automated stale-lock recovery must wait for the future
supervisor/tmux integration, which can verify process identity before reclaiming
it; deleting a lock merely because it is old could create two live Scouts.

## Verification

```bash
npm run verify
```

This runs Prettier check, strict TypeScript typecheck and the offline Vitest
suite.
