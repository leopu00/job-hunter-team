"""The POSIX host bridge: local core image, busy-port fallback and cleanup on SIGINT/error."""
import os
import signal
import subprocess
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "scripts/jht-wrapper.sh").read_text()
FUNCTIONS = SOURCE[SOURCE.index("CHATGPT_LOGIN_HELPER="):SOURCE.index("# The setup in the container:")]


@pytest.mark.parametrize("busy", [False, True])
@pytest.mark.parametrize("interrupt", [False, True])
def test_core_relay_cleanup_and_busy_port_device_fallback(tmp_path, busy, interrupt):
    if os.name == 'nt':
        pytest.skip('POSIX host bridge')
    calls = tmp_path / 'calls'
    fake = tmp_path / 'docker'
    fake.write_text('''#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
case "$1" in
 inspect) printf 'sha256:synthetic-core-image\\n' ;;
 run) [ "$BUSY" != 1 ] || exit 125; printf 'synthetic-relay-id\\n' ;;
 exec) case "$*" in *randomBytes*) printf aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ;; *) exit 1 ;; esac ;;
esac
''')
    fake.chmod(0o755)
    harness = tmp_path / 'case.sh'
    harness.write_text(FUNCTIONS + '''
ATTESTED_CONTAINER_ID=attested-team
uname() { printf Darwin; }
chatgpt_bridge_start || exit 4
printf '%s' "${CHATGPT_LOGIN_ENV[*]}" > "$MODE"
if [ "$INTERRUPT" = 1 ]; then
  printf ready > "$READY"
  while :; do sleep 0.1; done
fi
exit 9
''')
    env = {**os.environ, 'PATH': str(tmp_path) + os.pathsep + os.environ['PATH'], 'CALLS': str(calls),
           'MODE': str(tmp_path / 'mode'), 'READY': str(tmp_path / 'ready'), 'BUSY': str(int(busy)), 'INTERRUPT': str(int(interrupt))}
    proc = subprocess.Popen(['bash', str(harness)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        if interrupt:
            deadline = time.monotonic() + 15
            while not (tmp_path / 'ready').exists() and time.monotonic() < deadline:
                time.sleep(0.05)
            assert (tmp_path / 'ready').exists()
            proc.send_signal(signal.SIGINT)
        out, err = proc.communicate(timeout=20)
        assert proc.returncode == (130 if interrupt else 9), (out, err)
    finally:
        if proc.poll() is None:
            proc.terminate(); proc.wait(timeout=20)
    assert ('METHOD=device_code' if busy else 'METHOD=browser') in (tmp_path / 'mode').read_text()
    lines = calls.read_text().splitlines()
    launch = next(line for line in lines if line.startswith('run '))
    assert '--pull=never' in launch
    assert '--publish 127.0.0.1:1455:1455' in launch
    assert '--entrypoint node sha256:synthetic-core-image' in launch
    assert '--volume' not in launch and '--mount' not in launch
    assert any(line.startswith('stop --time 10 jht-chatgpt-') for line in lines)
    assert any(' --cancel ' in line for line in lines)
