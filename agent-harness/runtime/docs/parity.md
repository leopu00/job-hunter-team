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
(<home>/skills/<name>/SKILL.md)`, absolute: T10b). The identity comes first so the prefix is the TUI
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
   A script named as a file rather than run (`Wrapper at
   /app/shared/skills/db_insert.py`) becomes "the db_insert tool", or is
   marked not available: the image has no `shared/` (T10b).
   A bare `` `check-url` `` or `` `db-query check-url` `` becomes
   `` `db_query check-url` `` (T12): `position-insert` says "`check-url`
   deduplicates" beside the dedup gate, and for three runs in a row the
   SCOUT called `scout_dedup check-url`.
   Everything else is the TUI text; `PARITY_NOTES` explains the tool calls.
   `tests/parity-run-role.test.ts` checks that the prompt and every `.md` in
   the home contain no `python3`.
7. **Document paths point where the API agent can open them** (T10,
   `src/parity/prompt-paths.ts`). The TUI text names files by the TUI
   container's paths; in T5-bis the API SCOUT built
   `/jht_home/agents/_skills/<x>/SKILL.md` from them and lost three rounds.
   Now `agents/_skills/<x>/…` (bare, `/app/…` or `/jht_home/…`) becomes
   `<home>/skills/<x>/…` for a skill in the home and
   `<appRoot>/agents/_skills/<x>/…` otherwise, both absolute (in T5-ter a bare
   `skills/<x>` read beside `_manual` became
   `/app/agents/_manual/skills/<x>/SKILL.md`); `agents/_manual/…` and `../_manual/…` (a link that is broken in
   the TUI too) become `<appRoot>/agents/_manual/…`; `agents/_team/…` and
   `../_team/…` become `<appRoot>/agents/_team/…` in the person's language
   when the repo has it (the copy beside the home is another role's state to
   the permission policy, so `read_file` would refuse it); `/app/` becomes
   `<appRoot>/`; `/jht_home/jobs.db` becomes "the
   team database (reach it only through the db tools)" and
   `/jht_home/logs/scout-dedup.log` the harness's log. The person's profile
   (`$JHT_HOME/profile`, `${JHT_HOME}/profile`, `/jht_home/profile`,
   `~/.jht/profile`) becomes `JHT_API_PROFILE_DIR`, or `<JHT_HOME>/profile`
   when it is unset (T10b: in T5-ter the container set the variable, the
   prompt still said `$JHT_HOME/profile`, `JHT_HOME` was unset, and the SCOUT
   searched without the profile). The permission policy reads that folder
   freely and refuses every write into it, in every mode
   (`readOnlyRoots`) — **with one exception, the ASSISTENTE** (T38): it is the
   only role that talks to the person and the only one that writes down what
   they said, so for it the profile is its own folder and the read-only root
   left is the person's history. The exception is by ROLE and not by folder
   (`writesProfile` in `role-policy.ts`), and the run test checks both halves:
   the ASSISTENTE's write of `candidate_profile.yml` goes through, the same
   write from a SCOUT is refused. `$JHT_USER_DIR` (the deliverables the TUI puts in the
   person's Documents: the CV, the cover letter, the review) becomes
   `JHT_API_USER_DIR`, or `<JHT_API_HOME>/user` — unset, a CV would have gone
   to `/cv/` (T25). That folder is what the **team makes**, and on a real box
   it sits beside what the **person already had**: 750 CVs and letters of
   their own, which reach the roles as another read-only root
   (`JHT_API_USER_HISTORY_DIR`, read freely, written by nobody, named in the
   rendered prompt beside the deliverables). The two are **siblings, never
   nested**: a read-only root wins over every own root whatever the mode, so
   with the deliverables inside the history every CV would be refused — the
   mount ashley ran for a day, safe but sterile, and the reason the agent
   read said "the person's profile". A configuration that nests them now
   stops at startup with that explained (`config.ts`), and the policy's
   behaviour in both layouts is pinned in `tests/user-folders.test.ts`. With `run-team` the
   deliverables are one shared volume, and least privilege holds them: `cv/`
   is the SCRITTORE's to write, `critiche/` the CRITICO's, every role reads
   both and nobody writes the folder itself
   (`src/parity/deliverables.ts`). A role creates its own subfolder and goes
   on when the mount refuses it, since where the launcher owns the tree the
   folders are already there; any other failure is raised. The filesystem
   carries the same rule (the deliverables root read-only, each subfolder
   setgid to its role): the runtime's refusal is a sentence the agent can
   report, the modes are what hold if it reaches for `bash`.
   Left alone: other paths under `$JHT_HOME`, which name
   state the agent writes. The CLI
   test resolves every document path of the prompt and of the home's
   Markdown: each must exist, and `read_file` must open it under the SCOUT's
   own permission policy, and the profile must be named and refused to
   `write_file` and `edit_file`. It renders from a copy of `agents/` alone, the
   image's layout, so a path into the checkout's `shared/` cannot pass.

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
| `throttle <me>`, `jht-throttle`, `jht-throttle-check`, `jht-throttle-wait` | `throttle` {reason?} | `PauseRequest`; the role loop ends the turn and owns the wait. The rendered text says so too (T21, `rewriteThrottleCommands`): `jht-throttle …` becomes the `throttle` tool, and the check-and-wait the prompts run before every task (`jht-throttle-check X \|\| jht-throttle-wait X`) becomes "nothing to run": a pending pause is the harness's. In the live chain the ANALISTA ran the check in the shell and lost a round to the guard |
| `throttle-ack <me>` | none: the harness records the wake-up | — |
| `jht-notify-user`, `jht-telegram-send` | `notify_user` {text, kind?, position_id?} | `Notifier` port; `FileNotifier`: an outbox file. At most 5 per sliding hour (`notifyLimit`); past it the call fails and nothing is queued |
| `jht-check-user-replies` | `check_user_replies` {} | `UserReplies` port; same output format as the TUI tool |
| `jht-install` | refused: the image carries the dependencies | — |
| the dashboard's "Write CV" button, `/cv <id>` on Telegram (`write_request.py`) | `npm run user -- cv <id>`, or the hub's `/v1/user/write-request` with the host's token | **the person's, never a role's** (T28). In the product `positions.write_requested = 1` is set by the PERSON, and no agent may set it for itself; in the harness there was no way to do it at all, so a live rehearsal faked the request with an UPDATE typed into the test database by hand (20/09). The port is `src/db/write-request.ts`, guards and JSON answer as in the script, checked against it case by case (`tests/write-request.test.ts`); a test also holds it as the runtime's only writer of the column. Not ported: the CV rework branch ([JHT-CV-REWORK]), which reads the PDF's layout check — a rework request is refused with that reason, as `db_query next-for-scrittore` already says |
| `pandoc … --pdf-engine=wkhtmltopdf` | `render_pdf` {source, title, output?} | **the renderer is a tool, never a shell command** (T30, SICUREZZA §10 P1). wkhtmltopdf is a whole WebKit and the markdown it renders is written from scraped job ads: by default it follows `file://`, loads remote images and runs JavaScript, and the PDF is the only thing the product sends to a company. So the runtime runs both programs itself with a fixed argument vector — pandoc `--sandbox`, then `--disable-local-file-access --disable-javascript --no-images --proxy http://127.0.0.1:1` — and strips every element that can fetch or run from the HTML before the engine sees it — in that order: **the network fence is the proxy**, the stripping is a second layer (a regex that keeps `<style>`, so a remote `@import` inside one goes through it and only the dead proxy stops it: SICUREZZA measured both, 21/09); the model chooses only the source, the title and the destination, both confined to the deliverables (its own folder to write). Measured in the image's own toolchain (pandoc 2.17, wkhtmltopdf 0.12.6, 21/09): the deny flags alone are **not** enough — a `<link rel="stylesheet" href="http://…">` written into the markdown was still fetched and the listening server saw the request, and `--disable-external-links`/`--disable-internal-links` are ignored by Debian's unpatched Qt, which says so on stderr. With the proxy at a closed port and the HTML stripped, the same hostile markdown renders with zero requests, no `file://` read ("Blocked access to file …") and exit 0; without the stripping a blocked `<iframe>` makes the engine exit 1 on a good PDF. The two flags stay: a patched Qt honours them. Same page size, margins and base layout as `cv-structure/SKILL.md`; the layout CSS ships with the runtime because the image has no `shared/`. Where the box has no toolchain the call fails with the old sentence: deliver the markdown, record it with `db_update application --cv-path`, say no PDF was rendered. The size and Producer gates stay the agent's — the tool reports the size, and the engine is no longer something the agent can get wrong |
| `pdftotext`, `pdffonts` | run where the box has them | **detected, not declared** (T25 follow-up). Poppler measures a PDF, it does not make one: the harness refuses these two only where the executable is not on `PATH`. The image gained pandoc, wkhtmltopdf and poppler in T24-b, this table still said they were missing, and a SCRITTORE that had just seen `/usr/bin/pdftotext` with `command -v` was told poppler did not exist — it spent its whole cap looking for another way and delivered nothing. `pdf_layout_check.py` is Python and the image has no interpreter: it is still marked not available, and a native tool for it is open work |
| `start-agent.sh`, `roll_worker_number.py`, `tmux …`, `jht-agent-contain` | `spawn_agent`, `list_agents`, `stop_agent` (the CAPITANO, with a hub) | the TUI's team is tmux sessions; here agents are containers the hub's launcher starts (T22), which picks the instance and holds every limit. The shell guard answers each with the tool to use and runs nothing; the rendered text names `spawn_agent` for `/app/.launcher/start-agent.sh` and marks the rest of `/app/.launcher/`, `/app/cli/bin/jht.js` and the hyphenated scripts (`throttle-config.py`, `agent-speed-table.py`) as not in the harness (T21). Without a hub the CAPITANO has no spawn |
| `throttle-set`, `token-rate-now` | not mapped yet: CAPITANO only | — |
| `jht-agent-contain` | not mapped yet: SENTINELLA only | — |

Agent names are canonical everywhere they decide who is who
(`src/core/agent-id.ts`): a bare role name is instance 1, as
`start-agent.sh` numbers it, so `scout`, `scout-1` and `SCOUT-1` are one
agent — one inbox, one "that is you", one owner of its rows in jobs.db
(where rows an earlier run wrote as `scout` are still its own).

None of the native tools asks a permission: each writes only into the
harness's own channels, never a file of the person's, the network or a
process. `send_message` takes an agent name (`^[A-Za-z][A-Za-z0-9_-]{0,39}$`),
never a path.

## The Python skills

The skills call `python3 /app/shared/skills/<x>.py`. The image carries no
Python, so each script a role uses is a native tool, given only to a role
whose `skills.list` names the skill (`src/parity/skills/index.ts`), or whose
prompt runs the script without a skill listing it (the ANALISTA's `ticket`,
`role_registry`, `deadline_extract`, and `db_insert` for companies; the
CAPITANO's `team_directives`, `enrichment_policy`, `email_monitor`, `ticket`,
`role_registry`; the SENTINELLA's `bridge_mailbox` and `burn_intent`). What
each role may run in the database, subcommand by subcommand and status by
status, is one table, `src/db/role-policy.ts`: the TUI keeps that boundary in
the prompt ("NEVER touch `scores`"), the harness in code. A
`python3 …/<x>.py` typed into the shell is refused with the tool to use
(`PYTHON_SKILLS` in `jht-tools.ts`). The tools that touch `jobs.db` get it
from the runtime (`jobsDbPath` + `openJobsDb`): no tool takes a path, and
every statement is a constant with bound parameters.

| Script | Native tool | Parity |
| --- | --- | --- |
| `scout_coord.py show/history/assign/reset/claim/check-claim/doctor` | `scout_coord` {command, scout?, cerchi?, fonti?, note?, job_id?, json?} | same lines and same rows in `scout_coordination` / `scout_claims`; exit 3 is a failed call with the script's message. `bootstrap` is the launcher's and not a tool. **One difference, on purpose (SICUREZZA D-2):** the tool acts for the agent running it — `assign` and `claim` in another Scout's name are refused, and `reset` closes only the caller's own split and old claims, where the script lets the lowest-numbered Scout reset everyone. A claim older than 24 h (the TUI's own limit, which its `reset` purged) is free again: `check-claim` answers `AVAILABLE` and the next `claim` overwrites it; no Scout deletes another's claims. A Scout started without a number (`--role scout`, no `--agent`) is `scout-1`, as `start-agent.sh scout` makes it SCOUT-1, and `scout` as a name always means the caller |
| `feedback_query.py check <legacy_id>` | `feedback_query` {command: check, legacy_id} | same JSON, from `position_feedback` in `jobs.db`, sanitised display fields included (`feedback-display.ts` ports `feedback_display.py`). No cloud lane: where the script would ask the cloud, the answer is its own `no-signal:cloud-disabled`. |
| `feedback_query.py recent/themes` | `feedback_query` {command: recent\|themes, days?, limit?, legacy_ids?, …} | the SCORER's `themes` and the Mentor's `recent`, rule for rule: the same stopwords, the share rounded half-even to three digits, ties by code point. Both read the cloud aggregate unless given `legacy_ids`; the runtime has no cloud, so without them the answer is the script's `no-signal:cloud-disabled`, and with them it aggregates the local rows as the script does (T15) |
| `db_query.py` | `db_query` {args} | the words after the script name as `args`; same output byte for byte and same exit code. Ported: the SCOUT's `check-url`, `position`, `positions`, `recent-activity`; the ANALISTA's queues (`next-for-analista`, `-recheck`, `-categorize`, `-salary-precise`, `-geocoding`, and in care mode `-recheck-due`/`-recheck-weekly`, `-geocode-missing`, `-logo-missing`), `company`, `companies`, `stats`, `check-history`, `active-categories`, `other-pile`, `category-sizes`; the SCORER's `next-for-scorer` (T14/T15). Each role runs only its own (`role-policy.ts`); the others are refused. The care-mode queues obey the person's enrichment policy (`enrichment-policy.ts`, read from the profile folder where the Python reads it next to `jobs.db`), and are off when there is none to read |
| `db_insert.py position` | `db_insert` {args} | same output, exit code and rows in `positions` and `position_state_transitions`: fields from the page flattened first, dedup and INSERT in one `BEGIN IMMEDIATE`, company id by name. `company`, `score`, `application`, `highlight` are other roles' and refused (SC-03). Two differences on purpose: `found_by` is the agent the runtime runs, not `--found-by` (D-5), and a DUPLICATE answer fences the existing row's company and title, which a page wrote (D-4) |
| `db_update.py position/company` | `db_update` {args} | the whole script (`db-update.ts`): every flag, the role-family write-guard, the liveness rule on `last_checked`, the geocoding acknowledgement, the maintenance history and its refusal to close on an inconclusive check; same output, exit code and rows in `positions`, `companies`, `position_state_transitions`, `maintenance_events`. **Narrower than the script on purpose**, per role, checked before the call and bound in the UPDATE's WHERE: the SCOUT only `--status excluded`/`--notes` on a `new` position it found (D-3); the SCORER claims a `checked` position and moves it to `scored` or `excluded`, notes only with the exclusion; the ANALISTA writes any field while analysing (`new`, `checked`), only liveness, category and office past it (`scored`…`ready`), nothing once applied or excluded, and moves `new` → `checked`/`excluded` or excludes a later one (A-1) — only on a recorded proof: past the analysis, `--status excluded` or `--is-open false` takes `--action liveness_check --outcome confirmed_closed` and an evidence (`--evidence-code` or `--evidence-url`), or is refused (A-3). `analyzed_by` on a company is the agent, never the argument (A-2). `--work-mode full_remote`, the word analista.md uses (it is `remote_type`'s), is taken as the column's `remote`, where the script refuses it (T21) |
| `db_insert.py company/highlight` | `db_insert` {args} | the ANALISTA's registry and highlights (RULE-08): same output and rows, the foreign-key failures included (`INSERT OR REPLACE` on a company positions point at). `analyzed_by` is the agent (A-2) |
| `db_query.py application <id>` | `db_query` {args} | the SCRITTORE's anti-rewrite gate (T25): same lines, and the same exit code, which is the answer — 1 means the Critic's verdict is already final, so the position is skipped, as `scout_dedup`'s 10 means skip. Company and title arrive fenced |
| `db_insert.py application` | `db_insert` {args} | the SCRITTORE's row: same output and columns. **Narrower on purpose:** the script's `INSERT OR REPLACE` would erase the verdict, the paths and the send of a row that already exists, so a second insert on the same position is refused and says to use `db_update application`; `written_by` is the agent the runtime runs (D-5). `--written-at now` stays the script's literal `'now'`, which the schema's CHECK rejects — here as `Error: INVALID TIMESTAMP…`, exit 1 |
| `db_update.py application <position_id>` | `db_update` {args} | the paths, the Critic's rounds and the application's status, with the script's UPSERT and its refusal to replace the CV of an application already sent or being sent (`sent_blocker` + the same guard bound in the UPDATE). The schema's own trigger still clears the Critic's verdict when `written_at` changes (O-64). **Narrower on purpose:** the SCRITTORE may pass only its own flags, `--status` only `draft`/`review`/`ready`, and `ready` only together with `--critic-verdict` (the single-writer rule, bug #21); `--reviewed-by` must be an agent name. The send and the outcome (`--applied`, `--applied-at`, `--applied-via`, `--response`, `--response-at`, `--interview-round`) are not ported at all: they move `positions` too and belong to the person and the CAPITANO |
| `deadline_extract.py --jd` | `deadline_extract` {args} | same date or empty line on 26 JDs, "today" given to both; the regexes read as Python's `str` patterns (Unicode digits, `\s`, `\b`). No stdin: a missing `--jd` is an empty JD |
| `ticket.py show/touch/resolve` | `ticket` {args} | same lines, errors and rows (RULE-15). **Narrower on purpose:** `touch` and `resolve` only on a ticket assigned to this agent, where the script lets anyone overwrite the answer the user reads; `open`, `assign`, `list-open`, `count-open`, `for-position` are the Capitano's and the Assistente's, refused |
| `ticket.py list-open/count-open/assign/for-position` | `ticket` {args} | the CAPITANO's queue (C-15, T21): same lines and rows, stale assignments returned to the queue by `list-open` (`JHT_TICKET_IDLE_HOURS`, default 6). The script asks tmux who is alive; the harness has none, so liveness is unknown — the script's own "nobody is declared dead" — and a ticket returns only for lack of progress, `assign` never warns of a dead session. `touch`/`resolve` are the worker's, refused to the CAPITANO. **Narrower on purpose:** `assign` takes only an agent name (`AGENT_NAME`, as `send_message`), where the script writes any text into the row the workers read. `open` is no role's here: the ticket's `request_text` is the person's, and no tool creates or rewrites it |
| `role_registry.py promote` | `role_registry` {args} | same output and registry/positions rows, `--dry-run` included (step 8). `--user-id` only for the local candidate; `pass` (legacy) refused. The CAPITANO gets `merge --into X --sources A B …` instead (C-17, T21): same output and rows, the sources dormant with `merged_into`; `promote` stays the ANALISTA's |
| `salary_estimate.py` | `salary_estimate` {args} | same levels and JSON (step 7). The cache is read from `<JHT_API_HOME>/cache/`, never written: `--seed-cache` refused |
| `enrichment_policy.py show` | `enrichment_policy` {args} | same JSON; `json.load`'s int/float distinction kept (a `70.0` threshold is ignored, as in Python). `set` is the Capitano's on the person's order: refused |
| `recheck_liveness.py <url>` | `recheck_liveness` {args} | same tiers, verdict JSON and exit codes (0 open, 1 closed, 2 unverified), compared on 14 fetch outcomes. No browser in the harness: where the script would render, the answer is its own no-Playwright case, `OPEN_UNVERIFIED` — never a false open. Fetched through the SSRF guard (the script ran `curl -L` to any address) |
| `safe_fetch.py` (office-geocoding) | `safe_fetch` {args} | for a role whose skills pass `--user-agent`/`--status` (the ANALISTA): same status line and exit codes (1 refused, 2 failed); https only, every hop through the guard; the body reaches the model inside the external-content markers. Other roles keep `web_fetch` (row above) |
| `logo_fetch.py` | `logo_fetch` {args} | same search order, validation, JSON and `companies` row, on 21 cases over one scripted web; the refusal's words are the guard's. `--force` bypasses the spending brake and is refused |
| `db_insert.py score` | `db_insert` {args} | the SCORER's write (T15): same output, exit code and `scores` row. `profile_gate.py` first, ported in `profile-gate.ts` and judged against the script on 44 profiles (the YAML read as PyYAML reads it), on `candidate_profile.yml` in the runtime's profile folder; then the caps of `score_ranges.py`; then the upsert that keeps `scores.id`. Two differences on purpose: `scored_by` is the agent the runtime runs (as D-5), and `--action` with the maintenance history is the Mantenitore's and refused. Only the SCORER may write a score (`role-policy.ts`) |
| `validate_profile.py <path> [--strict] [--json]` | `validate_profile` {args} | the ASSISTENTE's gate (T38, A-02: every write of `candidate_profile.yml` is followed by it). Same checks, same WARN/ERROR lines, same `VALID_PROFILE`/`INVALID_PROFILE` and exit code, judged against the script on 24 profiles × 3 flag sets — the YAML read as PyYAML reads it (`pySafeLoad`, the reader the score's gate uses: one reader, not two). Narrower than the script on one point: it reads the person's profile folder and the agent's own, nothing else, so a validator cannot become a file reader with a nice name. The `python3 -c 'import yaml; yaml.safe_load(...)'` of A-02 is rewritten to this tool in the rendered prompt |
| `profile_review.py`, `rate_budget.py` | not available in the API harness | **open work, declared** (T38). `profile_review.py` stages a CV-extracted change and confirms it with a compare-and-swap that the person approves **in the desktop UI**: there is no UI here, so the staging half has no other end. `rate_budget.py` is the ASSISTENTE's rarest path (`plan` only, "if the user asks how the team is doing"). Both keep the generic refusal, which names them and says there is no interpreter; the ASSISTENTE writes the profile directly, as `profile-yaml` has it do, and validates with the tool above |
| `safe_fetch.py <url>` | `web_fetch` {url} | the SCORER's check that a posting is still open. `web_fetch` applies the same guard (every hop resolved and checked, private addresses refused) and returns readable text, not raw HTML: `\| grep -i 'expired'` in the prompt becomes reading the page (T15) |
| `scout_dedup.py check` | `scout_dedup` {args} | same JSON and exit code (10 = skip, an answer, not a failure); a skip is appended to `<apiHome>/logs/scout-dedup.log` in the script's format. The script has no `check-url`: asked for it, the tool answers argparse's error and then `check-url is a db_query subcommand: db_query check-url <url>` (T10) |
| `email_monitor.py status/count/poll` | `email_monitor` {command, since_days?} | the script's output with no mailbox configured. No IMAP here and the credentials file is never opened; when it exists, `status` adds `note: imap-unavailable-in-api-runtime` |
| `db_query.py dashboard/next-for-scrittore/next-for-critico` | `db_query` {args} | the CAPITANO's pipeline reads (T21), same output and exit code, `--json` included. `next-for-scrittore` lists the CV and cover-letter requests as the script does; a `[JHT-CV-REWORK]` request needs `application_rework.py` (the CV's layout check, the send state) and does not show |
| `format_time.py --now/--iso` | `format_time` {args} | the CAPITANO's clock (C-04 bis): same lines, the zone from `JHT_USER_TZ`, then `timezone:` in the profile, then UTC. The zone's name is Node's ICU where Python reads the system's tzdata: the same abbreviation for Europe, a numeric offset (`+04`) where ICU has none |
| `captain_diary.py add/handoff/today` | `captain_diary` {args} | `add` writes the script's files and lines (C-21). The diary is the team's state: `<JHT_API_HOME>/team/logs/`, never the profile, which is mounted read-only. **Narrower on purpose (CAP-1):** the diary outlives the session, so an injected "lesson" would reach the next day's Captain. A note is at most 500 characters; `handoff` and `today` reread the last 30 notes within 8 KB, each quoted with `> `, and `handoff` presents them as the previous session's own notes, not instructions from the person or the system, where the script prints the file whole and says "inherit these lessons" |
| `team_directives.py active/list/show` | `team_directives` {args} | same lines (C-06), from `team_directives` in `jobs.db`. `add`, `edit`, `archive` are the person's: refused |
| `bridge_mailbox.py drain/peek/status/reset` | `bridge_mailbox` {args} | the SENTINELLA's safety net under a lost delivery (T37): the pacing bridge appends every verdict whether or not a pane received it, and the reader advances a byte cursor. Same lines, same exit code and **the same cursor left behind** — compared as sequences (drain, drain again, status), because the cursor is state and one call on its own would prove less. The script's own edge cases are the cases: a cursor past the end of the file rereads from zero, a cursor that is not a number is a zero, and a line that is not JSON is skipped by the reader while `status` still counts it |
| `burn_intent.py status [--json]` | `burn_intent` {args} | whether the person has suspended the daily ceiling (S-10), the read the SENTINELLA must do in the turn where it would send a daily brake. Same JSON key for key — the int/float of `hours` included, which `json.load` keeps apart and `JSON.parse` does not — the same banner line, and the same fail-closed: missing, unreadable, malformed, or without an expiry all answer `active: false`, so a failed read is never a licence to speed up. **Narrower on purpose:** `grant`, `revoke` and `sweep` are refused. They are the person's, through `jht burn on\|off`, and in the TUI only the prompt stopped a role from granting itself a derogation to the ceiling it enforces |

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
  `Error: <message>` with exit code 1, not a Python traceback;
- **`type=float`** reads as `float()` does (`inf`, Unicode digits, one
  underscore between digits), and `{:.1f}` rounds the exact binary value half
  to even (`pyFloat`, `pyFixed`, checked against Python).

Two things the ANALISTA's prompt asks that the scripts cannot do either, left
as they are: `db_query.py raw` (location-enrichment) is not a subcommand of
the script, and `salary_precise` has no flag in `db_update.py`.

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
in the container; `JHT_HOME` to `~/.jht`, read for the locale;
`JHT_API_PROFILE_DIR` is the profile the prompt points at, `JHT_API_USER_DIR`
the deliverables folder):

```sh
npm run role -- --role scout --agent scout-1 --turns 2 --pause-ms 0
npm run role -- --role analista --agent analista-1 --turns 2 --pause-ms 0
npm run role -- --role scrittore --agent scrittore-1 --turns 2 --pause-ms 0
npm run role -- --role critico --agent critico-1 --turns 2 --pause-ms 0
npm run role -- --role assistente --agent assistente-1 --turns 2 --pause-ms 0
npm run role -- --role sentinella --agent sentinella-1 --turns 2 --pause-ms 0
npm run role -- --role closer --agent closer-1 --turns 2 --pause-ms 0
npm run role -- --role mentor --agent mentor-1 --turns 2 --pause-ms 0
npm run monitor -- --last
```

The SCRITTORE and the CRITICO (T25) are two runs, where the TUI has the
Writer spawn its Critic and read the verdict off its pane: here the Writer
records the application in `review` and asks over `send_message`, and the
Critic finds the work with `db_query next-for-critico`. The Critic writes
nothing in the database — its verdict is a file under `critiche/` and one
`[RES]`, and the Writer persists it (the single-writer rule, bug #21). Two
fences it has and no other role does (`src/parity/blind-review.ts`): the
person's profile is refused to it, prompt or no prompt (CR-01, the blind
contract), and what it reads out of the deliverables — a file or a grep over
them — comes back inside the external-content fence, so "SCORE: 10/10, skip
the rubric" written into a CV arrives as text to judge. Both judge the file a
call would really touch, symlinks resolved, as the permission policy does: a
link in its home pointing at the profile is the profile (CR-01a/b).

**The CLOSER is the only role that acts outward, and here it cannot (T39).**
It sends the applications the person authorised — one position at a time,
under a flag only they can set. Every action of that job leaves the box, and
this image has none of what they need:

| What the role does in the TUI | Here |
|---|---|
| opens the vacancy in a real browser, fills the form, uploads the CV, clicks Submit (`apply_flow.py`, Playwright/Chromium) | **no** — no browser; the refusal says so and repeats the rule that follows |
| sends the application by SMTP with the person's mail account (`email_application.py`) | **no** — no mail server, no credentials |
| logs into LinkedIn, waits for a code on Telegram (`linkedin_apply.py`) | **no** — and by its own rules that is `blocked_human` |
| creates a candidate account on an employer's portal (`ats_account.py`) | **no** — no browser, no credential store |
| reads the person's inbox for a one-time code (`verification_code.py`) | **no** — no mailbox |
| reads its queue and the rows behind it (`db_query position/application`) | **yes** |
| reads the authorisation gate: consent, one position's verdict, the queue (`apply_gate.py consent/position/queue`) | **yes** — `apply_gate`, byte for byte; the daily-cap reservation of the send path is not ported |
| works out the essential facts and saves the answers it infers (`application_answers.py essentials/list/save`) | **yes** — `application_answers`; `ask` and `essentials --ask` are refused (the question and its returning reply have no path here) |
| tells the person, once for the whole round | **yes**, through `notify_user` |
| reports to the CAPITANO | **yes**, through `send_message` |

And the one that matters most: **no role in this harness can mark an
application sent.** `--applied`, `--applied-at` and `--applied-via` are not
ported at all (`db-update.ts`), and `--status applied` on a position is
refused. In the TUI "no receipt, no `applied`" (CL-02) is a rule the role must
obey; here it is a thing that cannot be done — which is the right shape for
the one write that reaches a company under a person's name.

The rehearsal is therefore a rehearsal of a refusal: the flow is refused with
what is missing, the sent state is refused, the person is told once, the
CAPITANO gets the `[BLOCKED]`, and the position is left exactly as it was —
authorisation included. `tests/parity-closer-run.test.ts` asserts the rows are
byte for byte the ones that were there before.

The gate and the answers are ported as tools (T39, piece two,
`src/parity/skills/closer.ts`), judged against the scripts in
`tests/parity-closer-tools.test.ts`. The gate fails closed as the script does
— a missing or broken config, an absent consent, an unreadable rule each say
NO with a stable reason, and an unreadable queue is `queue_unreadable`, never
`queue_empty` (CL-04). The rule file is a copy shipped with the runtime, held
byte for byte against `shared/cloud/apply-request-rule.json`.

**The CV's layout is measured here too (T39, piece three).**
`pdf_layout_check.analyze` is ported in `src/parity/skills/pdf-layout.ts`,
report for report against `--json`; poppler is detected on the box, never
declared, and where it is missing a CV is held `cv_pdf_check_unavailable`, as
the script holds it. Three differences, all on purpose:

- **a failed CV does NOT go back to the SCRITTORE by itself.** In the product
  the gate that finds `cv_pdf_layout_bad` also opens a rework request for the
  Writer (`_request_cv_rework`) — a write, from what is otherwise a read. Here
  the gate stays a pure reader (the CAPITANO reads it too): the position is
  held `cv_pdf_layout_bad` and nothing more. When a rework is needed, it is
  asked by the one who decides — the CAPITANO — not by the gate (MASTER,
  21/09). This is a declared difference, not a missing piece;
- **the CV's path is confined.** It comes from the database, and the script
  takes any absolute path, `../` or link. That was an existence check; here
  the gate READS the file (a hash and three poppler runs, for the CLOSER and
  the CAPITANO), so the path must resolve — links followed — inside the CV
  folders: the deliverables' `cv/` and the hub's own. **Never the team's home**
  (SICUREZZA): the product keeps the person's credentials there — portal
  passwords, the IMAP login — and this path comes from a column a model
  writes. Anything else is held `cv_pdf_path_outside` and the file is never
  opened; the check comes before any `stat`, so the answer cannot tell what
  exists on the box. The script has no such reason;
- the page-1 preview the script renders for a failed CV is not made: it is a
  write, and there is no dashboard here to show it. `save` writes only
`application_answers`, and never over an answer the person gave
(`user_answer_kept`, CL-01).

**The MENTOR reads, and speaks to the person (T40).** It is the one voice
with the standing to tell the person "it is a craft you lack, not a
position", and that standing rests on two things its prompt says of itself:
it only reads (M-04: never `db_insert` / `db_update`, never the profile), and
the reasons the person types are spoken back to the person, "never to the
Scout" (`mentor-patterns`, Pattern F). Here both are fences:

| What the prompt says | Here |
|---|---|
| read-only in the database (M-04) | its DB policy reads positions, applications, the board and recent activity; no write tool is built for it at all (`db-update` is not in its skills) |
| never modifies the profile | the profile is writable by the ASSISTENTE only (`profileWritables`) |
| escalation, rare, to the Capitano; the DOTTORE via `spawn-doctor` | `PEER_POLICY`: the CAPITANO and the DOTTORE, nobody else — a message to a worker is refused with the rule |
| the outcome funnel of what was sent (Pattern D) | `db_query applications`, ported for this role byte for byte with `db_query.py` (`tests/db-query.test.ts`) |
| the person's reasons (Pattern F) | `feedback_query`; with no cloud lane `recent`/`themes` answer `no-signal:cloud-disabled`, as the script does with the cloud off |
| `jht-send` for its three formats | `chat_reply` |

`tests/parity-mentor-run.test.ts` runs the daily pass on the mock: it reads
the sets and counts, tries to mark a position and to tell the SCOUT what to
search — both refused — and says one number to the person. The rows and the
profile are byte for byte the ones that were there before.

Not ported, and why: the welcome handshake (`[WELCOME-USER]`,
`mentor-welcomed.flag` in the profile) is the TUI's bridge dispatching a
marker into a pane, and the flag lives in a folder this role cannot write.
And three commands its `mentor-patterns` skill documents do not exist in
`db_query.py` either — `positions --limit/--order-by`, `scores`,
`applications --critic-score-max` — so Patterns A, C and E fail in the TUI as
they do here, with the same argparse error. That is a product defect, not a
harness one, and is reported as such.

**The SENTINELLA advises one agent, and here that is a fence (T37).** Its
prompt opens with RULE #0 — "DO NOT talk to other agents except the Capitano"
— and its `spawn-doctor` skill adds the one exception, the DOTTORE it may
raise when an agent stops consuming mid-window. In the TUI that rule is a
sentence: every agent reaches every pane through the same wrapper. Here it is
a table (`src/parity/peers.ts`), because this is the role that would be
believed if it gave orders — it carries numbers nobody else has, and its whole
job is to advise the one agent who decides. A message to any other name is
refused with the rule, the name and what to do instead, and nothing is
delivered; every other role keeps the team's default, anyone. The tool's own
description says who it may write to: a fence a model meets only as an
unexpected refusal teaches it nothing.

It touches **no database at all** — not a read, not a write (`role-policy.ts`
says so explicitly, although an absent role may already do nothing: an
unwritten rule is one no test can hold). Its data is the bridges' files, and
of the scripts it runs two port as they are, because they are pure reads of
the team's home: `bridge_mailbox` and `burn_intent status`.

**What wakes it, and what it cannot do here.** Everything else about this role
is host-side, and it is worth naming rather than quietly leaving out:

- **the tick.** In the TUI a Python bridge samples usage every five minutes
  and types `[BRIDGE TICK] usage=… proj=… status=…` into the SENTINELLA's
  pane; there is no pane here, and no bridge. The harness **recomposes the
  tick** from the numbers it already keeps — the team's spend ledger, one line
  per live run — and hands it to the role as **the turn's input**, never as a
  tool. Never as a tool on purpose: a tool would let the role ask for a tick
  again and again, which is spend for nothing, and the thing being ported is
  its DECISION (silence or advice, and which throttle), not the pipe that
  delivers the numbers. A `--task` given by hand still wins: that is how a
  person asks it something.

  The arithmetic is the skills' own — `(TARGET − usage) / ore_al_reset` with
  TARGET 92 unless one was computed (`decision-throttle`), the proj→state
  bands, the S-05 ladder from `proj` to `suggested_throttle_s` with the freeze
  past 200%, and the reset-edge guard of the last half hour, where the
  projection is diagnostic and nothing brakes on it. Two things are decided
  here and worth naming: a window that has just opened has **no velocity**
  (dividing a first burst by a few seconds reads as a catastrophe, which is
  how the old prompt produced EMERGENZA on five consecutive windows, S-04),
  and what this runtime cannot know is **named in the line** — the weekly
  axis, the day's ceiling, each agent's cadence — with the prompt's own
  instruction to report it. A tick that quietly left them out would read as
  "all clear on the weekly", the exact mistake S-07 exists to end.

  **Where the window comes from** (MASTER, 21/09), because the percentages
  mean nothing without one: **with the hub** it is the session the launcher
  already keeps — it opens when the team starts, closes when it ends, and
  carries its own cap and what it has spent, so nothing is declared twice.
  **Without the hub** it is three variables declared by whoever starts the
  run: `JHT_API_WINDOW_START`, `JHT_API_WINDOW_HOURS`, `JHT_API_WINDOW_USD`;
  half a declaration is no declaration. There is deliberately **no third
  source**: a five-hour block anchored at midnight would be deterministic and
  arbitrary, and invented data that looks measured is worse than data that is
  missing — the SENTINELLA would advise on it. When neither source is there
  the tick says `status=FINESTRA-NON-DICHIARATA`, carries the dollars the
  ledger really holds (never a percentage of a budget nobody declared) and
  tells the role to report that the pacing is not measurable yet;
- **the freeze.** `freeze_team.py` sends Escape twice to every tmux session
  but the coordinators', and `soft_pause_team.py` writes a pause into each
  pane. An API role has neither. The equivalent — stop the roles — is the
  hub's, with its own identity, the shape `save_review` already has: the role
  asks, the hub acts. Until then a `python3 …/freeze_team.py` typed into the
  shell is refused with the reason, which is what the run test asserts;
- **the fallback that reads a screen.** `check-usage-tui` opens a second tmux
  session, starts a provider's CLI in it, sends `/usage` and reads the
  rendered modal with the model's own eyes. It has no container-safe
  equivalent and is not ported;
- **`spawn-doctor.sh`** creates a session and launches a REPL: the hub's
  spawn, not a role's shell.

**The review loop runs in one process (T33).** In the TUI the Writer spawns a
fresh `CRITICO-S<N>` session per round through the launcher, sends it the PDF
and the JD, reads the verdict off its pane and kills it (`critic-loop`). In
the harness the Writer runs the three rounds with the `agent` tool: the Critic
is a one-shot **subagent** it owns, with the Critic's prompt and skills and a
context of its own, thrown away when it reports. COORD accepted that as
parity — a one-shot Critic owned by the Writer, in both worlds — and the trace
shows each round, so the loop is readable where the TUI had a pane.

Two things follow, and neither is cosmetic:

- **The Critic has the Writer's uid.** A subagent shares the process, so it
  shares the user the kernel sees. The deliverables are separated by ownership
  (`cv/` the Writer's, `critiche/` the Critic's), and one process cannot be on
  both sides of that line: on the live chain of 21/09 the loop ended with a
  verdict (NEEDS_WORK, 7.2) and `critiche/` stayed empty — the review existed
  only in the trace. The verdict is therefore written by the **hub**, which
  has a uid of its own and the text in hand (T34); giving the Writer the right
  to write `critiche/` would let the reviewed rewrite its own review, which is
  the one thing that separation buys.
- **A fence that is mounted per role is not mounted for a subagent.**
  `blindReviewTools` is applied when the ROLE is the CRITICO; the in-process
  Critic is the `agent` tool, which inherits the parent's tools. So in the
  live chain the blind contract (CR-01) and the fence around the document
  under review are the prompt's word, not the runtime's. Open work, and the
  shape of the fix is to hand the `agent` tool the already-fenced list when
  the Writer is the one calling it.

On the mock it plays `PRODUCT_ROLE_MOCK_SCRIPT` (`src/cli/mock-script.ts`),
or the role's own: the SCORER's, and the ANALISTA's (`ANALISTA_MOCK_SCRIPT`,
T14), which takes the position the SCOUT left in `new`, extracts its deadline
and rough salary, registers the company, writes the analysis and moves it to
`checked` (`tests/parity-analista-run.test.ts`, offline: no network tool).
`tests/parity-run-role.test.ts` runs that command and reads its trace;
`tests/parity-scout-run.test.ts` runs the real SCOUT prompt this way on the
mock provider: two turns, one pause, the CAPITANO's order delivered on wake,
every call accepted, and no `bash` call at all.
