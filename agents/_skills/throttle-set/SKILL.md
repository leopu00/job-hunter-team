---
name: throttle-set
description: The ONLY way the team's rhythms get written. Captain-only. `throttle-set <agent> <seconds>` edits the per-agent throttle config; the engine re-reads it when it arms each timer, so the change bites on that agent's NEXT cycle by itself - no tmux message, no agent has to re-read anything, and the cycle already running is not disturbed. Use it instead of sending numbers to workers. Also `throttle-set a=N b=M ...` for one atomic multi-write, `--dump` for the effective values, `--get <agent>`, `--reset`.
allowed-tools: Bash(throttle-set *), Bash(python3 /app/shared/skills/throttle-config.py *)
---

# throttle-set — govern the rhythms without touching the agents

```bash
throttle-set <agent> <seconds>              # one agent
throttle-set scout-1=660 analista-1=300     # several, one atomic write
throttle-set --dump                         # the EFFECTIVE values right now
throttle-set --get <agent>                  # the effective value of one
throttle-set --reset                        # drop every override
```

## Why you never send a number over tmux

The throttle engine reads the config **at the moment it arms each timer**. So:

- a value you change here bites on that agent's **next** cycle, by itself;
- the cycle **currently running** is untouched — its deadline was already
  computed, and moving it would be a surprise nobody asked for;
- workers never see a number and never learn how long they wait. They call
  `throttle <their-name>` and stop. The duration is yours alone.

That is the whole reason this exists: five tmux messages carrying a number are
five chances to race an agent that is mid-pause. One atomic write is none.

## What you get back is the EFFECTIVE value, not what you asked for

Two automatic corrections apply on read, so the number an agent actually serves
can differ from the one you typed:

- **Worker floor, 5 min.** Workers (Scout/Analyst/Scorer/Writer/Critic) are never
  below 300s, `0` included. It comes from a measured incident — one Scout with no
  pause burned ~308kT for 3 positions of dirty data. The interactive core
  (Captain/Sentinel/Assistant/Mentor) has **no** floor: it must stay responsive
  for the user's chat, so `0` stays `0` there.
- **Coprime ladder.** Every value > 0 snaps to a rung in prime minutes
  (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60). Rungs that were multiples of
  5 resynchronised workers *by construction*: 5+10 collided every 10 minutes.
  Coprime rungs make collisions rare instead of periodic.

So `throttle-set scout-1 120` reads back as `300`. That is not the tool ignoring
you — it is the value the agent will serve, and it is what `--dump` shows.

Both step aside while the user's time-boxed derogation is live, and come back on
their own when it expires. You do not need to remember to restore them.

## To CONSUME more, the lever is parallelism, not a smaller throttle

Workers do not go below 5 min, so "set the throttle to 0" does not exist for
them. If the team is under the target pace, add workers **in stages**; do not try
to win it back by shaving the pause. A saturated throttle is a signal, not a
destination: when an agent is already high on the ladder and still overshoots,
the lever becomes killing it, not another nudge.

## Exit codes

- `0` — written / read
- `1` — invalid arguments, value out of range (0..3600), or the config missing

## Example

```bash
throttle-set --dump
# default = 0s
# scout-1        = 660s
# analista-1     = 300s

throttle-set scout-1 1380
# scout-1=1380s

# scout-1 is mid-pause: it keeps the 660s it had, and serves 1380s next cycle.
# Nobody told it anything.
```
