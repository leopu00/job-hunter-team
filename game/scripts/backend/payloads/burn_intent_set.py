import base64, json, sys
sys.path.insert(0, '/app/shared/skills')
import burn_intent

data = json.loads(base64.b64decode('%s').decode('utf-8'))
# Il motivo finisce nell'audit log e nel banner letto dagli agenti: è la
# traccia di CHI ha tolto i freni, e resta in italiano come gli altri
# messaggi che il backend manda al team.
if bool(data.get('active')):
    payload = burn_intent.grant(data.get('hours', burn_intent.DEFAULT_HOURS),
                                "concessa dall'utente dal pannello del Coordinatore",
                                'user')
    out = {'ok': True, 'action': 'grant', 'expires_at': payload['expires_at'],
           'hours': payload['hours']}
else:
    burn_intent.revoke("revocata dall'utente dal pannello del Coordinatore")
    out = {'ok': True, 'action': 'revoke'}
print(json.dumps(out, ensure_ascii=False))
