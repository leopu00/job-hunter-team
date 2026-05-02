---
name: throttle
description: Pause your loop for N seconds in a tracked way. ALWAYS use this instead of `sleep` whenever you want to slow down your iteration rate to respect the team's rate budget. Logs every pause to $JHT_HOME/logs/throttle-events.jsonl so the Captain and the dashboard can see who is throttling and for how long. `sleep` for throttle pauses is FORBIDDEN — only this skill, with `--agent <your-name>`.
allowed-tools: Bash(jht-throttle *), Bash(python3 /app/shared/skills/throttle.py *)
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

## Usage

```bash
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
  `analista-2`) — it's the key the dashboard groups by.
- `--reason` is optional but useful: a short tag like
  `"post-batch"`, `"cooldown after URG"`, `"waiting for analyst"`
  helps later when reading back the events.

## Examples

```bash
# Scout: cooldown of 2 min after a batch of position fetches
jht-throttle 120 --agent scout-1 --reason "post-batch cooldown"

# Captain: pause 1 min before next monitoring cycle
jht-throttle 60 --agent capitano --reason "between cycles"

# Writer: short pause while waiting for the Critic to come back
jht-throttle 30 --agent scrittore-1 --reason "waiting critic review"
```

## Exit codes

- `0` — pause performed and logged
- `1` — missing or invalid arguments

## Captain's note

When you order another agent to slow down, ask them to use this skill,
e.g.:

> `[@capitano -> @scout-1] [URG] Throttle: jht-throttle 180 --agent scout-1 --reason "rate budget pressure"`

Don't just say "sleep 3 minutes" — that bypasses the logging and we
lose visibility on the pacing.
