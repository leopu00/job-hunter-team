#!/bin/sh
# Points apt at a mirror that serves a package quickly from THIS runner, before a job installs anything.
# Usage: sudo sh scripts/ci/apt-mirror.sh
#
# Why: the runner's default Ubuntu mirror answers the index at full speed and then serves some runners the
# packages themselves at 25-50 kB/s: on 22/10 and 26/10 the Playwright libraries took 10 minutes and the
# PDF toolchain 20, and the pytest job was cancelled at its 40-minute ceiling.  The same toolchain takes
# 10-30 seconds on most runners, so the guard has to be cheap when the mirror is fine and quick to leave
# it when it is not.  The index is no test (it was fast in the slow runs); a package is, so a real .deb
# is fetched for a few seconds from each candidate.
#
# Integrity does not depend on the mirror: apt checks every package against the signed index of the
# distribution, whoever serves the file.  Nothing here touches keys, suites or packages; it only
# replaces the host in apt's own sources.
#
# Environment (tests set them; CI uses the defaults):
#   APT_MIRROR_CANDIDATES  mirrors to try, in order of preference; the first fast enough wins, the rest are not asked
#   APT_MIRROR_MIN_BPS     bytes per second that count as fast (default 1000000)
#   APT_MIRROR_SECONDS     longest wait for one candidate (default 6)
#   APT_MIRROR_PROBE       path of the .deb to fetch, below the mirror
#   APT_DIR                apt's configuration folder (default /etc/apt)
# Exit 0 always: no answer is a reason to keep the sources as they are, never to stop the job.
CANDIDATES="${APT_MIRROR_CANDIDATES:-http://azure.archive.ubuntu.com/ubuntu http://archive.ubuntu.com/ubuntu https://mirrors.edge.kernel.org/ubuntu}"
MIN="${APT_MIRROR_MIN_BPS:-1000000}"
SECONDS_MAX="${APT_MIRROR_SECONDS:-6}"
PROBE="${APT_MIRROR_PROBE:-pool/main/f/fonts-freefont/fonts-freefont-ttf_20211204+svn4273-2_all.deb}"
APT_DIR="${APT_DIR:-/etc/apt}"

# the sources apt reads: the main file, the drop-ins and the list the mirror:// method reads
files=""
for f in "$APT_DIR"/sources.list "$APT_DIR"/sources.list.d/* "$APT_DIR"/apt-mirrors.txt; do
  [ -f "$f" ] && files="$files $f"
done
[ -n "$files" ] || { echo "apt mirror: no sources found in $APT_DIR, left as they are"; exit 0; }

# the Ubuntu mirror the sources use now (the host, without a trailing slash)
# shellcheck disable=SC2086
current=$(cat $files 2>/dev/null | grep -oE 'https?://[A-Za-z0-9.-]+/ubuntu' | head -n 1)
[ -n "$current" ] || { echo "apt mirror: the sources name no Ubuntu mirror, left as they are"; exit 0; }

speed() {  # bytes per second of the probe from $1, 0 when it cannot be fetched
  bps=$(curl -fsSL --connect-timeout 3 --max-time "$SECONDS_MAX" -o /dev/null -w '%{speed_download}' "$1/$PROBE" 2>/dev/null) || bps=0
  printf '%s' "${bps%%.*}"
}

chosen=""
for mirror in $CANDIDATES; do
  bps=$(speed "$mirror")
  [ -n "$bps" ] || bps=0
  echo "apt mirror: $mirror $((bps / 1000)) kB/s"
  if [ "$bps" -ge "$MIN" ]; then chosen="$mirror"; break; fi
done

if [ -z "$chosen" ]; then
  echo "apt mirror: none reached $((MIN / 1000)) kB/s, sources left as they are ($current)"
  exit 0
fi
if [ "$chosen" = "$current" ]; then
  echo "apt mirror: keeping $current"
  exit 0
fi
for f in $files; do   # in place without `sed -i`, which differs between GNU and BSD
  sed "s#${current}#${chosen}#g" "$f" > "$f.new" && cat "$f.new" > "$f"
  rm -f "$f.new"
done
echo "apt mirror: switched $current -> $chosen"
exit 0
