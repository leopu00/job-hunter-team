#!/bin/sh
# Mechanical, read-only checks on a range of commits before it can reach master-arthur.
# Usage: sh scripts/ci/precheck-sha.sh <sha> [base]   (base defaults to origin/master-arthur)
#
# Exit 0 when every check passes, 1 when at least one fails, 2 on bad arguments.
# It changes nothing, does not fetch, uploads nothing, and never prints the content of a
# secret or of a matched line: this runs in a public CI log, so a failure reports only a
# count and the commit/line where to look.
#
# Checks: 1 the sha exists · 2 a trial merge into the base is clean · 3 diff --check
#         4 gitleaks over the range · 5 author and committer are the project owner
#         6 forbidden names in commit messages · 7 forbidden names in added lines
#
# The list of forbidden names is NOT in the repository (it would publish the very names it
# guards). It comes from PRECHECK_NAMES, an extended regular expression matched as whole
# words and case-insensitively; in CI it is the repository secret of the same name. Without
# it checks 6 and 7 are reported as skipped, never as passed. Likewise PRECHECK_OWNER is the
# "Name <email>" every commit must carry as author and committer (a secret in CI, so that the
# address is not written here); without it check 5 is skipped.
SHA="${1:-}"; BASE="${2:-origin/master-arthur}"
OWNER="${PRECHECK_OWNER:-}"
[ -n "$SHA" ] || { echo "usage: sh scripts/ci/precheck-sha.sh <sha> [base]" >&2; exit 2; }
FAIL=0
ok()   { printf 'OK    %s\n' "$*"; }
ko()   { printf 'FAIL  %s\n' "$*"; FAIL=1; }
note() { printf 'NOTE  %s\n' "$*"; }

git rev-parse --verify -q "${SHA}^{commit}" >/dev/null || { ko "1 sha $SHA does not exist in this clone"; exit 1; }
BASE_SHA=$(git rev-parse --verify -q "${BASE}^{commit}") || { ko "1 base $BASE does not exist"; exit 1; }
MB=$(git merge-base "$BASE_SHA" "$SHA" 2>/dev/null) || { ko "1 no merge-base between $BASE and $SHA"; exit 1; }
N=$(git rev-list --count "$MB..$SHA")
ok "1 sha $(git rev-parse --short "$SHA") · base $(git rev-parse --short "$BASE_SHA") · merge-base $(git rev-parse --short "$MB") · $N commits"

if git merge-tree --write-tree "$BASE_SHA" "$SHA" >/dev/null 2>&1; then ok "2 trial merge is clean"; else ko "2 trial merge into $BASE has conflicts"; fi

if git diff --check "$MB" "$SHA" >/dev/null 2>&1; then ok "3 diff --check is clean"; else ko "3 diff --check reports trailing whitespace or conflict markers"; fi

if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks git --log-opts="$MB..$SHA" --redact --no-banner >/dev/null 2>&1; then ok "4 gitleaks: nothing found over the range"
  else ko "4 gitleaks found something over the range (rerun it locally with --redact for the category and place)"; fi
else note "4 gitleaks is not installed: check skipped"; fi

if [ -z "$OWNER" ]; then
  note "5 PRECHECK_OWNER is not set: the author check is SKIPPED, not passed"
else
  OTHERS=$(git log --format='%an <%ae>|%cn <%ce>' "$MB..$SHA" | tr '|' '\n' | sort -u | grep -v -x -F "$OWNER")
  if [ -z "$OTHERS" ]; then ok "5 author and committer: only the project owner"
  else ko "5 $(printf '%s\n' "$OTHERS" | wc -l | tr -d ' ') other identities in the range"; fi
fi

if [ -z "${PRECHECK_NAMES:-}" ]; then
  note "6 7 PRECHECK_NAMES is not set: the name checks are SKIPPED, not passed"
else
  # «master-arthur» is the integration branch; a model's Co-Authored-By trailer is the convention.
  M=$(git log --format='%h %B' "$MB..$SHA" | grep -v -i '^co-authored-by:' | sed 's/master-arthur//Ig' | grep -c -i -w -E "$PRECHECK_NAMES")
  if [ "$M" = 0 ]; then ok "6 no forbidden name in commit messages"; else ko "6 forbidden names in $M lines of commit messages (rewrite before it goes on)"; fi
  A=$(git diff "$MB" "$SHA" | grep '^+' | grep -v '^+++' | sed 's/master-arthur//Ig' | grep -c -i -w -E "$PRECHECK_NAMES")
  if [ "$A" = 0 ]; then ok "7 no forbidden name in added lines"; else ko "7 forbidden names in $A added lines (git diff $BASE...$SHA | grep '^+' | grep -i -w -E \"\$PRECHECK_NAMES\" shows them)"; fi
fi

[ "$FAIL" = 0 ] && echo "RESULT: every mechanical check passes" || echo "RESULT: at least one check fails"
exit "$FAIL"
