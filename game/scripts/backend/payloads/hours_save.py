import json, base64, shutil, time, os
data = json.loads(base64.b64decode('%s').decode('utf-8'))
path = '/jht_home/jht.config.json'
try:
    c = json.load(open(path))
    if not isinstance(c, dict):
        c = {}
except (FileNotFoundError, json.JSONDecodeError, TypeError):
    # Su un'installazione vergine il provider non ha ancora creato il
    # config. Gli orari sono indipendenti dal login e devono poter essere
    # il primo passo della checklist.
    c = {}
try:
    backup = path + '.bak-' + time.strftime('%%Y%%m%%dT%%H%%M%%S')
    bfd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(bfd, 'wb') as output:
        with open(path, 'rb') as source:
            output.write(source.read()); output.flush(); os.fsync(output.fileno())
except Exception:
    pass
c.setdefault('team', {})['working_hours'] = data
os.makedirs(os.path.dirname(path), exist_ok=True, mode=0o700)
os.chmod(os.path.dirname(path), 0o700)
temp = path + '.game-tmp'
fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as output:
    json.dump(c, output, indent=2, ensure_ascii=False)
    output.write('\n'); output.flush(); os.fsync(output.fileno())
os.chmod(temp, 0o600); os.replace(temp, path); os.chmod(path, 0o600)
print(json.dumps(dict(ok=True)))
