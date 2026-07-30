import json, sys
sys.path.insert(0, '/app/shared/skills')
try:
    import burn_intent
except Exception:
    # Deploy sfasato: il gioco può essere più nuovo dell'immagine del
    # container per qualche minuto. Dirlo è meglio che offrire un
    # interruttore che non comanda nulla (come COORDINATOR_STATE_PY).
    print(json.dumps({'ok': True, 'supported': False}))
    raise SystemExit(0)

from datetime import datetime, timezone

st = burn_intent.status()
remaining = 0.0
if st.get('active'):
    try:
        expires = datetime.fromisoformat(str(st.get('expires_at')))
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        remaining = (expires - datetime.now(timezone.utc)).total_seconds()
    except Exception:
        remaining = float(st.get('remaining_min') or 0) * 60.0
st['ok'] = True
st['supported'] = True
st['remaining_sec'] = int(max(0.0, remaining))
st['never_yields'] = list(burn_intent.NEVER_YIELDS)
st['default_hours'] = burn_intent.DEFAULT_HOURS
st['max_hours'] = burn_intent.MAX_HOURS
print(json.dumps(st, ensure_ascii=False))
