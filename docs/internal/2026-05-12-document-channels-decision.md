# Canali per trasferimento documenti utente ↔ VPS — decisione

**Data**: 2026-05-12
**Contesto**: setup beta su VPS. L'utente carica documenti (CV preesistente, PDF profilo, lettere referenze, screenshot) per nutrire gli agenti, e scarica documenti generati (CV per candidatura X, cover letter, report). Vincolo: nessuna interazione SSH lato utente dopo il pairing iniziale.

> Documento di **decisione**, non di design. Il design dell'opzione scelta è in `docs/internal/2026-05-12-telegram-document-ingest-design.md` (TBD).

## Vincoli

- ❌ No SSH lato utente nel flusso quotidiano
- ❌ No storage massiccio su Supabase (costo + scalabilità)
- ❌ VPS non esposta pubblicamente (solo `127.0.0.1:3000`)
- ✅ Disco VPS abbondante (Hetzner CPX22 = 80 GB SSD)
- ✅ Telegram bridge già esistente (Capitano bidirezionale)
- ✅ Cloud pairing token già esistente (`~/.jht/cloud.json`, `cloud-sync`)

## Opzioni valutate

| Opz | Sintesi                                          | UX 👤 | Effort 🔧 | Costo ☁️ | Scala 📈 | Sicurezza 🔐 |
|-----|--------------------------------------------------|-------|-----------|----------|----------|--------------|
| A   | Upload web → DB transit → VPS pulla → DELETE     | 🟢    | 🟡        | 🟡       | 🟡 < 1k  | 🟢           |
| B   | **Telegram bot bidirezionale**                   | 🟢    | 🟢        | 🟢 0     | 🟢       | 🟢           |
| C   | HTTPS pubblico diretto su VPS                    | 🟢    | 🔴        | 🟡       | 🟢       | 🔴           |
| D   | Relay cloud (S3/R2) + cloud-sync pull            | 🟢    | 🟡        | 🟢 €/GB  | 🟢       | 🟢           |
| E   | Tailscale tra browser utente e VPS               | 🟡    | 🟢        | 🟢 0     | 🟢       | 🟢🟢         |
| F   | Mailbox dedicata + IMAP poll                     | 🟡    | 🟡        | 🟡       | 🟢       | 🟡           |

Panoramica grafica completa: vedi conversazione del 2026-05-12.

## Decisione

### Adesso (beta) — **Opzione B: Telegram**

Canale primario. Già infrastruttura nostra (Capitano bridge), zero costi, bidirezionale, allegati nativi fino a 20 MB (50 MB con Bot API self-hosted, sufficiente per CV/PDF profilo). Il flow `setup` configura Telegram nei primi step → all'utente arriva subito un messaggio "mandami il tuo CV qui" → gli agenti lo ricevono dentro la VPS senza che l'utente apra una shell.

**Perché:**
- Effort minimo (estensione del bridge esistente)
- Robustezza: TLS Telegram + auth via chat_id pinato al pairing utente
- Bidirezionale gratis: l'utente riceve CV generati sullo stesso canale dove ha mandato l'input
- Funziona anche da mobile, indipendente dal browser

**Limiti accettati per la beta:**
- 20 MB/file (raro che un CV superi)
- Dipendenza Telegram come account (mitigata con secondary channel più sotto)
- No "libreria documenti" navigabile dal sito (rimedio in fase v1)

### Possibile secondary in beta — **WhatsApp Cloud API**

Per chi non usa Telegram. Stesso pattern (bot bidirezionale, allegati), ma su WhatsApp Business Cloud API. Da valutare costi (Meta fattura per conversation, ~$0.005-0.08 a seconda del Paese) e onboarding numero verificato. **Decisione**: rimandato. Valutare dopo aver visto quanti beta tester rifiutano Telegram. Se >2/10, attiviamo.

### Future (post-beta, scalabilità) — **A + D + E, non mutualmente esclusive**

Telegram **non sarà escluso** quando aggiungeremo questi canali. Resta come opzione, perché è quella più "no-setup" per molti utenti. Quel che cambia è solo che non sarà più l'**unico** canale.

#### D — Relay cloud S3/R2 + cloud-sync pull *(raccomandato come v1)*
Quando dobbiamo togliere Telegram come dipendenza obbligatoria. L'utente carica via dashboard → bucket transit (TTL 10 min, presigned PUT) → la VPS pulla via `cloud-sync` client (riusa il token di pairing già esistente) → bucket purge. DB Supabase tiene SOLO l'indice (sha, filename, location_on_vps).

**Trigger di adozione**: prima volta che un beta tester chiede "voglio caricare 20 PDF in un colpo" o "voglio una libreria documenti sul sito".

#### A — DB transit *(fallback, scartato come primario)*
Variante più semplice ma trasforma Postgres in coda binaria. Tenibile come piano B se D è troppo costoso da implementare. **Default**: non lo facciamo, D è meglio.

#### E — Tailscale *(per power-user e self-hoster)*
Mesh VPN tra PC utente e VPS. Dashboard locale-like, sicurezza massima, zero esposizione pubblica. Trade-off: l'utente deve installare un'app in più. Lo offriremo come "modalità avanzata" nel wizard del desktop launcher (`[JHT-VPS-FRIENDLY]` in BACKLOG).

**Trigger di adozione**: quando il desktop launcher per VPS è pronto e vogliamo dare un'alternativa "no cloud relay" ai privacy-sensitive.

## Cosa NON facciamo (mai)

- ❌ **C** — esporre Next.js direttamente sull'IP pubblico della VPS senza reverse proxy maturo, cert mgmt, abuse handling. Apre superficie di attacco e ci porta nel territorio di "manutenzione infra utente" che vogliamo evitare.
- ❌ **F** — mailbox dedicata. Latenza 30-120s, deliverability incerta, sensazione "vecchio". Non vale l'effort.

## Roadmap implementativa

1. **Adesso** → design + build ingest documenti via Telegram (Opz B)
   - Spec: `docs/internal/2026-05-12-telegram-document-ingest-design.md` (TBD)
   - Codice: estensione di `telegram-bridge/` e `shared/telegram/`
2. **Post-beta feedback** → valutare WhatsApp secondary
3. **v1 pubblica** → implementare Opz D (relay cloud)
4. **Desktop launcher VPS** → integrare Opz E come opzione avanzata

## Riferimenti

- `docs/guides/VPS-SETUP.md` — flow VPS attuale (Telegram non ancora documentato lì)
- `docs/internal/2026-05-04-vps-deployment-design.md` — design 3 tier VPS
- `docs/internal/2026-05-01-bridge-and-token-monitoring.md` — bridge attuale
- `docs/internal/INFRA.md` — overview canali utente↔team
- `telegram-bridge/src/` — codice bridge corrente
- `shared/channels/telegram-channel.ts` — abstraction lato shared
