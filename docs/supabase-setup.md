# Supabase Setup — Job Hunter Team Platform

**Data:** 15 marzo 2026
**Eseguito da:** COORD (JHT) + CLI automatica
**Status:** ✅ Database cloud attivo, ⚠️ Google OAuth in attesa

---

## Progetto Supabase

| Campo | Valore |
|-------|--------|
| **Nome** | job-hunter-team |
| **Reference ID** | `[in .env.local]` |
| **URL** | `[in .env.local]` |
| **Region** | Central EU (Frankfurt / eu-central-1) |
| **Status** | ACTIVE_HEALTHY |
| **Dashboard** | `[in .env.local — usa il project ref per comporre l'URL]` |

---

## Chiavi API

| Chiave | Uso |
|--------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | `[in .env.local]` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | JWT anon (nel file `web/.env.local`) |
| `SUPABASE_SERVICE_ROLE_KEY` | JWT service_role (nel file `web/.env.local`) |

> ⚠️ Le chiavi complete sono in `web/.env.local` (NON versionato — escluso da .gitignore)

---

## Database — Migrations Applicate

| File | Status |
|------|--------|
| `supabase/migrations/001_schema.sql` | ✅ Applicato |
| `supabase/migrations/002_add_interview_round.sql` | ✅ Applicato |

**Schema completo:**
- `candidate_profiles` — profilo candidato (1 per utente, RLS enforced)
- `positions` — posizioni trovate dagli Scout
- `companies` — aziende
- `scores` — punteggi 0-100 dello Scorer
- `applications` — candidature (CV, CL, stato)

**RLS:** Ogni utente vede solo i propri dati (`auth.uid() = user_id`).

---

## App Web Next.js

**Struttura:** `web/` (Next.js 14, App Router, TypeScript, Tailwind)

```
web/
├── app/
│   ├── page.tsx              # Landing page + Login Google
│   ├── auth/callback/        # Handler redirect OAuth
│   └── (protected)/
│       ├── layout.tsx        # Auth guard SSR
│       ├── dashboard/        # Dashboard pipeline
│       ├── profile/          # Visualizza profilo
│       └── profile/edit/     # Modifica profilo (form completo)
├── components/Navbar.tsx     # Avatar + logout
├── lib/
│   ├── supabase/client.ts    # Client browser
│   ├── supabase/server.ts    # Client server-side
│   └── types.ts              # TypeScript types
└── .env.local                # ⚠️ NON versionato
```

**Build:** ✅ Compilato con successo (`npm run build` — 0 errori TypeScript)

---

## Auth Config (aggiornata)

| Campo | Valore |
|-------|--------|
| `site_url` | `https://jobhunterteam.ai` |
| `uri_allow_list` | `https://jobhunterteam.ai/**,https://jht-web-deploy.vercel.app/**,https://job-hunter-team.vercel.app/**,http://localhost:3000/**` |
| Google OAuth | ✅ Configurato |

---

## ⚠️ Passo Manuale Richiesto: Google OAuth

Il team non può accedere a Google Cloud Console automaticamente. L'admin deve:

### Step 1 — Google Cloud Console
1. Vai su https://console.cloud.google.com
2. Crea un nuovo progetto (o usa "job-hunter-team")
3. Menu: **APIs & Services** → **Credentials**
4. Clic **+ CREATE CREDENTIALS** → **OAuth 2.0 Client ID**
5. Tipo: **Web application**
6. Nome: `job-hunter-team`
7. Aggiungi **Authorized redirect URI**:
   ```
   https://<PROJECT_REF>.supabase.co/auth/v1/callback
   ```
8. Salva → Copia **Client ID** e **Client Secret**

### Step 2 — Abilita Google OAuth in Supabase
Vai su: https://supabase.com/dashboard/project/<PROJECT_REF>/auth/providers
Oppure con curl (dopo aver ottenuto Client ID e Secret):

```bash
curl -X PATCH \
  -H "Authorization: Bearer sbp_..." \
  -H "Content-Type: application/json" \
  -d '{
    "external_google_enabled": true,
    "external_google_client_id": "TUO_CLIENT_ID.apps.googleusercontent.com",
    "external_google_secret": "TUO_CLIENT_SECRET"
  }' \
  "https://api.supabase.com/v1/projects/<PROJECT_REF>/config/auth"
```

### Step 3 — Vercel (quando fai deploy)
Aggiungi le env vars nel progetto Vercel (valori in `web/.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<chiave anon>
SUPABASE_SERVICE_ROLE_KEY=<chiave service_role>
NEXT_PUBLIC_APP_URL=https://jobhunterteam.ai
```

> Progetto Vercel canonico: `job-hunter-team`

---

## Test Locale

```bash
cd web/
npm install
npm run dev
# Vai su http://localhost:3000
```

> Funzionerà già (build OK) ma il login Google darà errore finché OAuth non è configurato.

---

## MCP Server Supabase

Il MCP server `@supabase/mcp-server-supabase` è stato aggiunto alla config globale Claude (`~/.claude.json`):

```json
"supabase": {
  "command": "npx",
  "args": ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", "<PAT>"]
}
```

Permette a Claude Code (Capitano incluso) di:
- Listare/gestire progetti Supabase
- Eseguire query SQL sul database cloud
- Gestire auth config, API keys, migrations

---

## Stato Complessivo Platform

| Componente | Status | Note |
|-----------|--------|------|
| Supabase project cloud | ✅ ATTIVO | Frankfurt, eu-central-1 |
| Schema PostgreSQL V2 | ✅ Applicato | 2 migrations, RLS, 5 tabelle |
| Next.js web app | ✅ Build OK | 6 route, TypeScript 0 errori |
| Google OAuth | ✅ Configurato | |
| CI/CD Vercel | ✅ Pipeline pronta | Deploy su push in `web/**` |
| MCP Supabase | ✅ Configurato | In `~/.claude.json` globale |

---

## Comandi Utili

```bash
# Link worktree al progetto (già fatto per main/)
supabase link --project-ref <PROJECT_REF>

# Push nuove migrations
supabase db push

# Stato migrations
supabase migration list

# Log auth
supabase logs --type auth

# Avvio dev locale (Next.js)
cd web/ && npm run dev
```
