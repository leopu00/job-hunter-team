import json, base64, shutil, time
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
    shutil.copy2(path, path + '.bak-' + time.strftime('%%Y%%m%%dT%%H%%M%%S'))
except Exception:
    pass
c.setdefault('team', {})['working_hours'] = data
json.dump(c, open(path, 'w'), indent=2, ensure_ascii=False)
print(json.dumps(dict(ok=True)))
