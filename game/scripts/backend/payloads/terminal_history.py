import base64, json
from collections import deque
from pathlib import Path

agent = base64.b64decode('%s').decode('utf-8')
project = Path('/jht_home/.claude/projects') / ('-jht-home-agents-' + agent)
files = list(project.glob('*.jsonl')) if project.is_dir() else []
if not files:
    print(json.dumps({'ok': False, 'text_b64': '', 'events': 0}))
    raise SystemExit
source = max(files, key=lambda p: p.stat().st_mtime)
rows = deque(maxlen=1200)
with source.open('r', encoding='utf-8', errors='replace') as handle:
    for row in handle:
        rows.append(row)

def clean(value, limit):
    if isinstance(value, str):
        text = value
    elif value is None:
        return ''
    else:
        try:
            text = json.dumps(value, ensure_ascii=False)
        except Exception:
            text = str(value)
    text = text.replace(chr(0), '').strip()
    if len(text) > limit:
        text = text[:limit] + '…'
    return text

def content_text(value, limit):
    if isinstance(value, str):
        return clean(value, limit)
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                part = item.get('text', item.get('content', ''))
            else:
                part = item
            rendered = clean(part, limit)
            if rendered:
                parts.append(rendered)
        return clean('\n'.join(parts), limit)
    if isinstance(value, dict):
        return clean(value.get('text', value.get('content', value)), limit)
    return clean(value, limit)

out = []
events = 0
for row in rows:
    try:
        item = json.loads(row)
    except Exception:
        continue
    kind = str(item.get('type', ''))
    message = item.get('message') or {}
    blocks = message.get('content', []) if isinstance(message, dict) else []
    if isinstance(blocks, str):
        blocks = [{'type': 'text', 'text': blocks}]
    if not isinstance(blocks, list):
        continue
    stamp = str(item.get('timestamp', ''))[11:19]
    lead = ('[' + stamp + '] ') if stamp else ''
    if kind == 'assistant':
        for block in blocks:
            if not isinstance(block, dict):
                continue
            block_kind = str(block.get('type', ''))
            if block_kind == 'text':
                body = clean(block.get('text', ''), 8000)
                if body:
                    out.append('● ' + lead + body)
                    events += 1
            elif block_kind == 'tool_use':
                name = clean(block.get('name', 'tool'), 80)
                data = block.get('input', {})
                detail = ''
                if isinstance(data, dict):
                    for key in ('command', 'file_path', 'path', 'url', 'query', 'pattern'):
                        if data.get(key):
                            detail = clean(data.get(key), 1800)
                            break
                if not detail:
                    detail = clean(data, 1000)
                out.append('└ ' + lead + name + (': ' + detail if detail else ''))
                events += 1
    elif kind == 'user':
        for block in blocks:
            if not isinstance(block, dict) or block.get('type') != 'tool_result':
                continue
            body = content_text(block.get('content', ''), 3000)
            if body:
                out.append('  ' + lead + 'output: ' + body)
                events += 1

text = '\n\n'.join(out)
if len(text) > 450000:
    text = '… storico precedente omesso …\n\n' + text[-450000:]
payload = base64.b64encode(text.encode('utf-8')).decode('ascii')
print(json.dumps({'ok': True, 'text_b64': payload, 'events': events,
                  'source': source.name}))
