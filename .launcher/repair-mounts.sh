#!/bin/sh
# Repair the ownership of the two bind mounts, run by the HOST before `up`.
#
# On Docker Desktop for Windows (WSL2) /jht_home and /jht_user can arrive owned
# by root, and the container's `jht` user (1001) cannot write in them. The
# container used to fix this itself with a passwordless `sudo chown`, which made
# every agent root (P1, 08/10). Now the host runs this script BEFORE `up`, in a
# one-shot container of the same image:
#
#   docker run --rm --user 0:0 --cap-drop ALL --cap-add CHOWN --network none
#     --security-opt no-new-privileges
#     -v <home>/.jht:/jht_home -v "<home>/Documents/Job Hunter Team":/jht_user
#     --entrypoint /bin/sh <image> -c '<dispatch>'
#
# with <dispatch> exactly:
#   if [ -x /app/.launcher/repair-mounts.sh ]; then exec /app/.launcher/repair-mounts.sh; else echo mount_repair_unsupported; fi
#
# Root, but only CAP_CHOWN, no network, and only these two folders. Callers:
# scripts/jht-wrapper.ps1 (Repair-MountOwnership) and the desktop app
# (setup_service.gd, _repair_mount_ownership): one contract, read below.
#
# Contract — one line per folder on stdout, then the exit code:
#   mount_ok <dir>              already 1001 throughout
#   mount_repaired <dir>        chown -R 1001:1001 done and verified
#   mount_repair_failed <dir>   missing, or still not 1001 after the chown
#   exit 0 when no folder failed, 1 otherwise.
# And, from the dispatch alone: `mount_repair_unsupported` (exit 0) when the
# image predates this script. Such an image still repairs its own mounts at
# start with the sudo it carries, so the host goes on.
# The host stops `up` on a failure and shows the user what to do.
set -u

JHT_UID=1001
# Test seam: other folders than the two mounts. The host never sets it.
ROOTS="${JHT_REPAIR_MOUNT_ROOTS:-/jht_home /jht_user}"
status=0
for d in $ROOTS; do
  if [ ! -d "$d" ]; then
    echo "mount_repair_failed $d"
    status=1
    continue
  fi
  # Any entry not owned by jht, the folder itself included. -xdev: never walk
  # into another mount (the runtime mask lives below /jht_home in compose).
  foreign="$(find "$d" -xdev ! -uid "$JHT_UID" -print -quit 2>/dev/null)"
  if [ -z "$foreign" ] && [ "$(stat -c %u "$d")" = "$JHT_UID" ]; then
    echo "mount_ok $d"
    continue
  fi
  chown -R "$JHT_UID:$JHT_UID" "$d" 2>/dev/null
  foreign="$(find "$d" -xdev ! -uid "$JHT_UID" -print -quit 2>/dev/null)"
  if [ -z "$foreign" ] && [ "$(stat -c %u "$d")" = "$JHT_UID" ]; then
    echo "mount_repaired $d"
  else
    echo "mount_repair_failed $d"
    status=1
  fi
done
exit "$status"
