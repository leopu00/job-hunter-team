# VPS Fresh Install — UX Fixes Punch List

**Data**: 2026-05-12
**Contesto**: Test installazione "utente totalmente nuovo" su VPS Hetzner fresca (Ubuntu 24.04, root), branch `master`.
Comando one-liner: `curl -fsSL https://jobhunterteam.ai/install.sh | bash`

L'install gira liscio fino alla fine, ma il post-install ha attriti che confondono un utente al primo contatto. Lista di problemi rilevati e fix proposti, ordinati per impatto.

---

> **Stato fix**: i 🔴 P0 di questo doc sono stati applicati su `dev1`
> nei commit `c360bb27`, `d24d2b8a`, `4a6cb181`, `c2ab7247`. Restano da
> indirizzare i P1/P2/P3 elencati sotto.

## 🔴 P0 — Wizard non parte da solo dopo install

**Stato attuale**: alla fine di `curl | bash` lo script stampa "Stdin/stdout non e' un terminale interattivo: salto il wizard" e lascia l'utente con tre istruzioni divergenti (`jht`, `jht up`, `jht setup`). L'utente deve ricordarsi di rilanciare un comando, e in più non è chiaro quale.

**Comportamento atteso**: dopo `curl | bash` il wizard di setup parte da solo, senza alcun comando aggiuntivo. È **l'unica chance** di onboarding pulito: se la salti, l'utente cade in una help con 30+ comandi.

**Fix proposti**:
1. **Opzione A — re-exec via TTY**: a fine `install.sh`, se `[ ! -t 0 ]` (siamo dentro `curl | bash`), ri-lanciarsi con `exec </dev/tty` per il solo step finale (il wizard). Pattern usato da `rustup`, `nvm`, `oh-my-zsh`.
2. **Opzione B — istruzione one-liner finale**: stampare una sola riga chiara, es. `▸ Setup non avviabile da pipe. Esegui ora:  jht setup` (eliminando le altre due varianti `jht`/`jht up`).
3. **Opzione C — primo-run hook in `jht`**: se `~/.jht/config.yml` non esiste, `jht` (qualunque sub-comando, inclusa la chiamata nuda) entra automaticamente in `setup`. Idempotente al secondo run.

Preferenza: **A** (esperienza migliore) + **C** come safety net.

**File da toccare**:
- `scripts/install.sh` → funzione `maybe_onboard()`
- `scripts/jht-wrapper.sh` → primo-run detection
- `cli/bin/jht.js` → eventuale entry-point dispatch

---

## 🟠 P1 — `jht` senza argomenti ha doppio comportamento

**Stato attuale**: `jht` da solo (nessun arg) fa **due cose**:
1. `jht up` implicito (pull immagine 50s, ~500 MB)
2. Stampa la help di tutti i comandi

**Problema**: utente che voleva solo "vedere cosa fa jht" si ritrova con un pull di 500 MB. Effetto collaterale invisibile.

**Fix**: separare strettamente:
- `jht` (no args) → stampa help, **nessun side-effect**
- `jht up` → pull + start container, esplicito
- `jht setup` → up + wizard (con messaggio "avvio container al primo run, attendere...")

**File**: `scripts/jht-wrapper.sh` (dispatcher) — rimuovere l'auto-`up` dal default branch.

---

## 🟠 P1 — Help post-install troppo lunga per nuovo utente

**Stato attuale**: al primo `jht` (o post-install) l'utente vede 30+ sotto-comandi: `reset full`, `cron`, `webhooks`, `secrets`, `keyring`, `hooks`, `migrate`, `cache`, `plugins`, `context`, `container`, `positions`, ecc. Spaventoso.

**Fix**:
- Aggiungere un livello "essential commands" mostrato di default a primo-run o se config assente:
  ```
  Comandi essenziali:
    jht setup      Configurazione iniziale
    jht status     Stato del sistema
    jht agents     Lista agenti e task
    jht dashboard  Apri la dashboard web
    jht doctor     Diagnostica setup

  Per tutti i comandi: jht help
  ```
- La help completa rimane su `jht help` esplicito.

**File**: `cli/bin/jht.js` — split tra `commander.help()` ed entry-help custom; oppure flag `--all` su help.

---

## 🟡 P2 — Verbosity install (`apt-get` muro di testo)

**Stato attuale**: `apt-get install -y docker.io` stampa ~30 righe (URL Hetzner, `Selecting/Setting up...` per ogni pacchetto, "No services need to be restarted" x2, scanner kernel). Su un cliente "utente nuovo" sembra debug verbose.

**Fix**:
- `apt-get install -qq -y docker.io` (silenzia output)
- Mostrare invece un singolo spinner / progress: `▸ Installazione Docker... ✓ (12s)`
- Stesso pattern per `docker-compose-v2` e altre dipendenze.

**Trade-off**: log meno utile per debug. Soluzione: redirect verbose a `/tmp/jht-install.log` + cita il path in caso di failure.

**File**: `scripts/install.sh` → `install_docker_linux()`

---

## 🟡 P2 — Warning "gruppo docker" mostrato anche a root

**Stato attuale**:
```
⚠ Sei stato aggiunto al gruppo 'docker'. Esci e rientra (o 'newgrp docker') per usarlo senza sudo.
```
Su VPS-root questo warning è **rumore puro**: root usa docker senza relogin, non c'è nulla da fare.

**Fix**: in `install_docker_linux()` condizionare il blocco `usermod -aG docker $USER` + warning a `[ "$(id -u)" -ne 0 ]`.

**File**: `scripts/install.sh` riga ~307

---

## 🟡 P2 — "Allineo owner di /root/.jht a 1001:1001 (era uid 0)..."

**Stato attuale**: messaggio criptico stampato da `jht up`. Per un utente non-developer è un mistero.

**Fix**:
- O renderlo silenzioso se è una operazione di routine
- O contestualizzare: `▸ Imposto permessi cartelle host per container non-root (sicurezza)... ✓`

**File**: `scripts/jht-wrapper.sh` (chown logic)

---

## 🟡 P2 — Manca conferma "✓ Tutto pronto" finale

**Stato attuale**: ultima riga dopo `jht` è la help di commander. Niente "✓ Container avviato. Prossimo step: `jht setup`". L'utente non sa se è andato tutto bene.

**Fix**: dopo `jht up` (esplicito), stampare blocco verde:
```
✓ Container jht avviato (immagine: ghcr.io/leopu00/jht:latest)
▸ Prossimo: jht setup
```

**File**: `scripts/jht-wrapper.sh` finale di `up`

---

## 🟢 P3 — Istruzioni di disinstall incomplete

**Stato attuale**:
```
Per disinstallare:
  jht down && rm -rf /root/.jht/runtime /usr/local/bin/jht && docker rmi ghcr.io/leopu00/jht:latest
```
NON include `/root/.jht/{config,db,allegati,agents}` né `~/Documents/Job Hunter Team/`. Utente che vuole pulire tutto resta con GB di dati orfani.

**Fix**: due varianti:
```
Per disinstallare (mantiene dati):
  jht down && rm -rf /root/.jht/runtime /usr/local/bin/jht && docker rmi ghcr.io/leopu00/jht:latest

Per cancellare anche i tuoi dati (config, db, CV, output):
  rm -rf ~/.jht "~/Documents/Job Hunter Team"
```

Memo: rispettare `feedback_no_user_data_wipe.md` — separare hard sempre "uninstall" da "wipe dati".

**File**: `scripts/install.sh` → `final_message()`

---

## 🟢 P3 — Tipografia minore

`runtime:/root/.jht/runtime` → manca spazio dopo `runtime:` nella banner di header.

**File**: `scripts/install.sh` riga ~148

---

---

# Wizard setup — Step 1: Host detection

## 🔴 P0 — Lingua deve essere LA PRIMA scelta del wizard

**Stato attuale**: il wizard parte direttamente in italiano, l'utente non può scegliere lingua. Su VPS in cloud (utente potenzialmente non italiano) è bloccante.

**Fix**:
- Primissimo step del wizard, **prima** dell'host detection:
  ```
  Choose your language / Scegli la lingua:
    1) English
    2) Italiano
  Choice [1]:
  ```
- Default **English** (allineato con `feedback_lang_picker_default_english.md` del desktop). Salvato in config, usato per tutti gli step successivi del wizard e per la TUI.

**File da toccare**: `cli/wizard/setup.js` (nuovo step prima di tutto) + `scripts/host-setup.sh` (i18n delle stringhe esistenti).

---

## 🔴 P0 — Selettore host ambiguo (`[V] 1)` / `[ ] 2)`)

**Stato attuale** (`scripts/host-setup.sh:80-91`):
```
Dove stai eseguendo JHT?
  [V] 1) Server remoto / VPS    (rilevato)
  [ ] 2) Computer locale
Scelta [1]:
```

**Problemi**:
- La sintassi `[V]` sembra una checkbox interattiva (utente prova a premere V o spazio); in realtà è solo testo, vuole il numero
- Non è chiaro se invio = conferma del default o se serve digitare `1`
- "rilevato" tra parentesi non spiega *cosa è stato rilevato* (private/public IP? cloud metadata?)

**Fix**:
- Rimuovere il finto-checkbox `[V]` / `[ ]` e usare semplice prompt numerico con default visibile:
  ```
  Dove stai eseguendo JHT?
    1) Computer locale         — il tuo PC, accessibile in rete locale
    2) Server remoto / VPS     — un server cloud raggiungibile via IP pubblico

  Rilevato: server remoto (IP pubblico assegnato)
  Scelta [2]: _
  ```
- Invio = accetta il default (mostrato tra parentesi quadre)
- In alternativa: usare libreria di prompt interattivi (es. `inquirer` o `@inquirer/prompts` se siamo già in Node) per arrow-key navigation. Più moderno ma cambia stack.

---

## 🟠 P1 — Testo opzioni poco esplicativo

**Stato attuale**: `Server remoto / VPS` + `Computer locale` — l'utente nuovo non sa che differenza fa né perché glielo si chiede.

**Fix** (proposta utente): spiegare *perché* la scelta conta:

```
Dove stai eseguendo JHT?

  1) Computer locale
     Stai usando JHT sul tuo PC personale, accessibile solo da te
     in rete locale. La dashboard web si apre automaticamente.

  2) Server remoto / VPS
     JHT gira su un server cloud (es. Hetzner, DigitalOcean) raggiungibile
     da remoto via IP pubblico. Servono passi extra per esporre la
     dashboard in sicurezza.

  Scelta [2 — rilevato server remoto]: _
```

**File**: `scripts/host-setup.sh:81-89`

---

---

# Wizard setup — Step 2: Swap config

## 🟠 P1 — Spiegazione swap troppo prolissa

**Stato attuale** (`scripts/host-setup.sh:139-146`):
```
Consiglio: configurare 2GB di swap.
Motivo: con 4 GB RAM e gli 8 agenti del team, picchi puntuali
possono superare la RAM. Senza swap, il kernel killa i processi (OOM)
fermando il team. La swap previene questo (anche se piu' lenta della RAM).

Configurare 2GB swap (/swapfile)? [Y/n]:
```

**Problemi**:
- 4 righe di motivazione tecnica (OOM, kernel, 8 agenti, "anche se piu' lenta della RAM") per una scelta che l'utente accetterà sempre col default `Y`
- L'utente vede "killa i processi" e si spaventa
- Info ridondante: "2GB di swap" stampato 2 volte (riga 1 + riga prompt)

**Fix proposto** — versione sintetica:
```
RAM: 4 GB  |  Swap: 0 MB

▸ Con solo 4 GB di RAM il team può andare in OOM sotto carico.
  Configuro 2 GB di swap in /swapfile per sicurezza? [Y/n]: _
```

Una sola riga di motivo, formulata come azione consigliata (non come allarme). Il dettaglio tecnico (kernel OOM killer ecc.) va in un eventuale `--verbose` o nei docs.

**Sotto-fix correlati**:
- Se RAM ≥ 8 GB: skippare lo step (no warning, no prompt) — già implementato (`host-setup.sh:130-133`).
- Se swap già configurata ≥ proposta: skippare con `✓ Swap già configurata (X MB)` — già implementato (`host-setup.sh:125-128`).
- ~~Typo `[Y\n]` in riga 146~~ — falso allarme, in realtà è `[Y/n]` (avevo letto male l'output a schermo).

**File**: `scripts/host-setup.sh:135-146`

**Stato**: ✅ Fix applicato in commit `c2ab7247`.

---

---

# Wizard setup — Step 4: Pairing CLI ↔ web

## 🔴 P0 — Link diretto `/cli-link?code=...` non porta al login, perde il code

**Sintomo riproducibile**:
1. Utente nuovo lancia `jht setup` su VPS, wizard stampa link diretto: `https://jobhunterteam.ai/cli-link?code=MNRN-4885`
2. Utente apre il link in browser (non loggato)
3. **Atteso**: pagina di login → dopo login torna a `/cli-link?code=MNRN-4885` con codice pre-compilato
4. **Effettivo**: utente landa sulla landing page `https://jobhunterteam.ai/` (senza modale login, senza code). Deve cliccare "Sign in" → dopo OAuth viene mandato a `/dashboard` → il pairing code è perso.

**Root cause** (chain di 3 bug):

1. **`web/app/(protected)/layout.tsx:42`** — `if (!user) redirect('/')` **scarta sia l'URL che la query** (perde `/cli-link` e `?code=MNRN-4885`). Inoltre non passa `?login=true`, quindi l'utente vede la landing pubblica, non la modale di login.

2. **`web/proxy.ts:137`** — il middleware espone `x-pathname` ai server component ma **non la search string**, quindi anche volendo il layout non può ricostruire `?code=MNRN-4885`.

3. **`web/app/components/landing/LandingClient.tsx:42-48`** — `signInWithOAuth` hardcoda `redirectTo: ${origin}/auth/callback` senza accettare un `returnTo`. Anche se l'utente atterrasse sulla modale login (caso `?login=true` esplicito), dopo OAuth non avrebbe modo di sapere dove tornare.

4. **`web/app/auth/callback/route.ts:7`** — già supporta `next = searchParams.get('next') ?? '/dashboard'`, quindi se la landing passasse `next=<returnTo>` nel `redirectTo` di OAuth, il callback farebbe già il redirect corretto. **Nessuna modifica al callback.**

**Fix proposto** (4 modifiche, 3 file):

1. `proxy.ts` riga ~138 — aggiungere `requestHeaders.set('x-search', request.nextUrl.search)`
2. `proxy.ts` riga 252 — `redirect('/?login=true')` → preservare `returnTo` dalla request URL
3. `(protected)/layout.tsx` riga 42 — `redirect('/')` → `redirect('/?login=true&returnTo=<pathname+search>')`
4. `app/page.tsx` — accettare `returnTo` da searchParams, passarlo a `LandingClient`
5. `LandingClient.tsx` — accettare `returnTo` come prop, in `signInWithOAuth.options.redirectTo` usare `${origin}/auth/callback?next=${encodeURIComponent(returnTo)}` quando presente

**Impatto**: non solo cli-link — sistema un bug generale di "perdita URL su login" per **tutte** le pagine protette. Bookmark deep-link, link condivisi, ecc. tornano a funzionare dopo login.

---

---

## 🔴 P0 — CSRF guard blocca pairing su `jobhunterteam.ai` prod

**Sintomo riproducibile**:
1. Utente arriva su `/cli-link` autenticato (avendo fatto login manualmente)
2. Inserisce codice e clicca "Conferma pairing"
3. La pagina mostra banner rosso: **`Cross-origin mutation rejected`**
4. Il pairing non si completa, il polling CLI scade in 10 min.

**Root cause**: `web/lib/csrf.ts:26-33` ha un'allowlist hardcoded di origin per le mutazioni:
```ts
const STATIC_ALLOWED = new Set([
  'http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002',
  'http://127.0.0.1:3000', 'http://127.0.0.1:3001', 'http://127.0.0.1:3002',
])
```
Più `JHT_PUBLIC_ORIGIN` da env. Su prod la env var non è settata, quindi `Origin: https://jobhunterteam.ai` non è in allowlist → 403 per qualsiasi POST/PUT/PATCH/DELETE dal sito stesso.

**Spiega**:
- ✓ Sign-in OAuth funziona (è redirect GET, niente mutazioni)
- ✗ Form pairing rotto (POST verso `/api/cloud-sync/device-confirm`)
- ✗ Qualsiasi mutazione dal frontend prod fallisce silenziosamente con stesso errore

**Fix proposti** (3 opzioni):

**A) Quick fix deploy** — settare `JHT_PUBLIC_ORIGIN=https://jobhunterteam.ai` nell'env del container/Vercel prod. Zero codice, deploy immediato.

**B) Code fix robust** ← raccomandato. In `proxy.ts` calcolare `hostOrigin` da `x-forwarded-proto` + `x-forwarded-host` (fallback `host` header), passarlo a `shouldRejectBrowserMutation`. La funzione accetta come "non-CSRF" qualsiasi `Origin` che combaci con l'host della request (definizione standard di same-origin). Vantaggio: funziona su qualsiasi dominio futuro senza setup env.

**C) Code fix pragmatico** — aggiungere `'https://jobhunterteam.ai'` e `'https://www.jobhunterteam.ai'` allo `STATIC_ALLOWED`. Minimale ma hard-coded, non scala.

**File da toccare** (opzione B):
- `web/lib/csrf.ts` — estendere `MutationCheck` con `hostOrigin?: string | null`, aggiungere short-circuit `if (origin === params.hostOrigin) return false`
- `web/proxy.ts:158-164` — calcolare `hostOrigin` e passarlo al check

---

## Note per follow-up

- L'utente sta procedendo con `jht setup` ora per scoprire problemi nel wizard. Aggiungere qui i fix che escono da quel test.
- Nota: il route `/cli-link` esiste (`web/app/(protected)/cli-link/page.tsx`), errore mio iniziale nel cercarlo con glob — era in `(protected)` group. La P0 sopra è comunque valida: il problema è che l'utente non loggato perde URL+code passando per login.
- VPS di test: Hetzner CX21? `46.224.59.127`, Ubuntu 24.04.4, 4 GB RAM (5% usage), 75 GB disk.
- Branch testata: `master`.
