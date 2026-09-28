# Parity round: TUI team against API team

Two tools:

- `jobsdb_parity.py`: the metre. It takes the seed, prepares the API side's db, and diffs two
  `jobs.db` by what the rows mean.
- `parity_round.py`: the whole round from one command. It runs the checks, puts the API side in a
  known state, takes copies on the clock, stops at the cap or at the end of the window, and writes
  the diffs and the report.

The round of 27/09 gave no verdict, and each reason is now a check in `parity_round.py`:

| What went wrong on 27/09 | What the round does now |
| --- | --- |
| The TUI box was updated twice during the window, so its first and last hours ran different code | `check` refuses two revisions (TUI image label against the API image's hex tag). During the window the TUI container's identity (start and image) is read every minute: a change stops the round and marks it **NOT VALID** |
| The API captain drained old mailbox messages and re-read an old diary, then coasted for two hours | Known state: the mailboxes, `notify.jsonl`, the replies, the captain's diaries, the old db and the old `STOP` are **moved** into `archivio-<round>/` on the API box, never deleted; the old launcher config is renamed beside itself (`<file>.usata-<round>`). `check` runs again and refuses anything left over |
| Copies taken by hand, at hours chosen on the fly | T0, then one copy of both dbs every `snapshot_every_min` minutes on the clock, and one at the end, each with its diff from the seed |
| Launcher cap and key proxy cap that did not agree | The launcher's `sessionUsd` is set to the budget. `check` refuses a key proxy with less than the budget left, minus 0.02 USD (it would stop the round first), or with more than the budget plus 0.50 USD (it is no backstop). The round stops itself when the spend since the start reaches the budget |
| Diff and report by hand | `diff-<copy>.txt/.json` and `REPORT.md`, with a verdict, the timeline, and the spend at each copy |

## Setup (once, outside git)

1. Copy `round.example.json` to a private place (for example `~/.config/jht-parity/round.json`)
   and fill in the `<...>` fields: the ssh config, the two ssh aliases, and the private output
   directory. **The repository names no machine and no address**: keep them in that file only.
2. Check the paths and commands against the two boxes. The example holds the ones in use on
   27/09: TUI in the `jht` container with `/jht_home`; API under `/srv/jht-api` with podman, the
   launcher and the key proxy.
3. Both boxes must run the same revision. Deploy the API image built from the same commit the
   TUI box runs, with the rev as its tag (`jht-api:<rev>`).

## Use

```bash
R=~/.config/jht-parity/round.json
# 1. read only: are the two sides ready? (exit 0 ready, 1 not ready, 2 a command failed on a box)
python3 scripts/parity/parity_round.py check "$R" --budget-usd 2
# 2. the plan, with nothing done
python3 scripts/parity/parity_round.py start "$R" --hours 10 --budget-usd 2
# 3. the round (long: run it in tmux or with nohup)
python3 scripts/parity/parity_round.py start "$R" --hours 10 --budget-usd 2 --yes
# the report again, from a round's directory
python3 scripts/parity/parity_round.py report <out_dir>/round-<stamp>
```

`start --yes` in order:

1. `check` (read only): same revision, same profile (`sha256`), the key proxy's room against the
   budget, no API role running. Leftovers are checked after the known state, not before.
2. **T0**: the TUI db copied in memory on the box through SQLite's backup, bytes on stdout,
   nothing written there. Then the seed, and the API db prepared from it (a seed with mock rows
   is refused).
3. **Known state** on the API box (moves, never deletes). Then `check` again.
4. `start_cmds`. Every `tick_s`:
   - the TUI identity;
   - the spend;
   - a copy when one is due;
   - `relaunch_cmds` when no API role runs, at most every `relaunch_min_s`.
5. **Stop** (end of the window, budget, TUI changed, a box silent for `max_consecutive_misses`
   ticks (default 10), or Ctrl-C):
   - `stop_cmds`;
   - the last copies;
   - the diffs;
   - `REPORT.md`.

   The stop covers the window only: if a `start_cmds` command or the first copy fails, the
   round ends with an error before it, and the API team is stopped by hand.

Everything lands in `<out_dir>/round-<stamp>/` (0700, files 0600):

- `tui-*.db`, `api-*.db` (with `api-prepared.db`), `seed-T0.db`;
- `diff-*.txt/json`;
- `timeline.jsonl`;
- `REPORT.md`.

## Reading the report

- **Verdict VALID** means:
  - both checks passed;
  - the TUI side did not change code during the window;
  - the round stopped on its own.

  Anything else is NOT VALID and says why.
- **scout**: both teams search the live web, so their new positions differ by nature. Compare the
  counts and the pace, not the rows.
- **analista, scorer, scrittore**: they work on the same queue from the seed, and parity is read
  in the seed rows:
  - "both, same" is parity;
  - "both, different" shows the difference field by field;
  - "changed by one side only" is work the other side did not do.

## What it does not do

- It never writes on the TUI side. It does not stop, update or restart the TUI box.
- It does not deploy: the same revision on both sides is checked, not made.
- It does not set the key proxy's cap: `check` says when it disagrees with the budget, and the
  operator sets it.
- It does not decide the window or the budget: they are arguments, chosen by the operator.

## Tests

`tests/test_parity_round.py` runs whole rounds on two local "hosts" (transport `local`, a fake
clock, synthetic rows):

- the TUI db is never written;
- the known state moves and never deletes;
- the copies land on the clock;
- the relaunches are spaced;
- the budget and a TUI restart stop the round, and the restart voids it;
- a side that is not ready stops the round before anything moves.
