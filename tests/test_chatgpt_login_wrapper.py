"""Lazy POSIX callback bridge: core image, busy/dead relay, no-login setup and SIGINT cleanup."""
import os
import signal
import subprocess
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "scripts/jht-wrapper.sh").read_text()
FUNCTIONS = SOURCE[SOURCE.index("CHATGPT_LOGIN_HELPER="):SOURCE.index("# The setup in the container:")]
URL = ('https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann'
       '&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid+profile+email+offline_access'
       '&code_challenge=' + 'a' * 43 + '&code_challenge_method=S256&state=' + 'b' * 32
       + '&id_token_add_organizations=true&codex_cli_simplified_flow=true&originator=pi')


@pytest.mark.parametrize("busy,dead,probe,interrupt", [
    (False, False, True, False), (True, False, True, False), (False, True, True, False),
    (False, False, False, False), (False, False, True, True),
])
def test_lazy_core_relay_and_cleanup(tmp_path, busy, dead, probe, interrupt):
    if os.name == 'nt':
        pytest.skip('POSIX host bridge')
    calls = tmp_path / 'calls'
    fake = tmp_path / 'docker'
    fake.write_text('''#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
case "$1" in
 inspect) printf 'sha256:synthetic-core-image\\n' ;;
 run) [ "$BUSY" != 1 ] || exit 125; printf 'synthetic-relay-id\\n' ;;
 exec) case "$*" in
  *--request*) [ "$PROBE" = 1 ] || exit 1; if [ -f "$MODE_SENT" ]; then printf '%s' "$AUTH_URL"; else printf probe; fi ;;
  *--health*) [ "$DEAD" != 1 ] ;;
  *--mode*) printf '%s' "$*" > "$MODE_SENT" ;;
  *--arm*|*--cancel*) exit 0 ;;
  *) exit 1 ;;
 esac ;;
esac
''')
    fake.chmod(0o755)
    opener = tmp_path / 'open'
    opener.write_text('#!/bin/sh\nprintf "%s\\n" "$1" >> "$OPENED"\n')
    opener.chmod(0o755)
    harness = tmp_path / 'case.sh'
    harness.write_text(FUNCTIONS + '''
ATTESTED_CONTAINER_ID=attested-team
uname() { printf Darwin; }
chatgpt_login_url_allowed "$AUTH_URL" || exit 7
if chatgpt_login_url_allowed "${AUTH_URL}&extra=other"; then exit 8; fi
chatgpt_bridge_start
if [ "$PROBE" = 1 ]; then
  for attempt in 1 2 3 4 5 6 7 8 9 10; do [ ! -f "$MODE_SENT" ] || break; sleep 0.5; done
  [ -f "$MODE_SENT" ] || exit 6
fi
sleep 2.2
if [ "$INTERRUPT" = 1 ]; then
  printf ready > "$READY"
  while :; do sleep 0.1; done
fi
exit 9
''')
    env = {**os.environ, 'PATH': str(tmp_path) + os.pathsep + os.environ['PATH'], 'CALLS': str(calls),
           'MODE_SENT': str(tmp_path / 'mode'), 'READY': str(tmp_path / 'ready'), 'BUSY': str(int(busy)),
           'INTERRUPT': str(int(interrupt)), 'PROBE': str(int(probe)), 'DEAD': str(int(dead)),
           'AUTH_URL': URL, 'OPENED': str(tmp_path / 'opened')}
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
    lines = calls.read_text().splitlines()
    launches = [line for line in lines if line.startswith('run ')]
    if not probe:
        assert launches == [], 'an API-key or other setup publishes no callback port'
    else:
        assert len(launches) == 1
        launch = launches[0]
        assert '--pull=never' in launch and '--publish 127.0.0.1:1455:1455' in launch
        assert '--entrypoint node sha256:synthetic-core-image' in launch
        assert '--volume' not in launch and '--mount' not in launch
        expected = 'device_code' if busy or dead else 'browser'
        assert (tmp_path / 'mode').read_text().endswith(' ' + expected)
        assert (tmp_path / 'opened').read_text().splitlines() == [URL], 'each URL type opens at most once'
    assert any(line.startswith('stop --time 10 jht-chatgpt-') for line in lines)
    assert any(' --cancel ' in line for line in lines)
