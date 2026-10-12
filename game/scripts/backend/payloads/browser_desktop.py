"""Fixed authenticated host bridge; never accepts host, port, path or shell."""
import base64
import json
import re
import subprocess

REQUEST = json.loads(base64.b64decode('%s', validate=True))
RUNTIME = json.loads(base64.b64decode('%s', validate=True))
HANDSHAKE = %s
OPERATIONS = {'descriptor', 'snapshot', 'delete_snapshot', 'confirm', 'handoff',
              'observe', 'finish', 'abandon', 'frame', 'input'}
KEYS = {'op', 'mission_id', 'position_id', 'owner_id', 'generation', 'review_id', 'event_id', 'display_id', 'frame_sequence',
        'kind', 'x', 'y', 'button', 'pressed', 'key'}
# This is the only executable entrypoint. Request values go to stdin, never argv.
ENTRY = ('import sys,json;sys.path.insert(0,"/app/shared/skills");'
         'from closer_interactive import desktop_request;'
         'print(json.dumps(desktop_request(json.load(sys.stdin))))')


def bridge():
    if not isinstance(REQUEST, dict) or set(REQUEST) - KEYS or REQUEST.get('op') not in OPERATIONS:
        raise ValueError('browser_request_invalid')
    if len(json.dumps(REQUEST).encode()) > 4096:
        raise ValueError('browser_request_too_large')
    if REQUEST['op'] != 'descriptor':
        for name in ('mission_id', 'owner_id'):
            if not isinstance(REQUEST.get(name), str) or not re.fullmatch(r'[0-9a-f]{32}', REQUEST[name]):
                raise ValueError('browser_binding_invalid')
        if type(REQUEST.get('position_id')) is not int or REQUEST['position_id'] <= 0 or type(REQUEST.get('generation')) is not int or REQUEST['generation'] != 1:
            raise ValueError('browser_binding_invalid')
    if not isinstance(RUNTIME, dict) or set(RUNTIME) != {'container_id', 'oci_revision', 'image_id', 'digest'}:
        raise ValueError('browser_runtime_binding_required')
    patterns = {'container_id': r'[0-9a-f]{64}', 'oci_revision': r'[0-9a-f]{40}',
                'image_id': r'sha256:[0-9a-f]{64}', 'digest': r'sha256:[0-9a-f]{64}'}
    if any(not isinstance(RUNTIME[k], str) or not re.fullmatch(patterns[k], RUNTIME[k]) for k in patterns):
        raise ValueError('browser_runtime_binding_invalid')
    cid = RUNTIME['container_id']
    probe = subprocess.run(['docker', 'inspect', '--type', 'container', '--format',
                            '{"Id":{{json .Id}},"Running":{{json .State.Running}},"Image":{{json .Image}},'
                            '"Revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}', cid],
                           capture_output=True, timeout=8, check=True)
    info = json.loads(probe.stdout)
    if info.get('Id') != cid or info.get('Image') != RUNTIME['image_id'] or info.get('Revision') != RUNTIME['oci_revision']:
        raise ValueError('browser_container_mismatch')
    if info.get('Running') is not True:
        raise ValueError('browser_container_stopped')
    image = subprocess.run(['docker', 'image', 'inspect', '--format',
                            '{"Id":{{json .Id}},"Digests":{{json .RepoDigests}},'
                            '"Revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}', RUNTIME['image_id']],
                           capture_output=True, timeout=8, check=True)
    metadata = json.loads(image.stdout)
    digests = metadata.get('Digests')
    if (metadata.get('Id') != RUNTIME['image_id'] or metadata.get('Revision') != RUNTIME['oci_revision']
            or not isinstance(digests, list) or not any(isinstance(d, str) and d.endswith('@' + RUNTIME['digest']) for d in digests)):
        raise ValueError('browser_image_mismatch')
    if HANDSHAKE:
        return {'cid': cid, 'reply': {'ok': True}}
    result = subprocess.run(['docker', 'exec', '--user', '1001', '-i', cid,
                             '/usr/bin/python3', '-I', '-B', '-c', ENTRY],
                            input=json.dumps(REQUEST).encode(), capture_output=True,
                            timeout=15, check=True)
    if len(result.stdout) > 12 * 1024 * 1024:
        raise ValueError('browser_response_too_large')
    reply = json.loads(result.stdout)
    if not isinstance(reply, dict):
        raise ValueError('browser_response_invalid')
    # Do not carry private screen descriptors, paths or session secrets to Godot.
    public = {'ok', 'error', 'queued', 'mission_id', 'position_id', 'owner_id',
              'generation', 'review_id', 'phase', 'input_ready', 'block',
              'event_id', 'png_base64', 'display_id', 'frame_sequence', 'width', 'height', 'allowed_actions', 'stream_available', 'gate_reason'}
    reply = {k: v for k, v in reply.items() if k in public}
    if isinstance(reply.get('block'), dict):
        reply['block'] = {k: v for k, v in reply['block'].items()
                          if k in {'event_id', 'reason', 'action', 'screenshot_available'}}
    return {'cid': cid, 'reply': reply}


try:
    print(json.dumps(bridge()))
except ValueError as exc:
    # Only locally generated reason codes; never include remote output.
    reason = str(exc)
    print(json.dumps({'reply': {'ok': False, 'error': reason if reason.startswith('browser_') else 'browser_response_invalid'}}))
except Exception:
    print(json.dumps({'reply': {'ok': False, 'error': 'browser_transport_unavailable'}}))
