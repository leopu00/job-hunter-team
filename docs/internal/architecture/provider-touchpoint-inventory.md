# Provider-specific touchpoint inventory

This is the human-readable view of the machine-checked manifest at
`shared/config/provider-touchpoints.json`. The manifest records a path and one
or more stable source anchors for every row;
`tests/test_provider_touchpoint_inventory.py` fails when a path disappears, an
anchor drifts, an ID is duplicated, or the canonical provider enum accidentally
grows a `local-scorer` entry.

Snapshot reviewed for the M5 one-role spike on 2026-08-03.

| Concern | Source of truth | Why it is provider-specific |
|---|---|---|
| Config schema and types | `shared/config/schema.ts`, `shared/config/types.ts` | Canonical team enum, auth shape, and role-scoped override |
| Setup catalog | `cli/wizard/setup-helpers.js` | User-selectable provider list and config validation |
| Provider CLI | `cli/src/commands/providers.js` | List/select/install/update/model-pin behavior |
| Agent launch | `.launcher/start-agent.sh` | Maps provider to Claude/Codex/Kimi CLI; narrowly maps Scorer to the local worker |
| Local adapter | `shared/skills/local_scorer.py` | OpenAI-compatible transport, output contract, DB boundary |
| Health | `cli/src/commands/doctor.js` | Active-provider readiness checks |
| Usage ingest | `shared/skills/check_usage.py`, `shared/skills/usage_record.py` | Provider-specific collection and normalized samples |
| Capacity/pacing | `shared/skills/provider_capacity.py`, `shared/skills/plan_registry.py` | Provider aliases, plans, windows, and subscription semantics |
| Cloud UI/API | `web/lib/providers.ts`, `web/app/api/credentials/route.ts` | Display metadata and credential state |
| Container network | `docker-compose.yml` | Makes a host-local inference server reachable on Linux Docker Engine |

## Architectural boundary used by the spike

`active_provider` remains one of `claude`, `openai`, or `kimi` and continues to
control the whole interactive team. `team.local_scorer` is an opt-in override
read only at the Scorer launch boundary. This preserves the existing provider
abstraction rather than pretending that a local chat-completions endpoint can
already satisfy usage metering, OAuth, coordinator pacing, tool use, and every
agent role.

The executable seam is therefore:

```text
Scorer launch → local OpenAI-compatible adapter → validated JSON
              → shadow output (default)
              → existing db_insert/db_update skills (experimental write mode)
```

All other roles continue through the normal provider CLI launch path.

## Risks found during inventory

- The interactive Scorer rubric gives experience 0–25, while `db_insert.py`
  persists `experience_fit` in 0–10. The local adapter makes this conversion
  explicit and tests it; the broader prompt/DB drift remains outside this spike.
- Case-study JSON files contain historical score distributions, not the same
  positions independently rescored for the same candidate. They are calibration
  context, not a quality oracle.
- The interactive Scorer also verifies job liveness and applies feedback-derived
  multipliers. The spike does neither yet, so shadow is the default and write
  mode is labeled experimental.
- Local inference removes the LLM request from the cloud only for this role. It
  does not remove network use elsewhere in JHT.

## Keeping the inventory verifiable

When adding or moving a provider-specific seam, update both this explanation and
`shared/config/provider-touchpoints.json`. Prefer an anchor naming the actual
registry or dispatch function, not a comment. Run:

```bash
python3 -m pytest -q tests/test_provider_touchpoint_inventory.py
```

Passing this check proves that the declared touchpoints still exist. It does not
prove that an undiscovered touchpoint cannot exist; repository-wide audits must
still begin with a search for provider names, aliases, `active_provider`, auth,
usage, plan, and model-pin logic.
