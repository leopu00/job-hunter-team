# M4 evidence bundles

An M4 evidence bundle records exactly which scrubbed inputs, parameters,
analyzer versions and application commit produced the Kimi-window and
explicit-cost findings. A valid bundle establishes **reproducibility**. It does
not, by itself, establish that a provider price is current, that a workload
fits a subscription, or that a month-long live run succeeded.

The versioned manifest contract is
[`shared/schemas/m4-evidence-bundle-v1.schema.json`](../../shared/schemas/m4-evidence-bundle-v1.schema.json).
The command also enforces cross-field and data-boundary checks that JSON Schema
cannot express safely, including fixture fingerprint detection.

## Render the deterministic repository fixture

From the repository root, run:

```bash
python3 scripts/analysis/m4_evidence_bundle.py \
  tests/fixtures/m4/evidence-bundle.synthetic.json \
  --format markdown
```

Use `--format json` for the machine-readable assembled report. The output
records:

- bundle and per-dataset provenance classifications;
- the SHA-256 digest of each input;
- the application commit named by `tested_commit`;
- assembler/analyzer versions, report-schema versions and implementation
  hashes;
- all analyzer parameters and generated findings;
- an explicit external-validation status and claim boundary.

The fixture output is always labelled `FIXTURE`, and Kimi target findings stay
`inconclusive_non_live_evidence`. The synthetic cost arithmetic is not vendor
pricing.

## Prepare a real export

Keep raw exports outside Git. Create a separate scrubbed copy that contains
only the fields consumed by the analyzers.

The Kimi window input may be a JSON array or JSONL, matching the existing
analyzer. Its complete field allowlist is:

```text
ts, provider, usage, projection, reset_at_unix
```

Do not include session/account/user/candidate IDs, email addresses, hostnames,
IP addresses, names, cookies, authorization headers, API keys or raw event
payloads. The bundle command rejects extra Kimi fields instead of silently
dropping them. The cost input is similarly closed to the fields documented by
`m4_cost_compare.py`; vendor names and mutable price-page URLs are not needed
to reproduce the arithmetic.

Then:

1. Compute each scrubbed file's hash with `shasum -a 256 FILE` (or
   `sha256sum FILE` on Linux).
2. Copy the fixture manifest to a private operator location and replace the
   input paths, hashes and stable dataset IDs.
3. Set bundle and dataset provenance to `live`, `source_type` to
   `scrubbed_live_export`, and keep `scrubbed_export: true`.
4. Set `tested_commit` to the full 40-character commit of the JHT runtime that
   produced the observations. This is the observed runtime commit, not
   necessarily the commit containing the manifest.
5. Run the command above and archive the manifest, scrubbed inputs and JSON
   output together in the approved private evidence store.

Never commit a live export just to make the bundle portable. Portability comes
from preserving the scrubbed files with their verified hashes, not from making
potentially sensitive telemetry public.

## Fail-closed classifications

The three accepted classifications are:

| Classification | Meaning | Can support a live conclusion? |
|---|---|---|
| `fixture` | Deliberately synthetic test data | No |
| `unclassified` | Scrubbed, but provenance is not attested | No |
| `live` | Operator-attested scrubbed live export | Only where each analyzer's own sufficiency checks pass |

Bundle and dataset classifications must match. A `live` manifest fails if an
input has a fixture/synthetic path or marker, or matches a known repository
fixture hash. Renaming or copying a repository fixture therefore does not turn
it into live evidence.

Even for `live`, the output says
`live_input_attested_not_independently_validated`: the command verifies
provenance consistency and reproducibility, not third-party authenticity.

## What remains external

Publishing a decision still requires the evidence listed in the
[M4 entry-tier protocol](../internal/experiments/2026-08-03-m4-entry-tier-evidence-protocol.md):
enough complete single-account windows, dated official price inputs, workload
tokens from the same representative run, measured subscription capacity, and
any applicable tax/currency treatment. No fixture can replace those inputs.
