import json, base64, shutil, time
data = json.loads(base64.b64decode('%s').decode('utf-8'))
path = '/jht_home/jht.config.json'
c = json.load(open(path))
try:
    shutil.copy2(path, path + '.bak-' + time.strftime('%%Y%%m%%dT%%H%%M%%S'))
except Exception:
    pass
c.setdefault('team', {})['working_hours'] = data
json.dump(c, open(path, 'w'), indent=2, ensure_ascii=False)
print(json.dumps(dict(ok=True)))
