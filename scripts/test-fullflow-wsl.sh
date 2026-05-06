#!/usr/bin/env bash
# Test full-flow del nuovo design host/container in WSL Ubuntu.
# Simula gli effetti di install.sh (no curl: copia da repo locale).
set -euo pipefail

REPO=/mnt/c/Users/leone.puglisi/repos/job-hunter-team/dev-1
TEST_RUNTIME=$HOME/.jht/runtime/test-flow
TEST_BIN=$HOME/.local/bin/jht-test
TEST_CONTAINER=jht-flow-test

echo "=== teardown precedente ==="
JHT_CONTAINER_NAME=$TEST_CONTAINER \
JHT_RUNTIME_DIR=$TEST_RUNTIME \
JHT_COMPOSE_FILE=$TEST_RUNTIME/docker-compose.yml \
  $TEST_BIN down 2>/dev/null || true
docker rm -f $TEST_CONTAINER 2>/dev/null || true
rm -rf $TEST_RUNTIME

echo "=== install simulation: copia file ==="
mkdir -p $TEST_RUNTIME $(dirname $TEST_BIN)
cp $REPO/docker-compose.yml $TEST_RUNTIME/docker-compose.yml
cp $REPO/scripts/jht-wrapper.sh $TEST_BIN
chmod +x $TEST_BIN

# Customizzazioni del compose per test isolato:
# 1) container_name unique
# 2) port 3099 invece di 3000
# 3) bind-mount del container-proxy.js modificato (immagine GHCR ha la vecchia)
sed -i "s/container_name: jht\$/container_name: $TEST_CONTAINER/" $TEST_RUNTIME/docker-compose.yml
sed -i "s|127.0.0.1:3000:3000|127.0.0.1:3099:3000|" $TEST_RUNTIME/docker-compose.yml

# Inserisce una riga extra nel volumes per il container-proxy.js patchato
python3 -c "
import sys
with open('$TEST_RUNTIME/docker-compose.yml') as f:
    content = f.read()
patch_volume = '      - $REPO/cli/src/utils/container-proxy.js:/app/cli/src/utils/container-proxy.js:ro\n'
# Inserisce dopo la riga dei Documents
import re
content = re.sub(r'(\s+- \$\{HOME\}/Documents/Job Hunter Team:/jht_user\n)', r'\1' + patch_volume, content)
with open('$TEST_RUNTIME/docker-compose.yml', 'w') as f:
    f.write(content)
"

echo "=== compose finale ==="
cat $TEST_RUNTIME/docker-compose.yml
echo

# Override env vars per puntare al test
export JHT_CONTAINER_NAME=$TEST_CONTAINER
export JHT_RUNTIME_DIR=$TEST_RUNTIME
export JHT_COMPOSE_FILE=$TEST_RUNTIME/docker-compose.yml

run() {
  printf '\n--- $ jht-test %s ---\n' "$*"
  $TEST_BIN "$@"
}

# Mock the user dir bind-mount target so docker doesn't fail
mkdir -p "$HOME/Documents/Job Hunter Team"

echo "=== 1) jht-test up ==="
$TEST_BIN up 2>&1 | tail -5
sleep 2

echo
echo "=== 2) jht-test status ==="
$TEST_BIN status

echo
echo "=== 3) jht-test --help (CLI Node nel container) ==="
$TEST_BIN --help 2>&1 | head -8

echo
echo "=== 4) jht-test team list (tmux passthrough) ==="
$TEST_BIN team list 2>&1 | head -15

echo
echo "=== 5) jht-test logs (10 righe) ==="
$TEST_BIN logs --tail 10 2>&1 | tail -10

echo
echo "=== 6) docker ps ==="
docker ps --filter name=$TEST_CONTAINER --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

echo
echo "=== 7) jht-test down (teardown) ==="
$TEST_BIN down 2>&1 | tail -3

echo
echo "=== ALL DONE ==="
