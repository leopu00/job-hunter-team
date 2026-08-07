import base64, json, os, stat

ROOTS = ('/jht_user/cv', '/jht_user/allegati', '/jht_user/output', '/jht_user/critiche')
EXTS = {'markdown': '.md', 'pdf': '.pdf'}
MAX_BYTES = %d

def result(ok=False, error='', data=b''):
    print(json.dumps(dict(ok=ok, error=error,
                          b64=base64.b64encode(data).decode() if ok else '')))

def open_beneath(root, relative):
    # openat + O_NOFOLLOW su ogni componente: nessuna finestra fra realpath
    # e open in cui un file o una directory possano diventare un symlink.
    dflags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW
    fd = os.open(root, dflags)
    try:
        parts = relative.split('/')
        for part in parts[:-1]:
            child = os.open(part, dflags, dir_fd=fd)
            os.close(fd)
            fd = child
        return os.open(parts[-1], os.O_RDONLY | os.O_CLOEXEC |
                       os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    finally:
        os.close(fd)

try:
    path = base64.b64decode('%s', validate=True).decode('utf-8')
    kind = base64.b64decode('%s', validate=True).decode('ascii')
except Exception:
    path, kind = '', ''

root = next((r for r in ROOTS if path.startswith(r + '/')), '')
suffix = EXTS.get(kind, '')
name = os.path.basename(path)
stem = name[:-len(suffix)] if suffix and name.lower().endswith(suffix) else ''
canonical = (path and path == os.path.normpath(path) and os.path.isabs(path)
             and root and suffix and stem and '.' not in stem)

if not canonical:
    result(error='documento non valido')
else:
    try:
        fd = open_beneath(root, path[len(root) + 1:])
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                result(error='documento non valido')
            elif info.st_size > MAX_BYTES:
                result(error='file oltre i 10 MB')
            else:
                with os.fdopen(fd, 'rb', closefd=False) as fh:
                    data = fh.read(MAX_BYTES + 1)
                if len(data) > MAX_BYTES:
                    result(error='file oltre i 10 MB')
                elif kind == 'pdf' and not (data.startswith(b'%%PDF-') and
                                             b'%%%%EOF' in data[-1024:]):
                    result(error='documento non valido')
                else:
                    result(ok=True, data=data)
        finally:
            os.close(fd)
    except FileNotFoundError:
        result(error='file non trovato sul container')
    except OSError:
        result(error='documento non valido')
