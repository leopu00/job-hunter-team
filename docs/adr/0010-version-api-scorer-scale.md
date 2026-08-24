# ADR-0010: Version the API Scorer on a coherent 100-point scale

Status: Accepted

## Context

The persisted Scorer rubric has five component ceilings of 40, 25, 20, 10 and 15. They total 110, while the public total is constrained to 0–100 and is also
described as the exact component sum. Those rules cannot all hold at the top of
the scale. Existing scores belong to real users, so silently clamping,
normalizing or rewriting them would destroy their original meaning.

The experimental local Scorer already uses a coherent 100-point rubric:
stack 35, experience 25, remote/location 20, salary 10 and strategic fit 10.
It validates the exact sum before its separate legacy persistence adapter.

## Decision

New API Scorer proposals use the versioned scale `jht-100-v2`:

| Component           | Maximum |
| ------------------- | ------: |
| Stack match         |      35 |
| Experience fit      |      25 |
| Remote/location fit |      20 |
| Salary fit          |      10 |
| Strategic fit       |      10 |

The five ceilings total exactly 100. Explicit deductions may reduce the score;
`totalScore` must equal `max(0, component sum - deduction sum)`. The existing
40-point pipeline threshold remains unchanged.

The current persisted rubric is named `legacy-110-v1`. It remains readable and
unchanged. An API proposal carries its scale version and cannot be written to
the production score table until a separate adapter defines migration,
compatibility and rollback behavior. No automatic conversion between the two
scales is allowed.

Scoring also requires an explicit operator authorization envelope tied to the
exact source ID. A model proposal never grants its own handoff or persistence
authority.

## Consequences

- The isolated API Scorer can enforce an exact and explainable 0–100 contract.
- Historical scores are not changed or reinterpreted.
- Cross-scale analytics must group by scale version until a product migration
  is explicitly approved.
- A future production adapter must reject unversioned proposals and cannot infer
  permission to write from a successful model response.

## Alternatives considered

- **Clamp a 110-point sum to 100:** rejected because distinct top-end scores
  collapse to the same total.
- **Normalize 110 to 100:** rejected because it introduces hidden fractional
  weights and changes the meaning of every component.
- **Change the legacy columns immediately:** rejected because existing user data
  and UI comparisons need a separately reviewed migration and rollback plan.
