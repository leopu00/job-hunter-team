---
name: recheck-liveness
description: Verifica se un annuncio di lavoro è ANCORA APERTO senza falsi-aperti. Sostituisce il curl ad-hoc (HTTP 200 = "aperto") che NON vede l'expiry renderizzato in JavaScript (Ashby/Workday/Greenhouse) né l'authwall LinkedIn (200 anche per i chiusi). Usala SEMPRE nel recheck; non marcare mai is_open a mano da un solo HTTP 200.
allowed-tools: Bash(python3 /app/shared/skills/recheck_liveness.py *)
---

# recheck-liveness — "il job è ancora aperto?" fatto bene

## Perché esiste
Il vecchio recheck era un curl improvvisato (`code=200 marker=none → aperto`). curl
vede solo l'HTML GREZZO, quindi su molti ATS (Ashby/Workday/Greenhouse) e su
LinkedIn lo status "scaduto/chiuso" è renderizzato in JS o dietro authwall → curl
non lo vede → `is_open=1` su job già CHIUSI. Dati sporchi a valle (score, mappa).

## Come si usa
```sh
python3 /app/shared/skills/recheck_liveness.py "<url>" "[titolo opzionale]"
```
Output JSON + exit code:
| state | exit | significato |
|---|---|---|
| `OPEN` | 0 | aperto verificato |
| `CLOSED` | 1 | chiuso/scaduto (404/410 o closed-marker) |
| `OPEN_UNVERIFIED` | 2 | impossibile verificare (host JS/authwall + browser giù) |

## Cosa fa (tiered)
1. **curl** veloce: HTTP code + scan dei closed-marker (EN+IT) + 404/410.
2. host **ATS-JS / LinkedIn** o code ambiguo → **escala al BROWSER** (Playwright
   render) e ri-scan dei marker sull'HTML RENDERIZZATO.
3. ancora incerto → **`OPEN_UNVERIFIED`** — MAI un falso-aperto (pattern `resilience`).

## Regola d'oro
- `is_open=1` **SOLO** se `state == OPEN`.
- `state == CLOSED` → `status='expired'` + nota con `evidence`.
- `state == OPEN_UNVERIFIED` → **lascia `is_open` invariato** + nota `[OPEN_UNVERIFIED]`;
  NON spacciarlo per aperto.
- **Vietato** il curl ad-hoc "200 = aperto" per decidere la liveness.
