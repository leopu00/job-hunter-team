---
name: throttle
description: Pause your loop for N seconds in a tracked way. ALWAYS use this instead of `sleep` whenever you want to slow down your iteration rate to respect the team's rate budget. The duration is read from $JHT_HOME/config/throttle.json (the Captain calibrates per-agent values there); pass --agent <your-name> and the skill resolves the rest. Uses a detached-child pattern that survives any provider tool-call timeout (Kimi 60s, Codex 30s, Claude 120s/600s). Always pair with `jht-throttle-check` before each task to recover if a parent gets killed prematurely. Logs every pause to $JHT_HOME/logs/throttle-events.jsonl. `sleep` for throttle pauses is FORBIDDEN.
allowed-tools: Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 /app/shared/skills/throttle.py *), Bash(python3 /app/shared/skills/throttle-config.py *)
---

# throttle — tracked pause

Shell wrapper at `/app/agents/_tools/jht-throttle`. Calls
`/app/shared/skills/throttle.py` under the hood.

## Why it exists

Until now every agent put `sleep N` in its loop "when it felt right".
That works, but the team has no observability on it: the Captain can't
see *who* is pausing, *for how long*, *how often*. With this skill every
pause is appended to `$JHT_HOME/logs/throttle-events.jsonl` with the
agent name, requested seconds, applied seconds and an optional reason.

The dashboard in `/team` reads this file and shows a per-agent throttle
chart, so we can *see* the team's pacing and tune it over time.

## How calibration works (read this carefully)

The Captain calibrates **the duration** for each agent in
`$JHT_HOME/config/throttle.json` via:

```bash
python3 /app/shared/skills/throttle-config.py set <agent> <seconds>
```

You (the operating agent) DO NOT need to know the current value.
You just call:

```bash
jht-throttle --agent <your-name> [--reason "..."]
```

and the skill reads the config, sleeps that many seconds, logs the
event, and returns. If the Captain has set you to 0 (or you're not in
the config), the skill returns immediately as a no-op — no log, no
sleep, your loop runs at full speed.

This means:

- The Captain changes calibration with **a single config write**, no
  tmux orchestration. Your next call picks up the new value.
- You never store the throttle value in your own memory; you don't
  hardcode `jht-throttle 60` in your loop. The Captain owns the value.
- The Captain can also tell you to call the skill **more or less
  frequently** in your loop (e.g. "throttle every task" vs "throttle
  every 3 tasks") — that's a separate axis you control.

## Usage

```bash
# Recommended (reads the config):
jht-throttle --agent <your-name> [--reason "..."]

# Explicit override (bypasses the config; only when the Captain
# tells you to with a specific number):
jht-throttle <seconds> --agent <your-name> [--reason "..."]
```

## How it works internally (detached pattern)

`jht-throttle` uses a **detached child** pattern that survives any
provider's tool-call timeout (Kimi 60s, Codex 30s, Claude 120s/600s):

1. Reads the config to get the duration.
2. Writes a state file `$JHT_HOME/state/throttle-<agent>.json` with
   `until = NOW + duration` (used by `jht-throttle-check` and
   `jht-throttle-wait`).
3. Forks a `python3 throttle.py` subprocess as a child of init
   (PPID 1) — outside the tool-call subprocess tree. This child writes
   the `start` event, sleeps, and writes the `end` event indipendently
   of what happens to the calling tool call.
4. The parent (the bash you're calling) blocks for the full duration
   in 15-second sleep chunks. The chunked sleep is shorter than any
   provider's default tool-call timeout, so even on Kimi 60s default
   the parent survives. **The agent stays blocked the whole time.**
5. If the provider DOES kill the parent (e.g. you didn't pass enough
   timeout in your tool call): the child detached keeps running and
   writes `end` correctly → no orphan in the log. But the agent (you)
   is now free and could mistakenly start the next task. To prevent
   that, see the **gating pattern** below.

## Gating pattern: ALWAYS check before next task

After every `jht-throttle` (and especially in normal loop iterations),
**before starting a new task**, run:

```bash
jht-throttle-check <your-name>
# exit 0 → ok, start next task
# exit 1 → "STILL_THROTTLED remaining=Xs" on stderr, you must wait
```

If `jht-throttle-check` exits 1, immediately call:

```bash
jht-throttle-wait <your-name>
# Blocks (in 15s chunks) until until passes, then exits.
```

This is the recovery path: a previous `jht-throttle` whose parent was
killed prematurely by the provider timeout. The detached child is
still sleeping, the state file is still valid, the check tells you
"don't start a task yet". The wait re-blocks you safely.

The full safe loop in your role prompt:

```
loop:
    jht-throttle-check <me>          # gate
    if exit 1:
        jht-throttle-wait <me>       # re-block
    do_task()
    jht-throttle --agent <me>        # parent blocks + child detached
```

## Rules

- **NEVER** use `sleep N` for throttle pauses. Use `jht-throttle` instead.
  Plain `sleep` is allowed only for very short waits between retries
  (≤ 5 s) where logging would be noise.
- **MUST run in FOREGROUND, blocking.** `jht-throttle` is your loop's
  pause — its whole point is to stop *you* from doing anything else
  until it returns. Run it via your normal blocking shell tool (`Shell`
  / `Bash`), wait for it to exit, and only then issue the next tool
  call. **DO NOT** wrap it in a background `Task`/`TaskOutput`/`bash &`
  / `nohup` / `disown` and keep working in parallel — the parent
  blocks for you on purpose. (The detached *child* runs in the
  background; that's an internal implementation detail of the
  wrapper, not something you do.)
- **ALWAYS check before next task.** If your tool call returned earlier
  than the config seconds (provider timeout), call `jht-throttle-check`
  first. Don't guess.
- Always pass `--agent <your-name>` (e.g. `scout-1`, `capitano`,
  `analista-2`) — it's the key the dashboard groups by AND the key the
  Captain writes in the config.
- `--reason` is optional but useful: a short tag like
  `"post-batch"`, `"cooldown after URG"`, `"waiting for analyst"`
  helps later when reading back the events.

## Examples

```bash
# Pre-task gate (always before starting a task)
jht-throttle-check scout-1 || jht-throttle-wait scout-1

# Scout: pause between batches, duration set by the Captain in config.
jht-throttle --agent scout-1 --reason "post-batch cooldown"

# Captain: explicit override (rare, only for emergencies)
jht-throttle 60 --agent capitano --reason "between cycles"

# Writer: pause while waiting for the Critic, config-driven
jht-throttle --agent scrittore-1 --reason "waiting critic review"
```

## Exit codes

- `0` — pause performed and logged, OR config returned 0 (no-op fast path)
- `1` — missing or invalid arguments

## Captain's note

To slow an agent down, **edit the config**, don't send a number via
tmux:

```bash
# Single agent
python3 /app/shared/skills/throttle-config.py set scout-1 60

# Multi-agent in one atomic write
python3 /app/shared/skills/throttle-config.py bulk-set scout-1=60 scrittore-1=120 analista-1=0

# Dump current state
python3 /app/shared/skills/throttle-config.py dump
```

Use tmux only to tell agents to call the skill **more or less often**
in their loop, not to dictate the duration.
