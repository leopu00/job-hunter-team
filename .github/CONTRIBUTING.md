# Contributing

Thanks for considering a contribution. Bug reports, feature ideas, documentation improvements, and code PRs are all welcome.

## Ways to help

- **Report bugs and ideas** — use the [Bug Report](ISSUE_TEMPLATE/bug_report.md) and [Feature Request](ISSUE_TEMPLATE/feature_request.md) templates
- **Improve docs** — PRs against `docs/`, the README, or the ADRs are always appreciated
- **Fix a bug / ship a feature** — follow the PR flow below
- **Share feedback from the app** — the in-app `/feedback` page is wired to a ticketing backend (see [`docs/guides/feedback-ticketing.md`](../docs/guides/feedback-ticketing.md))

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

Be decent. No harassment, no discrimination. Constructive disagreement is welcome — personal attacks are not.

## License

Contributions are licensed under MIT — see [`LICENSE`](../LICENSE).
