"""Fixed desktop transport, synthetic subprocesses only. Never opens Docker/SSH."""
import base64
import contextlib
import io
import json
from pathlib import Path
import subprocess
from unittest.mock import patch

import pytest

PAYLOAD = Path(__file__).resolve().parents[1] / 'game/scripts/backend/payloads/browser_desktop.py'
CID = 'a' * 64
BINDING = dict(mission_id='b' * 32, owner_id='c' * 32, position_id=41, generation=1)


def execute(request, cid='', state=True, returned_cid=CID, stdout=None, fail=False):
    calls = []
    def command(argv, **kwargs):
        calls.append((argv, kwargs))
        if fail:
            raise subprocess.TimeoutExpired(argv, 1, output=b'PRIVATE_SENTINEL')
        if argv[1] == 'inspect':
            return subprocess.CompletedProcess(argv, 0, json.dumps(dict(Id=returned_cid, Running=state)).encode())
        return subprocess.CompletedProcess(argv, 0, stdout if stdout is not None else json.dumps(dict(ok=True, **BINDING)).encode())
    source = PAYLOAD.read_text() % (base64.b64encode(json.dumps(request).encode()).decode(), base64.b64encode(cid.encode()).decode())
    captured = io.StringIO()
    with patch('subprocess.run', command), contextlib.redirect_stdout(captured):
        exec(compile(source, str(PAYLOAD), 'exec'), {})
    return json.loads(captured.getvalue()), calls


def test_resolves_readonly_selector_then_executes_exact_id_and_private_stdin():
    result, calls = execute(dict(op='descriptor'))
    assert result['cid'] == CID
    assert calls[0][0] == ['docker', 'inspect', '--type', 'container', '--format',
                              '{"Id":{{json .Id}},"Running":{{json .State.Running}}}', 'jht']
    args, options = calls[1]
    assert args[:7] == ['docker', 'exec', '--user', '1001', '-i', CID, '/usr/bin/python3']
    assert args[7:10] == ['-I', '-B', '-c']
    assert options['input'] == b'{"op": "descriptor"}'
    assert options['timeout'] == 15


@pytest.mark.parametrize('body', [dict(op='input'), dict(op='frame', **BINDING, host='example.invalid'),
                                      dict(op='observe', **{**BINDING, 'generation': True}),
                                      dict(op='snapshot', **{**BINDING, 'owner_id': '../owner'}),
                                      dict(op='shell', **BINDING)])
def test_bad_binding_or_arbitrary_target_rejected_before_any_subprocess(body):
    result, calls = execute(body, CID)
    assert not result['reply']['ok'] and not calls


def test_control_requires_previous_exact_container_descriptor():
    result, calls = execute(dict(op='finish', **BINDING))
    assert result['reply']['error'] == 'browser_descriptor_required' and not calls


@pytest.mark.parametrize('state, returned_cid', [(False, CID), (True, 'd' * 64)])
def test_stopped_or_different_container_never_executes(state, returned_cid):
    result, calls = execute(dict(op='observe', **BINDING), CID, state, returned_cid)
    assert not result['reply']['ok'] and len(calls) == 1


def test_private_route_fields_stripped_before_ui():
    secret = 'PRIVATE_SENTINEL'
    response = dict(ok=True, screen=dict(password_file=secret), password=secret,
                    block=dict(reason='synthetic', action='inspect', path=secret))
    result, _ = execute(dict(op='descriptor'), stdout=json.dumps(response).encode())
    assert secret not in json.dumps(result)
    assert result['reply']['block'] == dict(reason='synthetic', action='inspect')


@pytest.mark.parametrize('stdout, fail', [(b'PRIVATE_SENTINEL', False), (None, True)])
def test_unknown_transport_result_never_returns_remote_body_or_success(stdout, fail):
    result, _ = execute(dict(op='descriptor'), stdout=stdout, fail=fail)
    assert result['reply']['ok'] is False
    assert 'PRIVATE_SENTINEL' not in json.dumps(result)
