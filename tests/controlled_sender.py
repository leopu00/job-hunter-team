"""Owned, event-controlled fake sender for subprocess delivery tests (stdlib only)."""
import json
import math
import os
import pathlib
import shlex
import subprocess
import sys
import time
import uuid


def _identity(pid):
    """Return process birth token and state; never signal or reap another process."""
    if sys.platform.startswith('linux'):
        directory = pathlib.Path('/proc') / str(pid)
        try:
            raw = (directory / 'stat').read_text()
            fields = raw[raw.rindex(') ') + 2:].split()
            return dict(pid=pid, uid=directory.stat().st_uid, token=fields[19], state=fields[0])
        except (FileNotFoundError, ProcessLookupError):
            return None
    if sys.platform == 'darwin':
        result = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'uid=', '-o', 'lstart=', '-o', 'stat='],
                                capture_output=True, text=True, check=False,
                                env={**os.environ, 'LC_ALL': 'C'}, timeout=2)
        fields = result.stdout.split()
        if result.returncode == 1 and not fields:
            return None
        if result.returncode or len(fields) < 7:
            raise RuntimeError('Cannot read owned process identity with ps')
        return dict(pid=pid, uid=int(fields[0]), token=' '.join(fields[1:6]), state=fields[6])
    raise RuntimeError('ControlledSender requires Linux /proc or macOS ps')


# This canonical payload includes the exact identity implementation used by the
# controller; install does not depend on imports or a repository path at runtime.
_SENDER_BODY = r'''
def main():
    root, chatty, fixture = pathlib.Path(sys.argv[1]), sys.argv[2] == '1', sys.argv[3]
    deadline = time.monotonic() + float(sys.argv[4])
    arguments = sys.argv[5:]
    record = json.dumps(dict(pid=os.getpid(), args=arguments, fixture=fixture)) + '\n'
    fd = os.open(root / 'calls.log', os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        os.write(fd, record.encode())
    finally:
        os.close(fd)
    if arguments[:1] == ['--flush-ours']:
        return 0
    pid = os.getpid()
    own = _identity(pid)
    if own is None or own['uid'] != os.getuid():
        raise RuntimeError('Fake sender cannot attest itself')
    own['fixture'] = fixture
    temporary = root / ('started.' + str(pid) + '.pending')
    temporary.write_text(json.dumps(own))
    temporary.replace(root / ('started.' + str(pid)))
    def released(phase):
        return any((root / name).exists() for name in
                   ('release.all', 'release.' + phase, 'release.' + phase + '.' + str(pid)))
    for phase in ('paste', 'enter', 'exit'):
        while not released(phase):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                (root / ('timed-out.' + str(pid))).write_text(phase + '\n')
                return 124
            time.sleep(min(.01, remaining))
        if phase == 'paste':
            if chatty:
                print('controlled sender stderr before paste', file=sys.stderr, flush=True)
            (root / ('pasted.' + str(pid))).write_text('pasted\n')
        elif phase == 'enter':
            if chatty:
                print('controlled sender stdout before enter', flush=True)
            (root / ('entered.' + str(pid))).write_text('entered\n')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
'''


def _sender_source():
    # inspect obtains this one canonical function, never an independently copied
    # Linux/macOS identity implementation. No repository imports reach the fake.
    import inspect
    return ('import json, os, pathlib, subprocess, sys, time\n' +
            inspect.getsource(_identity) + '\n' + _SENDER_BODY)


class ControlledSender:
    """A case-owned sender, released only by markers written by its controller.

    Observe each delivery with wait_started before relying on its exit. The
    caller still owns and joins its Popen handles, including early failures.
    """

    def __init__(self, root, chatty=False, timeout=30):
        if type(timeout) not in (int, float) or not math.isfinite(timeout) or timeout <= 0:
            raise ValueError('Sender deadline must be finite and positive')
        path = pathlib.Path(root).absolute()
        if path.is_symlink():
            raise ValueError('Sender root must be a real owned directory')
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not path.is_dir() or path.stat().st_uid != os.getuid():
            raise ValueError('Sender root is not owned by the current UID')
        self.root, self.chatty = path.resolve(), bool(chatty)
        self.timeout = timeout
        self.fixture = uuid.uuid4().hex
        self._known = {}
        self._closed = False
        self._installed = False

    def install(self, path):
        destination = pathlib.Path(path).absolute()
        if destination.exists() or destination.is_symlink():
            raise FileExistsError('Refusing to overwrite an installed executable')
        command = [sys.executable, '-c', _sender_source(), str(self.root),
                   '1' if self.chatty else '0', self.fixture, str(self.timeout)]
        script = '#!/bin/sh\nexec ' + ' '.join(shlex.quote(arg) for arg in command) + ' "$@"\n'
        with destination.open('x') as stream:
            stream.write(script)
        destination.chmod(0o755)
        self._installed = True
        return destination

    def started(self):
        for marker in self.root.glob('started.*'):
            if not marker.name[len('started.'):].isdigit():
                continue
            record = json.loads(marker.read_text())
            if record.get('fixture') != self.fixture:
                continue
            if record.get('uid') != os.getuid() or not isinstance(record.get('pid'), int):
                raise ValueError('Started marker failed UID/PID ownership check')
            if not record.get('token') or record['pid'] <= 0:
                raise ValueError('Started marker lacks a valid process birth token')
            self._known[(record['pid'], record['token'])] = record
        return tuple(dict(record) for record in self._known.values())

    def _wait(self, condition, timeout, description):
        deadline = time.monotonic() + timeout
        while True:
            value = condition()
            if value:
                return value
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(description)
            time.sleep(min(.01, remaining))

    def wait_started(self, count=1, timeout=5):
        if not isinstance(count, int) or count < 1:
            raise ValueError('count must be positive')
        return self._wait(lambda: self.started() if len(self.started()) >= count else None,
                          timeout, 'Controlled sender did not start')

    def release(self, phase, pid=None):
        if phase not in ('paste', 'enter', 'exit'):
            raise ValueError('Unknown sender phase')
        if pid is not None and pid not in {record['pid'] for record in self.started()}:
            raise ValueError('Cannot release an unknown sender PID')
        name = 'release.' + phase + ('.' + str(pid) if pid is not None else '')
        (self.root / name).touch(mode=0o600, exist_ok=True)

    def release_all(self):
        """Persistent case-local release: future synchronous calls also complete."""
        (self.root / 'release.all').touch(mode=0o600, exist_ok=True)

    def _all_exited(self):
        for known in self.started():
            actual = _identity(known['pid'])
            if actual is None:
                continue
            if actual['uid'] != known['uid'] or actual['token'] != known['token']:
                continue
            if actual['state'].startswith(('Z', 'X')):
                continue
            return False
        return True

    def wait_exited(self, timeout=5):
        if not self.started():
            raise ValueError('Cannot attest exit without an observed sender')
        return self._wait(self._all_exited, timeout, 'Owned sender processes still running')

    def close(self, timeout=5):
        self.release_all()
        if self._installed:
            self.wait_started(timeout=timeout)
        if self.started():
            self.wait_exited(timeout=timeout)
        self._closed = True

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
