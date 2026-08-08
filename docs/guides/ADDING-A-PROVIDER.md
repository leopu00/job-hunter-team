# Adding a provider without breaking the runtime contract

Job Hunter Team does not have an open-ended provider plugin API. [ADR-0002](../adr/0002-three-supported-agent-clis.md)
closes the supported runtime set to **Claude Code, Codex and Kimi**. This guide
is therefore both an implementation checklist and a gate: a fourth CLI starts
with a new ADR and field evidence, not with an enum edit.

## First decide what is actually changing

| Change | Required path |
|---|---|
| New model, plan or vendor alias for Claude/Codex/Kimi | Stay inside the existing runtime; update only the affected plan/model/alias seams and their tests. |
| Different credential product for an existing CLI | Extend credential handling. Do **not** add that credential name to `active_provider`. |
| A fourth executable agent CLI | Write a superseding ADR, prove config-file compatibility and long-running continuity, then follow the full checklist below. |

The distinction matters in current code:

- canonical active runtimes are `claude`, `openai` and `kimi`;
- `anthropic` and `codex` remain accepted legacy aliases at runtime boundaries;
- `chatgpt_pro` and `claude_max` identify credential products, not executable
  runtimes;
- `moonshot` is a compatibility alias in selected CLI/bridge paths, not a new
  runtime.

The executable mapping is `claude → claude`, `openai/codex → codex`, and
`kimi/moonshot → kimi`.

## Evidence gate for a fourth CLI

Before changing code, the ADR must record evidence for all of these:

1. The official CLI can load the per-agent Markdown contract without a custom
   prompt injector.
2. Authentication uses an officially supported subscription/login flow; API
   keys remain only a power-user escape hatch under [ADR-0004](../adr/0004-subscription-only-no-api-keys.md).
3. A multi-hour tmux session survives tool calls, context growth, restart and
   resume on Linux (the container runtime).
4. Usage/quota data has a stable, legal source and an explicit reset boundary.
5. A real run demonstrates that its quota can be paced. A synthetic fixture is
   useful for parser tests but is not field evidence.

If any item is missing, stop at an experiment or issue. Do not advertise the
provider as supported.

## Implementation seams

Work through these in order. Each row names the current source of truth for
that concern; searching for the old three-name tuple afterward is still part
of the review.

| Concern | Current seams | Required proof |
|---|---|---|
| ADR and public support claim | `docs/adr/0002-three-supported-agent-clis.md`, `docs/about/PROVIDERS.md`, roadmap | Accepted ADR plus links to field evidence |
| Config types and validation | `shared/config/types.ts`, `shared/config/schema.ts`, `cli/wizard/setup-helpers.js` | Valid and invalid config tests; aliases cannot become a fourth canonical ID |
| Active runtime vs credentials | `web/lib/providers.ts`, `shared/credentials/types.ts` | `web/lib/providers.test.ts`; credential-product IDs are not active runtimes |
| Setup UX | `cli/wizard/setup-helpers.js`, `cli/wizard/setup-noninteractive.js`, native setup UI | Fresh setup writes a config the launcher accepts |
| Install/update/model pin | `cli/src/commands/providers.js`, `cli/src/commands/model-pin.js`, container image | Install and update are idempotent; model changes require a successful probe |
| CLI version the release installs | `shared/config/provider-versions.json`, `shared/runtime/provider-pins.js` | The new provider has a pinned version with `pinned_at` and a `note`; nothing in the install path uses a mutable tag (`tests/js/tasks/provider-version-pin.test.ts`) |
| Process launch and recovery | `.launcher/start-agent.sh`, `.launcher/agent-watchdog.sh` | Correct binary, auth environment, health marker and zombie detection |
| Usage and pacing | `.launcher/sentinel-bridge.py`, `shared/skills/usage_record.py`, `shared/skills/provider_capacity.py`, `shared/skills/plan_registry.py` | Parser fixture plus real quota export across complete reset windows |
| Operator smoke | `scripts/test-providers.sh` | Login, one real turn, restart/resume and usage readback |

Do not implement only the picker and launcher. A provider that can start but
cannot be measured or recovered is not supported.

## Drift checks

Run the narrow checks while iterating:

```bash
pytest -q tests/test_first_run_plan.py tests/test_check_usage.py tests/test_m4_entry_tiers.py
cd tests/js && npm test -- ../../web/lib/providers.test.ts
```

Then run the provider-specific model-pin/autoupdate tests and the repository's
normal CI before merge. The static contract test intentionally keeps exactly
three canonical runtime names; changing it is evidence that the ADR gate is in
scope, not a test to “fix” casually.

Finally search for provider dispatch that cannot import the shared TypeScript
list (shell and Python are expected duplication boundaries):

```bash
rg -n "claude|anthropic|openai|codex|kimi|moonshot" \
  .launcher cli shared web game scripts tests
```

Review each changed boundary for aliases, credential location, executable,
quota reset semantics, update command and failure behavior. Record live
evidence separately; never commit credentials, provider session logs or user
data.
