---
name: throttle
description: Pause your loop for N seconds in a tracked way. ALWAYS use this instead of `sleep` whenever you want to slow down your iteration rate to respect the team's rate budget. The duration is read from $JHT_HOME/config/throttle.json (the Captain calibrates per-agent values there); pass --agent <your-name> and the skill resolves the rest. Logs every pause to $JHT_HOME/logs/throttle-events.jsonl. `sleep` for throttle pauses is FORBIDDEN.
allowed-tools: Bash(jht-throttle *), Bash(python3 /app/shared/skills/throttle.py *), Bash(python3 /app/shared/skills/throttle-config.py *)
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

## Rules

- **NEVER** use `sleep N` for throttle pauses. Use `jht-throttle` instead.
  Plain `sleep` is allowed only for very short waits between retries
  (≤ 5 s) where logging would be noise.
- **MUST run in FOREGROUND, blocking.** `jht-throttle` is your loop's
  pause — its whole point is to stop *you* from doing anything else
  until it returns. Run it via your normal blocking shell tool (`Shell`
  / `Bash`), wait for it to exit, and only then issue the next tool
  call. **DO NOT** wrap it in a background `Task`/`TaskOutput`/`bash &`
  / `nohup` / `disown` and keep working in parallel — that defeats the
  throttle entirely (the bash sleeps, you don't) and the dashboard will
  correctly fail to register the pause as completed (only `end` events
  are counted; backgrounded runs that get killed never write one).
- Always pass `--agent <your-name>` (e.g. `scout-1`, `capitano`,
  `analista-2`) — it's the key the dashboard groups by AND the key the
  Captain writes in the config.
- `--reason` is optional but useful: a short tag like
  `"post-batch"`, `"cooldown after URG"`, `"waiting for analyst"`
  helps later when reading back the events.

## Examples

```bash
# Scout: pause between batches, duration set by the Captain in config
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
