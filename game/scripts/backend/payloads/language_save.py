import base64
import json
import os
import tempfile

SUPPORTED_LOCALES = {"en", "it", "hu", "es", "de", "fr", "pt"}
data = json.loads(base64.b64decode('%s').decode('utf-8'))
locale = data.get('locale') if isinstance(data, dict) else None
if locale not in SUPPORTED_LOCALES:
    print(json.dumps(dict(ok=False, error='unsupported locale')))
    raise SystemExit(2)

path = '/jht_home/i18n-prefs.json'
os.makedirs(os.path.dirname(path), exist_ok=True)
fd, temporary = tempfile.mkstemp(prefix='.i18n-prefs.', dir=os.path.dirname(path))
try:
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump({'locale': locale}, stream, indent=2, ensure_ascii=False)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
except Exception:
    try:
        os.unlink(temporary)
    except OSError:
        pass
    raise
print(json.dumps(dict(ok=True, locale=locale)))
