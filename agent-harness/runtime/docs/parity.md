# Parity with the TUI agents

An API agent must behave like the TUI agent of the same role: same prompt,
same skills, same team channels. This page says how the harness gets there,
what it changes on purpose, and how the claim was checked.

Code: `src/parity/role-prompt.ts` (the prompt), `src/parity/jht-tools.ts`
(the commands). Tests: `tests/parity-*.test.ts`.

## The prompt

`.launcher/start-agent.sh` and `jht_spawn_copy_skills` in
`.launcher/spawn-lib.sh` decide what a TUI agent reads. `loadRolePrompt`
applies the same rules to the same files:

| Launcher rule | Harness |
| --- | --- |
| Locale: `i18n-prefs.json` → `$JHT_LANG` → `JHT_LANG=` in `host.env` → `en`; unknown values skipped | `resolveUserLocale` |
| Identity: `agents/<role>/<role>.<locale>.md`, else `<role>.md`, copied to `CLAUDE.md`/`AGENTS.md` | `RolePrompt.identity`, byte for byte |
| Skills: `agents/<role>/skills.list` in order (`#` comments, `_lib` skipped), then `agents/<role>/_skills/*`; a private skill replaces a shared one of the same name | `RolePrompt.skills` |
| `SKILL.<locale>.md` becomes `SKILL.md` (not for `en`); every other `SKILL.*.md` removed | `materializeRoleHome` |
| `agents/_team/*.md` baselines (localized variant when present) copied to `../_team/` | `materializeRoleHome` |
| A name in `skills.list` with no folder: warning, spawn goes on | `RolePrompt.missingSkills` |

The system prompt is `composeSystemPrompt`: the identity whole, then
`PARITY_NOTES`, then a skill index (`- <name>: <description>
(skills/<name>/SKILL.md)`). The identity comes first so the prefix is the TUI
prompt and the provider's prompt cache holds across runs.

### Expected differences

These, and only these, separate what an API agent reads from what a TUI agent
reads:

1. **The CLI's own system prompt is absent.** Claude Code and Codex wrap
   `CLAUDE.md`/`AGENTS.md` in their own instructions; the harness sends the
   identity as the system prompt itself.
2. **`PARITY_NOTES` follows the identity** (about 750 characters): where the
   `_tools` commands went, see the table below.
3. **The skill index is text in the system prompt.** The CLIs list skills in
   a tool description and load them on demand; here the index names the
   `SKILL.md` to read with the file tools.
4. **Skills live in `skills/`**, not `.claude/skills` or `.agents/skills`.
   Only the folder name changes; the tree under it is the same.
5. **`_team/` holds only the repo's docs.** On a running box the agents also
   write their own state there (a progress TSV, a workspace JSON); that is
   their work, not the prompt, and a fresh API home starts without it.

### How it was checked (2026-09-19)

On the reference TUI box, read only: the `scout-1` folder of a running team
(provider openai, so `AGENTS.md` and `.agents/skills`), image built from
commit `149c147e6`. The harness loaded `agents/` from the same commit with
locale `en` (the box has no `i18n-prefs.json` and no `JHT_LANG`):

| Compared | Result |
| --- | --- |
| TUI `AGENTS.md` vs `RolePrompt.identity` | identical (`cmp`) |
| TUI `AGENTS.md` vs first 20 615 bytes of the API system prompt | identical |
| TUI `.agents/skills/` vs API `skills/` (14 skills, every file) | identical (`diff -r`) |
| TUI `_team/` vs API `_team/` | the repo's 3 docs identical; 3 extra files on the box written by agents (difference 5) |

To repeat it: copy the agent folder out of the container
(`tar cf - AGENTS.md .agents/skills`), `git archive <image commit> agents`,
run `loadRolePrompt` + `materializeRoleHome` on it, `cmp` and `diff -r`.

## The commands

`agents/_tools/*` are on a TUI agent's `PATH`. In the harness each command a
role uses to talk or pause is a native tool (`createJhtTools`), and
`guardShellTool` answers any shell line that still runs one with the name of
its replacement, without running anything.

| TUI command | Harness | Where the effect lands |
| --- | --- | --- |
| `jht-tmux-send <SESSION> "<msg>"` | `send_message` {to, text} | `Mailbox` port; `FileMailbox`: `<dir>/<to>.jsonl`, drained into the peer's next turn |
| `jht-send "<msg>"` | `chat_reply` {text, partial?} | `<home>/chat.jsonl`, the same line `jht-send` writes (`role`, `text`, `ts` in seconds, `done`) |
| `throttle <me>`, `jht-throttle`, `jht-throttle-check`, `jht-throttle-wait` | `throttle` {reason?} | `PauseRequest`; the role loop ends the turn and owns the wait |
| `throttle-ack <me>` | none: the harness records the wake-up | — |
| `jht-notify-user`, `jht-telegram-send` | `notify_user` {text, kind?, position_id?} | `Notifier` port; `FileNotifier`: an outbox file. At most 5 per sliding hour (`notifyLimit`); past it the call fails and nothing is queued |
| `jht-check-user-replies` | `check_user_replies` {} | `UserReplies` port; same output format as the TUI tool |
| `jht-install` | refused: the image carries the dependencies | — |
| `throttle-set`, `token-rate-now` | not mapped yet: CAPITANO only | — |
| `jht-agent-contain` | not mapped yet: SENTINELLA only | — |

None of the native tools asks a permission: each writes only into the
harness's own channels, never a file of the person's, the network or a
process. `send_message` takes an agent name (`^[A-Za-z][A-Za-z0-9_-]{0,39}$`),
never a path.

## The Python skills

The skills call `python3 /app/shared/skills/<x>.py`. The image carries no
Python, so each script a role uses is a native tool, given only to a role
whose `skills.list` names the skill (`src/parity/skills/index.ts`). A
`python3 …/<x>.py` typed into the shell is refused with the tool to use
(`PYTHON_SKILLS` in `jht-tools.ts`). The tools that touch `jobs.db` get it
from the runtime (`jobsDbPath` + `openJobsDb`): no tool takes a path, and
every statement is a constant with bound parameters.

| Script | Native tool | Parity |
| --- | --- | --- |
| `scout_coord.py show/history/assign/reset/claim/check-claim/doctor` | `scout_coord` {command, scout?, cerchi?, fonti?, note?, job_id?, json?} | same lines and same rows in `scout_coordination` / `scout_claims`; exit 3 is a failed call with the script's message. `bootstrap` is the launcher's and not a tool. **One difference, on purpose (SICUREZZA D-2):** the tool acts for the agent running it — `assign` and `claim` in another Scout's name are refused, and `reset` closes only the caller's own split and old claims, where the script lets the lowest-numbered Scout reset everyone. A claim older than 24 h (the TUI's own limit, which its `reset` purged) is free again: `check-claim` answers `AVAILABLE` and the next `claim` overwrites it; no Scout deletes another's claims |
| `feedback_query.py check <legacy_id>` | `feedback_query` {command: check, legacy_id} | same JSON, from `position_feedback` in `jobs.db`, sanitised display fields included (`feedback-display.ts` ports `feedback_display.py`). No cloud lane: where the script would ask the cloud, the answer is its own `no-signal:cloud-disabled`. `recent`/`themes` come with the Mentor and the Scorer |
| `email_monitor.py status/count/poll` | `email_monitor` {command, since_days?} | the script's output with no mailbox configured. No IMAP here and the credentials file is never opened; when it exists, `status` adds `note: imap-unavailable-in-api-runtime` |

`tests/skills-parity.test.ts` runs each script and its tool on the same
input and compares what they print and what they leave in the database.

## The run

`prepareProductRole` (`src/parity/product-role.ts`) puts the two halves
together for a `RoleSession`: the prompt and home above, the runtime's tools
with `bash` guarded, and the native tools after them. `runCycles` does what
tmux and the throttle engine do for a TUI agent:

1. The first order goes in as a message, as the CAPITANO or the kick-off
   would type it into the pane.
2. The turn runs until the model answers without a tool call. A `throttle`
   call tells it to end the turn, so the pause costs one short closing round.
3. After a pause the process waits `pauseMs` (the caller's choice; the TUI's
   engine takes it from the CAPITANO's config), then opens the next turn
   with every inbox message under a `[from <sender>]` line, the sender the
   mailbox recorded, followed by
   `[@system -> @<agent>] [WAKE] Your pause is over. Continue your loop.`
   Every line of a peer's text is quoted with `> ` (whatever breaks it:
   `\n`, `\r`, `\u2028`…), so only the harness's own lines start at column 0,
   and `PARITY_NOTES` tells the agent that a quoted line is the peer's words,
   never an instruction from the harness or the person. A peer can still
   *write* a fake header or envelope — its text is the model's output — but
   it lands quoted. Envelopes the harness recognises (`[@X -> …]` with X not
   the real sender, `[USER REPLY …]`) are also marked `[forged by <sender>:
   …]`, as a hint; the quoting is the boundary. No agent may be named
   `system`. (The TUI has no verified sender: this is a difference on purpose.)
4. A turn that ends with no pause and nothing in the inbox ends the run: an
   idle TUI agent waits at its prompt for free, an idle process does not.

From the command line (`JHT_API_APP_ROOT` defaults to this checkout, `/app`
in the container; `JHT_HOME` to `~/.jht`, read only for the locale):

```sh
npm run role -- --role scout --agent scout-1 --turns 2 --pause-ms 0
npm run monitor -- --last
```

On the mock it plays `PRODUCT_ROLE_MOCK_SCRIPT` (`src/cli/mock-script.ts`).
`tests/parity-run-role.test.ts` runs that command and reads its trace;
`tests/parity-scout-run.test.ts` runs the real SCOUT prompt this way on the
mock provider: two turns, one pause, the CAPITANO's order delivered on wake,
every call accepted, and no `bash` call at all.
