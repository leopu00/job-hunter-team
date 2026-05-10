## Description

<!-- What does this PR do? Why is it needed? -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Documentation
- [ ] Test
- [ ] CI/CD

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

<!-- Describe how you verified the changes -->

## Screenshots (if frontend)

<!-- Add screenshots if the PR changes UI -->
