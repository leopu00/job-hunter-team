#!/usr/bin/env bash
# CI-only recipe: canonical payload first, declared mutant copy second.
# Requires a Godot executable installed/attested by the gate owner.
set -euo pipefail
T204_PAYLOAD=16f208cd79c0ced1df7d7e4428b900d380c7c780
T204_ROOT=$(git rev-parse --show-toplevel)
cd "$T204_ROOT"
[ "$(git rev-parse HEAD)" = "$T204_PAYLOAD" ]
[ -n "${RUNNER_TEMP:-}" ]
task_evidence=$(mktemp -d "$RUNNER_TEMP/t204-supports.XXXXXX")
task_real_godot=$(command -v godot)
[ -x "$task_real_godot" ]
export T204_REAL_GODOT="$task_real_godot"
echo "T204_PAYLOAD=$T204_PAYLOAD TREE=$(git rev-parse HEAD^{tree})"
echo "T204_GODOT_BINARY=$task_real_godot"
"$task_real_godot" --version

for task_input in game/tools/source_guard_support.gd game/tools/source_guard_support_selftest.gd game/tools/run.sh game/tools/test-matrix.txt game/project.godot; do
  git diff --exit-code "$T204_PAYLOAD" -- "$task_input"
  sha256sum "$task_input"
done > "$task_evidence/canonical-before.sha256"
cat "$task_evidence/canonical-before.sha256"
[ "$(sha256sum game/tools/source_guard_support.gd | awk '{print $1}')" = 1b2757b8f6dde9dc1c797ac1f1b66797527a78aa96d15d3459852fa267b1166d ]
[ "$(sha256sum game/tools/source_guard_support_selftest.gd | awk '{print $1}')" = 0b5e103ef4c456472112a6724a91a1f18312849ff99e8f811e221634b180b019 ]
awk -F'|' '$1 == "source_guard_support" {print; n++} END {if(n != 1) exit 2}' game/tools/test-matrix.txt > "$task_evidence/helper-matrix.txt"
[ "$(cat "$task_evidence/helper-matrix.txt")" = 'source_guard_support|script|gate|any|-|tools/source_guard_support_selftest.gd|SOURCE-GUARD-SUPPORT-TEST PASS' ]
cat "$task_evidence/helper-matrix.txt"

# Forward to the real engine, preserving its status while retaining native output.
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
export TMPDIR="$task_evidence/tmp"
export JHT_HOME="$task_evidence/jht-home" JHT_USER_DIR="$task_evidence/jht-documents" JHT_NOVPS=1
export XDG_CONFIG_HOME="$task_evidence/config" XDG_DATA_HOME="$task_evidence/data" XDG_CACHE_HOME="$task_evidence/cache"
export JHT_TEST_MATRIX="$task_evidence/helper-matrix.txt"
export T204_NATIVE_LOG="$task_evidence/pure-native.log"
set +e
bash game/tools/run.sh test gate > "$task_evidence/pure-runner.log" 2>&1
task_pure_rc=$?
set -e
cat "$task_evidence/pure-runner.log" "$task_evidence/pure-native.log"
echo "PURE_RC=$task_pure_rc"
[ "$task_pure_rc" -eq 0 ]
grep -Fq 'SOURCE-GUARD-SUPPORT-TEST PASS (' "$task_evidence/pure-native.log"

# A fresh archive copy outside canonical checkout; only the test helper is mutated.
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
sha256sum "$task_evidence/mutant/game/tools/source_guard_support.gd" "$task_evidence/mutant/game/tools/source_guard_support_selftest.gd" "$task_evidence/mutant/game/tools/run.sh" "$task_evidence/mutant/game/tools/test-matrix.txt" "$task_evidence/mutant/game/project.godot" > "$task_evidence/mutant-inputs.sha256"
cat "$task_evidence/mutant-inputs.sha256"
cmp game/tools/source_guard_support_selftest.gd "$task_evidence/mutant/game/tools/source_guard_support_selftest.gd"
cmp game/tools/run.sh "$task_evidence/mutant/game/tools/run.sh"
cmp game/tools/test-matrix.txt "$task_evidence/mutant/game/tools/test-matrix.txt"
cmp game/project.godot "$task_evidence/mutant/game/project.godot"
export T204_NATIVE_LOG="$task_evidence/mutant-native.log"
set +e
(cd "$task_evidence/mutant" && bash game/tools/run.sh test gate) > "$task_evidence/mutant-runner.log" 2>&1
task_mutant_rc=$?
set -e
cat "$task_evidence/mutant-runner.log" "$task_evidence/mutant-native.log"
echo "MUTANT_RC=$task_mutant_rc"
[ "$task_mutant_rc" -ne 0 ]
grep -Fq 'SOURCE-GUARD-SUPPORT-TEST FAIL' "$task_evidence/mutant-native.log"
for task_reason in 'snapshot comparator rejects same-total names' 'observation comparator rejects same-total names' 'snapshot comparator rejects same-total multiplicities' 'observation comparator rejects same-total multiplicities' 'real reader and scanner reject same-total signal names' 'real reader and scanner reject same-total signal multiplicities'; do
  grep -Fq "$task_reason" "$task_evidence/mutant-native.log"
done

for task_input in game/tools/source_guard_support.gd game/tools/source_guard_support_selftest.gd game/tools/run.sh game/tools/test-matrix.txt game/project.godot; do
  git diff --exit-code "$T204_PAYLOAD" -- "$task_input"
  sha256sum "$task_input"
done > "$task_evidence/canonical-after.sha256"
cmp "$task_evidence/canonical-before.sha256" "$task_evidence/canonical-after.sha256"
echo 'T204_SUPPORT_PURE_AND_SAME_TOTAL_MUTANT PASS'
echo "T204_EVIDENCE=$task_evidence"
# Upload the evidence directory in the owner workflow even on failure; no npm.
