# 📎 File bridge on-demand — architettura & stato

> **Living doc.** Source of truth per il "bridge effimero" dei file (CV, cover
> letter, allegati) tra container VPS e web pubblico (Vercel). Deciso con
> l'utente il 2026-06-07. Aggiornare a ogni shift architetturale.

## 🧭 TL;DR

- **Problema**: i file binari (PDF/CV/allegati) **non** stanno nel DB Postgres
  (consumerebbero lo storage del DB) e **non** vengono sincronizzati nel cloud.
  Vivono solo sul disco del container (VPS) o in locale. Sul **web puro su
  Vercel** (nessun container sotto) le route `fs.readFileSync` falliscono →
  l'utente non vede né apre nessun file.
- **Decisione 2026-06-07** (con l'utente):
  - **Modello trasporto = pull on-demand puro**: il file sale nel bucket **solo
    quando l'utente lo chiede**, e viene rimosso poco dopo. Il DB tiene **solo
    l'indice** (nome, sha, size, mime, path-sul-vps), mai il binario.
  - **Storage di transito = Supabase Storage** (bucket `file-transit`, privato).
- **Coerenza con l'architettura esistente**: la VPS **non ha credenziali
  Supabase** (come gli altri poller, vedi `cloud-sync-architecture.md`). Parla
  solo con endpoint web autenticati via token `jht_sync_`. **Tutte le mutazioni
  sullo Storage le fa il web** (service-role). La VPS carica usando una **signed
  upload URL** usa-e-getta ricevuta dal web → nessun byte transita per Vercel,
  nessun limite di body-size della Lambda.

## 🗺️ Flusso completo (happy path)

```
BROWSER (Vercel, sessione utente Supabase)        VPS container (token jht_sync_)
─────────────────────────────────────────        ────────────────────────────────
1. GET /api/profile/files
   └─ cloud: legge candidate_files (indice)  ◀──── (popolato da #0)
   mostra la lista "Anteprima CV"

2. utente clicca "Apri documento"
   POST /api/profile/files/request {name}
   └─ insert file_bridge_requests(status=pending)
   ◀─ { requestId }

3. polling GET /api/profile/files/request/:id
   (status=pending → spinner "preparazione…")
                                                  4. GET /api/cloud-sync/file-bridge?status=pending
                                                     ◀─ [{ id, name }]
                                                  5. PATCH /api/cloud-sync/file-bridge/:id
                                                     { status: 'uploading' }
                                                     ◀─ { uploadUrl, token, storagePath }
                                                        (web minta createSignedUploadUrl,
                                                         claim atomico pending→uploading)
                                                  6. legge il file dal disco locale,
                                                     PUT diretto su Supabase Storage
                                                     usando uploadUrl (no creds)
                                                  7. PATCH /api/cloud-sync/file-bridge/:id
                                                     { status: 'ready' }
                                                     (web set expires_at = now()+10min)

3'. polling vede status=ready
    └─ web enumera solo userId/requestId e minta createSignedUrl(path, 60s)
    ◀─ { status:'ready', url }
    il browser apre la signed URL → l'utente vede il PDF

8. PURGE (effimero):
                                                  il poller chiama periodicamente
                                                  POST /api/cloud-sync/file-bridge/purge
   └─ il web (service-role) enumera solo userId/requestId, elimina gli oggetti con
      expires_at < now() e marca le richieste 'expired'.
```

`#0` = popolamento indice: il poller VPS fa upsert di `candidate_files` (lista
dei file presenti sul disco) all'avvio e ogni ~60s, via
`POST /api/cloud-sync/file-index`.

## 🧱 Schema DB (migrations `037_file_bridge.sql` + `062_feedback_and_file_bridge_authority.sql`)

- **`candidate_files`** — indice persistente dei file disponibili per utente.
  Popolato dalla VPS, letto dal web per la lista "Anteprima CV".
  - `id uuid pk`, `user_id uuid → auth.users`, `name text`, `category text`
    (`cv|cover_letter|attachment|other`), `sha256 text`, `size bigint`,
    `mime text`, `location_on_vps text`, `updated_at timestamptz`.
  - `unique(user_id, name)`.
- **`file_bridge_requests`** — coda effimera delle richieste on-demand.
  - `id uuid pk`, `user_id uuid → auth.users`, `file_name text`,
    `status` (`pending|uploading|ready|served|error|expired`),
    `storage_path text generated always as (user_id/id/payload)`, `error text`,
    `expires_at timestamptz`,
    `created_at`, `updated_at`.
- **Bucket** `file-transit` (privato) creato nella stessa migration via
  `insert into storage.buckets`.
- **RLS**:
  - `candidate_files` / `file_bridge_requests`: l'utente vede solo le proprie
    righe (`user_id = auth.uid()`). Sul bridge può inserire esclusivamente
    `user_id` e `file_name`; id, stato e path restano server-side. Gli endpoint VPS usano il
    **service-role** (`admin`) filtrando manualmente per `user_id` ricavato dal
    token (stesso pattern di `team_commands`).
  - `storage.objects` del bucket: nessun accesso anon/authenticated diretto;
    si passa **solo** per signed URL mintate dal service-role.

## 🔌 Endpoint

### Lato VPS (Bearer `jht_sync_`, service-role, filtro `user_id`)
- `GET  /api/cloud-sync/file-bridge?status=pending` → richieste pending.
- `PATCH /api/cloud-sync/file-bridge/:id` → claim/transition.
  - `{status:'uploading'}` → claim atomico `pending→uploading`; risponde con
    `{ uploadUrl, token, storagePath }` (signed upload URL appena mintata).
  - `{status:'ready'}` → set `expires_at = now()+10min`.
  - `{status:'error', error}` → registra l'errore.
- `POST /api/cloud-sync/file-bridge/purge` → il web elimina dal bucket gli
  oggetti scaduti e marca `expired`.
- `POST /api/cloud-sync/file-index` → upsert `candidate_files` (indice).

### Lato browser (sessione utente Supabase)
- `GET  /api/profile/files` → **locale**: `fs` come oggi; **cloud**: legge
  `candidate_files`.
- `POST /api/profile/files/request {name}` → crea la richiesta, `{requestId}`.
- `GET  /api/profile/files/request/:id` → `{status}`, e quando `ready`
  `{status:'ready', url}` (signed download URL 60s). Il path viene ricavato dal
  prefisso autenticato, mai da metadata forniti dal client. Purga opportunisticamente
  le richieste scadute dell'utente.

## 🖥️ VPS poller — `cli/src/lib/file-bridge-poller.js`

Stesso scheletro degli altri poller (`team-commands-poller.js`): long-poll su
`base_url` con token da `cloud.json`, backoff esponenziale 5s→60s, rispetto del
`.weekly-halt.flag`, shutdown pulito su SIGTERM/SIGINT. Comando CLI
`jht cloud file-bridge-listen`, spawnato/supervisionato da `pid1.js` accanto
agli altri reader (respawn 5s on-crash, gate `isCloudConfigured`).

Responsabilità per ciclo:
1. upsert indice `candidate_files` (all'avvio e ogni ~60s).
2. per ogni richiesta pending: claim → upload diretto del file via signed URL →
   `ready` (o `error`).
3. trigger `purge` degli scaduti.

Risoluzione del file sul disco: cerca `name` nelle cartelle note del container
(`JHT_USER_UPLOADS_DIR`/allegati, `JHT_USER_CV_DIR`/cv), con `basename()` +
containment per evitare traversal.

## 🔒 Sicurezza
- Path traversal: `name` ridotto a `basename`, lookup confinato alle cartelle
  note (riusa `safeResolveUnder`).
- Il bucket è privato; gli oggetti sono raggiungibili **solo** via signed URL a
  TTL corto (upload usa-e-getta; download 60s).
- La VPS non riceve mai credenziali Supabase: solo capability URL temporanee.
- TTL effimero: `expires_at = now()+10min` sul `ready`; purge elimina l'oggetto.
  Compromesso pratico al "purge immediato" (non sappiamo quando l'utente chiude
  il viewer): il file resta nel bucket solo per la finestra di visione.

## 📊 Stato implementazione (2026-06-07)
- [x] Design doc (questo file)
- [x] Migration `037_file_bridge.sql` (+ bucket + RLS)
- [x] Endpoint VPS-facing (`/api/cloud-sync/file-bridge*`, `/file-index`)
- [x] Endpoint browser-facing (`/api/profile/files*`) + UI cloud-aware
- [x] Poller `file-bridge-poller.js` + comando `cloud file-bridge-listen` + wiring pid1
- [x] **Applicata** la migration su Supabase prod (`smittwvohsnwwwisqdrh`,
      2026-06-07): tabelle + RLS + 6 indici + bucket `file-transit` (privato)
      verificati. Advisor: le 2 tabelle hanno solo il warning `pg_graphql_*`
      condiviso da tutte le 28 tabelle public (RLS select-own protegge i dati) —
      nessuna azione, coerente con lo schema esistente.
- [ ] **Manuale**: rebuild immagine container con il nuovo poller + deploy VPS
- [ ] Test end-to-end (richiede VPS paired + Vercel + immagine deployata)

> **Nota**: codice su `origin/dev2` (lint+typecheck puliti) e DB prod pronto.
> Resta solo il rebuild/deploy dell'immagine container (per far girare il nuovo
> poller `cloud file-bridge-listen` sulla VPS) e il test end-to-end.

## 🔭 Note / evoluzioni
- File grandi: il design evita il route-through-Vercel proprio per non incappare
  nei limiti di body-size/duration della Lambda; la signed upload URL regge file
  arbitrariamente grandi (limite = quota bucket).
- Purge "vero" immediato: in futuro un beacon dal browser (`navigator.sendBeacon`
  on unload del viewer) potrebbe accorciare la finestra; per ora basta il TTL.
- Supersede l'idea "Opzione D" abbozzata in `bot-telegram.md:186` (presigned PUT
  + bucket purge), qui concretizzata e ristretta al pull on-demand.
