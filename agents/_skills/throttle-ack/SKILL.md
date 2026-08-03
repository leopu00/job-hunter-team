---
name: throttle-ack
description: Sign your wake-up. ALWAYS the FIRST command of every wake-up, before anything else, whenever you receive a `[RIPRENDI]` message after a throttle pause. `throttle-ack <your-name>` flips your flag from NOTIFIED to ACTIVE. Only you can do it - the engine cannot - which is exactly why a flag left on NOTIFIED is proof that an agent got the wake-up and did not respond, and why the watchdog escalates on it. Skipping this makes a perfectly healthy agent look blocked.
allowed-tools: Bash(throttle-ack *), Bash(python3 /app/shared/skills/throttle_engine.py *)
---

# throttle-ack — sign the wake-up, then get back to work

```bash
throttle-ack <your-name>
```

First command of every wake-up. Then go **straight back to your loop** — the ack
is a signature, not a report.

## Why you and not the engine

The throttle engine writes two of the three states: `IN_THROTTLE` when you
register a pause, `NOTIFIED` when it has sent you the wake-up over tmux. The last
step, `NOTIFIED → ACTIVE`, is **only yours**.

That asymmetry is the whole point. Every watchdog in this system shares one blind
spot: looking at a tmux pane, `idle` and `blocked` are indistinguishable. With
your signature they stop being indistinguishable:

| flag | meaning | anomaly if it lasts |
|---|---|---|
| `IN_THROTTLE` | legitimate wait | no — the engine knows how long |
| `NOTIFIED` | wake-up sent, ack awaited | **yes → escalation after N min** |
| `ACTIVE` | you are working | judged against your DB output |

A flag stuck on `NOTIFIED` is not "maybe idle": the wake-up arrived and nobody
answered. That is a measurement, not a guess, and the watchdog escalates it to
the Capitano.

## The rules

- **First command, always.** Before reading your queue, before any tool, before
  answering anyone.
- **A daily halt wins over the wake.** The command checks
  `$JHT_HOME/logs/daily-halt.flag` atomically with the ack. If it prints
  `DAILY_HALT_ACTIVE`, do not work and do not message the Capitano: close the
  turn. The engine keeps the timer armed and will wake you after the flag goes.
- **Then work immediately.** Acknowledging and then sitting idle produces a fake
  "queue empty" that misleads the Capitano and the pacing. A wake-up is a signal
  to *work*.
- **Do not use it to end a pause early.** An ack sent while your timer is still
  running is refused (exit 1): if you could close the flag whenever you liked,
  the throttle would go back to being something you decide.
- You do not need to know how long you slept, and the command does not tell you.

## Exit codes

- `0` — flag on `ACTIVE` (idempotent: acking twice is harmless)
- `1` — ack **refused** because your pause is not over or daily halt is active:
  close your turn, the engine will wake you. Or invalid arguments / engine missing.

## Example

```
[DA @SISTEMA A @SCOUT-1] [RIPRENDI] La tua pausa è finita. PRIMO comando: `throttle-ack scout-1`...
```

```bash
throttle-ack scout-1
# THROTTLE_ACK agent=scout-1 NOTIFIED→ACTIVE
```

...and the very next thing you do is your next unit of work.
