# 🎯 JHT Threat Model

> Bozza pre-launch. Quando l'open-source sarà pubblico, questo file (con piccoli aggiustamenti) diventerà `SECURITY.md` alla root del repo.

**Ispirato a:** [OpenClaw `SECURITY.md`](https://github.com/openclaw/openclaw/blob/main/SECURITY.md) — pattern "personal assistant trust model".

---

## 1. Cos'è JHT

JHT è una **desktop app local-first per single user** che:
- gira sulla macchina dell'utente (Windows/macOS/Linux), via Electron + container Docker
- espone una dashboard web su `http://localhost:3000`
- orchestra agenti AI (Claude/Codex/Kimi) in `tmux` dentro al container
- legge file locali (CV, profilo) e fa fetch HTTP esterno (job listing)
- opzionalmente sincronizza dati su Supabase via cloud-sync

**JHT NON è:**
- una piattaforma SaaS multi-tenant
- un servizio condiviso tra utenti diversi
- un wrapper di sicurezza per dati di terzi

---

## 2. Trust model

### Trusted operators

I seguenti soggetti sono considerati **trusted** e hanno pieno accesso operatore:
- chi ha accesso fisico/SSH al sistema operativo dell'host
- chi può scrivere in `~/.jht/` (config, credenziali, agenti)
- chi può modificare `~/Documents/Job Hunter Team/` (CV, allegati)
- chi è autenticato sulla dashboard `http://localhost:3000` via local-token (cookie `jht_local_token` HttpOnly+SameSite=Strict, settato dal middleware solo su richieste localhost dirette senza header `x-forwarded-*`) o Supabase login

### Untrusted

I seguenti sono considerati **untrusted** e NON devono poter raggiungere capability operator:
- siti web aperti nel browser dell'utente (CSRF/DNS rebinding)
- altri utenti sulla stessa LAN (se la dashboard è esposta su rete)
- contenuto fetched dal web (job listing HTML, email, allegati)
- output dei modelli AI (prompt injection)

### Single-user assumption

JHT assume **un utente per macchina**. Se vuoi usare JHT con più persone:
- usa una macchina/VM/utente OS separata per ciascuna persona
- non sharare la stessa istanza container tra utenti

---

## 3. In scope

I seguenti vettori sono trattati come bug security:

| Vettore | Esempi |
|---------|--------|
| **Auth bypass** | bypass di `requireAuth()` su route sensibili senza control fisico/SSH dell'host |
| **CSRF / DNS rebinding** | sito malevolo che riesce a far eseguire side-effect su `localhost:3000` (es. start agent, leggere secret) |
| **Command injection** | input non-trusted (file content, body API, env config) che diventa esecuzione shell |
| **Path traversal** | leggere/scrivere file fuori dalle directory previste |
| **SSRF** | fetch verso `127.0.0.1`/`metadata.google.internal`/RFC1918 da URL untrusted |
| **Crypto weak** | decifrare credenziali `~/.jht/credentials/*.enc.json` senza la passphrase |
| **Secret leak** | API key in log/stack trace/response body |
| **Cloud-sync IDOR** | un utente Supabase che modifica/legge dati di un altro utente |
| **Prompt-injection con boundary bypass** | prompt injection che bypassa una policy esplicita (es. "non eseguire shell") |

---

## 4. Out of scope

I seguenti sono **non security bug** in JHT (ispirato a OpenClaw):

### Operator-controlled surfaces
- L'utente (operatore trusted) che esegue `jht agent start` e l'agente fa cose con il suo container — è exactly cosa JHT fa.
- Comandi shell eseguiti da agenti `--yolo` dentro al container — è il loro scopo.
- File scritti in `~/.jht/` da un agente trusted — autorizzato.

### Container ≠ security boundary
- L'utente `jht` ha `sudo NOPASSWD` nel container. Questo è **per design**: gli agenti devono poter installare pacchetti al volo (`pdftotext`, `tesseract`, ecc.). Il container è una sandbox **di convenienza** isolata dall'host, **non** un boundary tra agenti diversi sullo stesso container.
- Container escape via kernel CVE: out of scope a meno che non si dimostri specifico bug JHT (non Docker).

### Prompt injection senza boundary bypass
- "Ho fatto dire all'agente parolacce" — non è bug.
- "Ho fatto dire all'agente di eseguire `rm -rf` ma poi l'agente l'ha eseguito perché è in --yolo" — non è bug, è la natura di --yolo.
- "Ho fatto dire all'agente di leggere `~/.jht/secrets.json` quando la policy diceva 'no read di secret' e l'ha letto comunque" — bug security.

### Trusted plugin / skill
- Skill nel repo (`.skills-source/`, `agents/*/skills/`) sono parte del trusted compute base. Una skill che fa cose privilegiate non è bug.

### Backwards compatibility / supply chain di terzi
- CVE in dipendenze upstream non sfruttabili attraverso JHT specifico → segnaliamo all'upstream, non è JHT bug.

### Setup pubblicamente esposti
- Esporre `localhost:3000` su Internet senza Supabase auth è **non raccomandato e non supportato**. Bug solo nel caso il setup raccomandato (loopback only) sia bypassabile.

---

## 5. Deployment assumptions

JHT è progettato e testato per:

✅ **Setup raccomandato:**
- Una macchina (laptop/desktop) per utente
- Container Docker su loopback `127.0.0.1:3000`
- Optional: cloud-sync verso Supabase (autenticato)

⚠️ **Setup avanzati supportati ma con cautele documentate:**
- VPS personale per JHT headless: richiede `JHT_CREDENTIALS_KEY` env var, niente keyring
- Tunnel pubblico (ngrok/Cloudflare) verso JHT: **richiede Supabase auth attiva** (no localhost bypass)

❌ **Setup NON supportati:**
- Più utenti sullo stesso container
- Dashboard esposta su LAN/internet senza auth
- JHT come servizio multi-tenant

---

## 6. Reporting

Per riportare una vulnerabilità:
1. **NON** aprire una issue pubblica.
2. Email a `leopu00@gmail.com` (provvisorio fino al setup di `security@jobhunterteam.ai`) con:
   - Titolo descrittivo
   - Severity stimata (Critical/High/Medium/Low)
   - Path + funzione + righe del codice vulnerabile
   - Versione/commit di JHT su cui hai testato
   - PoC riproducibile
   - Impatto dimostrato (cosa si può fare con il bug)
   - Suggerimento di fix

Report che mancano di PoC riproducibile o che non dimostrano boundary bypass possono essere chiusi come "no-action".

---

## 7. Crypto / data handling

### Encryption at-rest
- Modulo principale `shared/credentials/`: credenziali (API key OpenAI/Anthropic, OAuth Google) cifrate in `~/.jht/credentials/*.enc.json` con **AES-256-GCM** + **PBKDF2-SHA512 100k iterazioni**.
- Modulo legacy `cli/src/commands/secrets.js`: AES-256-CBC. Migrazione a GCM tracciata in `[H5]` di [`05-checklist.md`](05-checklist.md).
- Salt random per installazione, persistito in `~/.jht/credentials/.salt` con permessi 0600.
- Master key derivata da:
  - **GUI desktop**: OS keyring via `jht keyring set/get/delete` CLI (macOS Keychain / Windows Credential Manager / Linux libsecret) — implementato nello sprint H4
  - **Headless / container**: env var `JHT_CREDENTIALS_KEY` obbligatoria
  - **Storage OAuth (`tui/src/oauth/storage.ts`)**: PBKDF2 + salt random per file (post-fix H4 iter 2)

### Data residency
- Default: **tutto locale** (SQLite in `~/.jht/`).
- Cloud-sync opzionale: Supabase, regione ai sensi del GDPR (vedi `docs/legal/gdpr.md`).

### Outbound
- LLM API: requests verso `api.anthropic.com`, `api.openai.com`, `api.minimax.chat` autenticate via API key utente.
- Cloud-sync: Supabase URL configurato dall'utente.
- Job scout: fetch verso siti job board (LinkedIn, Greenhouse, Lever, ecc.) — applicare SSRF policy.

### Telemetry
- Nessuna telemetria automatica.
- Crash reporter: **opt-in** (TODO).

---

## 8. Update / patch policy

- Security patches: rilasciate in versione patch (`X.Y.Z+1`) entro 7 giorni dalla scoperta per Critical, 30 giorni per High.
- Annunci tramite GitHub Security Advisory + cambio in CHANGELOG.md.
- Auto-update Electron: signed updates via Sparkle (TODO).

---

## 9. Cose che NON facciamo (volutamente)

Per evitare false aspettative:

- ❌ **Non offriamo bug bounty** (progetto open-source, no budget)
- ❌ **Non offriamo SLA enterprise** (use at your own risk)
- ❌ **Non garantiamo 100% prompt-injection-proof** (è ricerca attiva)
- ❌ **Non garantiamo container escape** (responsabilità Docker/OS)
- ❌ **Non firmiamo binary releases** (post-MVP)

---

## 10. Versioning

**Versione threat model:** 0.1 (bozza)
**Ultimo aggiornamento:** 2026-04-27
**Prossima revisione:** quando si fa il primo public release.
**Stato hardening corrente:** vedi [`05-checklist.md`](05-checklist.md) — Phase 1 (bloccanti) tracciata 9/9 prima del tag `v0.1.0`.
