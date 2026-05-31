# Contributing

Thanks for considering a contribution. Bug reports, feature ideas, documentation improvements, and code PRs are all welcome.

## Ways to help

- **Report bugs and ideas** — use the [Bug Report](ISSUE_TEMPLATE/bug_report.md) and [Feature Request](ISSUE_TEMPLATE/feature_request.md) templates
- **Improve docs** — PRs against `docs/`, the README, or the ADRs are always appreciated
- **Fix a bug / ship a feature** — follow the PR flow below
- **Share feedback from the app** — the in-app `/feedback` page is wired to a ticketing backend (see [`docs/guides/feedback-ticketing.md`](../docs/guides/feedback-ticketing.md))

## Triage and response time

While JHT is in beta we aim to apply a triage label (surface + severity) to every new issue within **48 hours**. We don't commit to a fix SLA in beta, but `severity:blocker` issues get a maintainer acknowledgement within **24 hours** even if the fix takes longer. The full workflow — labels, kanban columns, close reasons — lives in [`docs/internal/triage.md`](../docs/internal/triage.md). The canonical label set is [`/.github/labels.yml`](labels.yml).

## Setup

```bash
git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team

# Web dependencies
cd web && npm install && cd ..

# Test dependencies
cd tests/js && npm install && cd ../..

# Shared/cron dependencies
npm install --prefix shared/cron

# Pre-commit hooks (security gates: detect-secrets, actionlint, zizmor, npm-audit-prod)
pip install pre-commit
pre-commit install

# Configuration
jht setup
```

Full contributor setup (Node 20+, tmux, agent CLIs, TUI/CLI build from source) is in [`docs/guides/quickstart.md`](../docs/guides/quickstart.md#source-setup-for-contributors).

## Branches

- Branch off `master` with a descriptive name: `fix/description` or `feat/description`
- **Do not push directly to `master`**
- Open a Pull Request and wait for review

## What your PR should show

We love evidence. The clearer you show that your change makes things
better, the smoother the review — and the faster the merge.

**Small fixes go fast.** Typos, doc tweaks, and < 50 LOC fixes don't
need ceremony. Open the PR, mention what you changed, and we'll get it in.

**Substantial changes earn their merge with evidence.** When your PR
affects user-facing behavior, performance, or architecture, attach the
proof. The kind of proof depends on the area:

| Area | What helps us say yes |
|---|---|
| Team ops (skills, prompts, coordination) | metrics from a reproducible sim, before vs after |
| Frontend (UI, UX, dashboard) | screenshot or short video, before vs after |
| Infrastructure (CLI, container, cloud sync) | benchmark, incident replay, or perf trace |
| Security | what attack this prevents + how the mitigation works |
| Onboarding (DMG, wizard, setup) | time-to-complete metric, or a recording of a new user |
| Documentation | list of updated files + confirm no broken links |

Tests passing and a clean compile are the floor — that's the harness
saying nothing is broken. Showing the impact of your change is what
makes a PR memorable.

## Commits

Format: `type(scope): short description`

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Refactor with no new feature |
| `test` | Adding or changing tests |
| `ci` | CI / CD |
| `chore` | Maintenance tasks |

Rules:
- 1 commit = 1 logical unit of work
- Max ~200 lines per commit
- No sensitive data in commit messages
- Body explains **why**, not **what** — the diff already shows the what

## Pre-PR checklist

- [ ] `npx tsc --noEmit` passes (in `web/`)
- [ ] `npm run lint` passes (in `web/`)
- [ ] `npm run format:check` passes (from repo root)
- [ ] `npm test` passes (in `tests/js/`)
- [ ] `pre-commit run --all-files` passes (security hooks: secrets, actionlint, zizmor, npm-audit-prod)
- [ ] No sensitive files included (PDF, DB, credentials, personal data)
- [ ] Branch rebased on `master` before opening the PR

## Non-trivial decisions — write an ADR

If your change introduces a design decision that isn't obvious from the diff (new dependency, architectural tradeoff, invariant), drop a short Architecture Decision Record in [`docs/adr/`](../docs/adr/) alongside the code change. See the [ADR README](../docs/adr/README.md) for the format and when to add one.

Load-bearing invariants live in ADRs — breaking them breaks the rest of the system.

## Working on agents

Agents are the specialized pipeline workers (Scout, Analyst, Scorer, Writer, Critic, …). Two folders to know about:

- **[`agents/_team/`](../agents/_team/)** — team-wide overview (composition, pipeline, who-does-what). Start here to understand how the whole team fits together.
- **[`agents/_manual/`](../agents/_manual/)** — operational reference docs that individual agents consult at runtime (DB schema, anti-collision contract, communication protocol, tmux sessions). If you're adding a new agent, the existing prompts under `agents/<role>/<role>.md` plus the `_manual/` references give you the contracts to respect (anti-collision, DB schema, communication envelope) — no separate guide needed.

Note: the set of **supported agent CLIs** (Claude Code, Codex, Kimi) is closed by [ADR 0002](../docs/adr/0002-three-supported-agent-clis.md). Adding a fourth CLI requires a new ADR, not just a PR.

## Cutting a release (maintainers)

Releases are published by pushing a `vX.Y.Z` tag to `master`. Bump both
the root `package.json` and `desktop/package.json` before tagging —
electron-builder names artifacts after the desktop version, so forgetting
it ships assets labeled with the previous release number. The full
checklist (including the version-consistency gate and the Windows x64 /
ARM64 split) lives in [`docs/internal/release.md`](../docs/internal/release.md).

## Code of conduct

This project follows the [Contributor Covenant 2.1](../CODE_OF_CONDUCT.md). By participating you agree to uphold it. Report unacceptable behavior to `info@jobhunterteam.ai`.

## License

Contributions are licensed under MIT — see [`LICENSE`](../LICENSE).
