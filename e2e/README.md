# 🧪 e2e — end-to-end tests (Playwright)

Browser-driven end-to-end tests for the Job Hunter Team web dashboard.

- **Package:** `e2e` · **Stack:** Playwright · TypeScript
- **Config:** [`playwright.config.ts`](playwright.config.ts)

## Layout

```
tests/           Playwright specs
playwright.config.ts
```

## Run

```bash
npm test             # full suite
npm run test:smoke   # smoke tests
npm run test:auth    # auth flows
npm run test:report  # open the HTML report
```

> Requires the web dashboard reachable (see [`web/`](../web/) — `npm run dev:host`).

## See also

- Web dashboard (the system under test): [`web/`](../web/)
