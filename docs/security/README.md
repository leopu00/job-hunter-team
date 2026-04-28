# 🔒 Security documentation — JHT

This folder gathers the security analysis of the repo and the pre-open-source hardening plan.

## Index

| File | Purpose |
|---|---|
| [`01-pre-launch-review.md`](01-pre-launch-review.md) | Full pre-launch audit: 27 findings (5 critical / 9 high / 8 medium / 5 low), tooling used, remediation priorities |
| [`02-openclaw-comparison.md`](02-openclaw-comparison.md) | Systematic comparison with OpenClaw: how a mature agentic project tackles the same problems, file by file |
| [`03-implementation-tradeoffs.md`](03-implementation-tradeoffs.md) | Trade-off of every proposed fix: dev cost, UX impact, perf, lost functionality, recommendation |
| [`04-threat-model.md`](04-threat-model.md) | Explicit JHT threat model: what's in scope, what isn't, deployment assumptions, trust decisions |
| [`05-checklist.md`](05-checklist.md) | Actionable checklist of fixes to implement. `[x]` flipped when the commit lands on `master` |
| [`06-post-fix-comparison.md`](06-post-fix-comparison.md) | Post-fix comparison with OpenClaw: gap closed from -78 to -25, security score 30% → 74%, 12-area breakdown |

## How to read it

1. Start from `01-pre-launch-review.md` → the list of problems.
2. Move to `02-openclaw-comparison.md` to see **how they're solved in practice**.
3. Read `03-implementation-tradeoffs.md` to decide **which to fix now** and which to defer.
4. `04-threat-model.md` is the document to publish as `SECURITY.md` at the repo root when going open source — it heads off half the false-positives before they arrive.
5. `05-checklist.md` is the fix-by-fix execution status (commit SHA closing each item).
6. `06-post-fix-comparison.md` closes the loop: what changed vs OpenClaw after the sprint.

## Status

- **Initial audit:** 2026-04-27 11:00 on branch `dev-1` @ `65f2ec4a` — 27 findings.
- **Implementation sprint:** 2026-04-27 14:54–16:55 — 4 Claude agents in parallel (worktrees `dev-1`..`dev-4`), 31/34 tasks closed (91%) in ~95 min.
- **Merge into `master`:** SHA `7a2cb6ae` (2026-04-27 21:18).
- **Post-fix comparison:** [`06-post-fix-comparison.md`](06-post-fix-comparison.md) — gap closed from -78 to -25 points.
- **Initial tooling:** gitleaks 8.30.1, `npm audit`, pip-audit, sub-agent code review.
- **New tools integrated:** detect-secrets, actionlint, zizmor, npm-audit-prod, Dependabot Docker.

## Phase status (audit findings, 34 original tasks)

| Phase | Status | Detail |
|---|---|---|
| **Phase 1** (pre-launch blockers) | ✅ 9/9 | C1-C5, H1, H2, H8, H9 |
| **Phase 2** (within 2 weeks post-launch) | ✅ 12/12 | H3-H6, M1-M8 |
| **Phase 3** (ongoing hardening) | 🟡 10/13 | missing: L1 (CSP prod), `tests/security/`, `jht doctor security` |

## Critical gaps remaining before public release

3 tasks. Only `L1` overlaps with the Phase 3 list above: **SSRF** and **resolve-system-bin** are **non-audit gaps** (surfaced from the OpenClaw comparison, not from the 27 original findings) — tracked as a separate section in [`05-checklist.md`](05-checklist.md).

1. 🔴 **Generic SSRF dispatcher** — `shared/net/ssrf.ts` missing (~1 day effort)
2. 🟡 **`resolve-system-bin` strict** — anti-PATH-hijacking wrapper (~4 h)
3. 🟡 **Hash-based CSP in prod** (L1) — manual Next.js work (~4 h)
