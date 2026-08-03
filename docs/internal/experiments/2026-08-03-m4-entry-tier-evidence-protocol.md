# M4 entry tiers — evidence protocol and reproducible tools

**Issue:** [#92 — M4: Run on entry tiers + more providers](https://github.com/leopu00/job-hunter-team/issues/92)

**State on 2026-08-03:** analysis tooling shipped; live inputs still required
for a target or price decision.

## What the repository can substantiate today

Historical investigations report these preliminary observations:

- Kimi projection has oscillated by roughly ±10–15 percentage points, which
  motivated the current 88% buffer instead of 92%;
- exact CLI-token forensics estimated a Kimi subscription budget around
  16–20M non-cached tokens/week in a test bed that rotated accounts, versus
  roughly 48–57M for the compared Codex account;
- coordinator share was about 20% on both providers, so coordinator overhead
  alone did not explain the Kimi difference.

Those claims are documented in
[`kimi-vs-codex-economics.md`](../architecture/kimi-vs-codex-economics.md),
but their raw live CLI/bridge exports are deliberately **not versioned** in
this repository. They were not re-measured by this ticket and must not be
presented as output from the synthetic fixtures.

## Tool 1 — Kimi intra-window variance and 88→92 headroom

`scripts/analysis/m4_kimi_windows.py` reads an exported
`sentinel-data.jsonl` (or a JSON array) and:

1. accepts only Kimi/Moonshot samples with a timezone-aware `ts`, numeric
   `usage`, and numeric `reset_at_unix`;
2. groups samples by the provider's 5-hour reset epoch, not by bridge
   `session_id` (which can change after a telemetry gap);
3. marks a window complete only when it spans at least 30 minutes, has at
   least three samples, and ends within 20 minutes of reset;
4. measures sample variance of projections 15–240 minutes before reset;
5. takes one projection per window around 60±20 minutes before reset and
   compares it with final observed usage;
6. tests whether the worst historical underprediction fits inside the 12 pp
   (target 88) or 8 pp (target 92) headroom.

The last step is a **historical headroom check**, not a counterfactual pacing
simulation. The tool says so in machine-readable output. It also refuses to
produce a verdict unless the operator explicitly labels the input `live` and
at least five complete windows have a decision observation.

Run it on a real, redacted export without committing that export:

```bash
python3 scripts/analysis/m4_kimi_windows.py \
  "$JHT_HOME/logs/sentinel-data.jsonl" \
  --dataset-id 'kimi-single-account-YYYYMMDD' \
  --evidence live --format markdown
```

The versioned fixture `tests/fixtures/m4/kimi-windows.synthetic.json` is
synthetic and exists only to test grouping, units and inconclusive-evidence
behavior.

### External evidence still needed

- at least five complete Kimi 5-hour windows (preferably several weeks);
- a single known subscription/account segment—no account rotation inside the
  dataset;
- bridge sampling through the final 20 minutes and around one hour before each
  reset;
- the resulting JSON report archived with dataset provenance and CLI version.

Until those inputs exist, **88→92 remains unvalidated**.

## Tool 2 — pay-per-use versus subscription

`scripts/analysis/m4_cost_compare.py` has no embedded vendor prices. Its JSON
scenario must state:

- currency and comparison period in days;
- uncached-input, cached-input and output tokens **per day**;
- price for each class in **currency per million tokens**;
- fixed pay-per-use cost per comparison period;
- subscription price, billing-period days and number of subscriptions;
- whether the workload fitting in that subscription is measured, unknown or
  known false.

It normalizes both modes to the requested period and emits component costs,
totals, difference and ratio with units. A cheaper-mode result is always
`conditional_on_input_assumptions`; unknown or insufficient subscription
capacity is inconclusive.

```bash
python3 scripts/analysis/m4_cost_compare.py scenario.json --format markdown
```

The versioned cost scenario is synthetic unit-test arithmetic, **not Kimi,
OpenAI or Anthropic pricing**.

### External evidence still needed

- dated official price inputs (including cache-read/write rates when present);
- token-class totals from the same representative JHT workload;
- measured confirmation that the workload fits the named subscription tier;
- taxes/currency conversion if the comparison is published in EUR.

Without all four, the output is a sensitivity scenario, not a validated buying
recommendation.

## Provider slice

The contributor guide
[`ADDING-A-PROVIDER.md`](../../guides/ADDING-A-PROVIDER.md) turns ADR-0002 into
an implementation/evidence checklist. This ticket does not add an imaginary
fourth provider. It does close one high-confidence abstraction gap found while
walking the checklist: web setup/settings now share the active-runtime list,
do not duplicate Kimi, accept the existing Codex alias consistently, and do
not mistake OAuth credential-product IDs for executable runtimes.
