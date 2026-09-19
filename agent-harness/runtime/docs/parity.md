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
| `jht-notify-user`, `jht-telegram-send` | `notify_user` {text, kind?, position_id?} | `Notifier` port; `FileNotifier`: an outbox file |
| `jht-check-user-replies` | `check_user_replies` {} | `UserReplies` port; same output format as the TUI tool |
| `jht-install` | refused: the image carries the dependencies | — |
| `throttle-set`, `token-rate-now` | not mapped yet: CAPITANO only | — |
| `jht-agent-contain` | not mapped yet: SENTINELLA only | — |

The `python3 /app/shared/skills/*.py` commands in the skills (`db_query.py`,
`db_insert.py`, `scout_coord.py`, …) are not `_tools` and still run through
the shell tool.

None of the native tools asks a permission: each writes only into the
harness's own channels, never a file of the person's, the network or a
process. `send_message` takes an agent name (`^[A-Za-z][A-Za-z0-9_-]{0,39}$`),
never a path.
