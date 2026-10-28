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
subscription the user declared. If it refuses (`ok: false`, «subscription
plan not selected»), no plan is declared yet: do **not** guess a roster, an
over-estimate burns their window on day one. Ask the user with `python3 /app/shared/skills/first_run.py ask-plan`: it is the only way to ask, because it posts the card in the app, with the plans and the one the `Codex reports:` line names marked as suggested — a suggestion, never your choice. A question written as text in your pane reaches nobody: the user watches the app, not your pane. When the user answers, write exactly their choice with `python3 /app/shared/skills/plan_registry.py set <provider>:<id>` (the id of the card works: `pro_max` is `pro-max`) and run `begin-burst` again. If they answer «I do not know», stop and tell them; ask again at your next wake.

**While the burst runs, the plan can be gone** (the configuration was reset, the provider changed, the file
was edited). `first_run.py status` and `begin-burst` then carry `plan_missing: true` with a `hint`: do not
read «burst already in progress» as «all is well». The burst goes on, and you declare the plan the same way:
ask with `python3 /app/shared/skills/first_run.py ask-plan` (the card, never plain text) and write exactly the user's choice with `python3 /app/shared/skills/plan_registry.py set <provider>:<id>`. The Assistente asks the same when the user talks to it.

**Ask the plan once.** While your question about the plan is still unanswered in the chat, do not ask it again, not even reworded: a new «profile ready» message, another wake, or `plan_missing` in the next `status` do not change what you are waiting for. Look at the chat first: if you already asked and the user has not answered, wait. Ask again only after the user has answered «I do not know». `ask-plan` does not post a second card while the first has no answer: if it says the question is open, wait. If you never ask, the system posts the card a few minutes after the profile is imported. After «I do not know» it posts the card again only after an hour, and never more than three times in all: if it says so, wait and do not ask in text.

**Never before the profile, and the card goes where the user is.** `ask-plan` posts nothing while the profile is not saved (`wait_for_profile: true`): do not ask the plan at the welcome or while the profile is being built, and wait for the profile-ready message. While the user confirms their profile with the Assistente the card goes to the Assistente's chat, whoever runs `ask-plan` (`agent` and `in_your_chat` in the reply say where it is). When you tell the user about it, name the chat that has it — «the chat with the Assistente» — never «this chat» if `in_your_chat` is `false`.

**The plan comes only from the configuration or from the user.** Never write it yourself from your diary, a note, your memory or an earlier conversation: «the user confirmed Pro» in a note is what the user said then, not a declaration now (the configuration may have been reset, and the plan may have changed). While `plan_missing` is there the plan is missing: ask, once, and write only what the user answers.

**Asking with buttons.** If you ask with `jht-notify-user --oggetto … --option id=label`, an option id takes only `a-z`, `0-9` and `_` (up to 24 characters, never starting with `_`): the plan `pro-max` is the id `pro_max`, and when the answer comes back you write the registry's own id, `plan_registry.py set <provider>:pro-max`.

**2. Spawn the whole roster, staggered by ~60 seconds.**

Not one worker every ten minutes: the whole formation, back to back, through
`start-agent.sh` as always (C-03). This is the deliberate C-02 exception.

**After a restart, start only what is missing.** When you wake in a burst that is already open (the containers were restarted, so every session is gone), `first_run.py status` and `begin-burst` carry `roster_alive` and `roster_missing` per role. Start only the roles in `roster_missing`, staggered the same way, and leave alone the ones that are up, whatever they are doing: a busy session is alive (C-08 bis). Do not respawn the whole formation, and do not brief again a worker that is already working. If `roster_check` is `unavailable`, look at the tmux sessions yourself before you spawn anything.

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
