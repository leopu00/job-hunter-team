---
name: first-run-burst
description: The first half-hour a brand-new user ever watches the team work. Open this skill when you receive `[PROFILO-PRONTO]` from the Assistente, or at wake when `first_run.py status` reports phase `awaiting_profile` / `burst`. It overrides the gradual calibration (C-02) for the first window only, and it defines success as SCORED positions on screen — not as positions found.
allowed-tools: Bash(python3 /app/shared/skills/first_run.py *), Bash(python3 /app/shared/skills/plan_registry.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(/app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *), Bash(jht-send *)
---

# first-run-burst — the demo that decides whether the user stays

A new user finishes the setup, switches the team on, and watches. Ten minutes
later they have seen **one** raw position appear. Nothing tells them apart a
team pacing itself from an application that is broken — so they conclude it is
broken, and they are not being unreasonable.

Your normal calibration (C-02: one worker, observe 30 min, add a rung) is the
right rule **at steady state**, where a wrong guess costs a budget window. On
the very first run it costs the user. This skill is the documented exception,
and it applies to the **first window only**.

## Trigger

- `[@assistente -> @capitano] [PROFILO-PRONTO]` — the profile just became usable
- at wake, when `python3 /app/shared/skills/first_run.py status` reports
  `phase: awaiting_profile` or `phase: burst`

## What success means here

**Positions with a score on screen.** Not positions found. A run that sources
50 offers and scores 3 of them (measured, 2026-07-26) has produced almost
nothing the user can see — the shortlist is the product, the scraping is
plumbing. Everything below follows from that one sentence.

## The routine

**1. Open the burst and read the roster.**

```bash
python3 /app/shared/skills/first_run.py begin-burst
```

It returns the `roster` (how many Scout / Analista / Scorer), the
`scout_cap_first_pass` and the `target_scored`, all derived from the
subscription the user declared during setup. If it answers `piano non
dichiarato`, the setup step is incomplete: tell the user in chat and stop —
do **not** guess a roster, an over-estimate burns their window on day one.

**2. Spawn the whole roster, staggered by ~60 seconds.**

Not one worker every ten minutes: the whole formation, back to back, through
`start-agent.sh` as always (C-03). This is the deliberate C-02 exception.

**3. Do not wait for full queues to start the downstream.**

Spawn the Analista as soon as **one** position exists, the Scorer as soon as
**one** position is checked. The habit of "first collect, then evaluate" is
what leaves the user staring at a pile of unscored rows.

**4. Cap the first sourcing pass.**

Tell each Scout its share of `scout_cap_first_pass` and to report back when it
is reached, instead of sourcing until the budget runs out. Positions beyond
that cap have no value yet: they queue up behind the ones nobody has scored.

**5. Report early, not when it is complete.**

As soon as the first ~3 positions carry a score, send the user a short
`jht-send` with what they are — that is the moment the application stops
looking broken. Then keep going to `target_scored`.

**6. Close the burst.**

```bash
python3 /app/shared/skills/first_run.py check
```

Run it on each `[HEARTBEAT]`. When it flips to `steady` you are back under the
ordinary rules — C-02 calibration included.

## Speed is yours here too — the bridge only advises

`pace_guard` measures consumption against the window curve at every bridge
sample and writes one `[PACE-GUARD]` line into your pane with the throttle it
would recommend. It does **not** apply it: nothing does, until you run
`throttle-config.py`. So:

- **Never** `freeze_team.py` during the burst. A frozen team is exactly the
  silence this skill exists to prevent.
- Read a `[PACE-GUARD]` line as a decision to take, not as a notification. It
  carries the command already written out for the live workers — adapt it to
  who is doing what and run it. If you ignore it, the pace does not change:
  no script is going to touch the throttle in your place.
- If it reaches you as `LOCKOUT-IMMINENTE`, the recommended brake is already at
  the 1h ceiling — braking alone is no longer enough, and the lever is the
  **roster** — kill one Scout (never the Analista or the Scorer: without them
  nothing gets scored).
- The window should reach 100% **at the reset**, not before. Being at 100%
  halfway through means the user gets a mute team for two hours; being at 40%
  at the reset means budget left on the table. Both are failures, and the
  first one is much worse.

## Anti-patterns

- ❌ Spawning Scouts only, "material first, scoring later" — the measured
  outcome is 50 found / 3 scored, which reads to the user as a broken app.
- ❌ Waiting for a `[BRIDGE TICK]` before the first spawn: the profile being
  ready **is** the trigger.
- ❌ Climbing the C-02 ladder during the burst — that rule owns the steady
  state, this window is the exception.
- ❌ Freezing the team to protect the budget. Slow is recoverable, mute is not.
- ❌ Announcing the burst to the user in the language of infrastructure
  ("spawned 4 workers, throttle 300s"). Report positions, companies, scores.

## See also

- `spawn-agent` — the actual launch, unchanged.
- `pipeline-triage` — which role unblocks the bottleneck, once at steady state.
- `scaling-calc` / **C-02** — the gradual calibration this skill suspends.
- `chat-web` — how to phrase the early report to the user.
