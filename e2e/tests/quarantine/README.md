# 🚧 quarantine — specs that no longer test the product

These 75 specs are **excluded from every run**, in CI and locally
(`playwright.config.ts` → `testIgnore`). They are kept, not deleted, because
several contain assertions worth reviving once the surface they describe exists
again.

To run them anyway, on purpose:

```bash
E2E_INCLUDE_QUARANTINE=1 npx playwright test quarantine/
```

## Why they were quarantined (triage of 2026-07-26)

The triage was **static**: every `goto()` / `request.get()` path in the 78 specs
was matched against the routes that exist today in `web/app/`, and the
assertions of the survivors were read against the current source. No spec was
quarantined on the strength of a red run.

Three specs survived and stay in `e2e/tests/`: `39-og-twitter-image`,
`80-welcome-wizard`, `81-demo-mode`.

| Group | Specs | Why |
|---|---|---|
| **Pages that no longer exist** — `/about`, `/faq`, `/guide`, `/changelog`, `/demo`, `/stats`, `/ready`, `/reports`, `/sessions`, `/applications`, `/jobs`, `/companies`, `/interviews`, `/crescita`, `/risposte`, top-level agent routes (`/scout`, `/analista`, … now under `/team/`) | 04, 08, 11, 12, 13, 17, 21–26, 28, 30–34, 36–38, 40–75 | The historical suite was written against a site map that has since been rewritten. Most of these assert `status === 200` **before** any skip guard, so they do not skip politely: they fail. |
| **Local plane retired** — need a seeded workspace via `_helpers/workspace.ts` | 02, 03, 06, 07, 10, 15 | They log into a `/tmp` workspace and expect seeded positions ("Frontend Engineer"). The product no longer ships the local dashboard, and CI has no such workspace. |
| **Content drifted under the spec** | 14, 16, 18, 19, 27 | The route still answers 200, but the page behind it is a different page. Examples: `/pricing` is now a comparison of **AI provider costs**, not Free/Pro/Enterprise plans (27); the landing lost its `#features` and "Come funziona" sections in the 2026-07-25 rewrite (18); `/setup` is the retired web wizard — onboarding moved into the game (16). |
| **Assertions tied to production, not to the code** | 19, 31-security-headers | They assert `BASE_URL` starts with `https://` or that the URL is `jobhunterteam.ai`. Against the CI server (`http://localhost:3011`) they fail by construction, whatever the code does. |
| **API contract drifted** | 29, 30, 35, 38, 62, and every spec asserting on `/api/health` | `/api/health` returns `{ ok, ts }`; these expect a `status` field and an `uptime`. `/api/changelog` was pruned and they expect "not 404". |
| **Dead on arrival** | 05, 09 | Google Sheets integration: every test in the file is already `skip`ped. |
| **Never had an auth story** | 01 | `01-auth.spec.ts` still carries its original `TODO: richiede storageState`, and its entry-mode assertions assume the anonymous view. CI now *has* a session, which makes them wrong in the other direction. |

## Reviving one

A spec leaves quarantine when it (1) points at a route that exists in
`web/app/`, (2) asserts something the current page actually renders, and
(3) either runs anonymously or **skips loudly** when the session is missing —
the pattern in `80-welcome-wizard.spec.ts`. Moving the file back into
`e2e/tests/` is the whole procedure — CI runs everything that is not in here,
there is no allow-list to update.

Do not revive a whole file to save two good tests: lift the two tests into a
new `8x-` spec and leave the rest here.
