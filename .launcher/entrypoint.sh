#!/bin/bash
# Container entrypoint — runs as `jht` (never root).
#
# Windows fix: on Docker Desktop (WSL2 backend) the bind mounts /jht_home and
# /jht_user can arrive owned by root — the build-time `chown jht:jht` is
# overlaid by the mount, so `jht` gets EACCES on the very first mkdir
# ([watchdog] mkdir /jht_home/logs: Permission denied). On macOS/Linux the
# mounts map to the caller and are already writable.
#
# Strategy: real write-probe on each mount; only when it fails, repair
# ownership through the passwordless-sudo whitelist that the image already
# grants to `jht` (/bin/mkdir and /bin/chown — see /etc/sudoers.d/jht in the
# Dockerfile). No gosu, no root entrypoint: agents keep running as `jht`.
# Idempotent (chown preserves data) and a no-op where the probe succeeds.
set -u

for d in /jht_home /jht_user; do
  probe="$d/.jht-write-probe-$$"
  if mkdir -p "$probe" 2>/dev/null; then
    rmdir "$probe" 2>/dev/null || true
    continue
  fi
  echo "[entrypoint] $d not writable by $(whoami) — repairing ownership (Windows bind mount)" >&2
  sudo /bin/mkdir -p "$d"
  sudo /bin/chown -R jht:jht "$d"
  if mkdir -p "$probe" 2>/dev/null; then
    rmdir "$probe" 2>/dev/null || true
    echo "[entrypoint] $d writable now" >&2
  else
    echo "[entrypoint] WARNING: $d still not writable after chown — check the Docker Desktop file-sharing settings for this path" >&2
  fi
done

# Test hook: lets CI/sanity checks run the repair logic without starting the CLI.
if [ "${JHT_ENTRYPOINT_NO_EXEC:-}" = "1" ]; then
  exit 0
fi

exec node /app/cli/bin/jht.js "$@"
