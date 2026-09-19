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
  "taskChars": 2000
}
```

- `roles` is the allowlist; `capitano` in it and the hub does not start.
- The piggy bank: `captainUsd` + the caps of the children running + what the
  ended ones spent, as the executor measured it, must stay within
  `sessionUsd`. A child that ended with no measured spend stays at its cap.
- A new `session` starts the counts and the piggy bank over.
- A role that failed `maxFailures` times in the session is not started again.
- With the `STOP` file present (`JHT_LAUNCHER_STOP`, read-only in the hub),
  nothing starts.

## The spool (`JHT_LAUNCHER_SPOOL`, shared with the executor)

**`requests/<spawn_id>.json`** — written by the hub only (atomic rename,
0640), one per accepted spawn:

```json
{ "spawn_id": "3f9a0c1d2e4b5a67", "session": "2026-09-20-a", "role": "scorer", "agent": "scorer-1",
  "model": "gpt-5-mini", "cap_usd": 0.2, "max_minutes": 30, "task": "Score the queue.\nOne at a time." }
```

`spawn_id` is 16 lowercase hex characters. `agent` is `<role>-<n>`. `task`
is text of at most `taskChars` characters; it may hold anything, newlines
included, and is only ever data.

**`stops/<spawn_id>`** — an empty file: the CAPITANO asked to stop that child.

**`results/<spawn_id>.json`** — written by the executor, replaced as the
child's state changes:

```json
{ "spawn_id": "3f9a0c1d2e4b5a67", "state": "done", "exit_code": 0, "spent_usd": 0.061 }
```

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
4. Stops a child at `max_minutes`, on `stops/<spawn_id>`, or when the
   CAPITANO that started it ends: no child outlives its parent.
5. Writes `results/<spawn_id>.json` when the child starts and when it ends,
   and a line in its host log for every order, refusal and end.

`tests/launcher.test.ts` covers the hub's half: the allowlist, the models,
the caps, the number at once and per role, spawns and failures per session,
the piggy bank with the spend given back, `STOP`, stops of one's own
children only, the log, and the 403 to any token that is not a CAPITANO's.
