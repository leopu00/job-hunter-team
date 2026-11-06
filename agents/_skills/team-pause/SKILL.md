---
name: team-pause
description: "PAUSE the team (or one agent) without shutting anything down, and resume it. Open it the moment the user says «take a break», «pause», «hold on», «stop for now», «wait until I tell you», «freeze» — or «resume», «carry on», «you can start again». A pause keeps every session ON with its context; nobody works and nothing new starts until the user says to resume. It is NOT the stop: shutting the team down (`jht team stop`, `.team-halted.flag`, killing sessions) throws every agent's context away and is only for an explicit «turn the team off»."
allowed-tools: Bash(python3 /app/shared/skills/agent_control.py *), Bash(python3 /app/shared/skills/standby.py status *), Bash(python3 /app/shared/skills/agent_pause.py status *)
---

# team-pause — a pause is not a shutdown

A pause is not a shutdown. If «take a break» were answered with the stop flag, every session would be closed, every agent would lose its context, and the user would be told «Paused ✅» for what is a shutdown. This skill exists so that does not happen: the pause the user asked for keeps the sessions on and the context intact, and **what you tell the user is what the command's answer says**.

## 1. Which word means which

| The user says (any language) | It means | What you do |
|---|---|---|
| «pause», «take a break», «hold on», «wait, I'll tell you when to restart», «freeze», «everybody stop for now» | **PAUSE** | §2 |
| «resume», «carry on», «you can start again», «go» (after a pause) | **RESUME** | §4 |
| «pause the Scout» / «stop Analista-1 for a while» | **PAUSE one agent** | §5 |
| «turn the team off», «shut everything down», «stop the team» *said as a shutdown* | **STOP** — not this skill | tell the user it closes the sessions and loses what each agent had in mind; do it only if they confirm that is what they want |
| ambiguous («stop», «stop everything») | treat it as a **PAUSE** | it can be undone and keeps the context; say so, and offer the shutdown if they meant that |

**Never** use `jht team stop`, `.team-halted.flag`, `tmux kill-session` or the Capitano's «freeze» for a pause. Those are the stop.

## 2. Pausing the team

The **Assistente** runs the command itself (do not ask the Capitano to improvise a freeze):

```bash
python3 /app/shared/skills/agent_control.py pause --until-resumed --from-assistant
```

The **Capitano**, if the order reaches it (a `[REQ]` that says pause, or the user writing to it), runs the same line **without** `--from-assistant`. One line of JSON comes back. Read it:

```json
{"ok": true, "op": "pause", "result": "paused",
 "detail": {"reached": ["CAPITANO","SCOUT-1", ...], "not_reached": ["SCORER-1"], "until_resumed": true}}
```

- `result: "paused"` — done. `"already_paused"` — it already was; say so.
- `detail.reached` — the sessions that got the message *«close your step, note where you are, wait»*. `detail.not_reached` — live sessions that did not answer the transport: **tell the user which**.
- `ok: false` / `error` — it did **not** happen. Say that. Never say «paused» after an error.

The sessions stay on. The bridges and watchdogs go quiet by themselves (no heartbeat, no pacing ticks, no refresh, no nudges). The Assistente is **not** paused: it stays reachable.

The pause has no end time: it ends when the user says so, with a **hard cap of 7 days** after which the team resumes by itself (so a forgotten pause cannot silence it forever). Say that once.

## 3. While the team is paused

- Do **not** wake the Capitano or anyone else for new requests, tickets or answers: tell the user *it will be handled as soon as they resume*. A ticket stays open, nothing is lost.
- Do **not** start, stop, restart or spawn agents. Do not touch throttles.
- If asked how things are: `python3 /app/shared/skills/standby.py status` (and, for one agent, `python3 /app/shared/skills/agent_pause.py status SCOUT-1`). The sessions are on; nobody is working.
- The Capitano, if awake: close the step, no new orders, wait silently.

## 4. Resuming

```bash
python3 /app/shared/skills/agent_control.py resume
```

`result: "resumed"` — every session got *«pick up exactly where you were»* and the automation is back. `"not_paused"` — there was no pause. `error: "team_halted"` — the user had **stopped** the team: resuming a pause does not turn it on; say so and offer to start it.

An agent the user paused **alone** (§5) is not woken by the team's resume: it stays paused until it is resumed on its own.

## 5. One agent

```bash
python3 /app/shared/skills/agent_control.py pause-agent SCOUT-1
python3 /app/shared/skills/agent_control.py resume-agent SCOUT-1
```

The rest of the team keeps working. `error: "agent_not_running"` — that session is not on; `"agent_contained"` — someone shut it down on purpose: say it, do not force it. Stopping or restarting an agent clears its pause.

## 6. What you tell the user — only what happened

After the pause (adapt the words, keep the facts):

> The team is paused. The N agents are still on and each one keeps in mind what it was doing; none works until you tell me to resume, and nothing was shut down. I stay here. (If `not_reached`: «X did not answer, I could not tell it.»)

After the resume: *«Done: everybody picks up where they were.»* After an error: *what failed*, and what state the team is in (`standby.py status`).

## Anti-patterns

- ❌ «Paused ✅» without the command's answer. The word comes from `result`, the numbers from `detail`.
- ❌ Asking the Capitano to «apply a controlled freeze» and reporting its reply as the pause. The Capitano with no skill wrote the stop flag.
- ❌ `jht team stop`, `.team-halted.flag`, `kill-session`, `freeze_team.py` (Esc to every pane) for a pause.
- ❌ Waking the team for a ticket during a pause.
- ❌ Treating the shutdown as the default for «stop everything»: it loses the context of every agent.

## See also

- `graceful-shutdown` — closing the day when the user leaves the application (a different thing: the agents are closed).
- `throttle-distribution` — slowing agents to the budget's pace (a pause is not a throttle).
