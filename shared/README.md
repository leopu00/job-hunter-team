# 🧩 shared — shared core library

Code used by more than one surface: the CLI, the agents, the web build and the
container bootstrap. Mostly **Python skills** — the agents' hands — plus a thin
Node layer for paths, config schema and the cron store.

- **Package:** `jht-shared` · **Stack:** Python *(skills, i18n)* · Node.js · TypeScript

## What's here

```
skills/        74 Python skills: DB read/write, scouting, scoring, throttling,
               monitoring, sync, PDF, logos, LinkedIn liveness, tickets…
               This is the bulk of shared/ and the part that actually runs.
config/        Zod schemas for jht.config.json and the candidate profile.
               `schema.ts` is imported by web/; `profile-schema.ts` is the
               machine-verifiable half of the `profile-schema` agent skill.
cron/          Job store and schedule maths behind `jht cron`.
locales/       7 JSON catalogs, read by i18n.py, i18n.sh and cli/wizard/i18n.js.
credentials/   AES-256-GCM credential storage (TypeScript).
daemon/        install.sh / uninstall.sh — launchd & systemd unit templates.
runtime/       container.js — the CLI's docker-exec glue.
paths.js       Canonical JHT paths ($JHT_HOME and friends).
i18n.py i18n.sh   Same catalog, one helper per language.
```

## Notes

- Pure library: no entry script (`package.json` has no `start`).
- `web/` imports `shared/config/schema.ts` (which depends on `zod`) → any
  environment that builds `web/` must install `shared/` (or root) deps.
- **Two consumers cite files here as their spec rather than importing them**:
  `cli/wizard/setup-helpers.js` reimplements `config/io.ts` in plain JS, and
  `cli/src/commands/secrets.js` mirrors `credentials/crypto.ts`. If you change
  either original, change the replica too — nothing enforces it.

## History

This folder used to hold ~30 more subdirectories — an agent runtime, a gateway,
a plugin system, a queue, a rate limiter, a session store, a context engine and
so on — ported from OpenClaw in April 2026. On 2026-07-25 a reachability walk
from the real entry points (`cli/`, `web/`, `game/`, `scripts/`, Dockerfile)
showed **nine files** of `shared/`'s TypeScript were reachable at all; the rest
was scaffolding whose only callers were its own tests. It was removed. If you
need one of those modules, `git show d8fd3088:shared/<name>/` has it.

The lesson is worth keeping: a subdirectory with a test suite looks alive from
every angle except the one that matters — who imports it.

## See also

- DB schema: [`agents/_manual/db-schema.md`](../agents/_manual/db-schema.md)
- Monitoring stack: [`docs/about/MONITORING.md`](../docs/about/MONITORING.md)
