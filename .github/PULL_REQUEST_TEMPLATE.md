## Description

<!-- What does this PR do? Why is it needed? Link the related issue if any. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Documentation
- [ ] Test
- [ ] CI/CD

## Size tier

- [ ] 🪶 Quick fix — typo, small doc, < 50 LOC (you can skip the Evidence section below)
- [ ] 🏗️ Substantial — feature, refactor, infra change, ≥ 50 LOC (please fill the Evidence section)

## Area of impact

- [ ] Team ops (agents, skills, prompts, coordination)
- [ ] Frontend (UI, UX, dashboard, web/)
- [ ] Infrastructure (CLI, container, cloud sync, launcher)
- [ ] Security
- [ ] Onboarding (DMG, wizard, setup flow)
- [ ] Documentation

## Evidence (substantial PRs only — show your work)

<!--
We love evidence. The clearer you show that your change makes things
better, the smoother the review. Attach what fits your area:

- Team ops: sim metrics, scoring, or run report before vs after
- Frontend: GIF / screenshot / short Loom before vs after
- Infrastructure: benchmark numbers, incident replay, or perf trace
- Security: describe what attack this prevents + how the mitigation works
- Onboarding: time-to-complete, or a short recording of a new user finishing setup
- Documentation: list of updated files + confirm no broken links

For quick fixes, "tests pass and the change is obvious from the diff" is enough.
-->

## Checklist

### Code
- [ ] Max ~200 lines per commit
- [ ] No sensitive files (PDF, DB, CSV, credentials, personal data)
- [ ] No leftover debug `console.log` / `print` statements

### Frontend (if applicable)
- [ ] Components verified in the browser
- [ ] No TypeScript errors (`npx tsc --noEmit` in `web/`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

### Backend / Shared (if applicable)
- [ ] Vitest tests added or updated
- [ ] `npm test` passes (in `tests/js/`)

### Security gates
- [ ] `pre-commit run --all-files` passes (detect-secrets, actionlint, zizmor, npm-audit-prod)

### Architecture
- [ ] Non-trivial design decision? An ADR was added in `docs/adr/` (see [CONTRIBUTING](CONTRIBUTING.md#non-trivial-decisions--write-an-adr))

### Git
- [ ] Branch rebased on `master` before opening the PR
- [ ] Commit messages follow `type(scope): description`
- [ ] No mega-commits (4+ unrelated files)

## How was this tested?

<!-- Describe how you verified the changes. For quick fixes, one line is enough. -->

## Screenshots (if frontend)

<!-- Add screenshots if the PR changes UI. Before / after appreciated. -->
