# JHT API workers — isolated agent prototypes

This package is the first API-backed agent engine for Job Hunter Team. Its core
worker remains proposal-only and is not wired into the production launcher,
tmux, Bridge, Sentinel or `jobs.db`. A second entry point now wraps that core in
an entirely separate standalone ecosystem with its own profile, coordination
leases and SQLite database.

The architectural rationale and unchanged boundaries are recorded in
[`docs/internal/prototypes/2026-08-19-scout-api-worker-design.md`](../docs/internal/prototypes/2026-08-19-scout-api-worker-design.md).

The experiment now also exposes bounded experimental TypeScript/Vercel AI SDK
proposal contracts for several team roles. These snapshots are not replacements
for the production role prompts, pacing rules, session policy or orchestration
contracts, and no side-effect consumer is connected to them. The role workers
share only provider, guardrail, lock and sanitized-audit infrastructure; each
has its own strict input/output schema, prompt, runtime lock and proposal-only
result. They do not read or write the product database, files, tmux sessions,
mail or network tools.

## Structure

```text
src/contract.ts             versioned input/result/tool/error/event schemas
src/model-profile.ts        provider, model, capability and pricing profile
src/candidate-profile.ts    minimal standalone candidate/search profile
src/role/scout.ts           provider-independent Scout prompt
src/tools.ts                narrow injected search/read tools
src/web-job-reader.ts       public-HTTPS + Schema.org JobPosting evidence gate
src/safe-http.ts            public-IP policy + DNS-pinned HTTPS connector
src/guardrails.ts           step, tool, I/O, timeout and USD limits
src/run-lock.ts             one-run-at-a-time lock
src/audit.ts                schema-validated sanitized JSONL audit
src/providers/mock.ts       deterministic offline provider
src/providers/ai-sdk.ts     gated Anthropic/OpenAI/Kimi adapter
src/providers/ai-sdk-runtime.ts common AI SDK model and usage normalization
src/worker.ts               stable worker boundary
src/analyst-worker.ts       isolated one-position Analyst boundary
src/prototype-roles.ts      isolated Writer through Maintainer boundaries
src/structured-role-worker.ts guarded shared structured-output runtime
src/standalone-db.ts        isolated coordination, dedup and positions database
src/standalone.ts           profile-to-search-to-persistence orchestration
src/standalone-cli.ts       one-command standalone entry point
fixtures/                   synthetic input, model and job catalog
tests/                      offline automated tests
```

## Isolated API role roster

All demos use synthetic `.invalid` evidence and the deterministic mock model;
they execute the actual worker, schema, guard, lock, audit and CLI boundaries:

```bash
npm run scout
npm run analyst:demo
npm run scorer:demo
npm run writer:demo
npm run critic:demo
npm run assistant:demo
npm run mentor:demo
npm run captain:demo
npm run sentinel:demo
npm run doctor:demo
npm run maintainer:demo
```

Scorer is exposed on the versioned `jht-100-v2` proposal scale accepted in
[ADR-0010](../docs/adr/0010-version-api-scorer-scale.md): stack 35, experience
25, remote/location 20, salary 10 and strategic fit 10. The exact component
ceiling is therefore 100; explicit deductions may reduce it by at most 30
points. The existing persisted 110-point component ruler remains
`legacy-110-v1` and is not rewritten or silently converted.

The Scorer input contains the original Scout evidence, the checked Analyst
proposal and an explicit operator authorization tied to the same source ID.
Cross-position handoffs, excluded Analyst proposals, missing authorization,
wrong arithmetic and a decision inconsistent with the 40-point threshold fail
closed. The authorization permits only one proposal: it does not authorize a
database write or another agent handoff.

The downstream roles are deliberately proposals, not production automation:
Scorer does not write scores or position states, Writer does not create
documents, Critic does not save reviews, Captain and Sentinel do not issue
commands, Doctor does not restart sessions, and Maintainer does not edit the
repository. Writer is contract-gated to an explicit user request and a score
of at least 50 for CV work. Critic receives only the CV and job description,
preserving blind review.

For a paid canary, each non-Scout CLI additionally requires `--live`, explicit
`--input` and `--profile` files, a positive `--max-cost-usd`, current non-zero
pricing and the provider's fixed environment key. No test or demo enables that
path implicitly.

### OpenAI synthetic canary — 2026-08-24

The isolated Analyst → authorized handoff → Scorer path passed live with
`gpt-5.6-luna`: two provider requests, 3,694 tokens and projected configured
cost of `$0.00185767` under one `$0.05` process budget. Both results remained
`proposal_only` / `persistence: none`; their audits contained no persistence
events. This proves transport, strict structured output, accounting and the
handoff boundary on synthetic evidence. It is not a quality benchmark and the
projected cost has not yet been reconciled against provider billing.

The canary profile used the model ID, structured-output capability and token
prices published in the official
[OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
on that date. Pricing remains explicit runtime configuration and must be
rechecked before future paid runs.

> **Live-provider privacy boundary:** local audit files omit prompts and role
> evidence, but `--live` sends the serialized role input—including any supplied
> candidate or profile evidence—to the selected external model provider. Use
> synthetic or minimized inputs by default. Before sending personal data, the
> operator must explicitly authorize that transmission and verify the selected
> provider's applicable data-handling and retention policy.

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
subrequests pass through the same connector, and every TLS socket is pinned to
the exact public DNS result that passed validation. IPv4, IPv6, mapped IPv4,
private, loopback, link-local, CGNAT, metadata, documentation, transition,
multicast and reserved ranges fail closed. Chromium keeps its process sandbox;
its own DNS/network path, QUIC, WebSockets and service workers are disabled, so
it renders only responses proxied through the bounded connector. A sandbox
launch failure is not retried with weaker flags. Listing text is always treated
as hostile data. The audit records the source host, fetch method and a sanitized
failure reason.

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
    "cachedInputUsdPerMillionTokens": 0.0,
    "cacheWriteUsdPerMillionTokens": 0.0,
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

### Usage accounting

Every new provider attempt is recorded before the request, then paired with its
provider-reported usage when available. Input usage is split into uncached,
cache-read and cache-write tokens; output usage is split into text and reasoning
tokens. Provider response IDs and web-search calls are recorded without prompts,
results or credentials. Once a response has executed, its token usage and native
web-search cost are committed to the run ledger before post-response output,
tool or budget limits are enforced, so a failed run cannot hide billed work.

Inspect one agent's audit with:

```bash
npm run scout:usage -- --audit /absolute/path/to/scout-runs.jsonl
```

The report and standalone command summaries deliberately omit the resolved
audit and database filesystem paths.

`projectedCostUsd` is computed from provider usage and the explicit model
profile. It is deliberately not called billed cost. `missingUsageRequests`
identifies attempted provider requests for which the provider did not return
usage, while legacy runs are reported separately as unknown. Financial truth
requires later reconciliation with the provider billing/Costs API; until then
`billingFullyReconciled` remains false.

## Contract and extension seams

`ScoutApiWorker.run(unknown)` returns a `ScoutWorkerOutcome` rather than throwing
provider details across the boundary. Provider failures are reduced to typed,
sanitized public errors. Optional provider debug output contains only an
allowlisted category, HTTP status and structured-output reason/code; it never
copies an exception name, message, body or validation message. `ScoutJobSource`
and `ScoutProviderAdapter` are injected, so real-source tools and additional
model transports can replace the fixtures without changing the worker
input/result contract.

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
