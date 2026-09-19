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
6. **`python3` is gone from what the agent reads** (T6). In the identity,
   the skill descriptions and every Markdown file of the home,
   `rewritePythonSkills` turns `python3 …/<x>.py` into the name of the tool
   that replaces it (`db_query check-url 123`), marks a script with no tool
   `<x>.py (not available in the API harness)`, and says there is no
   interpreter where any other `python3` stood (`python3 -c`, `Bash(python3 *)`).
   Everything else is the TUI text; `PARITY_NOTES` explains the tool calls.
   `tests/parity-run-role.test.ts` checks that the prompt and every `.md` in
   the home contain no `python3`.
7. **Document paths point where the API agent can open them** (T10,
   `src/parity/prompt-paths.ts`). The TUI text names files by the TUI
   container's paths; in T5-bis the API SCOUT built
   `/jht_home/agents/_skills/<x>/SKILL.md` from them and lost three rounds.
   Now `agents/_skills/<x>/…` (bare, `/app/…` or `/jht_home/…`) becomes
   `skills/<x>/…` for a skill in the home and `<appRoot>/agents/_skills/<x>/…`
   otherwise; `agents/_manual/…` and `../_manual/…` (a link that is broken in
   the TUI too) become `<appRoot>/agents/_manual/…`; `agents/_team/…` and
   `../_team/…` become `<appRoot>/agents/_team/…` in the person's language
   when the repo has it (the copy beside the home is another role's state to
   the permission policy, so `read_file` would refuse it); `/app/` becomes
   `<appRoot>/`; `/jht_home/jobs.db` becomes "the
   team database (reach it only through the db tools)" and
   `/jht_home/logs/scout-dedup.log` the harness's log. Left alone: paths under
   `$JHT_HOME` that name the person's data or state the agent writes. The CLI
   test resolves every document path of the prompt and of the home's
   Markdown: each must exist, and `read_file` must open it under the SCOUT's
   own permission policy.

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
| `db_query.py check-url/position/positions/recent-activity` | `db_query` {args} | the words after the script name as `args`; same output byte for byte and same exit code (the four subcommands the SCOUT's skills call; the other 27 are other roles' and refused) |
| `db_insert.py position` | `db_insert` {args} | same output, exit code and rows in `positions` and `position_state_transitions`: fields from the page flattened first, dedup and INSERT in one `BEGIN IMMEDIATE`, company id by name. `company`, `score`, `application`, `highlight` are other roles' and refused (SC-03). Two differences on purpose: `found_by` is the agent the runtime runs, not `--found-by` (D-5), and a DUPLICATE answer fences the existing row's company and title, which a page wrote (D-4) |
| `db_update.py position <id> --status excluded --notes …` | `db_update` {args} | the SCOUT's one update, the duplicate recovery: same output, exit code and rows. **Narrower than the script on purpose**: only `--status excluded` and `--notes`, only on a position still `new` that this agent found (`found_by`, checked and in the UPDATE's WHERE, D-3); any other field, status or row is refused with the reason |
| `scout_dedup.py check` | `scout_dedup` {args} | same JSON and exit code (10 = skip, an answer, not a failure); a skip is appended to `<apiHome>/logs/scout-dedup.log` in the script's format. The script has no `check-url`: asked for it, the tool answers argparse's error and then `check-url is a db_query subcommand: db_query check-url <url>` (T10) |
| `email_monitor.py status/count/poll` | `email_monitor` {command, since_days?} | the script's output with no mailbox configured. No IMAP here and the credentials file is never opened; when it exists, `status` adds `note: imap-unavailable-in-api-runtime` |

`tests/skills-parity.test.ts` and `tests/db-*.test.ts` run each script and
its tool on the same input and compare what they print and what they leave
in the database. They take the scripts from git at the commit
`src/db/schema.sql` was dumped from, and skip where python3 or that commit
is missing (the image).

The DB tools read their arguments with `argv.ts`, which accepts what argparse
accepts (`--flag=value`, unique prefixes, `int()` with Unicode digits, last
one wins) and fails with argparse's error line and exit code 2. What differs
from the scripts, deliberately:

- **the usage line** above an argparse error is shorter; the error line is
  the same;
- **no `ensure_schema` per call**: the Python migrates and commits on every
  run, reads included. The harness's `jobs.db` is born with that schema
  (`jobs-db.ts`) and a read does not write;
- **a new fence nonce per call**, where the script has one per process: the
  harness is one long process;
- **a crash** (a locked database, a CHECK violated by a legacy row) is
  `Error: <message>` with exit code 1, not a Python traceback.

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
