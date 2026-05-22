# Dashboard tour — persistenza fix

**Date**: 2026-05-20
**Branch**: dev2
**Files**:
- `supabase/migrations/016_user_onboarding_state_tour_done.sql` (nuova)
- `web/app/api/preferences/route.ts` (modificato)
- `web/app/components/OnboardingWizard.tsx` (invariato — usa già `/api/preferences`)

## 🐛 Bug

Il wizard "Benvenuto nella dashboard" (4 step, `OnboardingWizard.tsx`) si riapriva ad ogni accesso a `/dashboard`. Riprodotto sia in dev locale sia dal beta tester su Vercel.

## 🔍 Root cause

`OnboardingWizard.tsx` salvava `tour_done` chiamando `PATCH /api/preferences` con `{ ui_state: { tour_done: true } }`. L'API persiste su **file JSON locale**:

```ts
const PREFS_PATH = path.join(JHT_HOME, "preferences.json")   // ~/.jht/preferences.json
```

- **Dev locale**: il file funziona finché esiste `~/.jht/`. Se l'utente fa hard reset o cambia browser/profilo, si perde.
- **Vercel (beta tester)**: il filesystem Lambda è ephemeral. Il `PATCH` o fallisce silenziosamente (read-only su alcuni paths) o scrive su un dir che non sopravvive al cold start. Risultato: a ogni request il flag risulta `false` → wizard riaperto.

## ✅ Fix architetturale

Spostato `tour_done` su **Supabase**, scoped per `user_id`. Riusata `user_onboarding_state` (tabella già canonica per stato onboarding utente, vedi migration 011) aggiungendo colonna `tour_done_at TIMESTAMPTZ`.

### Schema (migration 016)

```sql
ALTER TABLE user_onboarding_state
    ADD COLUMN IF NOT EXISTS tour_done_at TIMESTAMPTZ;
```

`NULL` = tour mai visto/completato. Timestamp = momento del primo dismiss.

### API `/api/preferences`

| Op | Comportamento |
|---|---|
| `GET` | `load()` dal file → se utente loggato, sovrascrive `ui_state.tour_done` con `tour_done_at IS NOT NULL` letto da DB. |
| `PATCH` con `ui_state.tour_done` | Upsert su `user_onboarding_state` via **admin client** (service role, bypass RLS). Il file viene comunque scritto come fallback per dev locale, ma il DB è la fonte di verità. |
| `DELETE` | Reset DB (`tour_done_at = NULL`) + reset file. |

### Perché admin client e non sessione utente

Migration 011 ha solo policy `SELECT` su `user_onboarding_state`: nessuna INSERT/UPDATE pubblica, per evitare che un utente marchi se stesso come "VPS setup completato" senza pairing reale. Estendere quella policy ad UPDATE generico aprirebbe quella superficie; column-level check non è straightforward in Postgres senza trigger.

Path scelto: stessa pattern di `device-register`/`push` — la route server-side autentica via cookie sessione (`createServerSupabase().auth.getUser()`), poi usa `createAdminClient()` per la mutation. Boundary di sicurezza identico al resto del codebase.

### Le altre preferenze (theme, language, notifications, shortcuts)

Restano sul file. Sono dev-local-only oggi e non c'è una richiesta di persistenza cross-device. Quando servirà, migrazione candidata: nuova tabella `user_preferences (user_id, prefs JSONB)` separata da `user_onboarding_state` (boundary semantico: stato setup vs preferenze cosmetiche).

## 📋 Steps rimanenti per chiudere

1. **Migration 016 applicata su Supabase remoto** — TODO (deferita, MCP supabase scollegata in questa sessione; da applicare via Supabase Studio SQL Editor oppure `supabase db push` quando CLI disponibile).
2. **`SUPABASE_SERVICE_ROLE_KEY` in env**:
   - **Vercel**: probabilmente già configurato (usato da `device-register`/`device-poll`); verificare in Project Settings → Environment Variables.
   - **`web/.env.local`** (dev locale): decommentare riga 11 (`# SUPABASE_SERVICE_ROLE_KEY=`) con il valore da Supabase Studio → Settings → API → `service_role` secret. Opzionale per dev — senza, il PATCH del DB fallisce silenziosamente e si torna al file (comportamento pre-fix).

## 🧪 Come testare (post-migration)

```bash
# 1. login su localhost:3000 con account che ha la sessione Supabase
# 2. apri /dashboard → wizard "Benvenuto" appare
# 3. dismiss (Salta o completa i 4 step)
# 4. refresh /dashboard → wizard NON deve riapparire
# 5. apri /dashboard in un browser diverso loggando lo stesso account
#    → wizard NON deve riapparire (cross-device, via DB)
```

Reset manuale per ri-testare:

```sql
UPDATE user_onboarding_state
SET tour_done_at = NULL
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'info@jobhunterteam.ai');
```

## 🔄 Comportamento prima/dopo

| Scenario | Prima | Dopo |
|---|---|---|
| Dev locale, utente loggato, dismiss + refresh | ✅ ok (file ~/.jht) | ✅ ok (DB + file) |
| Vercel beta tester, dismiss + refresh | ❌ riappare | ✅ ok (DB) |
| Cross-device stesso account | ❌ riappare sull'altro device | ✅ ok (DB) |
| Logout/cambio account | ❌ stato condiviso (file globale) | ✅ scoped per `user_id` |
