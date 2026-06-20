# 🧩 shared — shared core library

Cross-cutting logic shared across the CLI, TUI, agents, and monitoring stack.
This is the backbone of JHT: config/schema, the LLM provider layer, the
monitoring components, credentials, scheduling, and the agent runtime glue.

- **Package:** `jht-shared` · **Stack:** Node.js · TypeScript · Python *(monitoring + LLM + skills)*

## Notable areas

```
config/        shared config & Zod schemas (e.g. profile-schema.ts)
llm/ providers/  LLM provider abstraction (Anthropic · OpenAI · Moonshot/Kimi)
agents/        agent runtime glue
skills/        Python monitoring skills (Bridge / Sentinel)
rate-limiter/ scheduler/ cron/ queue/ retry/   pacing & scheduling
credentials/ secrets/ auth     AES-256 credentials, keyring
channels/ telegram/ notifications/ gateway/    user↔team channels
context-engine/ memory/ history/ sessions/     agent context & state
events/ monitoring/ analytics/ logger/         telemetry
migrations/ backup/ cache/ data/               persistence
i18n/ locales/ templates/                        localization & prompts
```

> 40+ subdirectories — the list above groups the main ones by concern.

## Notes

- Pure library: no entry script (`package.json` has no `start`).
- `web/` imports `shared/config/schema.ts` (depends on `zod`) → any environment
  that builds `web/` must install `shared/` (or root) deps.

## See also

- DB schema: [`agents/_manual/db-schema.md`](../agents/_manual/db-schema.md)
- Monitoring stack: [`docs/about/MONITORING.md`](../docs/about/MONITORING.md)
