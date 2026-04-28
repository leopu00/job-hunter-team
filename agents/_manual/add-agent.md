# 🛠️ Adding a new agent role

Contributor guide for introducing a **new type** of agent to the team (e.g. a Validator after the Critic, a domain-specialist Researcher, an outreach Agent).

> 🔁 **Scaling an existing role is not in scope here.** Adding a new instance of an existing role (e.g. `SCOUT-3` to widen Discovery) is **dynamic** — the Captain spawns it at runtime via `start-agent.sh`. No code change. Skip this file unless you're adding a new agent type.

## 1️⃣ Create the prompt directory

```
agents/<role>/
└── <role>.md      # the prompt; identity, rules, loop
```

Conventions:
- Lowercase folder name, ASCII (`maestro`, `validator`, `researcher`).
- Single prompt file `<role>.md` named after the folder.
- If the role needs runtime helpers, add them under `agents/<role>/skills/`.

## 2️⃣ Register the role in the launcher

Edit `.launcher/start-agent.sh` → `get_agent_info()` and add a case clause:

```bash
<role>) echo "<SESSION_PREFIX>|<effort>|<model_override>" ;;
```

- `SESSION_PREFIX` — uppercase tmux name (`VALIDATOR`, `RESEARCHER`)
- `effort` — `medium` or `high` depending on the tier (see step 3)
- `model_override` — empty for Opus default, `sonnet` for Sonnet

## 3️⃣ Pick a tier

Map the role to one of the four documented tiers:

| Tier | Effort | Model override | Use for |
|---|---|---|---|
| 🥇 very smart | high | (empty → Opus) | Critical, irreversible decisions |
| 🥈 expert | medium | (empty → Opus) | Pattern-matching against well-known templates |
| 🥉 smart | high | sonnet | Research, parsing, classification, user chat |
| 🎖️ medium | medium | sonnet | Light watchdog logic |

Document the tier in `agents/_team/architettura.md` § *How agents are tiered*.

## 4️⃣ Wire pipeline integration

- **DB schema** — does the role need new columns or a new status value? Review impact in [`db-schema.md`](db-schema.md). If yes, plan a migration.
- **Position in the pipeline** — what queue does it pull from? What does it write back? Either reuse `next-for-X` patterns or add a new one in `db_query.py`.
- **Communication** — which messages does it send/receive? See [`communication-rules.md`](communication-rules.md). Default to **DB-driven coordination** for pipeline handoffs; reserve tmux for real-time signals (`URG`, `FEEDBACK`).
- **Anti-collision** — if it's a pool (multiple instances), pick a lock strategy. See [`anti-collision.md`](anti-collision.md).

## 5️⃣ Update the related docs

- [`agents/_team/architettura.md`](../_team/architettura.md) — add to the tier table; if it changes the pipeline shape, add a new phase section
- [`agents/_manual/sessions.md`](sessions.md) — register the session naming (singleton vs pool vs dynamic)
- [`docs/adr/`](../../docs/adr/) — if the role introduces a load-bearing architectural decision (a new contract, a non-obvious tradeoff), file an ADR
- README role list (if user-facing visibility is desired)

## 6️⃣ Test

- Boot the team locally and verify the agent starts cleanly under all 3 providers (Claude · Codex · Kimi).
- Confirm idempotency: agent re-launch should not corrupt state.
- If multi-instance, validate the anti-collision contract end-to-end.
- Add a smoke test under `tests/js/` or `tests/` covering the role's main success path and one error path.

## 🔗 Related

- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — full team composition + tier mapping
- 💬 [`communication-rules.md`](communication-rules.md) — DB-driven defaults + tmux for real-time
- 🛡️ [`anti-collision.md`](anti-collision.md) — peer coordination patterns
- 🪟 [`sessions.md`](sessions.md) — session naming convention
- 🗄️ [`db-schema.md`](db-schema.md) — DB columns + CLI tooling
