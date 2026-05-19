# Dashboard routing — casistica completa

**Date**: 2026-05-19
**File**: `web/app/(protected)/dashboard/page.tsx`
**Migration**: `supabase/migrations/011_user_onboarding_state.sql`

## 🧭 Schema decisione

```
1. demoMode (?demo=1 | JHT_WEB_DASHBOARD_DEMO=1)
     → demo data (dataset sintetico)

2. Supabase configured + user loggato (sessione attiva)
     ├── vps_setup_completed_at NULL  → CloudDownloadLanding
     ├── profile_configured_at NULL   → VpsSetupCompleteLanding
     └── entrambi settati             → dashboard normale (Supabase)

3. Supabase configured + NO user + localhost
     ├── readWorkspaceProfile() != null → dashboard locale (SQLite ~/.jht)
     └── readWorkspaceProfile() == null → /onboarding (wizard split-screen)

4. Supabase configured + NO user + remote
     → middleware.ts redirecta a /login

5. NO Supabase env (pure local deploy)
     ├── readWorkspaceProfile() != null → dashboard locale
     └── readWorkspaceProfile() == null → /onboarding
```

## 📊 Matrice casistica

| # | Ambiente | Account Supabase | VPS paired | Profilo locale | Atteso |
|---|---|---|---|---|---|
| 1 | localhost (`npm run dev`) | sì | sì | qualsiasi | 🎯 **dashboard cloud** |
| 2 | localhost (`npm run dev`) | sì | no | qualsiasi | 📥 CloudDownloadLanding |
| 3 | localhost (`npm run dev`) | sì, VPS paired ma `profile_configured_at=NULL` | sì | qualsiasi | 🎉 VpsSetupCompleteLanding |
| 4 | localhost (`npm run dev`) | no | n/a | sì (yaml) | 🖥️ dashboard locale (SQLite) |
| 5 | localhost (`npm run dev`) | no | n/a | no | 🧙 /onboarding wizard locale |
| 6 | localhost (`npm run dev:host` + container `jht`) | no | n/a | sì (yaml) | 🖥️ dashboard locale (SQLite via container) |
| 7 | desktop launcher (web prod localhost) | sì | sì | qualsiasi | 🎯 dashboard cloud |
| 8 | remote deploy | sì | sì | n/a | 🎯 dashboard cloud |
| 9 | remote deploy | no | n/a | n/a | 🔐 middleware → /login |

## 🐛 Bug pre-fix (2026-05-19)

Caso 1 cadeva nel ramo "Local mode" su **DUE** punti che entrambi guardavano solo `localRequest` ignorando la sessione Supabase:

1. **`web/app/(protected)/layout.tsx`** — gate `localRequest && !pathname.startsWith("/onboarding") && !isProfileComplete(...)` → redirect `/onboarding`. Gira **prima** della page.tsx, quindi era questo il vero blocco.
2. **`web/app/(protected)/dashboard/page.tsx`** — `useCloudAuth = isSupabaseConfigured && !localRequest && !demoMode` disattivava il 3-way cloud routing su tutto localhost.

Risultato: utente VPS-paired loggato da `npm run dev` veniva redirectato a `/onboarding`, dove `AssistanteOnboarding` tentava `POST /api/assistente/start` → `start-agent.sh` via WSL → fail `Command failed: wsl -d Ubuntu-22.04`.

### 🔧 Fix

Invertita la priorità in entrambi i file: **prima si tenta la sessione Supabase, poi il fallback locale solo se NON loggato**.

- `web/app/(protected)/layout.tsx:21-66` — `cloudUser` letto subito; gate locale e gate remote ora entrambi controllano `!cloudUser`.
- `web/app/(protected)/dashboard/page.tsx:59-95` — branch cloud sempre attivo se `isSupabaseConfigured + !demoMode`; fallback locale solo se `!user && localRequest`.

## 🔍 Dove vengono settati i flag

| Flag | Setter | Trigger |
|---|---|---|
| `vps_setup_completed_at` | `web/app/api/cloud-sync/device-register/route.ts` | primo `device-register` POST dalla VPS con refresh_token |
| `profile_configured_at` | `web/app/api/cloud-sync/push/route.ts` | primo upsert di `candidate_profiles` |

Entrambi sono "first-success" — una volta settati non vengono sovrascritti.

## 🧪 Come testare ciascun caso

- **Caso 1**: account già VPS-paired, `npm run dev`, sign-in → dashboard popolata.
- **Caso 2**: nuovo account Supabase mai paired, sign-in → CloudDownloadLanding.
- **Caso 3**: account VPS-paired ma azzerare profilo:
  ```sql
  UPDATE user_onboarding_state SET profile_configured_at = NULL WHERE user_id = '...';
  ```
- **Caso 4**: logout dal web, profilo YAML in `~/.jht/profile/candidate_profile.yml`.
- **Caso 5**: logout dal web, niente YAML → /onboarding.
- **Caso 6**: `npm run dev:host` + `docker compose up -d jht` con DB popolato.

## 📎 File correlati

- `web/app/(protected)/dashboard/page.tsx` — routing
- `web/app/components/CloudDownloadLanding.tsx`
- `web/app/components/VpsSetupCompleteLanding.tsx`
- `web/lib/auth.ts` — `isLocalRequestFromHeaders`
- `web/lib/profile-reader.ts` — `readWorkspaceProfile`
- `supabase/migrations/011_user_onboarding_state.sql`
