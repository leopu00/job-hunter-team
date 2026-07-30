import json, os
AUTH = %s
HOME = '/jht_home'
try:
    c = json.load(open(HOME + '/jht.config.json'))
except Exception:
    c = None
out = {'config_read': isinstance(c, dict)}
if not isinstance(c, dict):
    c = {}
out['active_provider'] = str(c.get('active_provider') or '')
declared = c.get('providers') if isinstance(c.get('providers'), dict) else {}
out['providers'] = dict((k, {'plan': str((v or {}).get('plan') or '')})
                        for k, v in declared.items() if isinstance(v, dict))
team = c.get('team') if isinstance(c.get('team'), dict) else {}
out['team'] = {'working_hours': team.get('working_hours') or {}}
auth = {}
for name, paths in AUTH.items():
    for rel in paths:
        full = HOME + '/' + rel
        if os.path.isfile(full) and os.path.getsize(full) > 0:
            auth[name] = rel
            break
out['auth'] = auth
print(json.dumps(out))
