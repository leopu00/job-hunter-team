# 🖥️ App Desktop — stato, gap e roadmap (2026-07-03)

> 🗄️ **ARCHIVIATO il 2026-07-25 — descrive l'app Electron, che non esiste più.**
> La migrazione nativa del 2026-07-19 (`32225cb7`) ha eliminato l'intero albero
> `desktop/`: l'unica applicazione desktop è l'ufficio Godot in `game/`. Restano
> validi il *ragionamento* e le decisioni del giorno del lancio (CLI-only,
> ritiro del download desktop); sono superati tutti i dettagli tecnici
> (electron-builder, DMG/AppImage/deb, dashboard locale servita dal container).
> Stato attuale: `game/docs/GDD.md`, `game/docs/FIRST-RUN.md`,
> `game/docs/ROADMAP.md` e `docs/internal/ops/release.md`.

> **Contesto.** Snapshot preso il giorno del lancio su Reddit per reclutare
> contributor. **Decisione del giorno:** l'app desktop **non è ancora promossa** →
> per il lancio pubblico si espone **solo la CLI**; il download desktop dal web va
> **rimosso** (vedi §5). Questo doc riassume dove siamo, cosa manca e cosa vogliamo
> che l'app desktop diventi (il "centro di controllo" del team).
>
> Nessun dato sensibile qui dentro (niente IP, host, credenziali, nomi).

L'app desktop è un launcher Electron (`desktop/`) che builda per macOS (DMG),
Windows (NSIS) e Linux (AppImage + deb). Fa da wizard di onboarding + centro di
controllo locale del team di agenti.

---

## 1. Cosa funziona OGGI

**Build & distribuzione**
- Cross-build da Mac per tutte e 3 le piattaforme. Il ramo **Linux** (AppImage +
  deb x64) è stato validato questa sessione: build, moduli nativi (`node-pty`,
  `keyring`) caricati correttamente sotto l'Electron impacchettato (ABI ok),
  install del `.deb` e avvio dell'onboarding **verificati dal vivo**.

**Onboarding wizard**
- Welcome → scelta/login provider → **setup Docker** → working hours → upload
  profilo → scelta location (Local / VPS).

**Auto-install Docker (tutte e 3 le piattaforme)**
- Windows: Docker Desktop + WSL2. macOS: Colima (CLI, no GUI, no licenza).
  **Linux: Docker Engine CE via `get.docker.com`** — implementato questa sessione
  (commit `66c29b4d5`): una sola elevazione `pkexec` (single password prompt)
  installa Engine + `usermod -aG docker` + avvia il daemon. Validato end-to-end
  sul banco Linux: Docker installato, daemon `active`+`enabled`, utente nel gruppo
  `docker`.

**Dashboard NATIVA (niente webview)** — `dashboard-native.js`
- View native Electron: **Offerte, Statistiche, Candidature, Mappa, Attività,
  Agenti, Profilo, Working hours, Notifiche**. I dati arrivano dal runtime locale
  via un proxy IPC generico (`window.dashboardApi.get(path)` → localhost col
  local-token). È di fatto la **stessa dashboard del web, reimplementata nativa**.

**Chat con gli agenti** — `dash-chat.js`
- Chat nativa, oggi con **Capitano + Assistente** (`/api/<agent>/chat`, polling
  incrementale col cursore `after`).

**Controllo team** — `home.js` / `running.js`
- **Start** e **Stop** dell'intero team (`startTeamFromHome` / `stopTeamFromHome`),
  con polling di stato del container.

**Altro (dal resto del codebase desktop)**
- Lifecycle VPS, provider auth, token Telegram, email sourcing, sync.

---

## 2. Gap noti (cosa NON funziona / manca)

| Area | Gap |
|---|---|
| **AppImage su Ubuntu 24.04** | Richiede `libfuse2` (di serie c'è solo fuse3) → doppio-click non parte. **Il `.deb` è il formato consigliato** (non usa FUSE). Da documentare o defaultare al `.deb`. |
| **Docker Linux post-install** | Serve **un re-login (o reboot) una-tantum** perché il gruppo `docker` entri in vigore (comportamento inerente di Linux, non un bug). L'app mostra "Riavvio necessario" — badge condiviso con Windows, su Linux sarebbe più preciso "Riaccesso necessario". |
| **Firma** | Pacchetti non firmati (mac notarize off, win/linux unsigned) → warning Gatekeeper/SmartScreen. Da firmare al rilascio vero. |
| **Controllo per-agente** | Esiste solo start/stop dell'**intero** team. Manca **stop / respawn del singolo agente**. |
| **Vista consumi** | Nel dashboard nativo non c'è ancora una view **consumo/budget/token per agente** (ci sono Statistiche/Attività, non i consumi). |
| **Chat limitata** | Solo Capitano + Assistente. Manca **Mentor**, e manca il **relay** verso gli altri agenti. |

---

## 3. Da testare (rimasto)

- **Coda dell'onboarding su Linux**: working hours, upload profilo, login provider
  (Codex/Kimi), ramo Local vs VPS.
- **Team start → running → dashboard popolata → chat andata/ritorno** su Linux.
- Stop/restart team; sync; email; Telegram — su Linux.
- Passata **visiva** di tutte le view del dashboard su Linux.
- **UI Windows**: test visivo ancora da completare (serve sessione RDP attiva).
- Note infra di test (non l'app): una macchina headless per l'RDP screen-share ha
  bisogno di **autologin**, altrimenti dopo un reboot resta al login-screen e l'RDP
  fallisce (0x204) perché nessuna sessione GNOME condivide la :3389.

---

## 4. Visione — cosa vogliamo nell'app desktop

L'app desktop come **centro di controllo completo** del team, a parità col web e
oltre:

1. **Parità dashboard web ↔ desktop** — stesse view su entrambi (già in gran parte
   presente in forma nativa). Vederla sul desktop **e** sul web.
2. **Controllo pieno degli agenti dal desktop**:
   - avviarli, **fermarli**, **rispawnarli** (anche per-singolo-agente);
   - vedere **quanto consumano** (token/budget per agente);
   - vedere **cosa fanno** (attività in tempo reale).
3. **Chat con gli agenti — nuovo concetto di routing** ⭐
   - Si chatta **solo con 3 ruoli: Assistente, Mentor, Capitano**.
   - Attraverso questi tre si **raggiungono gli altri** agenti (relay).
   - **Stato attuale:** chat solo con Capitano + Assistente; **Mentor assente**,
     **nessun relay** verso gli altri. → da implementare: chat Mentor + il modello
     di instradamento "parli coi 3, loro parlano con gli altri".

---

## 5. Decisione: lancio pubblico CLI-only

L'app desktop **non è ancora promossa**. Per il lancio (Reddit) si espone **solo la
CLI**; il **download desktop va tolto dal web**.

**Dove intervenire (azione da fare, NON eseguita in questa sessione):**
- Pagina download: `web/app/download/page.tsx`.
- Richiami nella landing: `web/app/components/landing/` (`LandingCTA.tsx`,
  `LandingNav.tsx`, `LandingClient.tsx`, `LandingI18n.tsx` + le i18n per lingua),
  più `web/app/sitemap.ts`, `web/app/marketing-routes.ts` e le guide in
  `web/app/docs/guides/`.
- ⚠️ Va live **solo** con release **master → production** (il web di produzione non
  segue master via Docker CI). Rimuoverlo su dev4 non basta per il lancio di oggi:
  serve il deploy production.

---

## Riferimenti
- Fix auto-install Docker Linux: commit `66c29b4d5` (dev4).
- Moduli desktop chiave: `renderer/modules/dashboard-native.js` (dashboard),
  `dash-chat.js` (chat), `home.js` / `running.js` (lifecycle team),
  `docker-installer/` (setup Docker).
- Nota pulizia: in `desktop/` esistono due file **duplicati** non tracciati a path
  sbagliato (`docker-card.js`, `install.js`) — copie dei veri
  `renderer/modules/docker-card.js` e `docker-installer/install.js`. Artefatti di
  merge, candidati alla rimozione (non committati).
