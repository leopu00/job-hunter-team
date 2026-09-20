# The CAPITANO's launcher

SICUREZZA-HARNESS §9, accepted by the MASTER as the launcher's
specification. The CAPITANO **asks**, the launcher **decides**: every limit
below is in the hub or on the host, in files the CAPITANO cannot touch. Its
prompt may repeat them; nothing relies on the prompt.

Two halves:
- **the hub** (`src/hub/launcher.ts`) decides: who may ask, what, how many,
  how much. It writes an accepted spawn as an order in the spool;
- **the host's executor** (`run.sh executor`, VPS) is the only side that can
  start a container. It checks each order again, runs it with an argument
  list and no shell, and writes back what happened and what it cost.

## The CAPITANO's tools

With a hub, and only for a `capitano` agent: `spawn_agent {role, instance?,
cap_usd, model, task}`, `stop_agent {spawn_id}`, `list_agents {}`. A child
never has them, and the hub answers 403 to any token that is not a
CAPITANO's: the tree is one level deep. A refusal comes back with its reason,
so the CAPITANO can ask again within the limits: a cap above the role's is
refused, never lowered.

## The base set: `run-team` (T24)

The product's launcher starts the base team and the CAPITANO coordinates
whoever it finds up; `spawn_agent` is for the extras. Here the same thing:
`run.sh run-team` on the host asks the hub on `POST /v1/team/start` with the
**host's own token** (`JHT_HUB_TEAM_TOKEN`, a file of its own, no role has
it: a role's token gets 403, and the host's token is not an agent and can do
nothing else). The hub books the whole set against the one piggy bank,
applies §9, and writes one order per member in the configured order.

A member is a **peer, not a child**:
- it does not spend the CAPITANO's `maxActive`, `maxSpawns` or `maxFailures`;
- it holds its instance, so no child of the CAPITANO can double it;
- `kind` in its order is `team`, so the executor lets it outlive the
  CAPITANO; a child (`kind: "spawn"`) still dies with it;
- it is not the CAPITANO's to stop: `stop_agent` refuses a member, which the
  host stops with `run.sh team-stop`.
The team starts once per session: while a member is up, another
`/v1/team/start` is refused with the members' names.

## Configuration (`JHT_LAUNCHER_CONFIG`, set by the operator)

```json
{
  "session": "2026-09-20-a",
  "sessionUsd": 0.6,
  "captainUsd": 0.3,
  "roles": { "scout": { "capUsd": 0.4, "instances": 2 }, "analista": { "capUsd": 0.4, "instances": 1 }, "scorer": { "capUsd": 0.4, "instances": 1 } },
  "maxActive": 3,
  "maxSpawns": 6,
  "maxFailures": 3,
  "maxMinutes": 30,
  "models": ["gpt-5.6-luna", "gpt-5-mini"],
  "taskChars": 2000,
  "spawnReserveUsd": 0.4,
  "team": [
    { "role": "scout", "instances": 2 },
    { "role": "analista", "instances": 1 },
    { "role": "scorer", "instances": 1 },
    { "role": "capitano", "instances": 1, "delay_s": 5, "task": "Start your cycle." }
  ]
}
```

- `roles` is the allowlist; `capitano` in it and the hub does not start.
- The piggy bank: `captainUsd` + the caps of the children running + what the
  ended ones spent, as the executor measured it, must stay within
  `sessionUsd`. A child that ended with no measured spend stays at its cap.
- A new `session` starts the counts and the piggy bank over: the launcher
  ignores a state file left by another session, whatever shape an older
  version wrote it in. Changing `session` is how the operator starts a run
  over; the file of the session in progress is never ignored, and if it
  cannot be read nothing starts (L-1).
- A role that failed `maxFailures` times in the session is not started again.
- `team` is the base set and its start order; each entry takes `instances`,
  and optionally `cap_usd` (default: the role's cap; the CAPITANO's is
  `captainUsd`), `model` (default: the first allowed), `task` (default
  `Start your cycle.`) and `delay_s`, the stagger the executor waits.
- `spawnReserveUsd` is money `run-team` may not take: the set is refused down
  to it, so the CAPITANO can still spawn an extra. The answer says plainly
  when no room is left for one, by money or by instances.
- The CAPITANO's cap is reserved from the start of the session and counted
  once: its own team order spends that reserve instead of adding to it. If it
  ends having spent more than the reserve, the measured spend is what counts:
  a fixed reserve does not hide real money.
- With the `STOP` file present (`JHT_LAUNCHER_STOP`, read-only in the hub),
  nothing starts.

## The spool (`JHT_LAUNCHER_SPOOL`, shared with the executor)

**`requests/<spawn_id>.json`** — written by the hub only (atomic rename,
0640), one per accepted spawn:

```json
{ "spawn_id": "3f9a0c1d2e4b5a67", "session": "2026-09-20-a", "kind": "spawn", "role": "scorer",
  "agent": "scorer-1", "model": "gpt-5-mini", "cap_usd": 0.2, "max_minutes": 30,
  "task": "Score the queue.\nOne at a time." }
```

`spawn_id` is 16 lowercase hex characters. `agent` is `<role>-<n>`. `task`
is text of at most `taskChars` characters; it may hold anything, newlines
included, and is only ever data. `kind` is `spawn` for a child of the
CAPITANO and `team` for a member of the base set; `delay_s` appears only
when the member asks to be staggered. A member also carries `seq`, 0 upward
in the configured order, and **that** is the order it starts in: orders
written in the same millisecond have no order of their own, by date or by
name. A child has no `seq`; there is only ever one to start.

**`stops/<spawn_id>`** — an empty file: the CAPITANO asked to stop that child.

**`results/<spawn_id>.json`** — written by the executor, replaced as the
child's state changes:

```json
{ "spawn_id": "3f9a0c1d2e4b5a67", "state": "done", "exit_code": 0, "spent_usd": 0.061 }
```

The hub takes results in whenever a call arrives, and every few seconds on
its own besides: in the live run of 20/09 three children ended after the
CAPITANO's last call, and without the sweep their bookings would have stayed
held for the rest of the session.

`state` is `running` (started), then one of `done` (exit 0), `failed` (any
other exit, or refused by the executor), `stopped` (by a stop file, the time
limit, `STOP`, or its CAPITANO ending). `spent_usd` is the spend the key
proxy's log shows for the run, as `ledger_line` sums it, never the child's
own figure. No other field is accepted; a malformed result is ignored.

## What the executor does (VPS)

1. Checks each order again, on its own rules: `spawn_id` format, `role` in
   `ROLE_UID` and not `capitano`, `agent` = `<role>-<n>` with a uid, `model`
   in the key proxy's allowlist, `cap_usd` a number within the role's cap,
   `task` valid UTF-8 without control bytes but `\n`. Anything else:
   `failed`, and the order is not run.
2. Starts nothing while `STOP` exists; with `STOP` present, stops the
   children running. An order whose `stops/<spawn_id>` already exists is
   not started: `stopped`, with no spend.
3. Writes the task into the child's private base
   (`roles/<id>/base/task/<spawn_id>.md`, 0600, the child's uid) and runs
   `run.sh live <role> <model> <cap_usd> --agent <agent> --task-file …`
   as an argument list.
4. Stops a child (`kind: "spawn"`) at `max_minutes`, on `stops/<spawn_id>`,
   or when the CAPITANO that started it ends: no child outlives its parent.
   A member of the team (`kind: "team"`) is a peer: it ends only on its own
   `stops/<spawn_id>`, `max_minutes`, `STOP`, or `run.sh team-stop`.
5. Writes `results/<spawn_id>.json` when the child starts and when it ends,
   and a line in its host log for every order, refusal and end.

`tests/launcher.test.ts` covers the hub's half: the allowlist, the models,
the caps, the number at once and per role, spawns and failures per session,
the piggy bank with the spend given back, `STOP`, stops of one's own
children only, the log, and the 403 to any token that is not a CAPITANO's.
