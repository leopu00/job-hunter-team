#!/usr/bin/env bash
# Seed dello stack Supabase LOCALE per il job `e2e-local-supabase`.
#
# Crea l'account di test SINTETICO (e2e@example.com) con la password che il
# job genera a ogni run. Nessun segreto: la service role key è quella dello
# stack locale, stampata da `supabase status -o env`, e muore col runner.
#
# Righe applicative: nessuna, apposta. L'account di test di produzione è
# vuoto e le spec lo presuppongono — 83-web-vps-rendezvous mette il cookie
# jht_welcome_seen proprio perché «l'account E2E non ha dati», e le spec
# 80/81/88/89/90 leggono il dataset demo versionato (web/lib/demo/seeds/),
# attivato da POST /api/demo, non il db. Un seed di posizioni cambierebbe
# /dashboard e /welcome rispetto a ciò che le spec asseriscono.
#
# Uso (dalla radice del repo, stack già avviato):
#   API_URL=... SERVICE_ROLE_KEY=... DB_URL=... E2E_PASSWORD=... \
#     bash supabase/seed-e2e.sh
set -euo pipefail

: "${API_URL:?API_URL mancante (supabase status -o env)}"
: "${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY mancante (supabase status -o env)}"
: "${DB_URL:?DB_URL mancante (supabase status -o env)}"
: "${E2E_PASSWORD:?E2E_PASSWORD mancante (generata dal job)}"
E2E_EMAIL="${E2E_EMAIL:-e2e@example.com}"

case "$API_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "seed-e2e: API_URL non è uno stack locale ($API_URL): mi fermo" >&2; exit 1 ;;
esac

body="$(E2E_EMAIL="$E2E_EMAIL" E2E_PASSWORD="$E2E_PASSWORD" node -e '
  process.stdout.write(JSON.stringify({
    email: process.env.E2E_EMAIL,
    password: process.env.E2E_PASSWORD,
    email_confirm: true,
  }));
')"

status="$(curl -sS -o /tmp/seed-e2e-user.json -w '%{http_code}' \
  -X POST "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  --data "$body")"
if [ "$status" != "200" ]; then
  echo "seed-e2e: creazione utente rifiutata (HTTP $status)" >&2
  cat /tmp/seed-e2e-user.json >&2
  exit 1
fi
rm -f /tmp/seed-e2e-user.json

# Verifica sull'effetto, non sulla risposta: l'utente esiste confermato e non
# possiede righe applicative.
psql "$DB_URL" -v ON_ERROR_STOP=1 -v e2e_email="$E2E_EMAIL" \
  -f "$(dirname "$0")/seed-e2e.sql"
