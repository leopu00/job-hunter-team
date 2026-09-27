import json, subprocess, time

def run(args):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=4).stdout
    except Exception:
        return None

def tail_of(session):
    pane = run(['tmux', 'capture-pane', '-t', session, '-p'])
    if pane is None:
        return None
    return '\n'.join(pane.splitlines()[-14:]).lower()

def classify(tail):
    busy = any(x in tail for x in (
        'esc to interrupt', 'to interrupt', 'ctrl+c to stop',
        'ctrl-c to stop', 'working (', 'thinking…', 'thinking...'))
    paused = any(x in tail for x in (
        'max number of steps reached', 'send another message to continue',
        'usage limit reached', 'rate limit reached', 'paused'))
    if busy:
        if any(x in tail for x in ('running tool', 'running command', 'web search', 'fetching')):
            return 'working', 'tool in esecuzione'
        if 'thinking' in tail:
            return 'working', 'elaborazione'
        return 'working', 'turno in corso'
    if paused:
        return 'paused', 'in attesa di ripresa'
    return 'idle', 'sessione attiva, nessun turno in corso'

raw = run(['tmux', 'list-sessions', '-F', '#{session_name}']) or ''
out = {}
retry = []
for session in [x.strip() for x in raw.splitlines() if x.strip()]:
    tail = tail_of(session)
    if tail is None:
        # cattura fallita: NON è idle, il client mantiene l'ultimo stato
        out[session] = {'status': 'unknown', 'detail': 'pane non osservabile'}
        continue
    status, detail = classify(tail)
    if status == 'idle':
        retry.append(session)  # forse è il flicker della barra: ricontrolla
    out[session] = {'status': status, 'detail': detail}
# Secondo campione per i soli 'idle' (falsi idle 03:5x): la TUI nasconde
# il marker per un attimo tra due step dello stesso turno — se al secondo
# sguardo il marker c'è, l'agente sta lavorando.
if retry:
    time.sleep(0.35)
    for session in retry:
        tail = tail_of(session)
        if tail is None:
            continue
        status, detail = classify(tail)
        if status != 'idle':
            out[session] = {'status': status, 'detail': detail}
print(json.dumps(out, ensure_ascii=False))
