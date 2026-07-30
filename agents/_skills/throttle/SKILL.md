---
name: throttle
description: Register your pause and END YOUR TURN. Time is no longer yours to keep - an engine outside your process owns the timer and wakes you over tmux when it expires. ALWAYS use this instead of `sleep` when you want to slow your iteration rate. One call, `throttle <your-name>`, returns immediately; you never learn how long you wait and you must not try to. On waking, your FIRST command is always `throttle-ack <your-name>`. Raw `sleep` for throttle pauses is FORBIDDEN, and so is backgrounding this call with `&` / `nohup` / a background task.
allowed-tools: Bash(throttle *), Bash(throttle-ack *), Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 /app/shared/skills/throttle_engine.py *)
---

# throttle — register the pause, then stop

```bash
throttle <your-name> [--reason "..."]
```

Returns immediately. Then **close your turn**: no other task, no other command.

## Why it works this way

Until 2026-07-30 the throttle was a contract you had to honour yourself:
`jht-throttle` blocked *your own process* with a sleep loop, and if that process
died you had to notice and re-block. Every failure we observed in production was
born from that design. The worst one: an Analyst launched
`jht-throttle … &` inside a compound command that the tool-call timeout killed
after 60s. The detached child died with its parent, the agent closed its turn
convinced the pause was running — and **nobody ever woke it again**. 2h15m of
stall, with the watchdog reporting the session as `idle` = healthy.

Now the timer belongs to an engine that is **not a child of your shell**:

```
YOU                          ENGINE (daemon, outside your process)
 |                              |
 |-- throttle <me> ------------>|  reads the duration the Capitano calibrated
 |                              |  flags you IN_THROTTLE
 |   (you close the turn        |  arms the timer ON DISK
 |    and do NOTHING)           |
 |                              |
 |<-- [RIPRENDI] over tmux -----|  timer expired -> flag becomes NOTIFIED
 |                              |
 |-- throttle-ack <me> -------->|  YOU flip NOTIFIED -> ACTIVE
 |   (first act on waking)      |
```

A daemon restart loses nothing: the deadline is an absolute timestamp on disk,
so there is no in-memory timer to re-arm.

## The rules

- **You never pass a number and you never see one.** The duration lives in
  `$JHT_HOME/config/throttle.json`, the Capitano owns it, and the engine reads
  it *when it arms the timer* — so a recalibration bites on your **next** cycle
  without anyone having to tell you. Do not hardcode `throttle 600` in your loop.
- **END YOUR TURN after the call.** The call returns in milliseconds precisely
  so that no tool-call timeout can kill it. If you keep working after it, you
  are running with no pause at all — which is what the throttle exists to
  prevent.
- **NEVER** background it (`&`, `nohup`, `disown`, a background task). There is
  nothing to background: it does not sleep.
- **NEVER** use raw `sleep N` for a throttle pause. Plain `sleep` is only for
  very short waits between retries (≤ 5 s), where logging would be noise.
- **On waking, `throttle-ack <your-name>` is your first command** — see the
  `throttle-ack` skill. Skip it and your flag stays on `NOTIFIED`, which the
  watchdog reads as proof that you are blocked, and it escalates to the Capitano
  about an agent that is perfectly fine.
- `--reason` is optional but useful: a short tag (`"post-batch"`,
  `"waiting for the critic"`) makes `logs/throttle-engine.jsonl` readable later.

## Examples

```bash
# Scout, at the end of one position:
throttle scout-1 --reason "post-batch"
# ... and the turn ends here.

# Writer waiting for the Critic:
throttle scrittore-1 --reason "waiting critic review"
```

## Exit codes

- `0` — timer armed, or duration 0 (no pause: the interactive core sits at 0 on
  purpose, so it stays responsive for the user's chat — keep going)
- `1` — invalid arguments, or the engine is missing

## Deprecated commands

`jht-throttle`, `jht-throttle-check` and `jht-throttle-wait` still work: they are
now thin shims over the engine, kept for prompts that have not migrated yet.
Prefer `throttle` + `throttle-ack`. If you find yourself computing timeouts for a
tool call (`timeout: N+30`), you are on the old path — you no longer need to.

## Captain's note

To change a rhythm, edit the config — never send a number over tmux:

```bash
throttle-set scout-1 660                       # one agent
throttle-set scout-1=660 analista-1=300        # several, one atomic write
throttle-set --dump                            # effective values right now
```

The change bites on each agent's next cycle by itself. Use tmux only to tell an
agent to call the skill **more or less often** in its loop, never to dictate a
duration.
