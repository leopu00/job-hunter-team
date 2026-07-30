import json, os, sys, urllib.parse, urllib.request
p = json.load(sys.stdin)
role, token, chat_id = p['role'], p['token'], str(p.get('chat_id') or '')
def call(method, query=''):
    url = 'https://api.telegram.org/bot' + urllib.parse.quote(token, safe=':') + '/' + method + query
    with urllib.request.urlopen(url, timeout=12) as response:
        return json.loads(response.read().decode('utf-8'))
try:
    me = call('getMe')
    if not me.get('ok'):
        raise RuntimeError(me.get('description') or 'getMe failed')
    if not chat_id:
        updates = call('getUpdates', '?timeout=2&limit=20')
        for update in reversed(updates.get('result') or []):
            message = update.get('message') or update.get('edited_message') or {}
            chat = message.get('chat') or {}
            if chat.get('id') is not None:
                chat_id = str(chat['id'])
                break
    if not chat_id:
        raise RuntimeError('Apri il bot, premi Start e riprova: chat non ancora rilevata')
    path = '/jht_home/jht.config.json'
    try:
        config = json.load(open(path))
    except Exception:
        config = {}
    channels = config.setdefault('channels', {})
    telegram = channels.setdefault('telegram', {})
    bots = telegram.setdefault('bots', {})
    bots[role] = {'bot_token': token, 'chat_id': chat_id}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp = path + '.game-tmp'
    with open(temp, 'w') as output:
        json.dump(config, output, ensure_ascii=False, indent=2)
        output.write('\n')
    os.replace(temp, path)
    print(json.dumps({'ok': True, 'username': me['result'].get('username', ''),
                      'chat_id': chat_id}), file=sys.stderr)
except Exception as exc:
    print(json.dumps({'ok': False, 'error': str(exc)}), file=sys.stderr)
    raise SystemExit(2)
