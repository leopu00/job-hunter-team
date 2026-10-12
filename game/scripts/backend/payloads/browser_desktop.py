"""Fixed authenticated host bridge; never accepts host, port, path or shell."""
import base64
import json
import re
import subprocess

REQUEST = json.loads(base64.b64decode('%s', validate=True))
PINNED_CID = base64.b64decode('%s', validate=True).decode('ascii')
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
    if PINNED_CID and not re.fullmatch(r'[0-9a-f]{64}', PINNED_CID):
        raise ValueError('browser_container_invalid')
    if not PINNED_CID and REQUEST['op'] != 'descriptor':
        raise ValueError('browser_descriptor_required')
    target = PINNED_CID or 'jht'  # selector is read-only and resolved once
    probe = subprocess.run(['docker', 'inspect', '--type', 'container', '--format',
                            '{"Id":{{json .Id}},"Running":{{json .State.Running}}}', target],
                           capture_output=True, timeout=8, check=True)
    info = json.loads(probe.stdout)
    cid = info['Id']
    if not re.fullmatch(r'[0-9a-f]{64}', cid) or (PINNED_CID and cid != PINNED_CID):
        raise ValueError('browser_container_mismatch')
    if info.get('Running') is not True:
        raise ValueError('browser_container_stopped')
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
