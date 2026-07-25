# 🧪 e2e — end-to-end tests (Playwright)

Browser-driven end-to-end tests for the Job Hunter Team **web** surface.

- **Package:** `e2e` · **Stack:** Playwright · TypeScript
- **Config:** [`playwright.config.ts`](playwright.config.ts) — `BASE_URL` (default `http://127.0.0.1:3000`), chromium only

> ⚠️ **Read "State of the suite" before trusting a green run.** The suite exits 0
> while skipping a large share of its tests, and the reason matters.

## Layout

```
tests/           Playwright specs (78 files, numbered by flow)
playwright.config.ts
```

## State of the suite (measured 2026-07-25)

Full run against a local server: **770 passed · 574 skipped · 0 failed** (6.9 min).
The skips are not flakiness — they are the specs skipping *themselves*:

| Cause | What it looks like |
|---|---|
| **No authenticated session** | Most specs touch the protected area (`/dashboard`, `/positions`, `/profile`, `/team/*`). On a cloud deployment that area redirects anonymous visitors to the login, so the spec skips. `01-auth.spec.ts` has carried a `TODO: test con sessione autenticata — richiede storageState` since it was written: **the suite never had an auth story.** |
| **Surface that no longer exists** | Specs written for the retired local dashboard, `/onboarding` (removed from the web on 2026-07-18) and API routes pruned on 2026-07-25. |
| **Data-dependent assertions** | Specs that need positions/applications in the database; against an empty `JHT_HOME` there is nothing to assert. |

Consequence: a green run proves the **public** pages work — landing, docs, `/demo`,
`/download`, security headers, a11y, sitemap — and says almost nothing about the
protected area. Tracked in `BACKLOG.md` as **[JHT-E2E-STALE]**.

New specs (`80-welcome-wizard`, `81-demo-mode`) follow a rule worth extending to
the rest: **skip loudly**. What can be tested anonymously runs on every
execution; what needs a session skips with a message that says so.

## How to run

The suite needs a reachable web server. Two useful configurations:

**A · Public pages + local plane** (what the historical specs were written for):

```bash
cd web && JHT_HOME=/tmp/empty-jht npm run dev -- -p 3007
cd e2e && npm ci && BASE_URL=http://127.0.0.1:3007 npx playwright test
```

In `local` deploy mode the protected-area auth gate is off (`isLocalDeploy()`),
so pages render — but they render the *local* plane, which the product no longer
ships. Useful to exercise rendering, misleading as a production signal.

**B · Cloud plane** (what production actually is):

```bash
cd web && JHT_HOME=/tmp/empty-jht NEXT_PUBLIC_JHT_DEPLOY=cloud npm run dev -- -p 3008
cd e2e && BASE_URL=http://127.0.0.1:3008 npx playwright test 80-welcome 81-demo
```

Anonymous: the demo API and the auth-closure tests pass; everything behind the
login skips.

```bash
npm test             # full suite
npm run test:smoke   # smoke only
npm run test:report  # open the HTML report
```

## Sessione

To unskip the protected-area specs you need a real Supabase session:

1. Create a **dedicated test account** on the Supabase project (never a personal
   one: these specs write feedback and toggle demo state).
2. Log in once by hand and save the storage state:
   ```bash
   npx playwright open --save-storage=auth-state.json http://127.0.0.1:3008
   ```
3. Point the config at it — `use: { storageState: 'auth-state.json' }` — or pass
   it per-project. `auth-state.json` is git-ignored: **never commit it**, it
   carries a live session token.

Not wired into CI on purpose: it needs a secret and an account decision that
belongs to the maintainer. Until then, treat the suite as a public-surface check.

## What is covered elsewhere (and better)

Some things read like e2e material but are verified without a browser, where the
assertions are real rather than skipped:

| Area | Where |
|---|---|
| Demo dataset contract (4 personas × 56 positions × 7 locales) | `tests/js/tasks/demo-seeds.test.ts` |
| Queries that feed the pages in demo mode | `tests/js/tasks/demo-queries.test.ts` |
| Retractable verdict stored in the demo cookie | `tests/js/tasks/demo-feedback-cookie.test.ts` |
| Public installers kept in sync with their mirror | `tests/test_public_installers_sync.py` |
| Native app: scene import, nav grid, terminal, pipeline, doctor | Godot self-tests in `.github/workflows/game.yml` |

## See also

- Web dashboard (the system under test): [`web/`](../web/)
- `BACKLOG.md` → **[JHT-E2E-STALE]** — the plan for this suite
- `docs/internal/2026-07-25-audit-doc-code-drift.md` — where these numbers come from
