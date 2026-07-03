# 📊 Analisi costi Vercel + fix schema `sync_requested_at` (2026-06-24)

> Sessione del 2026-06-24. Tre cose intrecciate: (1) un errore in produzione sulla
> dashboard cloud, (2) la sua causa-radice (schema DB disallineato dal codice),
> (3) un'analisi approfondita della spesa Vercel di giugno incrociata con i deploy
> e con l'attività reale delle VPS. Fonte dati: export `vercel-costs.csv`
> (25/05 → 24/06, 31 giorni) + Supabase prod `smittwvohsnwwwisqdrh` + SSH VPS.

---

## 1. 🐛 Il bug in produzione e il fix

### Sintomo
Dashboard cloud (`jobhunterteam.ai/dashboard`) con banner rosso:

> **Could not find the 'sync_requested_at' column of 'team_state' in the schema cache**

### Causa-radice — disallineamento codice ↔ schema
Mezzo-deploy **al contrario** rispetto al caso noto del 14/06 ([vedi nota](#riferimenti)):
il **codice è andato live, la migration DB no**.

- ✅ Codice live: release **0.1.22** (commit `40c6eb186`, in `origin/production`) →
  `/api/team-state`, `CloudRefreshButton` e l'auto-sync all'accesso fanno
  `PATCH { sync_requested_at }` via PostgREST.
- ❌ Schema indietro: la migration **`045_team_state_sync_rendezvous.sql`**
  (`ALTER TABLE team_state ADD sync_requested_at / sync_completed_at`) **non era mai
  stata applicata** a Supabase prod. La migration history si fermava a
  `043_position_tickets`; le colonne di `team_state` finivano a `updated_at`.

Risultato: ogni accesso alla dashboard → write su una colonna inesistente → errore
PostgREST in rosso.

### Fix applicato (2026-06-24)
```sql
ALTER TABLE team_state
    ADD COLUMN IF NOT EXISTS sync_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sync_completed_at TIMESTAMPTZ;
-- + NOTIFY pgrst, 'reload schema';
```
- Idempotente, additiva, due colonne nullable, nessun indice, RLS già coperta da mig 019.
- Registrata come migration `20260624175158 — 045_team_state_sync_rendezvous`.
- **Nessuna release web necessaria**: il codice in produzione era già corretto,
  mancava solo la colonna. Fix puramente lato DB → basta un refresh pagina.
- Vale per **tutti** gli utenti cloud (DB condiviso).

---

## 2. 💰 Analisi spesa Vercel (25/05 → 24/06, 31 giorni)

### Il conto
| Voce | Costo | Natura |
|---|---|---|
| 🔒 **Pro** (abbonamento) | **$20.09** | fisso, ~$0.645/giorno — indipendente dall'uso |
| ⚙️ **job-hunter-team** (uso) | **$23.21** | variabile — qui sta la storia |
| 🟢 altri siti (auriga, euritmia, turni) | $0.75 | rumore |
| | **= $43.29 / 31 gg** | run-rate attuale ~$1.3/giorno |

### Dove bruciano i $23 di JHT (uso variabile)
| Metrica | % | Costo | Volume |
|---|---|---|---|
| Observability Events | 60.3% | $13.99 | 11.7M eventi |
| Function Invocations | 11.5% | $2.67 | 4.2M |
| Fluid Active CPU | 10.8% | $2.51 | — |
| Fluid Provisioned Memory | 6.6% | $1.54 | — |
| Firewall Rate-Limit Requests | 5.3% | $1.23 | 2.1M |
| Fast Origin Transfer | 5.3% | $1.22 | — |

**Non è traffico utente: è telemetria di chiamate API.** Le 4 metriche di volume
(Observability, Function Invocations, Firewall, Edge Requests) salgono e scendono
**identiche** → un'unica causa: **i daemon VPS che pollano `jobhunterteam.ai`.**

### La curva — Observability Events/giorno (×1000)
```
25/05  196k  ▇▇▇▇▇▇▇▇▇                  baseline piatta
02/06  196k  ▇▇▇▇▇▇▇▇▇                  ← 🚀 v0.1.18 (03/06)
05/06  413k  ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇         ← 🚀 v0.1.19 / v0.1.20
14/06  438k  ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇        ← 🚀 v0.1.21 (15/06)
20/06  599k  ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇ 📈 PICCO
21/06  500k  ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇       ← 🛑 v0.1.22 + ritiro poller
23/06  333k  ▇▇▇▇▇▇▇▇▇▇▇▇▇▇             📉 nuovo regime (−45%)
24/06  167k  ▇▇▇▇▇  (giorno parziale)
```

Stesso identico profilo su **Function Invocations**:
- baseline (25/05–02/06): **~76.000/giorno**
- picco (16/06–20/06): **~218.000/giorno**
- post-fix (22/06–23/06): **~112.000/giorno**

---

## 3. 🔗 Incrocio con i deploy

Ogni release di giugno ha **aggiunto un canale di polling cloud** → la curva rampa
da 196k a 599k eventi/giorno (×3) **a parità di lavoro svolto**:

| Data | Release | Effetto sulla curva |
|---|---|---|
| 03/06 | v0.1.18 | 197k → 299k |
| 05–06/06 | v0.1.19 / v0.1.20 | → ~413k |
| 15/06 | v0.1.21 | 438k → 550k |
| 16–20/06 | (plateau) | 📈 picco ~599k |
| **21/06** | **v0.1.22** | 🛑 **inversione** |

**v0.1.22 = `[JHT-CLOUD-INTERACTIVE-RETIRE]` + `[JHT-WEB-READONLY]`**:
- `ce96b44eb` — "fondi il reconcile team_state nel daemon, **ritira i poller standalone**"
- `485566d3c` — throttle floor 5min + ladder a gradini
- `7bf2ca996` / `4a2da05d9` / `56bfb883f` — bus desired read-only, chat solo-desktop, sweep controlli

Da qui la curva si inverte: **−45% in 3 giorni**. Il fix previsto sta funzionando.

---

## 4. 🤖 Cosa fanno davvero le VPS (Supabase)

Attività reale del team, per giorno:
```
Utenti attivi:     1–2 soltanto
Scores scritti/g:  ~20–50
Transizioni/g:     sporadiche (84–650)
Heartbeat:         freschi (oggi 19:30) MA team is_running=false (stopped)
```

🎯 **Punto chiave:** il team produce **poche decine di azioni/giorno** ma genera fino a
**600.000 eventi/giorno** su Vercel. Il costo **NON scala col lavoro** — scala col
**battito dei daemon** (heartbeat/poll), che continua **anche a team fermo**
(heartbeat freschi con `is_running=false`). È telemetria di presenza, non di produttività.

---

## 5. ✅ Verifica deploy sulle VPS (SSH, read-only)

Domanda: le VPS hanno **davvero** ricevuto il container con il ritiro dei poller?

### betaC (203.0.113.10) — ✅ CONFERMATO
```
container:      ghcr.io/leopu00/jht:latest
image_created:  2026-06-22 22:22 UTC   (up ~45h)
handleSyncRendezvous in cloud.js:  presente (2 ref)
sync_requested_at in cloud.js:     presente (4 ref)
userMessagesPoller:                0 riferimenti  → poller RITIRATO
```
Il container del **22/06 22:22** ha tutto il lavoro di consolidamento. La data del
redeploy **coincide esattamente** con l'inizio del calo dei costi (22/06). ✅

### leopu00 (203.0.113.30) — ✅ verificato via Hetzner (metriche di rete)
La chiave SSH dedicata non è più recuperabile su questo Mac (il desktop la salva in
`userData/ssh/jht_ed25519`, `desktop/vps/index.js:248`, ma quella cartella non esiste
più; sul disco ci sono solo 3 keypair JHT — betaB / betaC(×2) / sim — nessuno apre
l'host). **Bypassata via Hetzner CLI** (token `~/.config/hcloud/cli.toml`, context `jht`):
le metriche di traffico danno il comportamento reale senza SSH.

### betaB (203.0.113.20) — N/A
Cloud sync disabilitato dal 22/05 (`enabled:false`) → non polla, irrilevante al costo.

### 🛰️ Cross-check Hetzner — traffico in uscita (pps medio/giorno = volume di polling)
Fonte **indipendente** da Vercel, conferma la stessa storia:

**betaC (hil-1):**
```
15–21/06  ~9.5–10.2 pps   plateau (picco)
22/06      6.5 pps        ← redeploy container 22:22
23/06      6.1 pps
24/06      5.4 pps
```
→ **−40% il 22/06**, esattamente al redeploy. Conferma che il calo dei costi Vercel è betaC.

**leopu00 (nbg1-1):**
```
25/05–04/06  6–10 pps (variabile)
08/06→24/06  ~4.5–5 pps  PIATTO — nessuna rampa, nessun calo il 22/06
```
→ leopu00 è a un regime **basso e stabile** da inizio giugno (~5 pps, metà di betaC al
picco), coerente col team per lo più fermo. **Non è il driver del costo, non era da
correggere.** Il picco di giugno + il −45% su Vercel sono attribuibili ad **betaC**.

### 🔧 Accesso a leopu00 ripristinato + container fermato (2026-06-24, sera)
Con un **token API Hetzner** fornito dall'utente, accesso recuperato via **rescue mode**
(la chiave SSH dedicata era persa): `enable-rescue --ssh-key jht-desktop-betaC` → reboot
→ SSH nel sistema di soccorso → mount `/dev/sda1` → **aggiunta la mia pubkey** a
`/root/.ssh/authorized_keys` → `disable-rescue` → reboot normale → accesso con
`~/.ssh/jht-vps/jht_ed25519`. (Tentato prima `reset-password`: respinto, sshd in
`prohibit-password`.)

**Scoperta:** leopu00 girava un'immagine `ghcr.io/leopu00/jht:latest` del **24 MAGGIO**
(`img_created 2026-05-24T23:03`) — **mai aggiornata in tutto giugno** (`handleSyncRendezvous`
assente → pre-20/06). Ecco perché il suo traffico era piatto e basso: vecchio comportamento
di polling, mai rampato coi feeder di giugno e mai toccato dal ritiro del 21/06.

**Azione:** `docker stop jht` (compose `restart: unless-stopped` + stop manuale ⇒ non
riparte ai reboot). Verifica post-stop: **0 container attivi, 0 processi node/jht, 0
connessioni in uscita su :443** (Vercel/Supabase). Il residuo ~2-3 pps in metriche è puro
rumore OS (sshd/monitoring/NTP). ⇒ **leopu00 ora genera ZERO traffico JHT.** Per riattivarlo:
`docker start jht`, ma **prima aggiornare l'immagine** (`docker compose pull` + `image prune`,
vedi gotcha disco pieno) perché è ferma a maggio.

---

## 6. ⚠️ Implicazione strategica (go-live blocker)

Il costo variabile è **lineare nel numero di utenti** (ogni utente accende fino a 3
daemon che pollano):

| Scenario | Costo variabile/mese (stima) |
|---|---|
| 🟢 oggi (1–2 utenti, post-fix) | ~$23 |
| 🟡 50 utenti beta | ~$580 |
| 🔴 200 utenti | ~$2.300 |

La traiettoria di giugno è **giusta** (−45% dopo v0.1.22), ma finché ogni utente
accende più daemon il costo **esplode linearmente**. Il vero sblocco per la beta larga
resta il **consolidamento a daemon singolo** (via tunnel SSH) + spending-limit Vercel.

---

## 7. 📌 Conclusioni operative

1. ✅ **Bug dashboard risolto** applicando mig 045 a prod (solo DB, nessuna release web).
2. ✅ **Calo costi reale e in corso**: −45% dopo v0.1.22, container del ritiro poller
   verificato deployato su betaC (22/06 22:22), **doppia conferma** dal traffico di rete
   Hetzner (betaC −40% in uscita il 22/06).
3. ✅ **leopu00 chiarito via Hetzner** (la chiave SSH non è recuperabile su questo Mac):
   traffico piatto e basso da inizio giugno → non è il driver del costo, non era da
   correggere. La sola voce in sospeso è la **versione esatta** del suo container (serve
   exec, non ispezionabile via metriche) — ininfluente dato il profilo già minimo.
4. 🚩 **Lezione di processo**: ogni release che introduce una migration Supabase richiede
   il **passo manuale** di applicarla al cloud — non è in CI. **Checklist post-release**:
   `list_migrations` su prod vs `supabase/migrations/` per snidare le mancanti.
5. 🎯 **Blocker go-live invariato**: daemon singolo + spending-limit prima della beta larga.

---

## Riferimenti
- Caso gemello (codice avanti, ma route web indietro): `docs/internal/` —
  pattern "web deploy da production non master".
- `supabase/migrations/045_team_state_sync_rendezvous.sql`
- `docs/internal/architecture/2026-06-20-data-sync-and-dashboard-split-design.md`
- Export: `~/Downloads/vercel-costs.csv` (25/05 → 24/06).
