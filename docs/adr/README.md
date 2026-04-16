# Architecture Decision Records

Short records of architecturally-significant decisions — what we chose, why, and what we rejected. One file per decision, numbered in order.

## Convention

- Filename: `NNNN-slug.md` (e.g. `0003-single-writer-team.md`)
- Status: `Proposed`, `Accepted`, `Deprecated`, or `Superseded by NNNN`
- Format: Context → Decision → Consequences → Alternatives considered
- Keep it short — an ADR is a record, not a design doc

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](./0001-colima-not-docker-desktop.md) | Use Colima (not Docker Desktop) for agent isolation on macOS | Accepted |
| [0002](./0002-three-supported-agent-clis.md) | Support exactly three agent CLIs: Claude Code, Codex, Kimi | Accepted |
| [0003](./0003-single-writer-team.md) | Team runs in one location at a time (VPS xor PC) | Accepted |

## When to add an ADR

Add one when a decision is:

- Hard to reverse (technology choice, data model, API contract)
- Non-obvious to a new contributor (would prompt "why are we doing it this way?")
- Load-bearing for the architecture (breaking it breaks other things)

Day-to-day implementation choices don't need an ADR — code + PR description is enough.
