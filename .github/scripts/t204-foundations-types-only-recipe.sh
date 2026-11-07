#!/usr/bin/env bash
# CI-only correction of the explicit-file TypeScript invocation.
# Other phases already ran on this immutable payload; this recipe checks types only.
set -euo pipefail
expected_payload=16f208cd79c0ced1df7d7e4428b900d380c7c780
expected_tree=35c1c14020da1605aad67eaf4076d963a48d2d46
[ "$(git rev-parse HEAD)" = "$expected_payload" ]
[ "$(git rev-parse 'HEAD^{tree}')" = "$expected_tree" ]
[ -n "${RUNNER_TEMP:-}" ]
[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]
node --version
printf 'T204_SOURCE_SHA=%s TREE=%s\n' "$expected_payload" "$expected_tree"
for source_input in tests/helpers/source-guard-snapshot.ts tests/helpers/source-guard-snapshot.cjs tests/helpers/rust-source-records.ts tests/js/helpers/source-guard-snapshot.test.ts tests/js/helpers/rust-source-records.test.ts tests/js/helpers/rust-source-records-transport.test.ts web/package.json web/package-lock.json tests/js/package.json tests/js/package-lock.json; do
  sha256sum "$source_input"
done > "$RUNNER_TEMP/t204-foundations-types-only-before.sha256"
cat "$RUNNER_TEMP/t204-foundations-types-only-before.sha256"
cd web
node - <<'JS'
const fs = require('node:fs');
const expected = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')).packages['node_modules/typescript'].version;
const actual = JSON.parse(fs.readFileSync('node_modules/typescript/package.json', 'utf8')).version;
if (actual !== expected) throw new Error('Installed TypeScript differs from the checked-in lock');
console.log('T204_TYPESCRIPT_LOCKED=' + actual);
JS
./node_modules/.bin/tsc --version
set +e
./node_modules/.bin/tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types node --esModuleInterop ../tests/helpers/source-guard-snapshot.ts ../tests/helpers/rust-source-records.ts ../tests/js/helpers/source-guard-snapshot.test.ts ../tests/js/helpers/rust-source-records.test.ts ../tests/js/helpers/rust-source-records-transport.test.ts > "$RUNNER_TEMP/t204-foundations-types-only.log" 2>&1
t204_types_rc=$?
set -e
cat "$RUNNER_TEMP/t204-foundations-types-only.log"
cd ..
for source_input in tests/helpers/source-guard-snapshot.ts tests/helpers/source-guard-snapshot.cjs tests/helpers/rust-source-records.ts tests/js/helpers/source-guard-snapshot.test.ts tests/js/helpers/rust-source-records.test.ts tests/js/helpers/rust-source-records-transport.test.ts web/package.json web/package-lock.json tests/js/package.json tests/js/package-lock.json; do
  sha256sum "$source_input"
done > "$RUNNER_TEMP/t204-foundations-types-only-after.sha256"
cmp "$RUNNER_TEMP/t204-foundations-types-only-before.sha256" "$RUNNER_TEMP/t204-foundations-types-only-after.sha256"
[ "$(git rev-parse HEAD)" = "$expected_payload" ]
[ "$(git rev-parse 'HEAD^{tree}')" = "$expected_tree" ]
git diff --exit-code HEAD
[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]
printf 'types_only_rc=%s\n' "$t204_types_rc"
exit "$t204_types_rc"
