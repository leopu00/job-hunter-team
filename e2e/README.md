# 🧪 e2e — end-to-end tests (Playwright)

Browser-driven end-to-end tests for the Job Hunter Team **web** surface.

- **Package:** `e2e` · **Stack:** Playwright · TypeScript
- **Config:** [`playwright.config.ts`](playwright.config.ts) — `BASE_URL` (default `http://localhost:3000`), chromium only

## Layout

```
tests/             4 live specs — these run, in CI and locally
tests/quarantine/  75 specs kept for parts, excluded from every run
playwright.config.ts
```

## State of the suite (triaged 2026-07-26, counts checked 2026-07-30)

**What runs: 50 tests in 5 files** — `npx playwright test --list` is the source
of this number, not this paragraph:

| Spec                        | Tests | What it covers                                                                                                 |
| --------------------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| `39-og-twitter-image`       | 21    | social/PWA metadata: OG and Twitter images, icons, manifest                                                    |
| `80-welcome-wizard`         | 10    | `/welcome`, the new cloud user's first run                                                                     |
| `81-demo-mode`              | 6     | the protected area serving the demo dataset                                                                    |
| `82-support-report`         | 12    | reporting a problem: `/contact` and the dashboard dialog, including privacy, delivery and offline truthfulness |
| `83-recording-profile`      | 1     | private opt-in gate: real seeded account, no demo banner                                                       |
| `88-protected-positions`    | 3     | the protected area's positions: list content, detail content, a filter that actually filters                   |
| `89-protected-profile-team` | 5     | profile (data + cloud read-only), team activity, swipe deck, map reachable                                     |

They run on every push and PR (`.github/workflows/test.yml`, job `e2e`) against
`next start` in cloud mode with a real session.

**`88-` and `89-` (added 2026-08-08)** close part of what [JHT-E2E-STALE]
left open: the protected area was almost uncovered, because quarantining
removed the specs that _claimed_ to cover it. They are written against the
pages that ship today and assert on the **content** of the demo dataset
(`web/lib/demo/seeds/`, `web/lib/demo/profile.ts`) — a named position, a
named company, the candidate's name — precisely because that dataset is
versioned in the repo. «At least one row exists» is the assertion that let
seventy-five useless specs pass; a page answering 200 with its loading
skeleton would satisfy it.

Still open in that ticket: `/map` cannot be verified beyond reachability
(WebGL is absent in headless), and the 11 API routes exercised only by
quarantined specs remain without a caller.

⚠️ **These specs are meant to be able to fail.** Until 2026-07-30
`39-og-twitter-image` guarded all 21 of its tests with
`if (res.status() === 404) test.skip(...)`: deleting `web/app/opengraph-image.tsx`
produced six skipped tests labelled "not deployed yet", not a red run — the
quarantine defect, alive inside a promoted spec. Those guards now assert
`toBe(200)`. Every asset they reach for is in the repository, so a 404 is a
regression; if the job goes red because `next start` does not produce one of
them, that is the suite doing its job for the first time.

**What does not: the other 75 specs**, moved to [`tests/quarantine/`](tests/quarantine/README.md).
The 2026-07-25 measurement of the full suite — 770 passed · 574 skipped ·
0 failed — was the thing that hid the problem: the "passes" were largely specs
skipping themselves, and the file that says why is the quarantine README. In
short: the site map was rewritten under them (`/faq`, `/guide`, `/about`,
`/changelog`, `/demo`, `/stats`, `/applications`, `/jobs`… no longer exist), the
local plane they logged into was retired, `/api/health` changed shape, and a few
assert on `https://jobhunterteam.ai` rather than on the code.

The triage was static — every route in every spec matched against `web/app/` —
and no spec was condemned on the strength of a red run. Reviving one is a
documented path, not a rewrite: see the quarantine README.

Tracked in `BACKLOG.md` as **[JHT-E2E-STALE]**.

The rule for anything new: **skip loudly, and only on the environment**. What
can be tested anonymously runs on every execution; what needs a session, a
cloud deploy mode or a configured delivery channel skips with a message naming
that condition — `80-welcome-wizard.spec.ts` and `82-support-report.spec.ts`
are the models. A missing file, a 404 on a route the repo contains, a meta tag
`layout.tsx` declares: those are failures. "Not deployed yet" is not an
environment.

Two more rules, both of which the live specs have broken before:

- **No local `BASE` constant.** Use relative paths and let `use.baseURL` decide
  the target, in one place. A private `process.env.BASE_URL || <default>` makes
  the config inert, and every such default has been wrong at least once — one
  pointed at production, two at `127.0.0.1`.
- **No `networkidle`.** But do not just delete it: replace it with
  `domcontentloaded` plus an anchor on something that proves what the test needs
  is there — a retrying assertion, an `expect.poll` on a count, a button whose
  `aria-pressed` only flips after hydration.
  `82-support-report.spec.ts:88-100` is the model.

## How to run

The suite needs a reachable web server. **Cloud plane** — what production
actually is, and what CI runs:

```bash
cd web && JHT_HOME=/tmp/empty-jht NEXT_PUBLIC_JHT_DEPLOY=cloud npm run dev -- -p 3008
cd e2e && npm ci && BASE_URL=http://localhost:3008 npx playwright test
```

Anonymous: the demo API and the auth-closure tests pass; everything behind the
login skips. With a session (below): everything runs.

To review a quarantined spec — the only reason to run one:

```bash
E2E_INCLUDE_QUARANTINE=1 BASE_URL=http://localhost:3008 npx playwright test quarantine/27-pricing
```

There used to be a second recipe here, `local` deploy mode without
`NEXT_PUBLIC_JHT_DEPLOY=cloud`, in which the protected-area gate is off
(`isLocalDeploy()`) and every page renders. It is gone with the specs that
needed it: it renders the _local_ plane, which the product no longer ships, so a
green run there proved something nobody uses.

> 🚨 **Use `localhost`, never `127.0.0.1`, against `next dev`.** Next refuses the
> HMR WebSocket upgrade when the host is not `localhost`; the dev runtime then
> hangs reconnecting and **React never hydrates**. The pages render, every click
> does nothing, and your tests fail with messages that point everywhere except
> the cause. Measured on 2026-07-25: same server, same build — `localhost`
> advances the wizard, `127.0.0.1` does not. The config default was changed for
> this reason.

```bash
npm test                  # the 4 live specs
npm run test:quarantine   # the 75 retired ones, on purpose
npm run test:report       # open the HTML report
```

## Sessione

The protected area needs a real Supabase session. **It is already set up** — one
command regenerates it:

```bash
node e2e/scripts/refresh-auth-state.mjs
```

That script signs in as the dedicated test account with email+password against
`/auth/v1/token` and writes `auth-state.json` in the exact cookie format
`@supabase/ssr` expects (`base64-` prefix, chunked at 3180 bytes, for both
`localhost` and `127.0.0.1`). `playwright.config.ts` picks the file up
automatically and announces at startup whether the protected-area specs will
run. Sessions last an hour: when they expire, run it again.

**Why not the interactive OAuth login** (`playwright open --save-storage`), which
is the usual recipe: it does not work here, for two independent reasons.

1. Google refuses OAuth from automated browsers ("this browser may not be
   secure"), and Chrome for Testing is one of them.
2. The dev port is not in the project's allowed redirect URLs, so even past
   point 1 the return trip would fail.

An email+password account sidesteps both and survives unattended runs.

**Where the credentials live.** Outside the worktrees, in one place, so every
checkout finds them:

```
~/.config/jht/e2e-credentials      ← canonical, shared by dev1…dev8, master, …
```

The script looks in three places, in order:

| Order | Source                                          | For                                            |
| ----- | ----------------------------------------------- | ---------------------------------------------- |
| 1     | env `E2E_EMAIL` / `E2E_PASSWORD`                | CI, from the repository secrets                |
| 2     | `e2e/.auth-credentials` in the current worktree | overriding with a different account, just here |
| 3     | `~/.config/jht/e2e-credentials`                 | everyday use, every worktree                   |

Not `~/.jht/`: that directory is bind-mounted into the agents' container, and a
test secret has no business being under their nose. Both files are `chmod 600`,
the directory `700`.

**In this repo: nothing.** Not the address, not the password — a public
repository should not hand out half a credential.

The account owns no data: RLS isolates rows per `user_id` and this one has
none, so a compromise leaks nothing. `auth-state.json` is git-ignored as well:
**never commit it**, it carries a live session token.

**In CI** the same script runs inside `.github/workflows/test.yml` (job `e2e`).
The credentials file is written from the secrets, used, and deleted in an
`always()` step, so it survives neither the job nor an artifact. Missing
secrets fail the job loudly rather than letting the protected-area specs skip
in silence.

To rotate the password: change it on the account, then
`gh secret set E2E_PASSWORD --repo <repo>` and update
`~/.config/jht/e2e-credentials`. Never paste it into a terminal that echoes —
pipe it from stdin.

## What is covered elsewhere (and better)

Some things read like e2e material but are verified without a browser, where the
assertions are real rather than skipped:

| Area                                                           | Where                                            |
| -------------------------------------------------------------- | ------------------------------------------------ |
| Demo dataset contract (4 personas × 56 positions × 7 locales)  | `tests/js/tasks/demo-seeds.test.ts`              |
| Queries that feed the pages in demo mode                       | `tests/js/tasks/demo-queries.test.ts`            |
| Retractable verdict stored in the demo cookie                  | `tests/js/tasks/demo-feedback-cookie.test.ts`    |
| Public installers kept in sync with their mirror               | `tests/test_public_installers_sync.py`           |
| Native app: scene import, nav grid, terminal, pipeline, doctor | Godot self-tests in `.github/workflows/game.yml` |

## See also

- Web dashboard (the system under test): [`web/`](../web/)
- `BACKLOG.md` → **[JHT-E2E-STALE]** — the plan for this suite
- `docs/internal/2026-07-25-audit-doc-code-drift.md` — where these numbers come from
