# Vercel quota exhaustion — jobhunterteam.ai down (HTTP 402)

Snapshot: 2026-05-22 mattina. Il dominio production `jobhunterteam.ai` (e tutti gli altri progetti del team `leopu00s-projects`) restituiscono **HTTP 402** con body `Payment required / DEPLOYMENT_DISABLED`.

Tutti i deploy del team sono **paused** automaticamente da Vercel: quota del piano Hobby (free) superata su 3 metriche su 4.

## Sintomo

```
$ curl -sI https://jobhunterteam.ai
HTTP/2 402

Payment required
DEPLOYMENT_DISABLED
fra1::5cpf5-1779399825261-f4100a0a7eee
```

DNS risolve correttamente a `216.198.79.1` (IP Vercel). Ultimo deploy `dpl_GGbALq2X4DHGLHAgQ2NZaUejhtWm` ha status `● Ready` ✅ — non è un build fail. È **a livello team account**.

## Dashboard usage (snapshot)

| Metrica | Usato | Limite (Hobby) | % | Stato |
|---|---|---|---|---|
| **Fast Origin Transfer** | 30.47 GB | 10 GB | **305 %** | 🔴 OVER |
| **Fluid Active CPU** | 5 h 58 min | 4 h | **149 %** | 🔴 OVER |
| **Function Invocations** | 1.2 M | 1 M | **120 %** | 🔴 OVER |
| Edge Requests | 666 K | 1 M | 66 % | 🟢 OK |

## Diagnosi cause root

### 1. Cloud-sync push daemon: full DB dump ogni 60s — NON delta

File: `cli/src/commands/cloud.js` riga 411-446.

```js
positions = readSqliteTable(db, 'positions', [...]);   // SELECT *, no WHERE
scores = readSqliteTable(db, 'scores', [...]);
applications = readSqliteTable(db, 'applications', [...]);
// ...
res = await fetch(pushUrl, {
  method: 'POST',
  body: JSON.stringify({ positions, scores, applications, ... })
});
```

Misura sul DB live VPS1 al 2026-05-21 07:55 UTC:

| Tabella | Bytes raw |
|---|---|
| `positions` (206 row × `jd_text` + `requirements` + `notes`) | 730 KB |
| `scores` (180 row × `breakdown` + `notes`) | 157 KB |
| `applications` (122 row × `critic_notes` + paths) | 60 KB |
| **Payload per push** | **~942 KB** raw → ~1.2-1.5 MB dopo JSON.stringify + HTTP framing |

Math con default `intervalSec = 60`:
- 1440 push/giorno × 1.2 MB = **1.7 GB/giorno upload**
- 30 giorni = **51 GB/mese** se VPS attivo H24

Il request body è **ingress** lato Vercel e NON conta in "Fast Origin Transfer". Però conta:
- **Function Invocations**: 1 per push = 43k/mese
- **Fluid Active CPU**: ~500 ms - 2 s per push (Supabase upsert + RLS chain) = 43k × ~700 ms = **~8 h CPU/mese** — spiega i 5 h 58 min osservati ✅

### 2. Dashboard polling client-side aggressivo

| File | Riga | Endpoint | Interval |
|---|---|---|---|
| `web/components/AgentInteraction.tsx` | 98 | `/api/capitano/terminal` | **1500 ms** |
| `web/components/AgentInteraction.tsx` | 88 | `/api/capitano/status` o simile | 5000 ms |
| `web/components/ProfileAssistantFab.tsx` | 56 | `/api/profile-assistant/*` (status) | 5000 ms |
| `web/components/ProfileAssistantFab.tsx` | 57 | `/api/profile-assistant/*` (messages) | 3000 ms |

Per ogni utente con dashboard aperta:
- `fetchTerminal` ogni 1.5 s = **2400 chiamate/ora**, ognuna ritorna `tmux capture-pane` (~5-20 KB)
- Altri 3 polling = ~1500 chiamate/ora aggiuntive

**1 ora dashboard aperta ≈ 5000 request + ~50 MB response cumulative**. Dashboard aperta H24 per debug/beta test = **30-60 GB/mese facili**. Spiega i 30 GB Origin Transfer ✅.

### 3. Cause minori

- **Telegram webhook** (`/api/channels/*` o handler bot): ogni messaggio inbound utente è 1 invocation + response.
- **PDF CV download** dalla dashboard: 122 PDF prodotti. Anche 1-2 download per file ≈ 500 MB cumulativi.
- **Next.js asset bundle**: ogni reload `jobhunterteam.ai` serve ~500 KB JS/CSS/HTML.

## Attribuzione percentuale stimata

| Metrica Vercel | Attribuzione principale |
|---|---|
| Fast Origin Transfer 30 GB | Dashboard polling terminal/status (~80 %), PDF download (~10 %), Next.js assets (~10 %) |
| Fluid Active CPU 5 h 58 min | Push daemon Supabase upsert (~70 %), dashboard polling endpoints (~25 %), altri (~5 %) |
| Function Invocations 1.2 M | Dashboard polling sommato (~70 %, ~840 K/mese), push daemon (~5 %, 43 K), ping/device-poll/team-commands (~15 %), Telegram webhook (~10 %) |

## Fix immediati (per sbloccare il sito)

1. **Upgrade a Pro plan** (~$20/mese) → quote drasticamente superiori, paghi metered overage. Sito torna online entro 1-2 min.
2. **Attendere reset mensile** del ciclo Hobby. Sito offline fino a quel momento.

## Fix strutturali (prossima release)

In ordine di payoff:

1. **Push incremental (delta-only)** — riduce upload ~95 %.
   - File: `cli/src/commands/cloud.js`, funzione `handlePush`.
   - Strategia: salvare `last_pushed_at` per (user_id, table) in `cloud_sync_tokens` o in file locale `.jht/last_push.json`. Query SQLite con `WHERE updated_at > ?`. Schema DB ha già `updated_at TIMESTAMP` su positions/scores/applications/companies.
   - Caveat: cold start dopo cancellazione last_pushed_at → full push una volta sola.
   - Stima: 5h dev.

2. **Dashboard polling adattivo** — riduce request/banda ~80 %.
   - File: `web/components/AgentInteraction.tsx`, `web/components/ProfileAssistantFab.tsx`.
   - Strategia:
     - `fetchTerminal` 1.5 s → 5 s + pausare se `document.visibilityState !== 'visible'`.
     - Migrare a SSE/WebSocket per il terminal stream (Vercel supporta SSE serverless ma con limiti).
     - Backoff esponenziale se l'agente non ha nuovo output da N secondi.
   - Stima: 1-2 giorni dev.

3. **Pause cloud-sync durante HALT-WEEKLY** — risparmio mirato durante stop team.
   - File: `cli/src/commands/cloud.js` funzione `handleDaemon`.
   - Strategia: check `test -f $JHT_HOME/.weekly-halt.flag` al top di ogni tick. Se esiste → sleep + continue senza chiamare `handlePush`.
   - Stima: 30 min dev (3 righe).

4. **CV PDF su Cloudflare R2 / Backblaze B2 invece di servire da Vercel** — sposta egress fuori da Vercel.
   - Solo se il PDF download diventa una quota di rilievo.
   - Stima: 1 giorno dev (signed URL + upload pipeline).

5. **Spending limit alert su Vercel** — non risolve il consumo ma evita la sorpresa.
   - Configurare alert email a 50 % / 80 % / 95 % delle 3 quote critiche.
   - Stima: 10 min dashboard.

## Rilevanza per beta forum

Questo incidente conferma che **non siamo pronti per beta forum pubblica** finché il push daemon non è incremental e la dashboard non smette di polling 1.5 s. 5 beta tester che girano dashboard H24 + i loro daemon VPS che pushano full DB ogni 60 s saturano un piano Pro in ~1 settimana e un piano Hobby in 1-2 giorni.

Va aggiunto a `BACKLOG.md` come P0 nella stessa categoria di `[PACING-WEEKLY-EXHAUSTION]` (sostenibilità infra).

## Stato HALT-WEEKLY parallelo

Da notare: il sito è andato giù mentre VPS1 era già in HALT-WEEKLY (team operativi fermi da 2026-05-21 07:25 UTC). Il cloud-sync daemon su VPS1 sta comunque continuando a girare in background (non l'abbiamo killato perché non bruciava weekly Codex, brucia però Vercel). Ironia: l'HALT-WEEKLY ha **fermato il consumo Codex** ma **non quello Vercel**, perché il daemon di sync push lavora indipendentemente dagli agenti.

→ Da implementare: l'halt deve estendersi anche al cloud-sync. Vedi fix #3 sopra.

## Riferimenti

- `BACKLOG.md` — entry da aggiungere `[INFRA-VERCEL-QUOTA]`.
- `docs/internal/2026-05-21-halt-weekly-incident.md` — HALT-WEEKLY parallelo, sezione cause root.
- `docs/internal/cloud-sync-architecture.md` — incident precedente sync VPS↔Supabase + architettura post-decisione (contesto rilevante).
- `docs/internal/_archive/2026-05-06-launch-infra-costs.md` — proiezione costi pre-lancio (da rivedere alla luce di questi numeri reali).
- File codice da modificare: `cli/src/commands/cloud.js`, `web/components/AgentInteraction.tsx`, `web/components/ProfileAssistantFab.tsx`.
- Commit storia rilevante: `86333443 fix(cloud-sync): throttle last_used_at a 1h per fermare la satura Disk IO`, `7c2b090b fix(cli/cloud): push daemon default 30s -> 60s`, `a61e2f93 fix(cli/cloud): rimuovi default Commander '30' che sovrascriveva il fix 60s` — la storia di tuning del push interval dimostra che il problema "push troppo frequente" era già noto, ma è stato fixato solo lato interval, non lato payload.
