# 0013 — Keep Codex's SQLite state on the VM's own disk, not on the host bind

**Status:** Proposed
**Date:** 2026-11-06

## Context

Every Codex agent of the team runs with `HOME=/jht_home` and no `CODEX_HOME`, so
its home is `/jht_home/.codex`. `/jht_home` is a bind mount of the host folder
`~/.jht`. On Windows that bind goes through WSL as a **9p/drvfs** mount of the
`C:` drive; on macOS through the Podman machine as **virtiofs**; on Linux it is
a local directory.

Codex keeps its state in six SQLite databases (`state_5`, `logs_2`,
`thread_history_1`, `goals_1`, `memories_1`, `queue_1`), all in WAL mode, plus
their `-wal` and `-shm` files. Up to seven agents open and write them at the same
time. Next to them, in the same home, live `auth.json` (the one login of the
team), `config.toml`, `version.json`, the `sessions/**/rollout-*.jsonl` files and
a few lock files.

On Windows agents have been seen failing at start with `database is locked` on
`state_5.sqlite` / `logs_2.sqlite`, and processes stuck in uninterruptible I/O
on the 9p client. A replaced agent starts on the same mount and meets the same
contention, so the team finds offers but does not get to scoring.

Measured on a Windows test machine, inside the Podman machine, with synthetic
data (a tiny table, one row per commit), the same script on the 9p mount of `C:`
and on the VM's own disk:

| | 9p mount of `C:` | VM disk |
| --- | --- | --- |
| one commit, WAL, `synchronous=NORMAL` | 3.08 ms | 0.02 ms |
| one commit, WAL, `synchronous=FULL` | 4.94 ms | 2.74 ms |
| open a connection, set WAL, write one row | 17.8 ms | 3.1 ms |
| seven processes, 150 commits each, 0.5 s busy timeout | 24 of 1050 busy, 5.2 s | 16 of 1050 busy, 3.2 s |
| `flock` and `lockf` taken twice from two processes | the second is refused | not run |

Two things follow. File locking **does** exclude across processes on that
mount, so this is not a lost-lock bug: the login file and the lock files are
safe in that respect. And plain SQLite did not fail on 9p: it is slower, by
about two orders of magnitude on a commit, so every lock is held that much
longer. Codex opens two databases at start (one is tens of MB with a WAL of
several MB) with a short busy timeout; with seven agents logging, that start
meets a held lock for long enough to fail. The cure is therefore latency, not a
different locking scheme. Upstream documents the same advice for network file
systems: keep the SQLite directory on local disk and leave the rollout files
where they are.

## Decision

Point Codex's SQLite directory at the container's own volume, with the variable
Codex defines for it, in `docker-compose.yml`:

```
CODEX_SQLITE_HOME=/opt/jht-deps/codex-state
```

- **One directory for the whole team**, as on a Linux machine: the seven agents
  share one set of databases and SQLite arbitrates, which is Codex's normal case.
  A directory per agent is not needed to avoid contention on a local disk.
- **`/opt/jht-deps` already is a Docker volume inside the VM**, owned by `jht`,
  present in every compose file of every install. No new volume, no change to the
  image or to the compose validation of the wrappers.
- **The variable moves all six databases and nothing else.** `auth.json`,
  `config.toml`, `version.json`, `sessions/` and the lock files stay in
  `/jht_home/.codex`, where the app, the wrappers and the watchdogs look for
  them. The login stays one file, renewed in one place; `jht oauth-login` still
  unlocks every agent.
- The directory is created by the launcher before an agent starts, with the
  owner `jht` and mode `0700`, so Codex never creates it with another owner.
  The folder preparation lives in `.launcher/agent-directories.sh`, sourced by
  `start-agent.sh`; this module runs inside the container.
- When the launcher finds that folder new (no database in it), it writes one line
  to `~/.jht/logs/codex-state.log` on the host, once per folder: so a setup that
  makes the volume disappear shows up, with its date, on the user's computer.
  If that append fails, the launcher reports it and removes its announcement
  marker, allowing another attempt while the database folder is still empty.
- `jht cache` prunes the logs database in its new place; its other targets
  (`.codex/.tmp/plugins`, `.codex/cache`, `models_cache.json`) did not move.

Codex 0.147 (pinned in `shared/config/provider-versions.json` and installed in
the dependency volume) defines `CODEX_SQLITE_HOME` and resolves
it before the default; it was checked in the source of that tag and, running,
in 0.166, where the six databases are created in the given directory and the
home keeps only what is listed above.

### Who removes the state

`/opt/jht-deps` outlives `compose down`, `up`, `restart`, container recreation
and image upgrade. It is removed only by the uninstall, by the macOS
`podman-machine-recreate` (a Podman machine removal destroys its volumes) and by
the loss of the machine itself. The reset of the broker volumes names three
other volumes. No setup step of the Windows installer removes a machine that
exists; it initialises one only when none is there.

When the state is gone, Codex creates empty databases on the next start. What is
lost is its index of threads and its diagnostic log; the rollout files stay, and
the login is not touched. This is the same as what happens today if the files
are deleted by hand.

### Migration

None for the login. The databases already in `~/.jht/.codex` stay where they
are, unused, and are not deleted by any step: they can be removed by hand. The
new directory starts empty.

## Consequences

- Seven agents no longer wait on 9p/virtiofs round trips for SQLite commits.
- Rollout files and lock files remain on the host bind (one writer per rollout;
  file locks measured to exclude on 9p).
- The product's own database is WAL SQLite on the same bind. It is not part of
  this decision and is not changed here.
- The Codex state is no longer visible from the host and is not part of the
  host backup. The backup already excludes `.codex`.

## Alternatives considered

- **One `CODEX_HOME` per agent.** Rejected: it would copy `auth.json` seven
  times, and the refresh token rotates, so the copies would invalidate each
  other. It also leaves the databases on the 9p mount.
- **Move all of `.codex` to the volume and link `auth.json` back.** Rejected:
  the host-side checks read `~/.jht/.codex/auth.json`, and a link adds a failure
  mode to the file everything depends on.
- **A dedicated named volume.** Rejected for now: it needs a compose volume, an
  image change for ownership, and changes to the checks that read the compose
  file, for no gain over a directory in a volume that already exists.
- **Update Codex in the image.** Not needed: 0.147 has the variable.
- **Rollback-journal mode, as Codex uses on NFS.** Not offered for 9p, and
  slower for seven writers.
