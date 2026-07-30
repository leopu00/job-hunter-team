import base64, json, os
path = base64.b64decode('%s').decode('utf-8')
real = os.path.realpath(path)
if not (real.startswith('/jht_user/') or real.startswith('/jht_home/')):
    print(json.dumps(dict(ok=False, error='percorso fuori dalle aree dati')))
elif not os.path.isfile(real):
    print(json.dumps(dict(ok=False, error='file non trovato sul container')))
elif os.path.getsize(real) > %d:
    print(json.dumps(dict(ok=False, error='file oltre i 10 MB')))
else:
    with open(real, 'rb') as f:
        print(json.dumps(dict(ok=True, b64=base64.b64encode(f.read()).decode())))
