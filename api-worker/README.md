# JHT API worker — Scout prototype

This package is the first API-backed agent engine for Job Hunter Team. Its core
worker remains proposal-only and is not wired into the production launcher,
tmux, Bridge, Sentinel or `jobs.db`. A second entry point now wraps that core in
an entirely separate standalone ecosystem with its own profile, coordination
leases and SQLite database.

The architectural rationale and unchanged boundaries are recorded in
[`docs/internal/prototypes/2026-08-19-scout-api-worker-design.md`](../docs/internal/prototypes/2026-08-19-scout-api-worker-design.md).

## Structure

```text
src/contract.ts             versioned input/result/tool/error/event schemas
src/model-profile.ts        provider, model, capability and pricing profile
src/candidate-profile.ts    minimal standalone candidate/search profile
src/role/scout.ts           provider-independent Scout prompt
src/tools.ts                narrow injected search/read tools
src/web-job-reader.ts       public-HTTPS + Schema.org JobPosting evidence gate
src/guardrails.ts           step, tool, I/O, timeout and USD limits
src/run-lock.ts             one-run-at-a-time lock
src/audit.ts                schema-validated sanitized JSONL audit
src/providers/mock.ts       deterministic offline provider
src/providers/ai-sdk.ts     gated Anthropic/OpenAI/Kimi adapter
src/worker.ts               stable worker boundary
src/standalone-db.ts        isolated coordination, dedup and positions database
src/standalone.ts           profile-to-search-to-persistence orchestration
src/standalone-cli.ts       one-command standalone entry point
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
`persistence: "none"`. The standalone wrapper, not the model or core worker,
performs the authorized write to `api-worker/.standalone/data/scout.db`. It does
not import the product's SQLite helpers and cannot discover or modify `jobs.db`.

## Standalone Scout

The safe offline path proves the entire lifecycle with synthetic data:

```bash
npm run scout
```

It reads `fixtures/candidate-profile.synthetic.yml`, checks the standalone
database for active colleagues, registers a lease, runs the mock Scout, applies
the three Scout dedup levels and inserts verified proposals as `status=new`.
Re-running the command demonstrates idempotency: the existing URLs are skipped.
On Node 22 the built-in `node:sqlite` module may print an experimental-feature
warning; the standalone package intentionally uses it here to avoid a native
SQLite dependency during this fast prototype phase.

The database is also the coordination bus. Active agents publish a renewable
lease; a new agent sees them and atomically claims a free role/location/work-mode
lane. Stale leases expire. No tmux session, container, product profile, email
inbox or product database participates.

For a live web cycle, provide a candidate profile, a provider/model profile and
a positive per-run budget explicitly:

```bash
ANTHROPIC_API_KEY="..." npm run scout -- \
  --live \
  --candidate-profile /absolute/path/to/candidate-profile.yml \
  --model-profile /absolute/path/to/model-profile.json \
  --workspace /absolute/path/to/isolated-scout-workspace \
  --agent-id scout-1 \
  --max-web-searches 2 \
  --max-cost-usd 0.25
```

Live standalone web discovery currently supports Anthropic and OpenAI. The
model uses the provider-native web-search tool, but a result is not eligible for
SQLite until `read_web_job` independently reads its public HTTPS URL. The reader
uses rotating browser-like HTTP requests, then escalates blocked or client-only
pages to local headless Chrome. Schema.org `JobPosting` is used when present;
otherwise the model receives bounded visible-page evidence and must produce an
extractive, evidence-grounded proposal. Redirects are revalidated, browser
requests to private/local addresses are blocked, responses are size- and
time-bounded, and listing text is always treated as hostile data. The audit
records the source host, fetch method and a sanitized failure reason.

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
    "structuredOutput": { "supported": true, "mode": "native" },
    "webSearch": { "supported": true, "mode": "provider" }
  },
  "pricing": {
    "inputUsdPerMillionTokens": 0.0,
    "outputUsdPerMillionTokens": 0.0,
    "webSearchUsdPerCall": 0.0
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
gate. Before a live experiment, replace them with currently verified prices,
including the provider's web-search tool charge. The guard reserves the
configured web-search allowance alongside token cost.

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

The standalone SQLite writer is deliberately not that production adapter: its
schema and path belong only to this experiment.

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
