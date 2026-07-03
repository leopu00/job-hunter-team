# 🖥️ App Desktop JHT — Stato, gap e visione (2026-07-03)

> **Documento di stato + roadmap.** Fotografa dove l'app desktop (Electron, `desktop/`)
> funziona oggi, cosa manca, cosa resta da testare, e la visione di prodotto che
> vogliamo raggiungere. Scritto in occasione del reclutamento di sviluppatori
> (release Reddit, 2026-07-03): serve sia come onboarding per chi contribuisce, sia
> come piano di lavoro interno.
>
> **Decisione operativa presa oggi:** finché l'app desktop non è promossa, la si
> **ritira dal web come scaricabile**. Sul sito resta **solo la CLI** (`jht`, wizard
> da terminale). Il codice desktop resta nel repo e continua a essere sviluppato:
> togliamo solo il download pubblico, non il lavoro. Vedi § "Ritiro del download".

---

## TL;DR

- **Il setup funziona end-to-end in dev** (macOS): wizard completo dalla schermata di
  benvenuto fino a "team pronto", con onboarding riscritto in 7 lingue e appena
  irrobustito (reti di sicurezza globali, null-guard del boot, timeout sull'installer).
- **Il controllo del team dal desktop esiste** (`docker exec` verso il container):
  start/stop/restart degli agenti, chat, stato tmux, dashboard locale embedded.
- **La dashboard è la stessa su web e desktop** (stessa UI Next): online via
  `jobhunterteam.ai` (login Supabase, read-only) oppure local-only su `localhost`
  servita dal container (nessun login).
- **I gap grossi** sono: (a) test su ambiente **davvero vergine** (Mac pulito/VM,
  Windows, Linux) mai fatto; (b) l'install Docker reale (Colima) provato poco; (c) la
  **chat oggi copre solo una parte** dei ruoli e va portata al **nuovo modello** a 3
  interlocutori; (d) la **visibilità su consumo/attività** per-agente è incompleta.
- **Nuovo modello di chat (decisione 2026-07-03):** si chatta **solo con Assistente,
  Mentor e Capitano**. Sono loro l'interfaccia verso il resto del team; con gli altri
  agenti non si parla direttamente. Oggi questo non è ancora così.

---

## 1. Fino a dove funziona (stato attuale)

### 1.1 Onboarding / setup wizard
Flusso completo, testato dal vivo su macOS (profilo `tester`), riscritto e irrobustito
nelle sessioni 2026-07-02/03:

- **Schermata di benvenuto** (pitch + "Inizia" / "Sei già registrato? Accedi") →
  **lingua** (7 lingue: en, it, hu, es, de, fr, pt) → **dove gira il team**
  (① questo computer via Docker · ② VPS Hetzner via tunnel SSH) → **account cloud**
  (login Google/GitHub Supabase, opzionale in modalità "Inizia") → **runtime Docker**
  (Colima auto-install su Mac / Docker Desktop / "uso il mio") → **container prep** →
  **scelta provider** (Claude/Codex/Kimi…) → **login provider** (terminale in-app) →
  **working hours** → **upload profilo/CV** → **email sourcing** (opzionale) →
  **Telegram** (opzionale) → **team pronto**.
- **Packaging**: build DMG macOS non-notarizzata per test locale
  (`CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg -c.mac.notarize=false`),
  peso ~97 MB (normale per Electron). Esistono i target Windows (`win-installer/`) e la
  configurazione multi-piattaforma, ma **non validati dal vivo**.
- **Robustezza (2026-07-03)**: reti di sicurezza globali main + renderer (un throw non
  gestito non fa più sparire l'app in silenzio → log + banner/dialog), null-guard di
  tutto il wiring di boot (un id HTML mancante non abortisce più l'intero avvio),
  idle-timeout sull'installer `brew` (niente più spinner eterno su rete bloccata),
  cleanup dei download parziali, recovery se il processo renderer muore.

### 1.2 Controllo del team dal desktop
Architettura consolidata (findings 2026-06-24/25, fix su `dev3`): il canale
desktop→team **non è l'HTTP** (il port-map Docker fa fallire `isLocalRequest()` → il web
tratta il desktop come "cloud" e risponde `read_only`), ma **`docker exec` dentro il
container**:

- **Avvio team**: `docker exec jht … jht team start`.
- **Stato agenti**: `docker exec jht tmux list-sessions` (intercetta `/api/agents`).
- **Chat**: `docker exec jht tmux send-keys -t <SESSION> …`.
- **Stop / restart agente**: `tmux kill-session` / `start-agent.sh <role>`.
- Le route web restano **sola lettura** (GET col local-token). Le azioni-posizione
  (write/recheck/like/ticket) restano su HTTP token-based, che funziona.

### 1.3 Dashboard: stessa UI su web e desktop
Un solo front-end (Next), due modi di vederlo con **gli stessi dati**:

- **Online**: `jobhunterteam.ai`, login Supabase → dashboard **read-only** (positions,
  score, mappa, case-studies). Da telefono / PC di lavoro.
- **Local-only**: l'app desktop apre la dashboard servita dal container su `localhost`
  (webview embedded), che legge il `jobs.db` locale **senza login e senza Supabase**.
  Local-only è una **feature** (anti-SaaS: puoi fare tutto in locale), non un ripiego.
- **VPS**: stesso stack via tunnel SSH — il team remoto si comporta come quello locale.

---

## 2. Gap (cosa non funziona / non è pronto)

| # | Gap | Impatto | Note |
|---|-----|---------|------|
| G1 | **Nessun test su ambiente vergine vero** (Mac pulito/VM, Windows, Linux) | ALTO | Finora testato solo su profilo `tester` dello stesso Mac, dove `/opt/homebrew` è di un altro utente (Homebrew single-user) → l'install Colima non è mai andato a termine pulito. Serve una VM/Mac dedicato. |
| G2 | **Install Docker reale (Colima) provato poco** | ALTO | Il codice c'è (`docker-installer/`), ora con idle-timeout e cleanup, ma il percorso `brew install colima → colima start → docker ps` non è stato validato end-to-end su una macchina pulita. |
| G3 | **Chat incompleta e sul modello vecchio** | ALTO | Oggi la chat non copre il modello a 3 interlocutori (§4). Il canale `send-keys` esiste ma la UX e il set di ruoli chattabili vanno allineati. |
| G4 | **Visibilità consumo/attività per-agente incompleta** | MEDIO | Vogliamo vedere, per agente, quanto consuma (token/budget) e cosa sta facendo. I dati esistono lato team (pacing/usage, event-log) ma non sono esposti in una vista desktop dedicata. |
| G5 | **Windows / Linux non validati dal vivo** | MEDIO | Config di build presente, zero test reali. |
| G6 | **Stato dei fix sparso tra branch** | MEDIO | Le fix desktop↔team sono su `dev3`, la robustezza/onboarding su `dev2`; serve consolidare in master e verificare che l'immagine `:latest` contenga davvero i fix. |
| G7 | **Notarizzazione macOS assente** | BASSO | Le build di test sono ad-hoc-signed / non notarizzate; per una distribuzione pubblica servono credenziali Apple + notarize. Non urgente perché ritiriamo il download (§ finale). |

---

## 3. Cosa resta da testare

1. **Setup end-to-end su Mac vergine** (VM o account pulito con Homebrew scrivibile):
   dal doppio-click del DMG fino a "team che gira" — incluso l'install Colima reale.
2. **Windows**: installer, WSL2, Docker Desktop, login provider, avvio team.
3. **Linux**: AppImage/.deb, runtime container, avvio team.
4. **Percorso VPS**: generazione chiave SSH → paste su Hetzner → install remoto →
   tunnel → controllo team "come locale".
5. **Chat e controllo agenti dal vivo**: inviare messaggi, ricevere risposte,
   stop/restart di un agente, verifica che lo stato tmux si aggiorni.
6. **Dashboard**: parità web/desktop sugli stessi dati; local-only senza login.
7. **Resilienza**: rete che cade a metà install, container che non parte, provider
   login annullato — verificare che le reti di sicurezza appena aggiunte diano
   feedback chiaro invece di bloccare.

---

## 4. Visione — cosa vogliamo nell'app desktop

L'app desktop è il **cockpit** del team (coerente con la vision anti-SaaS: "il team
vive nel tuo laptop"). Deve permettere di:

### 4.1 Vedere
- **La stessa dashboard del web, dentro il desktop** (già così): positions, score,
  mappa, case-studies — read-only, stessi dati sia online che local-only.
- **Cosa fanno gli agenti**: una vista attività/log per capire in tempo reale su cosa
  sta lavorando ciascun ruolo.
- **Quanto consumano**: consumo (token/budget) per-agente e complessivo, con il pacing
  (settimanale/giornaliero) reso leggibile.

### 4.2 Controllare
- **Start / stop / rispawn** dei singoli agenti dal desktop (già possibile via
  `docker exec`; va esposto in una UI chiara).
- **Avvio/arresto dell'intero team**, gestione working hours, upload profilo.

### 4.3 Chattare (nuovo modello — decisione 2026-07-03)
> **Si chatta solo con tre ruoli: Assistente, Mentor, Capitano.**
> Sono loro l'**interfaccia** verso il resto del team: attraverso di loro si
> raggiungono gli altri agenti. Con gli altri **non si parla direttamente**.

Razionale: dare all'utente **tre porte d'ingresso** chiare invece di N canali paralleli.
Ciascuna con un ruolo distinto:
- **Assistente** — il punto di contatto primario dell'utente (domande, richieste,
  chiarimenti sul profilo e sulle preferenze).
- **Mentor** — guida/coaching sul percorso e sulle scelte.
- **Capitano** — comando operativo del team (priorità, pacing, cosa fare adesso).

Gli altri ruoli (Scout, Analista, Scorer, Scrittore, Critico, Sentinella, …) lavorano
sotto il coordinamento di questi tre e **non sono interlocutori diretti** in chat.

**Stato oggi:** la chat non implementa ancora questo modello — il canale tecnico
(`send-keys` verso le tmux) c'è, ma la UX e la restrizione ai 3 ruoli-interfaccia vanno
costruite. È il prossimo blocco di lavoro sulla chat.

> Coerenza con l'architettura "interaction planes" (2026-06-15): l'**interazione** è
> sempre co-locata col team (desktop, o VPS via tunnel), il web resta **sola lettura**.
> Il modello a 3 interlocutori è la naturale evoluzione lato UX di quel piano.

---

## 5. Ritiro del download desktop dal web (decisione 2026-07-03)

Finché l'app desktop non è promossa e non è stata testata su ambiente vergine, **non
va offerta in download** dal sito: un utente che scarica un installer acerbo e sbatte
sui gap G1/G2 è un'esperienza negativa proprio mentre reclutiamo.

**Cosa si fa:**
- Si **rimuove dal sito il download dell'app desktop** (bottoni/sezioni/link agli
  artefatti DMG/exe/AppImage).
- Si **tiene solo la CLI**: installazione via terminale / wizard `jht`. È il percorso
  maturo e quello che promuoviamo su Reddit.

**Cosa NON si fa:**
- Non si tocca il **codice** dell'app desktop (`desktop/`): resta nel repo e continua a
  essere sviluppato secondo questa roadmap.
- Non si tocca la dashboard cloud read-only né il flusso CLI.

Quando l'app sarà testata e promuovibile, si rimette il download (con notarizzazione
macOS, G7).

### Fatto in questa sessione (dev2)
- `web/app/download/DownloadClient.tsx` — rimosso il **tab "Desktop"** e i suoi
  componenti (`PrimaryCta`, `OtherVariantCard`, icone OS): la pagina `/download` ora ha
  due soli percorsi, **Terminale (CLI)** e **Prompt assistente AI**. Default = terminale.
- `web/app/download/page.tsx` — rimosso il fetch delle **GitHub Releases** + UA-detection
  (servivano solo al tab Desktop): pagina ora statica.
- `web/app/download/layout.tsx` — SEO/JSON-LD: tolti `downloadUrl` e `softwareVersion`
  (non dichiariamo più un installer diretto), descrizioni riscritte in chiave CLI (7 lingue).
- i18n: `dl_desc`, `cta_button` ("Scarica l'app" → "Inizia"/"Get started"), `nav_download`
  ("Download" → "Installa"/"Install") aggiornate su base it/en/hu + overlay es/fr/de/pt.
- Verificato: `tsc --noEmit` e `eslint` verdi; nessun import esterno dei simboli rimossi.

### Follow-up web (NON fatto — copy desktop residua, da ripulire con calma)
Non sono state riscritte le pagine che *menzionano* il download desktop nella narrativa
(non offrono il file, quindi niente è rotto, ma la copy va allineata):
`web/app/run/page.tsx` (narrazione "tutto parte dall'app desktop"),
`web/app/docs/guides/getting-started/page.tsx` (**Path 2** desktop con link a `/download`),
`web/app/docs/guides/faq/page.tsx` (a3 "you download the desktop app"),
`docs/guides/beta` e `dashboard-and-results`, il tour demo (`demo_s0_*`), e le chiavi i18n
legacy `dl_*_instr`/`dl_*_guide*` + i blocchi `download` in `messages/*.json` (codice morto,
non referenziato a runtime). Da fare quando si rifinisce la messaggistica di lancio.

> ⚠️ **Deploy**: le modifiche web vanno live solo con release **master → production**
> (branch `production`), non basta il merge in master. Finché non si rilascia, il sito in
> produzione continua a mostrare il download desktop.

---

## Riferimenti

- `docs/internal/2026-06-15-interaction-planes-redesign-design.md` — i due piani
  (dati read-only ovunque · interazione co-locata sul desktop).
- `docs/internal/2026-06-25-desktop-team-integration-findings.md` — perché il controllo
  desktop→team passa da `docker exec` e non dall'HTTP.
- `desktop/` — codice dell'app Electron (wizard, docker-installer, controllo team).
</content>
</invoke>
