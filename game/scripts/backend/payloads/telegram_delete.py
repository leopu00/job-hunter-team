import json, os, sys
role = json.load(sys.stdin)['role']
path = '/jht_home/jht.config.json'
try:
    config = json.load(open(path))
except Exception:
    config = {}
bots = (((config.get('channels') or {}).get('telegram') or {}).get('bots') or {})
bots.pop(role, None)
temp = path + '.game-tmp'
os.makedirs(os.path.dirname(path), exist_ok=True, mode=0o700)
os.chmod(os.path.dirname(path), 0o700)
fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as output:
    json.dump(config, output, ensure_ascii=False, indent=2)
    output.write('\n')
    output.flush(); os.fsync(output.fileno())
os.chmod(temp, 0o600)
os.replace(temp, path)
os.chmod(path, 0o600)
print(json.dumps({'ok': True}), file=sys.stderr)
