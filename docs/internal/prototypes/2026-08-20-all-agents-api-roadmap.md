# All-agent isolated API roadmap

Date: 2026-08-20; updated 2026-08-24
Branch: `api-agents`

## Objective

Give each Job Hunter Team role with an accepted, unambiguous contract an isolated
TypeScript API worker on the Vercel AI SDK pattern established by Scout. This phase proves contracts,
provider execution, accounting, guardrails and runnable synthetic canaries. It
does not connect the prototypes to product state or grant operational powers.

## Shared design

Every worker accepts a versioned, role-specific input and returns a structured
proposal. The shared runtime provides explicit model profiles, fixed provider
key names, structured-output capability checks, worst-case preflight budget
reservation, post-response usage/cost recording, timeout and output limits,
exclusive per-role locks and schema-validated sanitized audit events.

Vacancy text, user text and prior-agent output are untrusted evidence. No role
can interpret those fields as instructions. Live execution is fail-closed
unless the operator supplies the flag, explicit files, a positive USD cap,
current pricing and the matching provider key.

## Role matrix

| Role       | Initial API responsibility                                             | Synthetic run        | Production side effects                 |
| ---------- | ---------------------------------------------------------------------- | -------------------- | --------------------------------------- |
| Scout      | Discover and independently read public job evidence                    | Passed               | Isolated SQLite only in standalone mode |
| Analyst    | Check/exclude one Scout proposal and structure requirements            | Mock + OpenAI passed | None                                    |
| Scorer     | Score one authorized Scout → Analyst handoff on versioned `jht-100-v2` | Mock + OpenAI passed | None; no score/status writes            |
| Writer     | Draft a user-requested CV/letter from supplied evidence                | Passed               | None; no files                          |
| Critic     | Blind, one-shot, CV-only seven-section review                          | Passed               | None; no review files                   |
| Assistant  | Classify intake and propose profile/ticket routing                     | Passed               | None                                    |
| Mentor     | Give sparse aggregate career guidance                                  | Passed               | None                                    |
| Captain    | Propose bounded coordination decisions from a snapshot                 | Passed               | None; no agent commands                 |
| Sentinel   | Propose usage-based continue/throttle/stop orders                      | Passed               | None; no controls                       |
| Doctor     | Propose observe/diagnose/refresh interventions                         | Passed               | None; no session mutation               |
| Maintainer | Turn supplied checks into maintenance recommendations                  | Passed               | None; no repository edits               |

All fixtures are fictional and synthetic. Downstream demos use the mock model
but traverse the real CLI, worker, guard, provider-adapter, audit and output
validation layers. Paid provider canaries remain operator-controlled. On
2026-08-24 the live OpenAI `gpt-5.6-luna` Analyst → authorized handoff → Scorer
canary passed with two requests, 3,694 tokens and `$0.00185767` projected cost
inside a shared `$0.05` cap. No persistence event occurred. The configured
prices came from the official
[OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna);
billing reconciliation remains open.

## Promotion path

Promotion must happen role by role. For each role: add a least-privilege adapter
for the exact product read set, test hostile inputs and recovery, run a bounded
paid canary, reconcile usage with provider billing, and only then review a
separate side-effect adapter. Coordination, database writes, document writes,
session control and repository mutation must never be inferred from a model
proposal.

ADR-0010 resolves the API Scorer contract without changing historical scores:
the new `jht-100-v2` ceilings total exactly 100, while the persisted ruler stays
named `legacy-110-v1`. The Scout → Analyst → Scorer envelope now requires an
explicit operator authorization tied to the exact source ID; it remains
proposal-only and has no persistence adapter.

The next useful slice is provider-billing reconciliation for the completed
synthetic canary. After that, design an isolated proposal store and a separately
authorized production read adapter. A
production score/status writer remains a different decision and must include a
legacy-scale migration and rollback plan. Writer and all operational roles stay
proposal-only until their adapters have independent authorization and rollback
designs.
