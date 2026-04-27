# 0003 — Team runs in one location at a time (VPS xor PC)

**Status:** Accepted
**Date:** 2026-04-16

## Context

The JHT infrastructure offers two deployment modes (see [INFRA.md](../internal/INFRA.md)):

- **Local** — the container runs on the user's PC
- **Cloud** — the container runs on a remote VPS

Both branches share the same data model (SQLite locally, Supabase + Google Drive in the cloud). A natural question is: can both run **at the same time**? For example, local for experimentation while the cloud team keeps discovering jobs.

## Decision

The team runs in **exactly one location** at any given moment. The Local/Cloud choice is **exclusive** (xor), not additive. Two teams may never be active in parallel against the same user's data.

The bidirectional sync between local storage and Cloud Storage (Supabase + Google Drive) exists for **data backup and remote access only** — not for concurrent execution.

## Consequences

- ✅ Single-writer model — no need for distributed locks, leader election, or conflict resolution between agent teams
- ✅ State transitions (e.g. position status moves) are linearizable against a single clock
- ✅ The storage layer can stay simple (SQLite locally, Supabase with standard RLS in the cloud)
- ⚠️ Starting the team in one location while the other is already running will corrupt shared state — the launcher / CLI must detect and refuse this
- ⚠️ True HA / multi-region deployments are out of scope for now; revisiting requires a new ADR

## Alternatives considered

- **Active/active** — rejected. Every shared table (positions, applications, scores) would need distributed conflict resolution. The cost-benefit doesn't justify it for a single-user tool.
- **Active/passive with automatic failover** — rejected for now. Possible in the future but requires leader election; not in scope.
- **Fully decentralized, offline-first with CRDTs** — rejected. Interesting but over-engineered for the current target audience.
