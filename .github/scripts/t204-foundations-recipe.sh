# Command payload for the authorized GitHub gate only. Not executed locally.
# Setup in the job: Ubuntu24; Node24; Python3.12; normal pinned repo npm/pip
# dependencies for tests/js, cli, web and pytest. No npm-audit-prod invocation.
set +e
node --version
python3 --version
git rev-parse HEAD 'HEAD^{tree}'
git status --porcelain
(
  cd tests/js
  npm test -- --reporter=verbose helpers/source-guard-snapshot.test.ts helpers/rust-source-records.test.ts helpers/rust-source-records-transport.test.ts
) > "$RUNNER_TEMP/t204-foundations-vitest.log" 2>&1
t204_vitest_rc=$?
cat "$RUNNER_TEMP/t204-foundations-vitest.log"
(
  cd web
  ./node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types node --esModuleInterop ../tests/helpers/source-guard-snapshot.ts ../tests/helpers/rust-source-records.ts ../tests/js/helpers/source-guard-snapshot.test.ts ../tests/js/helpers/rust-source-records.test.ts ../tests/js/helpers/rust-source-records-transport.test.ts
) > "$RUNNER_TEMP/t204-foundations-types.log" 2>&1
t204_types_rc=$?
cat "$RUNNER_TEMP/t204-foundations-types.log"
python3 -m pytest -vv -rA tests/test_positions_read_piles.py tests/test_asset_orphan_acquisition.py --junitxml="$RUNNER_TEMP/t204-foundations-pytest.xml" > "$RUNNER_TEMP/t204-foundations-pytest.log" 2>&1
t204_pytest_rc=$?
cat "$RUNNER_TEMP/t204-foundations-pytest.log"
python3 -B - <<'PY' > "$RUNNER_TEMP/t204-read-kinds.json" 2> "$RUNNER_TEMP/t204-read-kinds.stderr"
import hashlib
import json
import runpy
import subprocess
import sys
from collections import Counter
from pathlib import Path

root = Path.cwd()
sys.path.insert(0, str(root / "tests"))
from rust_source_guard import compiled_records

subject = runpy.run_path(str(root / "tests/test_positions_read_piles.py"))
subject["test_the_reader_stays_read_only_and_the_op_has_its_name_in_the_load_times_log"]()
actual = subject["_read_kind_names"](subject["_read_kind_definition"]())
expected = subject["_request_kind_names"]()
assert actual == expected
counts = Counter(actual)
records = compiled_records("lib.rs", root=subject["RUST"])
owner = subject["_read_kind_owner"](subject["RUST"])
inputs = [{"logical_module": record.logical_module or "crate", "relative": record.relative,
           "sha256": hashlib.sha256(record.path.read_bytes()).hexdigest()} for record in records]
support = ["tests/test_positions_read_piles.py", "tests/rust_source_guard.py",
           "tests/rust_source_graph.py", "tests/rust_source_lex.py"]
print(json.dumps({"version": 1, "sha": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
                  "tree": subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], text=True).strip(),
                  "python": sys.version, "python_executable": sys.executable,
                  "frozen": False, "owner": owner.relative_to(subject["RUST"]).as_posix(),
                  "ordered_actual": actual, "ordered_dispatcher": expected,
                  "snapshot": {"version": 1, "guard": "positions.read_kinds", "total": len(actual),
                               "elements": [{"name": name, "count": counts[name]} for name in sorted(counts, key=lambda value: value.encode("utf-8"))]},
                  "inputs": inputs,
                  "support_inputs": [{"path": name, "sha256": hashlib.sha256((root / name).read_bytes()).hexdigest()} for name in support]}, sort_keys=True))
PY
t204_capture_rc=$?
cat "$RUNNER_TEMP/t204-read-kinds.json"
cat "$RUNNER_TEMP/t204-read-kinds.stderr"
git diff --exit-code HEAD > "$RUNNER_TEMP/t204-foundations-postcheck.log" 2>&1
t204_postcheck_rc=$?
cat "$RUNNER_TEMP/t204-foundations-postcheck.log"
printf 'vitest_rc=%s types_rc=%s pytest_rc=%s read_kinds_capture_rc=%s postcheck_rc=%s\n' "$t204_vitest_rc" "$t204_types_rc" "$t204_pytest_rc" "$t204_capture_rc" "$t204_postcheck_rc"
test "$t204_vitest_rc" -eq 0 && test "$t204_types_rc" -eq 0 && test "$t204_pytest_rc" -eq 0 && test "$t204_capture_rc" -eq 0 && test "$t204_postcheck_rc" -eq 0
