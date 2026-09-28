# 🔌 The API team — product roles on pay-per-use API calls

Job Hunter Team's roles can run two ways:

- **The TUI team** — the default. Each role is an interactive agent CLI
  (Claude Code, Codex, Kimi) in its own `tmux` session inside the product
  container, on a flat-rate subscription. Its skills are the Python scripts
  in `shared/skills/` and `agents/_tools/`.
- **The API team** — the same roles, run headless by the Node.js runtime in
  [`agent-harness/runtime/`](../../agent-harness/runtime/), on metered API
  calls. Each run has a hard cap in dollars, and the team has one for the
  whole session.

The API team is the headless path of
[ADR-0012](../adr/0012-desktop-setup-matrix.md): an API key selects it, and
because API usage is metered, the flat-rate reasoning of
[ADR-0004](../adr/0004-subscription-only-no-api-keys.md) does not cover it.
Every limit on this page exists because of that.

> 🧪 **Status: in rehearsal.** The API team runs on a test VPS and is being
> held to the TUI team's behaviour with [parity rounds](PARITY-ROUND.md). The
> TUI team remains the product's supported path.

## 🧩 The pieces

On a VPS the API team is one podman pod and its host. Five pieces, each with one job and
the least it needs to do it:

| Piece | Where it lives | What it does | What it cannot do |
| --- | --- | --- | --- |
| **Role run** | `agent-harness/runtime` (`npm run role`) | Runs one role (`scout-1`, `capitano`…) for a number of turns under its own dollar cap | Open `jobs.db` or the team's channels; hold the provider key; start another container |
| **Hub** (`jht-hub`) | `src/hub/server.ts` (`npm run hub`) | Owns `jobs.db` and the channels; runs each role's database tools with that role's rights, on the pod's loopback | Start anything by itself: it writes orders, it does not run them |
| **Launcher** | `src/hub/launcher.ts`, inside the hub | Decides who may start, with which model, under which cap, and whether the session's money allows it | Run a container: its only output is an order file in the spool |
| **Executor** | the host (VPS configuration, not this repo) | The only side that can start a container. Re-checks each order on its own rules, runs it with an argument list and no shell, and writes back what happened and what it cost | Decide: an order the launcher did not write does not exist for it |
| **Key proxy** | the host (VPS configuration, not this repo) | Holds the provider key, forwards the roles' calls, logs every request with its cost, and enforces a cumulative ceiling and a model allowlist across all runs | — it is the last backstop: a run that got past everything else still stops here |

The key never enters a role's container. A role gets
`OPENAI_BASE_URL` pointing at the key proxy on the loopback and a placeholder
key: `bash` runs as the role's uid, so a key the process can read is a key
the model can print.

### How a session goes

1. The operator writes the **launcher configuration**
   (`JHT_LAUNCHER_CONFIG`): the session name, its money, the roles allowed,
   the base team and its order. A new `session` name starts the counts and
   the money over.
2. The host asks the hub to start the **base team**
   (`POST /v1/team/start`, with the host's own token, which no role has) —
   from the command line or from the START page of
   `run.sh monitor --dashboard`, which asks for confirmation first.
3. The launcher books the whole set against the session's money, and writes
   one order per member into the spool, each with its place (`seq`) and its
   wait.
4. The executor starts each member when its wait is over, as
   `run.sh live <role> <model> <cap_usd> …`: the order's `cap_usd` becomes
   the run's own dollar cap.
5. The **CAPITANO** coordinates whoever is up and may ask for extras with
   `spawn_agent`; the launcher answers yes or no with its reason, and a no
   is something the CAPITANO can read and ask again within.
6. When a run ends, the executor writes its `results/<spawn_id>.json` with
   the spend **as the key proxy's log shows it** — never the run's own
   figure — and the launcher gives back what the run did not spend.

The full contract of the launcher and the spool is in
[`agent-harness/runtime/docs/launcher.md`](../../agent-harness/runtime/docs/launcher.md);
the hub's endpoints and rights are in
[`docs/hub.md`](../../agent-harness/runtime/docs/hub.md).

### Base team and extras

| | Member of the base team (`kind: team`) | Extra spawned by the CAPITANO (`kind: spawn`) |
| --- | --- | --- |
| Started by | the host, once per session | the CAPITANO, with `spawn_agent` |
| Counts against `maxActive`, `maxSpawns`, `maxFailures` | no | yes |
| Outlives the CAPITANO | yes, it is a peer | no, it dies with its parent |
| Stopped by | its own stop file, `maxMinutes`, `STOP`, or the host's `team-stop` | `stop_agent`, `maxMinutes`, `STOP`, or its CAPITANO ending |

Only a CAPITANO has `spawn_agent`, `stop_agent` and `list_agents`, and the
hub answers 403 to any other token: the tree is one level deep. An instance
runs once, whoever started it, so an extra never doubles a member.

## 💰 What caps the spend

Four caps, from the smallest to the largest, each enforced by a different
piece. None of them relies on a role's prompt.

### 1. Per run — the role's own process

Set by `JHT_API_BUDGET_USD` (from the order's `cap_usd` on the VPS). A live
run without it, or with it at zero, does not start.

- **Before every model call** the runtime prices the call's worst case —
  the estimated input at full input price and again as a cache write, plus
  the full output allowance — and does not make the call if that does not fit in what is
  left. The run then ends with `budget_exhausted` (exit 1).
- **Web searches are billed and capped.** Each search costs its per-search
  fee (0.01 USD in the catalogue) plus its tokens, against the same budget.
  `JHT_API_MAX_WEB_SEARCHES` per run (default 8, `0` = none): once the count
  is reached no new search starts — one call can bill two, so a run may end
  one over. A search whose worst case would not fit in the budget is not
  sent either: the tool answers the model that searches are over, and the run goes
  on with what it has.

  > Until 28/09 the search fee never reached the cap: the runtime read the
  > search count from `result`, where the SDK hands a provider-run tool's
  > answer back as `output`, so every search counted as zero — and neither the
  > fee nor the count of 8 applied. On 27/09 a SCOUT capped at 0.25 USD spent
  > 0.469 on 28 searches. The fix reads `output`, and a test now goes through
  > the SDK's real OpenAI provider rather than through parts built by hand.
- **A token cap** of 400,000 tokens per run — input not served from the
  cache plus output — stops a run that loops cheaply (`token_limit_reached`).
- **A 429 is the provider's queue, not the run's end.** The call is tried
  up to four times in all, after a wait that doubles from 2.5 s, carries
  jitter and obeys `retry-after` — never more than 30 s at once, 45 s per
  call, or past the run's own time budget. A refused call bills nothing.
  Only 429s are retried.

A live run that cannot be priced (an unknown model with no price set),
capped (no budget) or recorded (no ledger) does not start. Every live run
that started appends **one line** to the spend ledger however it ends —
completed, failed or stopped — with its searches in the note
(`web_searches=N`).

### 2. Per start — the launcher's allowlist

Each role in the configuration has a `capUsd` (at most 5 USD) and a number of
instances (1–4). A `spawn_agent` whose `cap_usd` is above the role's is
**refused, never lowered**, so the CAPITANO learns the limit instead of
getting a smaller run than it asked for. The model must be in `models`, the
task within `taskChars`. The CAPITANO's own cap is `captainUsd`, and
`capitano` in the allowlist is a configuration the hub refuses to load.

### 3. Per session — the piggy bank

`sessionUsd` (at most 10 USD) bounds everything the session starts, the
CAPITANO included. The launcher splits the money into two figures, and says
both in every refusal for money and in `list_agents`:

- **spent** — what the runs that ended cost, as the key proxy measured them;
- **booked** — money held and not yet spent: the caps of the runs still
  going, the cap of a run that ended without a measured spend, and the part
  of the CAPITANO's reserve it has not used.

A start is accepted only if *spent + booked + its cap* stays within
`sessionUsd`. The CAPITANO's cap is reserved from the start of the session
and counted once; if it ends having spent more than that, the measured spend
counts — a fixed reserve does not hide real money. `spawnReserveUsd` is money
the base team may not take, so the CAPITANO can still start an extra.

> Why two figures: on 27/09 the launcher said «0.52 left» while the key proxy
> said «0.65». Both were right — the difference was the CAPITANO's unspent
> reserve, which one figure could not show.

Other session limits: `maxActive` extras at once, `maxSpawns` extras in all,
and a role whose extras failed `maxFailures` times is not spawned again.
`maxMinutes` travels in each order and the executor stops the run at it.
With the `STOP` file present nothing starts, and the executor stops what is
running.

### 4. Across sessions — the key proxy

The key proxy keeps its own running total against its own ceiling, and a
model allowlist, whatever the launcher decided. When a run reaches it the
proxy refuses the call. It is the backstop for a mistake in everything
above; a [parity round](PARITY-ROUND.md) refuses to start when the proxy's
room and the round's budget disagree.

### Staggered starts

The base team does not start in the same minute. With `staggerS` (default
30 s, lowered when the base team would not fit otherwise), the member in place *n* — counted in the configured order, instances
one by one — waits *n* × `staggerS`, plus its own `delay_s`. The executor
starts members by `seq`, their place, because orders written in the same
millisecond have no order of their own.

> Why: on 27/09 five members started within two seconds. That minute the key
> proxy passed about 940,000 tokens, twelve requests came back 429, and the
> CAPITANO died of it — on the account's rate limit, not on money.

The executor refuses an order that waits more than 300 s, so a `staggerS`
or a `delay_s` that would need one is refused when the configuration is
loaded; left out, the stagger is lowered to fit. `staggerS: 0` starts them
together.

## ⚖️ How it compares with the TUI team

An API role must behave like the TUI role of the same name. The goal is
*same instructions, same rows*; the differences below are the ones kept on
purpose, each pinned by a test so that it turns red if either side moves.

### What is the same

- **The prompt.** An API role reads `agents/<role>/` by the TUI launcher's
  own rules: the localized identity file, the skills in `skills.list` order
  plus the role's private `_skills/`, the `agents/_team/` baselines, the same
  locale cascade. The identity is sent first and unchanged, then a short
  note on where the `_tools` commands went, then an index of the skills.
- **The commands.** Each command a role uses — the team's wrappers and the
  Python skills — is either a native tool with the same arguments, the same
  output and the same exit code (`jht-tmux-send` becomes `send_message`,
  `jht-notify-user` becomes `notify_user`, `python3 …/db_insert.py`
  becomes `db_insert`), or refused with the reason and what to do instead.
  A role that tries a ported command in its shell is refused with the name
  of the tool that replaces it. The full
  table is in
  [`docs/parity.md`](../../agent-harness/runtime/docs/parity.md).
- **The rows.** For the roles that write `jobs.db`, the same commands on
  twin databases leave the same rows, compared column by column and with the
  parity metre:

| Role | Writes the same as its TUI twin |
| --- | --- |
| SCOUT | new positions; a duplicate refused on both sides |
| ANALISTA | the check, geocoding, company and highlights, the company's website, tickets touched and resolved, a role family promoted |
| SCORER | the score and the position's status |
| SCRITTORE | the application, the critic's rounds, the statuses up to ready |
| CAPITANO | the open-ticket queue and its assignments, merging role families |
| CLOSER | the answers it works out (`application_answers save`) |

On the API side the CRITICO, DOTTORE, SENTINELLA and MANTENITORE write
nothing in `jobs.db`, and the MENTOR and ASSISTENTE write only their messages
to the person (`pending_user_messages`): the rest of their output goes to
files, and the table below says where that differs from the TUI team.

### Differences kept on purpose

| Where | TUI team | API team | Why |
| --- | --- | --- | --- |
| **SCOUT** `scout_coord reset` | archives every scout's open assignments, dead scouts included | archives only the caller's own | one scout must not be able to close another's work; the cost is that the assignment of a scout that does not come back stays active and keeps its sources from the others |
| **SCRITTORE** `db_insert application` on an existing application | replaces the row, losing its PDF paths, the critic's rounds and verdict | refuses, keeps the row, and points to `db_update application` | the API side is the safe one: a replace wipes finished work |
| **SCORER** re-score | a re-score ticket closes with `db_insert score --action rescore` on a position already scored, whoever runs it | the same, but only on a rescore ticket assigned to the caller; any other `--action` is refused, and a plain score is written only on a `checked` position | a re-score is the person's request, and nothing else opens a position past the queue |
| **CLOSER** sending | sends applications, takes the daily slot, marks them `applied` | cannot send: no browser, no mail server, nothing leaves the box. It reads the queue the person authorised and saves answers | the only role that acts outward stays on the TUI side; `ask`, `essentials --ask` and `wake-idle-closer` are refused with the reason |
| **CAPITANO** writes | asks for a CV rework through `apply_gate`, wakes an idle CLOSER, may call `db_update` | `apply_gate` is read-only, no `wake-idle-closer`, `db_update` refused by policy | the CAPITANO coordinates; on the API side it writes only tickets and role families |
| **CRITICO** review | written by the CRITICO into the deliverables | written by the hub, with its own uid, on the SCRITTORE's or CRITICO's request | in-process the CRITICO runs with the SCRITTORE's rights, and the reviewed must not be able to rewrite its own review |

### Differences in how a role is held

These are not behaviour, they are the walls around it:

- **No database or channels in the role.** With a hub, a role's container
  mounts neither `jobs.db` nor the mailboxes; its database tools run in the
  hub with that role's rights, and who may message whom is checked there
  against the token, not against a name the model typed.
- **Seven roles have no shell**: ANALISTA, SCORER, CRITICO, CLOSER, MENTOR,
  SENTINELLA and SCOUT work through their tools only. Where a role keeps
  `bash`, it gets an allowlisted environment and runs under Seatbelt or
  bubblewrap when the box allows it. The permission modes (`auto`, `ask`,
  `read-only`) are a gate, not a sandbox: isolation is the container's job.
- **`web_fetch` is https only**, with every hop resolved and pinned to a
  public address, so a fetched URL cannot reach the pod's loopback — the
  key proxy included.
- **A rehearsal's database is not the team's.** The hub, and a live role
  without one, refuse a `jobs.db` holding rows a mock run wrote.

### Money

The TUI team runs on a flat-rate subscription: its limit is the provider's
usage window, watched by the SENTINELLA, which advises the CAPITANO to slow
down. The API team pays per call, so its limits are the
[four caps](#-what-caps-the-spend) above, enforced by the runtime, the
launcher and the key proxy rather than by a role's judgement. To compare
the two, a [parity round](PARITY-ROUND.md) runs them on the same seed and
reads what each one wrote, and at what cost.

## 🔗 See also

- [PARITY-ROUND](PARITY-ROUND.md) — how to run the two teams side by side
  and compare their databases.
- [`agent-harness/runtime/README.md`](../../agent-harness/runtime/README.md)
  — commands, configuration variables, and what the live runs cost.
- [`agent-harness/runtime/docs/parity.md`](../../agent-harness/runtime/docs/parity.md)
  — every Python skill and the native tool that replaces it.
- [`agent-harness/runtime/docs/launcher.md`](../../agent-harness/runtime/docs/launcher.md)
  and [`docs/hub.md`](../../agent-harness/runtime/docs/hub.md) — the
  launcher's and the hub's contracts.
