# 🌐 web — dashboard (Next.js)

The Job Hunter Team web dashboard: positions, scoring, map/globe, team telemetry,
profile, and settings. Reads from Supabase (cloud) or the local SQLite DB. The
public cloud site is **read-only** (data only); team control, chat and config live
in the desktop app (`requireLocalWrite` → 403 from cloud).

- **Package:** `web` · **Stack:** Next.js 16 · React 19 · Tailwind CSS 4 · Supabase
- **Deploy:** Vercel ([`vercel.json`](vercel.json)) · also containerized ([`Dockerfile`](Dockerfile))

## Layout

```
app/
  (protected)/   authenticated app: dashboard, positions, map,
                 profile, settings, team/*, secrets, cron, onboarding
  api/           route handlers (cloud-sync, profile, i18n, …)
  case-studies/  public case studies
  page.tsx       landing
components/       shared UI components
lib/             queries, i18n, parsers, types
i18n/config.ts   supported locales + the `Locale` type; the translations
                 themselves live in per-area dictionaries (lib/*-i18n.ts)
                 and in per-component `T` maps, keyed off the NEXT_LOCALE
                 cookie via lib/use-locale.ts
middleware.ts    auth/routing middleware
```

## Run

```bash
npm run dev            # localhost only
npm run dev:host       # LAN-accessible (recommended for team use)
npm run build && npm start
```

> ⚠️ When the team container is running, prefer `scripts/dev-up.sh` over a bare
> `next dev` — it wires the dashboard to the containerized DB.

## See also

- Routing edge cases: [`docs/internal/architecture/2026-05-19-dashboard-routing-cases.md`](../docs/internal/architecture/2026-05-19-dashboard-routing-cases.md)
- Globe feature: [`docs/internal/architecture/2026-05-20-world-globe-feature.md`](../docs/internal/architecture/2026-05-20-world-globe-feature.md)
