# Supabase — Schema PostgreSQL multi-tenant

Schema PostgreSQL per la piattaforma web Job Hunter Team, progettato per Supabase con Row Level Security (RLS).

## Tabelle

| Tabella | Descrizione |
|---------|-------------|
| `candidate_profiles` | Profilo candidato (1 per utente) |
| `positions` | Posizioni lavorative trovate |
| `companies` | Aziende analizzate |
| `scores` | Punteggi 0-100 per posizione |
| `applications` | CV e candidature |

## Sicurezza

Tutte le tabelle hanno **Row Level Security (RLS)** attivo. Ogni utente vede solo i propri dati tramite `auth.uid() = user_id`.

Policy attive: SELECT, INSERT, UPDATE, DELETE per owner.

## Setup

```bash
# Con Supabase CLI
supabase start
supabase db reset   # applica migrations + seed

# Solo migration
supabase migration up

# Solo seed (dopo migration)
psql $DATABASE_URL -f supabase/seed.sql
```

## Struttura file

```
supabase/
  migrations/
    001_schema.sql    # Tabelle, indici, trigger, RLS
  seed.sql            # Dati demo (6 posizioni, 4 aziende, 3 score, 2 application)
  README.md
```

## Differenze da SQLite (schema V2)

| SQLite | PostgreSQL |
|--------|-----------|
| `INTEGER PRIMARY KEY` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` |
| No multi-tenant | `user_id` FK su ogni tabella |
| No RLS | RLS con policy per owner |
| `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | `TIMESTAMPTZ DEFAULT now()` |
| `TEXT` per JSON | `JSONB` nativo |
| No CHECK constraint | CHECK su status, remote_type, score range |
