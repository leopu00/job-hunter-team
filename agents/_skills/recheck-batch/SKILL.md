---
name: recheck-batch
description: Recheck cadenzato della MODALITÀ CURA a costo minimo. Lo script fa il lavoro meccanico su un batch (verifica tiered di ogni URL, aggiorna last_checked per le OPEN verificate); tu giudichi SOLO i casi ambigui. Misurato 78-86kT a posizione col giro manuale — con il batch spendi un turno per 10 posizioni, non 10 turni. L'esclusione resta SEMPRE una tua decisione, mai dello script.
allowed-tools: Bash(python3 /app/shared/skills/recheck_batch.py *), Bash(python3 /app/shared/skills/db_update.py *), Bash(python3 /app/shared/skills/recheck_liveness.py *)
---

# recheck-batch — il recheck della modalità cura, senza sprecare un turno a posizione

## Perché esiste
Ricontrollare una posizione GIÀ analizzata è una frazione del check di una
posizione nuova: niente ri-analisi, niente ri-lettura della JD, niente
metadata. Il giro manuale (coda → una posizione → recheck-liveness →
db_update → ripeti) costava 78-86kT a posizione perché ogni passo era un
turno LLM. Questo batch comprime tutta la parte meccanica in UN comando.

## Come si usa (UN turno per batch)
```sh
python3 /app/shared/skills/recheck_batch.py            # batch di 10 dalla coda
python3 /app/shared/skills/recheck_batch.py --limit 5
```
Prende le posizioni dalla coda `next-for-recheck-due` (vive, score ≥ policy,
non verificate da > 14gg, SCORE DESC: prima le migliori) e per ognuna esegue
la verifica tiered di `recheck_liveness.py` (curl → browser, mai falso-aperto).

Il report ha tre esiti:
- **OK aperte e aggiornate** — verificate `OPEN`: `last_checked` è già
  aggiornato, escono dalla coda per 14 giorni. **Non toccarle, non
  rileggerle, zero lavoro tuo.**
- **DA GIUDICARE** — evidenza di chiusura (404/410, closed-marker, o
  `expires_at` passata). Qui entri TU.
- **NON VERIFICABILI** — host JS/authwall e browser non conclusivo. Qui
  entri TU (one-shot).

## Il giudizio è tuo — lo script NON esclude MAI (ordine utente 2026-07-30)
Uno script statico può sbagliare e buttare una posizione ancora viva.
Per ogni posizione **DA GIUDICARE**: guarda l'evidenza riportata; se serve,
UN solo sguardo diretto alla pagina. Se sei sicuro al 100% che è
scaduta/chiusa:
```sh
python3 /app/shared/skills/db_update.py position <ID> --status excluded \
  --is-open false --last-open-check now --notes "[SCADUTO] <evidenza>"
```
Se invece è ancora viva (falso positivo dello script):
```sh
python3 /app/shared/skills/db_update.py position <ID> --is-open true --last-checked now
```
Per ogni **NON VERIFICABILE**: one-shot col browser sull'URL; poi decidi come
sopra. Se resta non verificabile → `--last-checked now` + nota
`[OPEN_UNVERIFIED]`, `is_open` invariato (mai spacciarla per aperta).

## Disciplina di costo (il punto della skill)
- **Un batch = un turno.** Non fare un giro per posizione, non ri-analizzare,
  non ri-leggere JD o company: il recheck decide solo "ancora aperta?".
- Batch bounded (default 10): NON alzare il limit per "finire la coda in un
  colpo" — la cadenza spalma il lavoro, il Capitano lo pace (C-09/C-18).
- Coda OFF per enrichment-policy = stato voluto: fermati, non aggirarla.
