set +e
node --version
python3 --version
git rev-parse HEAD 'HEAD^{tree}'
node cli/tests/source-guard-capture.mjs > "$RUNNER_TEMP/t204-g5-capture.jsonl" 2> "$RUNNER_TEMP/t204-g5-capture.stderr"
jht_g5_capture_rc=$?
cat "$RUNNER_TEMP/t204-g5-capture.jsonl"
cat "$RUNNER_TEMP/t204-g5-capture.stderr"
node --test cli/tests/source-guard-reader.test.mjs cli/tests/source-guard-parsers.test.mjs cli/tests/source-guard-provenance.test.mjs > "$RUNNER_TEMP/t204-g5-units.tap" 2>&1
jht_g5_units_rc=$?
cat "$RUNNER_TEMP/t204-g5-units.tap"
python3 -m pytest -q -rA tests/test_source_guard_snapshot.py tests/test_asset_orphan_acquisition.py > "$RUNNER_TEMP/t204-python-tests.log" 2>&1
jht_python_tests_rc=$?
cat "$RUNNER_TEMP/t204-python-tests.log"
python3 game/tools/asset_orphan_audit.py --check > "$RUNNER_TEMP/t204-asset-gate.log" 2>&1
jht_asset_gate_rc=$?
cat "$RUNNER_TEMP/t204-asset-gate.log"
printf 'capture_rc=%s units_rc=%s python_rc=%s asset_gate_rc=%s\n' "$jht_g5_capture_rc" "$jht_g5_units_rc" "$jht_python_tests_rc" "$jht_asset_gate_rc"
test "$jht_g5_capture_rc" -eq 0 && test "$jht_g5_units_rc" -eq 0 && test "$jht_python_tests_rc" -eq 0 && test "$jht_asset_gate_rc" -eq 0
