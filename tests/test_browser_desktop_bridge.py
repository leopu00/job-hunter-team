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
RUNTIME = dict(container_id=CID, oci_revision='e' * 40, image_id='sha256:' + 'f' * 64, digest='sha256:' + '1' * 64)
BINDING = dict(mission_id='b' * 32, owner_id='c' * 32, position_id=41, generation=1)


def execute(request, runtime=RUNTIME, state=True, returned_cid=CID, stdout=None, fail=False, handshake=False, drift=None):
    calls = []
    def command(argv, **kwargs):
        calls.append((argv, kwargs))
        if fail:
            raise subprocess.TimeoutExpired(argv, 1, output=b'PRIVATE_SENTINEL')
        if argv[1] == 'inspect':
            if argv[-1] == 'jht':
                return subprocess.CompletedProcess(argv, 0, json.dumps(dict(Id='0' * 64, Running=False)).encode())
            return subprocess.CompletedProcess(argv, 0, json.dumps({**dict(Id=returned_cid, Running=state, Image=RUNTIME['image_id'], Revision=RUNTIME['oci_revision']), **(drift or {}).get('container', {})}).encode())
        if argv[1] == 'image':
            info = dict(Id=RUNTIME['image_id'], Revision=RUNTIME['oci_revision'], Digests=['example.invalid/inert@' + RUNTIME['digest']])
            info.update((drift or {}).get('image', {}))
            return subprocess.CompletedProcess(argv, 0, json.dumps(info).encode())
        return subprocess.CompletedProcess(argv, 0, stdout if stdout is not None else json.dumps(dict(ok=True, **BINDING)).encode())
    source = PAYLOAD.read_text() % (base64.b64encode(json.dumps(request).encode()).decode(), base64.b64encode(json.dumps(runtime).encode()).decode(), 'True' if handshake else 'False')
    captured = io.StringIO()
    with patch('subprocess.run', command), contextlib.redirect_stdout(captured):
        exec(compile(source, str(PAYLOAD), 'exec'), {})
    return json.loads(captured.getvalue()), calls


def test_trusted_candidate_inspect_then_executes_exact_id_and_private_stdin():
    result, calls = execute(dict(op='descriptor'))
    assert result['cid'] == CID
    assert calls[0][0][:5] == ['docker', 'inspect', '--type', 'container', '--format']
    assert calls[0][0][-1] == CID
    assert calls[1][0][-1] == RUNTIME['image_id']
    args, options = calls[2]
    assert args[:7] == ['docker', 'exec', '--user', '1001', '-i', CID, '/usr/bin/python3']
    assert args[7:10] == ['-I', '-B', '-c']
    assert options['input'] == b'{"op": "descriptor"}'
    assert options['timeout'] == 15


@pytest.mark.parametrize('body', [dict(op='input'), dict(op='frame', **BINDING, host='example.invalid'),
                                      dict(op='observe', **{**BINDING, 'generation': True}),
                                      dict(op='snapshot', **{**BINDING, 'owner_id': '../owner'}),
                                      dict(op='shell', **BINDING)])
def test_bad_binding_or_arbitrary_target_rejected_before_any_subprocess(body):
    result, calls = execute(body)
    assert not result['reply']['ok'] and not calls


def test_missing_trusted_binding_never_discovers_legacy():
    result, calls = execute(dict(op='finish', **BINDING), runtime={})
    assert result['reply']['error'] == 'browser_runtime_binding_required' and not calls


@pytest.mark.parametrize('state, returned_cid', [(False, CID), (True, 'd' * 64)])
def test_stopped_or_different_container_never_executes(state, returned_cid):
    result, calls = execute(dict(op='observe', **BINDING), state=state, returned_cid=returned_cid)
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


def test_handshake_and_first_descriptor_both_use_candidate_with_original_stopped():
    # The inert Docker seam would reject original jht; no call may select it.
    handshake, calls = execute(dict(op='descriptor'), handshake=True)
    descriptor, requests = execute(dict(op='descriptor'))
    assert handshake['reply']['ok'] is True and descriptor['reply']['ok'] is True
    assert len(calls) == 2 and all(c[0][1] != 'exec' for c in calls)
    assert all(c[0][-1] != 'jht' for c in calls + requests)
    assert calls[0][0][-1] == requests[0][0][-1] == requests[-1][0][5] == CID


@pytest.mark.parametrize('drift', [
    {'container': {'Revision': '2' * 40}},
    {'container': {'Image': 'sha256:' + '2' * 64}},
    {'image': {'Id': 'sha256:' + '2' * 64}},
    {'image': {'Revision': '2' * 40}},
    {'image': {'Digests': ['example.invalid/inert:latest']}},
    {'image': {'Digests': ['example.invalid/inert@sha256:' + '2' * 64]}},
])
def test_revision_image_or_digest_mismatch_prevents_exec(drift):
    result, calls = execute(dict(op='descriptor'), drift=drift)
    assert result['reply']['ok'] is False
    assert all(call[0][1] != 'exec' for call in calls)


@pytest.mark.parametrize('runtime', [{}, {**RUNTIME, 'container_id': 'candidate-name'},
                                      {**RUNTIME, 'digest': 'latest'},
                                      {**RUNTIME, 'target': 'jht'}])
def test_missing_or_invalid_delivery_never_falls_back(runtime):
    result, calls = execute(dict(op='descriptor'), runtime=runtime)
    assert result['reply']['ok'] is False and not calls
