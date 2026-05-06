# 2026-05-06 — Host/container split del CLI `jht`: ridisegno per VPS e launcher

## TL;DR

Il binario `jht` oggi mescola due ruoli incompatibili — **lifecycle host**
(parlare a Docker daemon: compose up/down, exec) e **operativita'
in-container** (wizard, agents, db, web, tmux). Sulla macchina del
maintainer funziona perche' Node gira sull'host e parla al container
persistente. Sul VPS via `install.sh` Docker-mode il CLI finisce dentro
un container effimero che non vede il daemon Docker dell'host: `jht setup`
funziona, `jht team start` si rompe.

Soluzione: separare i due ruoli.

- **Sull'host**: wrapper bash sottile (~80 righe) che fa solo
  `docker compose` e `docker exec`. Niente Node, niente Python, niente
  socket Docker esposto al container.
- **Dentro al container `jht` long-running**: il CLI Node attuale, ma
  raggiunto direttamente via `node /app/cli/bin/main.js`, senza il binario
  intermedio `jht`. La sessione tmux, gli agenti, il web, il db restano
  esattamente dove stanno oggi.

Risultato:

- VPS / Linux: `apt install docker.io` + scaricare il wrapper bash + `jht up`.
- Mac / Windows: stesso wrapper (bash su WSL/Git-Bash o equivalente PowerShell).
- Desktop launcher (Phase 2/3): chiama gli stessi `docker compose` / `docker exec`.
  Non serve piu' embeddare Node dentro Electron.

## Il problema

### Due ruoli, un binario

Il CLI `jht` ha sempre avuto due tipi di responsabilita':

| Ruolo                | Cosa fa                                            | Dove deve girare |
|----------------------|----------------------------------------------------|------------------|
| **Lifecycle host**   | `team start/stop`, `container up/down/recreate`, `dashboard`, qualunque cosa chiami `docker compose` o `docker exec` | Sull'**host** — serve accesso al daemon Docker |
| **Operativita'**     | wizard `setup`, modifica DB, scrive config, agents, web :3000, tmux | Dentro al **container** — serve l'ambiente baked nell'immagine |

Sulla macchina di sviluppo del maintainer i due ruoli convivono perche':
- Repo clonato sull'host
- Node 22+ sull'host
- `cli/bin/jht.js` viene eseguito direttamente con Node sull'host
- Quando deve fare `docker exec jht ...`, sta gia' sull'host → parla al daemon → tutto fila

### Cosa scopre l'utente VPS

`install.sh` Docker-mode (riga 284-365 di `scripts/install.sh`) scrive un
wrapper `~/.local/bin/jht` che fa `docker run --rm <image> "$@"` ad ogni
invocazione. Quindi:

```
jht setup        → docker run --rm <image> setup
                   container effimero scrive in /jht_home, esce  ✅
                   (il bind-mount preserva la config in ~/.jht)

jht team start   → docker run --rm <image> team start
                   container effimero parte
                   team.js dentro fa: docker exec jht tmux new-session ...
                                      ▲
                                      └─ ❌ NIENTE binario `docker` dentro al container
                                      └─ ❌ NIENTE socket Docker dell'host montato
```

Il CLI Node, infilato nel container effimero, non puo' piu' parlare al
daemon Docker dell'host. Tutto cio' che e' "lifecycle" si rompe. L'utente
VPS arriva fino a `jht setup`, poi finisce in un cul-de-sac.

Aggravante: `docker-compose.yml` non e' nemmeno baked nell'immagine —
sta solo nel repo. `install.sh` Docker-mode non clona il repo (lo fa
solo `--no-docker`). Quindi anche se il container effimero potesse
parlare al daemon, non avrebbe il file compose da usare.

### Stato attuale: la matrice scomoda

| Path                                | Mac | Win | Linux/VPS | Node host? | Funziona davvero? |
|-------------------------------------|:---:|:---:|:---------:|:-----------|:------------------|
| Desktop launcher                    | ✅  | ✅  | ✅        | **NO** ma Electron embedda un Node nascosto | ✅ |
| `install.sh` Docker-mode            | ✅  | ✅  | ✅        | **NO** in docs                              | ❌ rotto su `team start` |
| `install.sh --no-docker`            | ✅  | ✅  | ✅        | **SI** (`MIN_NODE_MAJOR=22`)                | ✅ ma installa tutto host-side |
| From source / contributors          | ✅  | ✅  | ✅        | **SI** (`git clone` + `npm install`)        | ✅ |

L'unico path "no-Node host" oggi realmente funzionante e' il Desktop
launcher — che pero' richiede una GUI e quindi e' inutile sul VPS.

## Tre soluzioni considerate

### A) Montare `/var/run/docker.sock` nel container effimero

Il container effimero parla al daemon Docker dell'host via socket. Bake
del compose dentro all'immagine e via.

**Pro**: 1 binario, niente wrapper esterno.

**Contro**:
- Il container ottiene root-equivalent sul host: puo' creare altri container,
  montare `/`, escalation completa (e' lo stesso threat model di Portainer
  / Watchtower, ben documentato).
- Per JHT, dove gli agents sono LLM esterni che eseguono codice generato,
  significa "una jailbreak nel prompt = root sull'host dell'utente".
- Inaccettabile col threat model di `docs/security/04-threat-model.md`.

### B) Wrapper bash sottile sull'host + CLI Node solo in-container ⭐

Ridisegno proposto. Dettaglio nelle sezioni successive.

### C) Path attuale `--no-docker`: clonare repo + Node sull'host

Funziona, ma abbandona la promessa "solo Docker, agents isolati nel
container". Inaccettabile come default — resta come "expert mode" per
chi vuole hackerare il source.

**Verdetto**: B.

## Architettura proposta

```
┌──────────────────── HOST (Linux / Mac / Windows / VPS) ─────────────┐
│                                                                     │
│  ~/.local/bin/jht          ← wrapper bash (~80 righe)               │
│   │                                                                 │
│   ├─ jht up | down | restart | recreate | upgrade                   │
│   │     └─→ docker compose -f ~/.jht/runtime/docker-compose.yml ... │
│   │                                                                 │
│   ├─ jht logs | status | shell                                      │
│   │     └─→ docker logs / inspect / exec -it jht bash               │
│   │                                                                 │
│   └─ jht <anything else>                                            │
│         └─→ docker exec -it jht node /app/cli/bin/main.js <args>    │
│                                                                     │
│  ~/.jht/runtime/                                                    │
│   └─ docker-compose.yml    ← scaricato da install.sh                │
│                              (no clone repo, no Node, no Python)    │
│                                                                     │
│  /var/run/docker.sock      ← parlato dal wrapper                    │
│                              MAI montato nel container              │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ docker exec
                                   ▼
┌──────────── CONTAINER `jht` (long-running, restart: unless-stopped) ┐
│                                                                     │
│  /app/cli/bin/main.js     ← CLI Node (ex `cli/bin/jht.js`)          │
│   │                                                                 │
│   └─ wizard, agents, web :3000, db, tmux, sentinella, bridge        │
│                                                                     │
│  Bind-mount:                                                        │
│   ~/.jht                ↔  /jht_home   (config, db, profile)        │
│   ~/Documents/JHT       ↔  /jht_user   (CV, allegati, output)       │
│                                                                     │
│  tmux server: vive qui, agents girano in sessioni tmux locali       │
│  niente `docker exec` interni: il CLI Node e' gia' al posto giusto  │
└─────────────────────────────────────────────────────────────────────┘
```

### Cose che NON ci sono in questo schema

- ❌ Node sull'host
- ❌ Python sull'host
- ❌ tmux sull'host
- ❌ Socket Docker dentro al container
- ❌ Repo clonato sull'host
- ❌ `cli/utils/container-proxy.js` (sparisce: il CLI non deve piu' uscire dal container)

## Esempi concreti — cosa esegue il wrapper

### Lifecycle (parla al daemon Docker dell'host)

| Utente digita    | Wrapper bash esegue                                                | Note |
|------------------|--------------------------------------------------------------------|------|
| `jht up`         | `docker compose -f ~/.jht/runtime/docker-compose.yml up -d`        | Avvia il container `jht`, idempotente |
| `jht down`       | `docker compose -f ... down`                                       | Ferma e rimuove il container |
| `jht restart`    | `docker compose -f ... restart jht`                                | Riavvio rapido |
| `jht recreate`   | `down && up -d`                                                    | Dopo bump immagine |
| `jht upgrade`    | `pull && up -d`                                                    | Update versione |
| `jht logs [-f]`  | `docker logs ... jht`                                              | Bypass del CLI Node |
| `jht status`     | `docker inspect jht --format '{{.State.Status}}'`                  | Bypass del CLI Node |
| `jht shell`      | `docker exec -it jht bash`                                         | Debug power-user |

### Operativita' (delega al CLI Node nel container)

Per tutto cio' che non e' lifecycle, il wrapper fa una sola cosa:

```bash
docker exec -it jht node /app/cli/bin/main.js "$@"
```

Esempi concreti:

| Utente digita           | Wrapper esegue                                                              |
|-------------------------|-----------------------------------------------------------------------------|
| `jht setup`             | `docker exec -it jht node /app/cli/bin/main.js setup`                       |
| `jht team start`        | `docker exec -it jht node /app/cli/bin/main.js team start`                  |
| `jht team status`       | `docker exec -it jht node /app/cli/bin/main.js team status`                 |
| `jht providers add`     | `docker exec -it jht node /app/cli/bin/main.js providers add`               |
| `jht doctor`            | `docker exec -it jht node /app/cli/bin/main.js doctor`                      |
| `jht sentinella status` | `docker exec -it jht node /app/cli/bin/main.js sentinella status`           |

### Auto-up: niente "container non attivo"

Per UX, il wrapper fa auto-up quando l'utente lancia un comando di
operativita' senza aver fatto `jht up` prima:

```bash
# pseudo-snippet del wrapper
if ! docker ps -q -f "name=^jht$" | grep -q .; then
  $COMPOSE up -d
fi
docker exec -it jht node /app/cli/bin/main.js "$@"
```

L'utente non incontra mai l'errore "container 'jht' non attivo": il
wrapper lo avvia da solo se manca.

## Sessione tmux: dove vive, come muore

Cambia poco rispetto a oggi, ma vale chiarirlo.

### Lifecycle

```
Step 1: jht up
   └─ wrapper: docker compose up -d jht
        └─ container `jht` parte
           tmux server NON ancora avviato dentro

Step 2: jht team start
   └─ wrapper: docker exec -it jht node /app/cli/bin/main.js team start
        └─ team.js gira DENTRO al container `jht`
           └─ chiama tmux new-session -d -s capitano  '/app/.launcher/start-agent.sh capitano'
           └─ chiama tmux new-session -d -s scout-1   '/app/.launcher/start-agent.sh scout:1'
           └─ ... una sessione per agente
        └─ tmux server attivo, 8 sessioni live, agents girano

Step 3: jht restart   (oppure crash del container, oppure reboot host)
   └─ container muore → tmux muore → sessioni perse
   └─ container riparte (restart: unless-stopped)
   └─ tmux NON riparte da solo: serve `jht team start` esplicito
```

Lo stato persistente (config, db, sessioni di lavoro tracciate) sopravvive
ai restart perche' sta sui bind-mount. Le **sessioni tmux runtime**
muoiono col container — comportamento corretto, e' uno stato esecuzione
non config.

### Differenza dall'oggi

Oggi `team.js` dice:

```js
// pseudo
spawnSync('docker', ['exec', 'jht', 'tmux', 'new-session', ...])
```

Domani dice:

```js
// pseudo — gia' dentro al container
spawnSync('tmux', ['new-session', ...])
```

`cli/utils/container-proxy.js` (oggi 152 righe) sparisce. Tutti i
chiamanti perdono il prefisso `docker exec jht bash -c ...`.

## Multi-piattaforma

| Piattaforma             | Cosa serve sull'host       | Wrapper                            |
|-------------------------|----------------------------|------------------------------------|
| 🐧 Linux (incluso VPS)  | docker daemon + bash       | `~/.local/bin/jht` (bash)          |
| 🍎 macOS                | docker (Colima o Desktop) + bash | `~/.local/bin/jht` (bash)    |
| 🪟 Windows nativo       | Docker Desktop             | `jht.ps1` (equivalente PowerShell) |
| 🪟 Windows + WSL2       | Docker Desktop con WSL2 backend | `jht` bash dentro WSL         |
| 🖥️ Desktop launcher     | Docker (gestito dal launcher) | Electron chiama gli stessi `docker compose` / `docker exec` (no Node embedded) |

Il wrapper PowerShell e' ~100 righe, mappa 1:1 quello bash. Su Windows con
Git-Bash o WSL2 si puo' usare quello bash (preferito per coerenza con il
resto della docs).

## Cosa cambia in `install.sh`

### Prima (Docker-mode oggi)

```
1. detect OS + pkg manager
2. install docker (apt / brew / colima)
3. docker pull <image>
4. write wrapper: docker run --rm <image> "$@"     ← rotto per lifecycle
5. invita a `jht setup`
```

### Dopo (Docker-mode ridisegnato)

```
1. detect OS + pkg manager
2. install docker
3. mkdir -p ~/.jht/runtime
4. curl -o ~/.jht/runtime/docker-compose.yml \
     https://raw.githubusercontent.com/leopu00/jht/master/docker-compose.yml
5. curl -o ~/.local/bin/jht \
     https://raw.githubusercontent.com/leopu00/jht/master/scripts/jht-wrapper.sh
   chmod +x ~/.local/bin/jht
6. jht up      (compose pull immagine + start container long-running)
7. jht setup   (wizard via docker exec)
```

Niente `docker pull` esplicito (lo fa compose). Niente clone repo.
Wrapper e compose sono versionati nel repo, scaricati raw da GitHub.

### Il `--no-docker` mode resta intatto

Path "expert" per chi vuole girare nativo: clone repo + Node + tmux +
provider CLI manuali. Stessa codepath di oggi. La duplicazione e'
voluta: i due path servono utenti diversi.

## Cosa cambia nel codice del CLI Node

### File che cambiano

| File                                       | Cambio                                                                  |
|--------------------------------------------|--------------------------------------------------------------------------|
| `cli/bin/jht.js`                           | Rinominato in `cli/bin/main.js` (evita confusione col binario host).    |
| `cli/utils/container-proxy.js`             | **Eliminato**. I chiamanti smettono di prefissare con `docker exec jht`. |
| `cli/src/commands/team.js`                 | `tmux ...` direttamente, non piu' via `execInContainer`.                |
| `cli/src/commands/container.js`            | **Spostato sul wrapper bash**. Il sottocomando `container` resta nel CLI Node solo per `status` (read-only). |
| `cli/src/commands/sentinella.js`           | `tmux capture-pane` direttamente.                                       |
| `Dockerfile`                               | Aggiungere alias `jht=node /app/cli/bin/main.js` in `/etc/profile.d/jht.sh` (ergonomia per `jht shell`). |
| `docker-compose.yml`                       | Rimuovere `build:` (image-only per il path utente). Aggiungere `restart: unless-stopped`. Risolvere `${HOME}` cross-platform (vedi Decisione 3). |
| `scripts/install.sh`                       | Vedi sezione precedente.                                                |
| `scripts/jht-wrapper.sh`                   | **Nuovo file** — wrapper bash da scaricare via curl.                    |

### File che NON cambiano

`cli/src/commands/{setup,providers,sentinella,positions,...}.js`,
`shared/skills/`, `agents/`, `web/`, tutto il monitoring V6 — stesso
codice, stesso comportamento. Vivono nel container e basta.

### Path "from source" (Path 4)

Per chi sviluppa, niente cambia funzionalmente: continua a clonare e
girare `node cli/bin/main.js ...` direttamente sull'host (con Node 22+).
La differenza e' che quando fa `team start`, deve aver fatto
`docker compose up -d` separatamente e il CLI host parla via
`docker exec` come oggi. Quindi `container-proxy.js` non sparisce
del tutto: resta come **path code per il dev mode**, mentre il container
ha la versione "tmux locale". Da decidere se vale la pena duplicare la
logica o se il path "from source" usa solo `docker compose exec` per
delegare al container (piu' pulito).

## Decisioni aperte

### 1. Dove si scarica il `docker-compose.yml`?

Tre opzioni:

- **(a) Bake nell'immagine** + `docker compose --project-directory /app`.
  Self-contained, ma require accesso al container per leggere il
  file → uovo-e-gallina (devi avere il container per startare il
  container).
- **(b) Scaricato da `raw.githubusercontent`** in `~/.jht/runtime/`.
  Versionato col repo, fresco a ogni install. Update separato da
  immagine.
- **(c) Generato inline** dall'`install.sh` con heredoc.
  Semplice ma deriva facilmente dalla "verita'" del repo.

**Proposta**: **(b)**. install.sh resta compatto e il compose segue la
versione master. Update: `jht upgrade` fa `docker compose pull` —
opzionale anche refresh del compose se cambiato.

### 2. Cosa fa il `build:` nel `docker-compose.yml`?

Oggi:
```yaml
services:
  jht:
    image: ghcr.io/leopu00/jht:latest
    build:
      context: .
      dockerfile: Dockerfile
```

`context: .` non esiste sul VPS (no repo clonato). Due opzioni:

- **Rimuovere `build:`** dal compose pubblico. Il dev che vuole
  ricostruire l'immagine localmente usa un `docker-compose.dev.yml`
  separato.
- **Lasciare `build:`** ma con `context: .` che fallisce graziosamente
  (compose continua se l'immagine pull e' OK).

**Proposta**: due file. `docker-compose.yml` (utenti, image-only) e
`docker-compose.dev.yml` (dev, con `build:`). Il dev fa
`docker compose -f docker-compose.dev.yml build`.

### 3. `${HOME}` cross-platform nei bind mount

Il compose oggi usa `${HOME}/.jht`. Su Windows + Git-Bash, `${HOME}` =
`/c/Users/<user>` (POSIX). Su WSL2, `${HOME}` = `/home/ubuntu` ma il
docker engine e' di Docker Desktop che lo legge come `\\wsl$\Ubuntu\home\ubuntu`
oppure direttamente da Windows se compose lanciato da PowerShell.
La memoria `feedback_compose_from_windows_shell.md` dice che lanciare
da WSL fa puntare a dir vuote.

Soluzioni:

- **(a)** wrapper bash converte `${HOME}` in path host-correct e lo
  passa via env var (`JHT_HOST_HOME=/c/Users/leone`) → compose usa
  `${JHT_HOST_HOME}/.jht`.
- **(b)** wrapper bash usa volumi nominati Docker invece di bind-mount,
  con un'one-shot copy iniziale dai bind del setup.
- **(c)** rinominare il path utente: invece di `~/Documents/Job Hunter Team/`
  (con spazi, scomodo su VPS root), usare `~/jht-data/` o
  `${JHT_USER_DIR:-$HOME/jht-data}`.

**Proposta**: **(a)** + **(c)**. Path utente con spazi su VPS e' brutto
(diventa `/root/Documents/Job Hunter Team/`) — meglio default
`/root/jht-data/` con override via env. Compatibilita' con installs
esistenti via migrazione one-shot al primo `jht up` post-upgrade.

### 4. Update flow

`jht upgrade` deve fare:
- (a) `docker compose pull` → tira nuova immagine
- (b) `docker compose up -d` → ricrea container con immagine nuova
- (c) opzionale: refresh del `~/.jht/runtime/docker-compose.yml` se cambiato upstream
- (d) opzionale: refresh del wrapper bash stesso se cambiato

Auto-update con `restart: unless-stopped` non serve: il container
riparte solo a crash, non a nuova versione. Per auto-update serve
Watchtower o un cron `jht upgrade` — out of scope v1.

**Proposta**: `jht upgrade` fa (a)(b) sempre e `(c)(d)` solo con flag
`--refresh-config`. L'utente che vuole "tutto fresco" digita
`jht upgrade --refresh-config`.

### 5. `jht setup` first-run: auto-up o esplicito?

Due opzioni:

- **Esplicito**: utente fa `jht up` poi `jht setup`. Coerente con
  `jht down` poi nessun comando funziona.
- **Auto-up**: il wrapper detecta che il container non gira e fa
  `compose up -d` automaticamente prima del `docker exec`.

**Proposta**: **auto-up**. Rimuove un step user-visible ed e' il pattern
di tutti i tool moderni (kubectl, gh, ecc. fanno provisioning lazy).

## Sequenza di implementazione

1. **Spike — wrapper bash funzionante** (~3-4 ore)
   - `scripts/jht-wrapper.sh` (bash, ~80 righe) con tutti i comandi lifecycle
   - test manuale su WSL Ubuntu: `jht up`, `jht setup`, `jht team start`, `jht logs`, `jht down`
   - validare che `docker exec ... node /app/cli/bin/main.js team start` davvero parta tmux nel container

2. **Refactor CLI Node — rimozione `container-proxy.js`** (~1 giorno)
   - rinomina `cli/bin/jht.js` → `cli/bin/main.js`
   - tutti i chiamanti di `execInContainer` / `containerRunning` / `execScriptInContainer` chiamano direttamente i comandi locali (`tmux`, `bash`, ecc.)
   - rimuovere `cli/utils/container-proxy.js`
   - test interno: lanciare l'immagine ricostruita + wrapper e verificare team start, sentinella, web

3. **`install.sh` ridisegno** (~2 ore)
   - Docker-mode: download wrapper + compose, niente clone repo, niente `docker pull` (lo fa compose)
   - `--no-docker`: invariato

4. **Compose dual-file** (~1 ora)
   - `docker-compose.yml`: image-only, `restart: unless-stopped`, default path migration
   - `docker-compose.dev.yml`: con `build:` per dev

5. **Smoke test VPS** (~3 ore — copre [JHT-VPS-VALIDATE] PHASE 1)
   - Hetzner CPX21 (4GB / 3vCPU) — sizing piu' rilassato di CX22 per il primo test
   - `curl install.sh | bash` → `jht up` → `jht setup` → `jht team start`
   - Verifica: container up, tmux 8 sessioni, web :3000 raggiungibile via SSH tunnel
   - Documentare gotcha in `docs/VPS-SETUP.md`

6. **Wrapper PowerShell + Desktop launcher refit** (Phase 2)
   - `jht.ps1` per Windows nativo
   - Electron launcher chiama gli stessi `docker compose` / `docker exec` invece di embeddare Node

## Rischi e mitigazioni

| Rischio                                                      | Mitigazione |
|--------------------------------------------------------------|-------------|
| Refactor `container-proxy.js` rompe path "from source" (Path 4) | Mantenere il proxy come fallback se `IS_CONTAINER` env non e' settata. Il binario decide a runtime se "uscire" o no. |
| `docker exec -it` su comandi non-interattivi (`jht status`)   | Detect `tty -s` nel wrapper e droppare `-it` quando non c'e' terminale. |
| Cambio default path utente rompe installs esistenti          | Migrazione one-shot al primo `jht up` post-upgrade: se `~/Documents/Job Hunter Team/` esiste, mv in `~/jht-data/` con backup. |
| Wrapper bash su Windows nativo non gira                      | Wrapper PowerShell separato (`jht.ps1`). Documentare in quickstart. |

## Architectural payoff

- **Sicurezza**: niente socket Docker nel container → eliminato il
  vettore "jailbreak prompt = root host" del threat model.
- **VPS support**: install.sh diventa funzionante davvero per il path
  "tier 🥉 manuale" di [JHT-VPS-VALIDATE].
- **Launcher leggero**: Phase 2/3 launcher non embedda piu' Node nascosto
  in Electron. La GUI chiama lo stesso wrapper bash / compose.
- **Codice CLI piu' pulito**: rimossi ~150 righe di `container-proxy.js`
  + tutti i prefissi `docker exec jht bash -c '...'` sparsi in `team.js`,
  `sentinella.js`, ecc.
- **Onboarding piu' veloce**: zero clone repo per gli utenti, zero Node
  installato, solo Docker.
- **Test campaign matrix** ([JHT-TEST-CAMPAIGN]): cella "VPS Linux" diventa
  riempibile.

## Riferimenti

- `BACKLOG.md` § PHASE 1 [JHT-VPS-VALIDATE]
- `docs/internal/2026-05-04-vps-deployment-design.md` — design Phase 3 launcher VPS
- `scripts/install.sh` — install attuale (Docker + native paths)
- `cli/utils/container-proxy.js` — codice da eliminare
- `docker-compose.yml` — compose attuale
- `docs/security/04-threat-model.md` — perche' opzione (A) socket-mount e' inaccettabile
