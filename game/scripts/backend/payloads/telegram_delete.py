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
with open(temp, 'w') as output:
    json.dump(config, output, ensure_ascii=False, indent=2)
    output.write('\n')
os.replace(temp, path)
print(json.dumps({'ok': True}), file=sys.stderr)
