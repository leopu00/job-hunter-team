# Feedback Ticketing

Runbook operativo per la pagina [`/feedback`](/feedback) e l'API [`/api/feedback`](/api/feedback).

## Stato attuale

- La UI feedback e' esposta nel menu laterale.
- L'API non usa piu' `~/.jht` nel runtime serverless.
- In cloud prova prima Supabase (`feedback_tickets`).
- Se Supabase non e' configurato o la tabella non esiste ancora, fa fallback su `/tmp/jht/feedback.json`.

## Modalita'

### Modalita' persistente

Richiede:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- migration `supabase/migrations/005_feedback_tickets.sql` applicata

In questa modalita':

- `GET /api/feedback` legge da `feedback_tickets`
- `POST /api/feedback` inserisce in `feedback_tickets`
- i dati sopravvivono ai redeploy

### Modalita' fallback

Si attiva se Supabase non e' configurato o non risponde.

In questa modalita':

- l'API legge/scrive su `/tmp/jht/feedback.json`
- il ticketing non va in `500`
- i dati non sono garantiti nel lungo periodo

## Migration richiesta

File: [`supabase/migrations/005_feedback_tickets.sql`](/Users/leoneemanuelpuglisi/Repos/job-hunter-team/fullstack-3/supabase/migrations/005_feedback_tickets.sql)

Crea:

- tabella `feedback_tickets`
- indici su `created_at` e `status`
- policy RLS `SELECT` e `INSERT` per `anon` e `authenticated`

## Deploy

Deploy produzione:

```bash
git checkout production
git pull --ff-only
git merge --ff-only <branch-da-rilasciare>
git push origin production
```

Note:

- il sito live deve passare da push su `production`, non da `vercel deploy --prod` lanciato da branch locali;
- crea il tag release solo dopo che il deploy Git di Vercel su `production` e' `READY`.

## Verifica

Smoke test rapido:

```bash
curl -i https://jobhunterteam.ai/api/feedback
curl -i -X POST https://jobhunterteam.ai/api/feedback \
  -H 'content-type: application/json' \
  --data '{"rating":4,"category":"feature","description":"probe"}'
curl -I https://jobhunterteam.ai/feedback
```

Atteso:

- `/api/feedback` non deve restituire `500`
- `POST /api/feedback` deve restituire `200`
- `/feedback` deve rispondere `200`

## Note operative

- Se Vercel non ha env Supabase configurate, il sistema resta funzionante ma non persistente.
- Se vuoi persistenza vera, applica la migration e configura le env Supabase nel progetto Vercel collegato.
