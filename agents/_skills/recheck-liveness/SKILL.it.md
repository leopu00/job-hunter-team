<!-- @translation: it, ai-translated 2026-08-03 -->
---
name: recheck-liveness
description: "Verifica se un annuncio è ANCORA APERTO senza produrre falsi aperti. Sostituisce il curl improvvisato (HTTP 200 = \"aperto\") che NON vede la scadenza renderizzata in JavaScript (Ashby/Workday/Greenhouse) né l'authwall di LinkedIn (200 anche per quelli chiusi). Usala SEMPRE nel recheck; non impostare mai is_open a mano sulla base di un singolo HTTP 200."
allowed-tools: Bash(python3 /app/shared/skills/recheck_liveness.py *)
---

# recheck-liveness — "l'annuncio è ancora aperto?", fatto come si deve

## Perché esiste
Il vecchio recheck era un curl improvvisato (`code=200 marker=none → aperto`). curl vede solo
l'HTML GREZZO, quindi su molti ATS (Ashby/Workday/Greenhouse) e su LinkedIn lo stato
"scaduto/chiuso" è renderizzato in JS o sta dietro un authwall → curl non lo vede → `is_open=1` su
annunci già CHIUSI. Dati sporchi a valle (score, mappa).

## Come si usa
```sh
python3 /app/shared/skills/recheck_liveness.py "<url>" "[titolo opzionale]"
```
Output JSON + exit code:
| state | exit | significato |
|---|---|---|
| `OPEN` | 0 | apertura verificata |
| `CLOSED` | 1 | chiuso/scaduto (404/410 o marker di chiusura) |
| `OPEN_UNVERIFIED` | 2 | impossibile verificare (host JS/authwall + browser giù) |

## Cosa fa (a livelli)
1. **curl** veloce: codice HTTP + scansione dei marker di chiusura (EN+IT) + 404/410.
2. host **ATS-JS / LinkedIn** o codice ambiguo → **escalation al BROWSER**
   (render con Playwright) e nuova scansione dei marker sull'HTML RENDERIZZATO.
3. ancora incerto → **`OPEN_UNVERIFIED`** — MAI un falso aperto (pattern `resilience`).

## Regola d'oro
- `is_open=1` **SOLO** se `state == OPEN`.
- `state == CLOSED` → `status='expired'` + una nota che riporta l'`evidence`.
- `state == OPEN_UNVERIFIED` → **lascia `is_open` invariato** + una nota `[OPEN_UNVERIFIED]`;
  non spacciarlo per aperto.
- Il curl improvvisato "200 = aperto" è **vietato** come modo per decidere la liveness.
