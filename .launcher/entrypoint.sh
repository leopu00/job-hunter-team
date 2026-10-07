#!/bin/bash
# Container entrypoint — runs as `jht` (never root), with no way to become root:
# the image has no sudo and the compose sets no-new-privileges (P1, 08/10).
#
# Windows: on Docker Desktop (WSL2) the bind mounts /jht_home and /jht_user
# can arrive owned by root — the build-time `chown jht:jht` is overlaid by the
# mount — and `jht` gets EACCES on its first mkdir. This entrypoint used to
# repair that with a passwordless `sudo chown`, which made every agent root.
# The repair now runs on the HOST before `up` (jht-wrapper.ps1 and the desktop
# app, one contract: a one-shot root container with only CAP_CHOWN, no
# network, only these two folders). Here we only check, and say so.
set -u

for d in /jht_home /jht_user; do
  probe="$d/.jht-write-probe-$$"
  if mkdir -p "$probe" 2>/dev/null; then
    rmdir "$probe" 2>/dev/null || true
    continue
  fi
  # Fixed code first: the host and the desktop match it, the sentence is for people.
  echo "[entrypoint] mount_not_writable $d: $d is not writable by $(whoami). The runtime repairs this before starting; restart it with 'jht up' (or from the desktop app). If it persists, check the Docker Desktop file-sharing settings for this folder." >&2
done

# Test hook: lets CI/sanity checks run the repair logic without starting the CLI.
if [ "${JHT_ENTRYPOINT_NO_EXEC:-}" = "1" ]; then
  exit 0
fi

exec node /app/cli/bin/jht.js "$@"
