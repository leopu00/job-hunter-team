#!/usr/bin/env bash
# PROPOSAL ONLY. CI execution requires a separate owner gate after scheduling.
set -euo pipefail
export LC_ALL=C
T204_PAYLOAD=16f208cd79c0ced1df7d7e4428b900d380c7c780
T204_ROOT=$(git rev-parse --show-toplevel)
cd "$T204_ROOT"
[ "$(git rev-parse HEAD)" = "$T204_PAYLOAD" ]
[ -n "${RUNNER_TEMP:-}" ]
task_evidence=$(mktemp -d "$RUNNER_TEMP/t204-supports-context.XXXXXX")
echo "T204_EVIDENCE=$task_evidence"
task_real_godot=$(command -v godot)
[ -x "$task_real_godot" ]
[ "$(sha256sum "$task_real_godot" | awk '{print $1}')" = f85bbc6b15e22416c7d797cd60b63286dd67b9cb13498847056c18520ae55a75 ]
export T204_REAL_GODOT="$task_real_godot"
echo "T204_PAYLOAD=$T204_PAYLOAD TREE=$(git rev-parse HEAD^{tree})"
"$task_real_godot" --version
sha256sum "$task_real_godot"
git ls-tree -r "$T204_PAYLOAD" game > "$task_evidence/expected-game-git.tsv"
git ls-tree -r --name-only "$T204_PAYLOAD" game | LC_ALL=C sort > "$task_evidence/expected-game-paths.txt"
awk -F'\t' '{split($1, fields, " "); print $2 "\t" fields[3]}' "$task_evidence/expected-game-git.tsv" | LC_ALL=C sort > "$task_evidence/expected-game-path-blobs.tsv"
cut -f2 "$task_evidence/expected-game-path-blobs.tsv" > "$task_evidence/expected-game-blobs.txt"

record_tracked_inputs() {
  local task_project="$1" task_label="$2" task_expected="$3" task_path
  while IFS= read -r task_path; do
    printf '%s/%s\n' "$task_project" "$task_path"
  done < "$task_evidence/expected-game-paths.txt" > "$task_evidence/$task_label-absolute.paths"
  git hash-object --no-filters --stdin-paths < "$task_evidence/$task_label-absolute.paths" > "$task_evidence/$task_label-actual.blobs" || return 2
  cmp "$task_expected" "$task_evidence/$task_label-actual.blobs" || return 2
  paste "$task_evidence/expected-game-paths.txt" "$task_evidence/$task_label-actual.blobs" > "$task_evidence/$task_label-source-manifest.tsv" || return 2
  sha256sum "$task_evidence/$task_label-source-manifest.tsv" || return 2
}
record_tracked_inputs "$T204_ROOT" pure-before "$task_evidence/expected-game-blobs.txt"

record_canonical_inputs() {
  local task_destination="$1" task_input
  for task_input in game/tools/source_guard_support.gd game/tools/source_guard_support_selftest.gd game/tools/run.sh game/tools/test-matrix.txt game/project.godot; do
    git diff --exit-code "$T204_PAYLOAD" -- "$task_input" || return 2
    sha256sum "$task_input" || return 2
  done > "$task_destination"
}
record_canonical_inputs "$task_evidence/canonical-before.sha256"
[ "$(sha256sum game/tools/source_guard_support.gd | awk '{print $1}')" = 1b2757b8f6dde9dc1c797ac1f1b66797527a78aa96d15d3459852fa267b1166d ]
[ "$(sha256sum game/tools/source_guard_support_selftest.gd | awk '{print $1}')" = 0b5e103ef4c456472112a6724a91a1f18312849ff99e8f811e221634b180b019 ]
awk -F'|' '$1 == "source_guard_support" {print; n++} END {if(n != 1) exit 2}' game/tools/test-matrix.txt > "$task_evidence/helper-matrix.txt"
[ "$(cat "$task_evidence/helper-matrix.txt")" = 'source_guard_support|script|gate|any|-|tools/source_guard_support_selftest.gd|SOURCE-GUARD-SUPPORT-TEST PASS' ]

# Capture cache and all files generated outside the pinned Git input set.
record_generated_inputs() {
  local task_project="$1" task_label="$2" task_path
  [ -d "$task_project/game" ] || return 0
  (cd "$task_project" && find game -type f | LC_ALL=C sort) > "$task_evidence/$task_label-all.paths" || return 2
  comm -13 "$task_evidence/expected-game-paths.txt" "$task_evidence/$task_label-all.paths" > "$task_evidence/$task_label-generated.paths" || return 2
  : > "$task_evidence/$task_label-generated.sha256"
  while IFS= read -r task_path; do
    (cd "$task_project" && sha256sum "$task_path") >> "$task_evidence/$task_label-generated.sha256" || return 2
  done < "$task_evidence/$task_label-generated.paths"
  if [ -f "$task_project/game/.godot/global_script_class_cache.cfg" ]; then
    sha256sum "$task_project/game/.godot/global_script_class_cache.cfg" > "$task_evidence/$task_label-class-cache.sha256" || return 2
  fi
}

# Read only: retain manifests even if import or a proof fails. Do not clean caches.
finish_evidence() {
  local task_saved_rc=$? task_bookkeeping_rc=0
  trap - EXIT
  set +e
  record_generated_inputs "$T204_ROOT" final-pure || task_bookkeeping_rc=2
  record_generated_inputs "$task_evidence/mutant" final-mutant || task_bookkeeping_rc=2
  record_tracked_inputs "$T204_ROOT" pure-final "$task_evidence/expected-game-blobs.txt" || task_bookkeeping_rc=2
  if [ -f "$task_evidence/expected-mutant-blobs.txt" ]; then
    record_tracked_inputs "$task_evidence/mutant" mutant-final "$task_evidence/expected-mutant-blobs.txt" || task_bookkeeping_rc=2
  fi
  record_canonical_inputs "$task_evidence/canonical-after.sha256" || task_bookkeeping_rc=2
  cmp "$task_evidence/canonical-before.sha256" "$task_evidence/canonical-after.sha256" || task_bookkeeping_rc=2
  git diff --exit-code "$T204_PAYLOAD" -- game || task_bookkeeping_rc=2
  echo "T204_EVIDENCE=$task_evidence"
  echo "T204_PROOF_RC=$task_saved_rc BOOKKEEPING_RC=$task_bookkeeping_rc"
  [ "$task_saved_rc" -ne 0 ] || task_saved_rc=$task_bookkeeping_rc
  exit "$task_saved_rc"
}
trap finish_evidence EXIT

# Exact diagnostics, no broad allowance for every source-guard error.
: > "$task_evidence/expected-pure-errors.txt"
for task_reason in 'snapshot comparator rejects same-total names' 'observation comparator rejects same-total names' 'snapshot comparator rejects same-total multiplicities' 'observation comparator rejects same-total multiplicities' 'real reader and scanner reject same-total signal names' 'real reader and scanner reject same-total signal multiplicities'; do
  printf 'ERROR: [source-guard-support] %s\n' "$task_reason"
done > "$task_evidence/expected-mutant-errors.txt"

require_expected_errors() {
  local task_log="$1" task_allowed="$2" task_line task_count task_bad=0
  [ -r "$task_log" ] && [ -r "$task_allowed" ] || return 2
  if ! awk '/SCRIPT ERROR:|ERROR:|Parse Error:/ {print}' "$task_log" > "$task_log.errors"; then return 2; fi
  while IFS= read -r task_line; do
    if ! grep -Fxq -- "$task_line" "$task_allowed"; then
      printf 'UNEXPECTED_ENGINE_DIAGNOSTIC: %s\n' "$task_line"
      task_bad=1
    fi
  done < "$task_log.errors"
  while IFS= read -r task_line; do
    task_count=$(awk -v wanted="$task_line" '$0 == wanted {n++} END {print n+0}' "$task_log.errors") || return 2
    if [ "$task_count" -ne 1 ]; then
      printf 'EXPECTED_DIAGNOSTIC_MULTIPLICITY: got=%s wanted=1 message=%s\n' "$task_count" "$task_line"
      task_bad=1
    fi
  done < "$task_allowed"
  return "$task_bad"
}

# Synthetic classifier counterexamples, not engine/program executions.
printf 'SOURCE-GUARD-SUPPORT-TEST PASS (46 synthetic checks)\nSCRIPT ERROR: synthetic.unexpected\n' > "$task_evidence/oracle-false-green.log"
if require_expected_errors "$task_evidence/oracle-false-green.log" "$task_evidence/expected-pure-errors.txt" > "$task_evidence/oracle-false-green-result.log" 2>&1; then exit 2; fi
printf 'SOURCE-GUARD-SUPPORT-TEST PASS (46 synthetic checks)\n\033[31mERROR: synthetic.unexpected\033[0m\n' > "$task_evidence/oracle-color.log"
if require_expected_errors "$task_evidence/oracle-color.log" "$task_evidence/expected-pure-errors.txt" > "$task_evidence/oracle-color-result.log" 2>&1; then exit 2; fi
require_expected_errors "$task_evidence/expected-mutant-errors.txt" "$task_evidence/expected-mutant-errors.txt"
cp "$task_evidence/expected-mutant-errors.txt" "$task_evidence/oracle-extra.log"
printf 'ERROR: synthetic.unexpected\n' >> "$task_evidence/oracle-extra.log"
if require_expected_errors "$task_evidence/oracle-extra.log" "$task_evidence/expected-mutant-errors.txt" > "$task_evidence/oracle-extra-result.log" 2>&1; then exit 2; fi
cp "$task_evidence/expected-mutant-errors.txt" "$task_evidence/oracle-duplicate.log"
head -n 1 "$task_evidence/expected-mutant-errors.txt" >> "$task_evidence/oracle-duplicate.log"
if require_expected_errors "$task_evidence/oracle-duplicate.log" "$task_evidence/expected-mutant-errors.txt" > "$task_evidence/oracle-duplicate-result.log" 2>&1; then exit 2; fi
tail -n +2 "$task_evidence/expected-mutant-errors.txt" > "$task_evidence/oracle-missing.log"
if require_expected_errors "$task_evidence/oracle-missing.log" "$task_evidence/expected-mutant-errors.txt" > "$task_evidence/oracle-missing-result.log" 2>&1; then exit 2; fi
echo 'T204_ERROR_CLASSIFIER_SELFTEST PASS cases=6'

mkdir -p "$task_evidence/bin" "$task_evidence/tmp" "$task_evidence/jht-home" "$task_evidence/jht-documents" "$task_evidence/config" "$task_evidence/data" "$task_evidence/cache"
cat > "$task_evidence/bin/godot" <<'T204_FORWARD_EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'GODOT_CALL:' >> "$T204_NATIVE_LOG"
printf ' %q' "$@" >> "$T204_NATIVE_LOG"
printf '\n' >> "$T204_NATIVE_LOG"
"$T204_REAL_GODOT" "$@" 2>&1 | tee -a "$T204_NATIVE_LOG"
T204_FORWARD_EOF
chmod 700 "$task_evidence/bin/godot"
export PATH="$task_evidence/bin:$PATH"
export TMPDIR="$task_evidence/tmp" JHT_HOME="$task_evidence/jht-home" JHT_USER_DIR="$task_evidence/jht-documents" JHT_NOVPS=1
export XDG_CONFIG_HOME="$task_evidence/config" XDG_DATA_HOME="$task_evidence/data" XDG_CACHE_HOME="$task_evidence/cache"
export JHT_TEST_MATRIX="$task_evidence/helper-matrix.txt"

import_project() {
  local task_project="$1" task_label="$2" task_import_rc
  if [ -e "$task_project/game/.godot" ]; then echo 'NONFRESH_PROJECT_CACHE'; return 2; fi
  export T204_NATIVE_LOG="$task_evidence/$task_label-import-native.log"
  set +e
  godot --headless --editor --import --path "$task_project/game" > "$task_evidence/$task_label-import.log" 2>&1
  task_import_rc=$?
  set -e
  cat "$task_evidence/$task_label-import.log"
  echo "IMPORT_$task_label=$task_import_rc"
  [ "$task_import_rc" -eq 0 ]
  require_expected_errors "$T204_NATIVE_LOG" "$task_evidence/expected-pure-errors.txt"
  [ -s "$task_project/game/.godot/global_script_class_cache.cfg" ]
  record_generated_inputs "$task_project" "$task_label-after-import"
}

import_project "$T204_ROOT" pure
export T204_NATIVE_LOG="$task_evidence/pure-native.log"
set +e
bash game/tools/run.sh test gate > "$task_evidence/pure-runner.log" 2>&1
task_pure_rc=$?
set -e
cat "$task_evidence/pure-runner.log" "$T204_NATIVE_LOG"
echo "PURE_RC=$task_pure_rc"
[ "$task_pure_rc" -eq 0 ]
grep -Fq 'SOURCE-GUARD-SUPPORT-TEST PASS (' "$T204_NATIVE_LOG"
require_expected_errors "$T204_NATIVE_LOG" "$task_evidence/expected-pure-errors.txt"
record_generated_inputs "$T204_ROOT" pure-after-execution

mkdir -p "$task_evidence/mutant"
git archive "$T204_PAYLOAD" game | tar -x -C "$task_evidence/mutant"
awk '
  /^static func _elements_equal\(/ {print; print "\treturn true"; skip=1; seen++; next}
  skip && /^static func / {skip=0}
  !skip {print}
  END {if(seen != 1) exit 2}
' game/tools/source_guard_support.gd > "$task_evidence/mutant-helper.gd"
mv "$task_evidence/mutant-helper.gd" "$task_evidence/mutant/game/tools/source_guard_support.gd"
echo "MUTANT_PARENT=$T204_PAYLOAD"
sha256sum "$task_evidence/mutant/game/tools/source_guard_support.gd" > "$task_evidence/mutant-helper.sha256"
[ "$(awk '{print $1}' "$task_evidence/mutant-helper.sha256")" = 4c96f9c52e59ea1da799a74a674db9123142edfbd3810cd3ca755f0d1e5d3050 ]
task_mutant_blob=$(git hash-object --no-filters "$task_evidence/mutant/game/tools/source_guard_support.gd")
awk -F'\t' -v replacement="$task_mutant_blob" '$1 == "game/tools/source_guard_support.gd" {$2=replacement; changed++} {print $2} END {if(changed != 1) exit 2}' "$task_evidence/expected-game-path-blobs.tsv" > "$task_evidence/expected-mutant-blobs.txt"
record_tracked_inputs "$task_evidence/mutant" mutant-before "$task_evidence/expected-mutant-blobs.txt"
for task_input in game/tools/source_guard_support_selftest.gd game/tools/run.sh game/tools/test-matrix.txt game/project.godot; do
  cmp "$task_input" "$task_evidence/mutant/$task_input"
done
import_project "$task_evidence/mutant" mutant
export T204_NATIVE_LOG="$task_evidence/mutant-native.log"
set +e
(cd "$task_evidence/mutant" && bash game/tools/run.sh test gate) > "$task_evidence/mutant-runner.log" 2>&1
task_mutant_rc=$?
set -e
cat "$task_evidence/mutant-runner.log" "$T204_NATIVE_LOG"
echo "MUTANT_RC=$task_mutant_rc"
[ "$task_mutant_rc" -ne 0 ]
grep -Fq 'SOURCE-GUARD-SUPPORT-TEST FAIL' "$T204_NATIVE_LOG"
require_expected_errors "$T204_NATIVE_LOG" "$task_evidence/expected-mutant-errors.txt"
record_generated_inputs "$task_evidence/mutant" mutant-after-execution
echo 'T204_SUPPORT_CONTEXT_PURE_AND_MUTANT PASS'
# The driver must upload the full evidence directory even when this recipe fails.
