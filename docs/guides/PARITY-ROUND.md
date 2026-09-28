# 🪞 Parity round — TUI team against API team

A parity round runs the two teams side by side for a few hours, on the same
queue and the same profile, and compares what each one wrote in its `jobs.db`.
It is how the [API team](API-TEAM.md) is held to the TUI team's behaviour, row
by row, instead of by impression.

Code: [`scripts/parity/`](../../scripts/parity/) — `parity_round.py` runs the
round, `jobsdb_parity.py` is the metre. Tests: `tests/test_parity_round.py`.

> ⚠️ The round starts paid API runs and reads a real person's database. The
> configuration file names hosts and paths: keep it **outside the
> repository**, and never commit a round's output (copies of `jobs.db`,
> diffs, reports).

## 🧭 What makes a round clean

A round gives a verdict only when the difference it measures comes from the
two runtimes and nothing else. Each condition below is a way an earlier round
went wrong, and each is now enforced by the script rather than remembered:

| Condition | Why | How the round holds it |
| --- | --- | --- |
| **Same code on both sides** | A box updated during the window compares two versions of itself against the other side | `check` refuses two revisions; during the window the TUI container's identity is read every tick, and a change stops the round and voids it |
| **Same candidate profile** | Different profiles make different searches and different scores | `check` compares the profile's `sha256` on the two boxes |
| **Known state on the API side** | A CAPITANO that finds old mailbox messages or an old diary acts on them — once it coasted for two hours on a stale "daily overspend" note | Mailboxes, notifications, replies, diaries, the old database and the old `STOP` are **moved** into an archive, never deleted; `check` runs again and refuses anything left over |
| **One seed** | Two databases that started apart cannot be compared | T0: the TUI database is copied, the seed is made from it, and the API database is prepared from the seed |
| **Copies on the clock** | Copies taken by hand at hours chosen on the fly compare different moments | One copy of both databases every `snapshot_every_min`, aligned to the clock, and one at the end, each diffed against the seed |
| **One budget, one backstop** | A launcher cap and a key-proxy cap that disagree stop the round at a moment nobody chose | The launcher's `sessionUsd` is set to the round's budget; `check` refuses a key proxy with too little left or far too much; the round stops itself when the spend since its start comes within 0.02 USD of the budget |
| **No API role already running** | A run started before T0 writes into the new database with the old one's memory | `check` refuses while any API role runs |

## 🛠️ Setup (once, outside git)

1. Copy [`round.example.json`](../../scripts/parity/round.example.json) to a
   private place (for example `~/.config/jht-parity/round.json`) and fill in
   its `<...>` fields.
2. Check each command in it against your two boxes: the example holds the
   shape of a TUI box running the product container and an API box running
   the harness under podman with its launcher and key proxy.
3. Deploy both sides from the **same commit**: the TUI image carries the
   revision as its OCI label, the API image as its hex tag (`jht-api:<rev>`).
   The round checks this; it does not do it.

The keys, by role:

| Key | Meaning |
| --- | --- |
| `out_dir` | Private directory for the rounds' output |
| `ssh_config` | Passed to `ssh -F`; the two `host` values are aliases in it |
| `tick_s` (60) | Seconds between two looks at the boxes |
| `snapshot_every_min` (60) | Minutes between two copies of both databases |
| `relaunch_min_s` (600) | Least time between two relaunches of the API team |
| `max_consecutive_misses` (10) | Ticks in a row a box may fail to answer before the round stops, not valid |
| `launcher_config` | The launcher settings for the round; `session` and `sessionUsd` are set by the round |
| `tui.*` | `transport` (`ssh` or `local`), `host`, `exec_prefix` (to run inside the container), `db`, `profile`, `revision_cmd` (prints the image's revision label), `identity_cmd` (prints the container's start time and image) |
| `api.*` | `transport`, `host`, `root`, `db`, `db_dir` (archived whole), `owner`, `profile`, `revision_cmd` (prints the image tags), `proxy_state` (the key proxy's JSON with `spent_usd` and `cap_usd`), `running_roles_cmd` (prints a count), `known_state_globs`, `launcher_config`, `stop_file`, `start_cmds`, `relaunch_cmds`, `stop_cmds` |

In the commands, `{key}` expands to that host's own scalar key (`{root}`);
any other brace, such as a `{{.Image}}` template, stays as written.

## ▶️ Running a round

```bash
R=~/.config/jht-parity/round.json

# 1. read only: are the two sides ready?
python3 scripts/parity/parity_round.py check "$R" --budget-usd 2

# 2. the plan, with nothing done
python3 scripts/parity/parity_round.py start "$R" --hours 10 --budget-usd 2

# 3. the round (long: run it in tmux or under nohup)
python3 scripts/parity/parity_round.py start "$R" --hours 10 --budget-usd 2 --yes

# the report again, from a round's directory
python3 scripts/parity/parity_round.py report <out_dir>/round-<stamp>
```

### `check`

Read only. Prints a JSON object — `ok`, the `problems`, and the `facts` it
read — and exits **0** when ready, **1** when not. A command that fails on a
box, or a configuration without its `tui` or `api` section, exits **2**; other
malformed configurations and a command that times out end with a Python
traceback instead.

It verifies:
- the two revisions match: the TUI's label, and the one hex tag among the
  API image's tags, where one is a prefix of the other and both have at
  least 7 hex digits (an empty label, or two different hex tags, is a
  mismatch);
- the candidate profile has the same `sha256` on both sides;
- with `--budget-usd`, the key proxy's room (`cap_usd − spent_usd`) is not
  below the budget minus 0.02 USD — it would stop the round first — and not
  above the budget plus 0.50 USD — it would be no backstop. Without
  `--budget-usd` the key proxy is not compared;
- no API role is running;
- no file matches `known_state_globs`.

A standalone `check` on a box that still holds an earlier round's files
answers "not ready": `start --yes` archives them before its own second check.

### `start`

`--hours` and `--budget-usd` are required: the window and the budget are the
operator's choice, not the script's.

Without `--yes`, it prints the plan and does nothing: no ssh, no output
directory.

With `--yes`, in order:

1. **`check`**, without the leftovers (they are about to be archived).
2. **T0.** The TUI database is copied through SQLite's backup API, opened
   read-only on the box and streamed on stdout: nothing is written there.
   The copy is checked for integrity, the seed is made from it, and the API
   database is prepared from the seed. A seed that holds mock rows is
   refused.
3. **Known state** on the API box, all moves and no deletions, into
   `<root>/archivio-<round>/`:
   - the whole database directory, replaced by a fresh one holding the
     prepared database;
   - every `known_state_globs` match (mailboxes, `notify.jsonl`, replies,
     diaries);
   - the old `STOP` file.

   The old launcher configuration is renamed beside itself to
   `<file>.usata-<round>`, and a new one is written with `session` set to
   the round's id and `sessionUsd` to the budget. A new `session` is what
   makes the launcher start its counts and its piggy bank over.
4. **`check` again**, leftovers included. Anything still there stops the
   round.
5. **`start_cmds`**, then the first copy.
6. **Every `tick_s`**: the TUI identity, the spend since the start, a copy
   when one is due, and `relaunch_cmds` (default: the last start command)
   when no API role runs and `relaunch_min_s` has passed.
7. **Stop** — end of the window, budget reached, TUI changed, a box silent
   for too long, or Ctrl-C — then `stop_cmds`, a last copy of both sides,
   the diffs and `REPORT.md`.

The exit code of `start --yes` does not carry the verdict: read the report.

> ⚠️ The stop guard covers the window, not the start. If a start command or
> the first copy fails, the round ends with an error before its guard, and
> the API team may already be running: stop it by hand with your
> `stop_cmds`.

## 📄 Reading the output

Everything lands in `<out_dir>/round-<stamp>/`, the directory 0700 and every
file 0600:

- `seed-T0.db`, `api-prepared.db`, and the copies `tui-*.db` / `api-*.db`;
- `diff-<copy>.txt` and `.json`, each copy against the seed;
- `timeline.jsonl`, every event with its time;
- `REPORT.md`: the verdict, window and budget, both revisions, the stop
  reason, the timeline, and one row per copy with the spend since the start
  and the counts per table.

**The verdict is VALID** only when every check passed, the TUI side did not
change during the window, and the round stopped on its own — at the end of
the window or at the budget. A round that was interrupted, lost a box, failed
a stop command, or saw the TUI change is **NOT VALID**, and the report says
why.

How to read the diffs:
- **SCOUT** — both teams search the live web, so their new positions differ
  by nature: compare the counts and the pace, not the rows.
- **ANALISTA, SCORER, SCRITTORE** — they work the same queue from the seed,
  and parity is read in the seed's rows: *both, same* is parity; *both,
  different* shows the difference field by field; *changed by one side only*
  is work the other side did not do.

`jobsdb_parity.py diff` matches rows **by meaning, never by id**: a position
by its normalised URL (scheme, `www.`, trailing slash, tracking parameters
and page anchors dropped), or by title and company when it has none; a
company by its normalised name; scores and applications by their position.
Ids and timestamps are ignored, agent columns are compared by role
(`SCOUT-2` is `scout`), prose written by a model is compared as present or
absent, and office coordinates within 0.01°. It exits 0 when the two agree,
1 when they differ, 2 when it failed.

## 🚫 What the round never does

- It never writes on the TUI side: it does not stop, update or restart it.
  The commands it sends there only read.
- It does not deploy: the same revision is checked, not made.
- It does not set the key proxy's cap: `check` says when it disagrees with
  the budget, and the operator sets it.
- It deletes nothing on the API side: every earlier file is moved into the
  round's archive, and the old launcher configuration is renamed beside itself
  (`<file>.usata-<round>`).

## 🔗 See also

- [API-TEAM](API-TEAM.md) — how the API team runs, what caps its spend, and
  where it differs from the TUI team on purpose.
- [`scripts/parity/README.md`](../../scripts/parity/README.md) — the tools'
  own reference.
