# `[JHT-RUNTIME-PODMAN]` — Podman al posto di Docker: cosa toglie all'utente e cosa costa a noi

**Data:** 2026-08-17 · **Base della misura:** worktree `master` a `dbd6369d6f`
**Stato:** implementazione e runtime E2E passati su host Windows esistente; resta il gate clean-machine · **Decide il direttore**
**ADR:** [`0008-podman-evaluated-behind-a-shim.md`](../../adr/0008-podman-evaluated-behind-a-shim.md) (Proposed)

> 📌 **Perché questo documento esiste.** Il tema era stato deciso una volta, di
> passaggio, dentro un ADR che nel frattempo è stato superato — e da allora non
> aveva più un posto dove vivere. Questo file è quel posto. Non contiene una
> decisione: contiene la misura su cui una decisione si può prendere, e la prova
> che la deciderebbe in mezza giornata.

---

## 1. L'obiettivo, nelle parole di chi lo pone

Togliere Docker perché **è una dipendenza tecnica per utenti non tecnici**, e una
dipendenza tecnica in cima all'imbuto di installazione è utenti persi prima del
primo run.

⚠️ **La risposta breve va detta subito, perché cambia la domanda:** Podman **non
toglie** la dipendenza dal container — la sostituisce. Quello che toglie, su
Windows, è **l'unico passo dell'installazione che oggi non possiamo fare noi**.
Quel passo è precisamente il punto di abbandono, quindi il guadagno è reale; ma
chi si aspetta «niente più dipendenze» resterà deluso, e va saputo prima di
scrivere codice, non dopo.

## 2. Cosa c'era già scritto: niente, e un verdetto orfano

Cercato «podman» in tutto l'albero, su tutti e nove i branch remoti, in tutta la
storia git raggiungibile e nelle issue GitHub. Risultato: **una occorrenza sola**,
in [`docs/adr/0001-colima-not-docker-desktop.md`](../../adr/0001-colima-not-docker-desktop.md):

> **Podman Desktop** — rejected. More fragmented ecosystem on macOS,
> compatibility layer for `docker` CLI not as mature.

- `git log --all -i --grep=podman` → **0 commit** lo nominano nel messaggio.
- `git log --all -i -S'podman'` → **2 commit**, che sono lo stesso commit prima e
  dopo il rewrite dell'11/08 (`91b2ad22c4`, `631ea481d7`, *«docs(adr): add
  Architecture Decision Records folder with 3 initial records»*). La storia
  pre-rewrite è coperta perché `production` sta ancora su quella lineage.
- **0 issue** GitHub, **0 righe** in `BACKLOG.md`.

📌 **Il fatto che conta non è l'assenza, è che il verdetto è orfano.** ADR-0001 è
`Superseded by 0006`, e **ADR-0006 non rivaluta Podman**: la decisione del
2026-04-16 non è né confermata né ridiscussa, è solo rimasta dentro il documento
che è stato superato. Quindi oggi non esiste un rifiuto in vigore da rispettare —
esiste un giudizio scaduto, su una versione di Podman di quattro mesi fa, che
**non va ereditato e non va liquidato: va rimisurato**.

## 3. L'attrito vero, oggi, per sistema

Non è una questione di gusto sul runtime: è che su Windows l'installer arriva a un
passo e si fossilizza. Lo dichiara ADR-0006 fra le conseguenze **accettate**:

> The Docker Desktop path is **not** silently installable (EULA + admin + open the
> GUI once) — same friction we already accept on Windows.

E [`docs/guides/QUICKSTART.md`](../../guides/QUICKSTART.md) descrive cosa facciamo
di conseguenza: *«On Windows: verifies Docker Desktop is running»*. Non lo
avviamo — **controlliamo che l'abbia fatto l'utente**.

| Sistema | Runtime oggi | Cosa deve fare l'utente a mano |
|---|---|---|
| **Windows** (target primario) | Docker Desktop su WSL2 | installare WSL2 (UAC + reboot), **aprire la GUI una volta**, accettare la licenza, tenerla accesa |
| **macOS** | Colima (default) o Docker Desktop, con detect-first | niente, sul percorso Colima: è headless e si installa in silenzio |
| **Linux / VPS** | Docker Engine nativo | niente, ma l'utente finisce nel gruppo `docker`, che equivale a root senza password |

📌 **Il guadagno di Podman è quasi tutto su Windows.** Su macOS abbiamo già un
percorso silenzioso che funziona (Colima), quindi lì si vince solo l'uniformità.
Su Linux si vince il rootless. Su Windows si vince **il passo che oggi non
possiamo automatizzare**, ed è l'unico dei tre che sposta l'imbuto.

## 4. Cosa guadagniamo

1. **Windows: catena di installazione interamente non interattiva.** Il client
   Podman si installa in silenzio (winget / MSI con flag silenzioso) e la macchina
   si crea da riga di comando (`podman machine init --now`). Nessuna licenza da
   accettare, nessuna finestra da aprire una volta, nessun processo nel tray che
   deve restare vivo. È esattamente l'attrito che ADR-0006 dichiara accettato.
2. **La licenza sparisce come argomento.** Docker Desktop richiede un abbonamento
   a pagamento sopra una soglia di dipendenti/fatturato. Per un prodotto open
   source installato da terzi è una clausola che l'utente **eredita da noi**.
   Podman è Apache 2.0 e la clausola non esiste — si allinea con la scelta di
   usare la trasparenza del codice come segnale di fiducia al posto del code
   signing.
3. **Rootless di default.** Su Linux sparisce `usermod -aG docker`. Su un prodotto
   i cui agenti girano con `--dangerously-skip-permissions` *dentro* il container,
   «il container non è root sul tuo host» è un argomento di sicurezza vero, e
   dicibile nella FAQ senza arrotondare verso l'alto.
4. **Un runtime invece di tre.** Oggi manteniamo Colima + Docker Desktop + Engine
   più il detect-first; ADR-0006 elenca *«più rami da mantenere su macOS»* fra i
   costi accettati. Podman li collassa in un modello mentale unico su tre sistemi,
   che è anche un percorso di supporto unico.
5. **Daemonless.** Non c'è un demone di sistema da tenere in piedi.

## 5. Cosa NON guadagniamo — e va deciso sapendolo

1. ⚠️ **WSL2 resta.** La `podman machine` su Windows **è** una distro WSL2. Il
   `wsl --install` con UAC e reboot non sparisce. Se l'obiettivo è «zero
   dipendenze tecniche su Windows», **Podman non ci arriva**: sposta l'attrito da
   due passi manuali a uno.
2. **Su macOS il guadagno è quasi nullo.** Podman machine è una VM come Colima,
   che già installiamo in silenzio. Si vince l'uniformità, non l'attrito.
3. ⚠️ **`restart: unless-stopped` diventa codice nostro.** Podman non ha un demone
   che riavvia i container: servono unit systemd (`podman-restart`, o unit
   generate). Per un team che lavora di notte su VPS **questa non è una riga di
   compose, è lavoro nuovo** — ed è la riga che fa la differenza fra un team che
   riparte e uno che non riparte.
4. **`docker compose` non è la stessa implementazione**, e sono 88 call site:
   Podman delega a un provider compose esterno.
5. **Il giudizio di ADR-0001 potrebbe essere ancora vero.** «Compatibility layer
   non abbastanza maturo» era aprile. Se è ancora vero, la strada A cade e resta
   solo la B, che costa dieci volte tanto.

## 6. Quanto siamo attaccati a Docker — misurato

**Definizione della misura, perché sia riproducibile:** `git grep -o -E 'docker
(compose|exec|run|info|ps|rm|start|stop|cp|pull|build|inspect|version|network|volume|logs|restart|image|kill|attach)\b'`
con `*.md` e `docs/` esclusi. Con un pattern più largo (qualunque parola dopo
`docker`) il totale sale a **461**; i **348** sotto sono quelli che sono
inequivocabilmente comandi.

| Area | Call site | Nota |
|---|---:|---|
| `scripts/` | 157 | installer, wrapper host, host-setup |
| `game/` | 102 | GDScript: è l'app desktop che pilota il container |
| `cli/` | 37 | lifecycle e container-proxy |
| `web/` | 24 | le 4 route che entrano nel container + la copia di `install.sh` |
| `tests/` | 11 | |
| `shared/` | 6 | |
| radice (`docker-compose*.yml`, `Dockerfile`) | 10 | |
| `.launcher/`, `.github/` | 3 | |
| **totale** | **348** | |

**Verbi, per frequenza:** `exec` 146 · `compose` 88 · `info` 26 · `inspect` 15 ·
`stop` 15 · `logs` 14 · `cp` 11 · `ps` 10 · `image` 7 · `version` 5 · `start` 4 ·
`rm` 3.

📌 **Punti di indirezione: ZERO.** Non esiste `DOCKER_BIN`, non esiste
`CONTAINER_RUNTIME`, non esiste un punto unico che decide quale binario invocare.
L'unico interruttore di runtime che abbiamo è `--runtime` in
`scripts/install.sh:103` (e nella sua copia `web/public/install.sh`), accetta
**solo** `colima|docker-desktop` ed è **macOS-only**: non c'è un valore da
aggiungere per un terzo runtime, c'è un concetto da introdurre.

**Il dettaglio che rende praticabile la strada A:** nessuna di queste chiamate
linka una libreria. Il gioco invoca il **nome del binario**, risolto via `PATH`:

- `game/scripts/backend/backend_bus.gd:218` — `OS.execute("docker", ["inspect", …])`
- `game/scripts/backend/local_backend.gd:81` — `OS.create_process("docker", …)`
- `game/scripts/backend/local_backend.gd:133`, `:196` — `OS.execute_with_pipe("docker", …)`

e i due wrapper host nominano `docker` su 62 righe (`scripts/jht-wrapper.sh`) e 48
(`scripts/jht-wrapper.ps1`).

## 7. Le due strade

### A · Shim di compatibilità — *tocca ~0 call site, sposta il rischio a runtime*

Podman espone un `docker` compatibile (pacchetto `podman-docker` + socket). I 348
call site restano invariati perché risolvono un nome via `PATH`.

- ✅ Nessuna modifica al codice, reversibile, provabile su una macchina sola.
- ⚠️ Ogni incompatibilità si manifesta come **guasto a runtime dentro il
  prodotto**, non come errore di build. Il perimetro da provare è tutto il
  lifecycle, non un file.
- ⚠️ È precisamente la maturità che ADR-0001 aveva giudicato insufficiente. La
  strada A **è** la rimisurazione di quel giudizio.

### B · Indirezione esplicita — *tocca 348 call site, sposta il rischio a design*

Un punto unico che decide il binario, più `--runtime` estesa a un terzo valore.

- ✅ Il runtime diventa configurazione dichiarata, con un test di parità possibile
  — la stessa forma che il repo già usa per i provider (ADR-0007).
- ⚠️ Il grosso del lavoro è in `scripts/` (157) e in `game/` (102, GDScript),
  cioè **fuori dal perimetro dove i test girano oggi**.
- 📌 Serve comunque, il giorno in cui si vuole *più di un* runtime invece di *un
  runtime diverso*. È la differenza fra le due domande della sezione 10.

## 8. I punti del compose che decidono l'esito

Letti da [`docker-compose.yml`](../../../docker-compose.yml). Questa era la lista
di rischio iniziale; l'esito runtime misurato è riportato al §12.

| Punto | Perché può mordere |
|---|---|
| `extra_hosts: host.docker.internal:host-gateway` | Serve allo spike Scorer per raggiungere Ollama sull'host. Podman ha un nome proprio (`host.containers.internal`) e il supporto di `host-gateway` dipende dalla versione. |
| Rootless e proprietà dei file sui bind | I due bind sono `~/.jht` → `/jht_home` e `~/Documents/Job Hunter Team` → `/jht_user`, con `HOME=/jht_home`. In rootless la mappatura degli UID cambia **chi possiede i file che scrivono gli agenti**: è il punto in cui un errore diventa dati dell'utente illeggibili. |
| `docker compose`, 88 volte | Implementazione diversa, delegata a un provider esterno. |
| `restart: unless-stopped` | Vedi §5.3: su Podman è systemd, non il demone. |
| Windows, che è il target primario | `podman machine` è WSL2: cambia la traduzione dei percorsi `${HOME}` nei bind — lo stesso punto per cui il compose va lanciato dalla shell Windows e non da WSL. |
| Volumi con nome (`jht-deps`, `jht-runtime-mask`), `stdin_open`/`tty`, immagine GHCR pinnata per digest | Forme standard, nessun motivo noto di divergenza. Da riverificare comunque l'attestazione sha in `.runtime-integrity` e `docker exec -it jht tmux attach`, che è la via con cui si guarda un pane. |

## 9. La prova che decide, e il vincolo che oggi la blocca

**La prova:** una macchina Windows pulita, e la catena completa **senza un solo
passo interattivo** fino a `jht team start`, con il solo shim `docker` → `podman`
e **zero modifiche** ai 348 call site. Se regge, il resto è manutenzione e la
strada A è la risposta. Se cade, cade lì — e lo sappiamo in mezza giornata invece
che dopo aver riscritto `scripts/` e il GDScript.

Il vincolo iniziale era l'assenza del banco Windows. La prova è poi stata eseguita
su un host Windows esistente; resta da ripeterla su un account/macchina puliti
prima di pubblicare Podman come default.

## 10. La domanda per il direttore, che decide tutto il resto

**Sostituire Docker, o supportare anche Podman?**

- *Sostituire* è una strada A con un interruttore, ed è coerente con l'obiettivo
  di togliere attrito: un solo runtime, un solo percorso di supporto.
- *Supportare anche* è una strada B, e oggi **non è nemmeno esprimibile**: senza
  indirezione non esiste un posto dove la scelta possa vivere.

Le due risposte non differiscono per costo del 20%: differiscono per quale lavoro
si fa prima. Per questo la riga resta aperta e l'ADR resta `Proposed`.

## 11. Aggiornamento operativo 2026-08-20 — il probe è eseguibile

Ora esiste [`scripts/podman-windows-probe.ps1`](../../../scripts/podman-windows-probe.ps1).
Il probe non introduce un runtime switch nel prodotto e non modifica i call site:
compila in una directory temporanea un vero `docker.exe` che inoltra gli argomenti
a `podman.exe`. È un eseguibile, non un alias PowerShell, quindi misura anche la
forma richiesta da `OS.execute("docker", …)` in Godot.

Su Windows il percorso misurato è:

1. Podman CLI (`Podman.CLI` da winget; lo scope è scelto dal manifest applicabile);
2. macchina WSL rootless dedicata (`jht-podman-probe`);
3. provider Compose standalone (`Docker.DockerCompose` da winget);
4. `docker.exe` temporaneo → `podman.exe` → provider Compose;
5. il `docker-compose.yml` di produzione, con HOME e directory utente isolate.

Preflight, senza installare pacchetti né creare macchine:

```powershell
pwsh -File scripts/podman-windows-probe.ps1 -PreflightOnly
```

Prima esecuzione esplicita, con installazione silenziosa e creazione macchina:

```powershell
pwsh -File scripts/podman-windows-probe.ps1 -InstallDependencies -InitializeMachine
```

Il secondo comando verifica `info`, `compose version`, `compose config`, avvio
dell'immagine JHT pinnata, bind mount in entrambe le direzioni, risoluzione di
`host.docker.internal`, volumi nominati e restart. Il container e i volumi del
probe vengono rimossi anche in caso di errore; pacchetti e macchina restano
installati intenzionalmente. Una macchina che contiene già un container `jht`
viene rifiutata, per non sovrascrivere un ambiente reale.

I test automatici compilano davvero lo shim sia con Windows PowerShell 5.1 sia
con PowerShell 7 e verificano che l'exit code del backend venga propagato.

## 12. Esito E2E 2026-08-20 — runtime e agenti passati

La parte che al §9 era indicata come non dimostrabile è stata eseguita su un host
Windows reale, anche se non ancora su un account pulito:

- Podman CLI 6.0.2, macchina WSL rootless, Compose standalone 5.1.2;
- immagine production pullata per digest e immagine della branch costruita con
  `podman build --network host`;
- lifecycle Compose `config/up/restart/down`, bind bidirezionali e named volume;
- proxy HTTP/CONNECT localhost persistente via systemd e connettore Windows nativo;
- API rootless `cgroupfs` e lifecycle container in servizi system-level, così il
  runtime non dipende dal `user@1000.service` condiviso tra distribuzioni WSL;
- stop/start della sola Podman machine con PID1 `shutdown complete`, exit 0,
  ripartenza automatica del container e ripristino watchdog dei quattro core;
- override `network_mode: host` per evitare il guasto nftables di Netavark sulla
  custom bridge e `keep-id:uid=1001,gid=1001` per i bind owner-only;
- repair recuperabile dei metadati UID lasciati dal precedente runtime Docker;
- wrapper installato con shim, override, runtime marker e machine marker tutti
  inclusi nella `.runtime-integrity` SHA-256;
- quattro agenti core visibili da `jht team status`: ASSISTENTE, CAPITANO, MENTOR,
  SENTINELLA.

La prova Codex ha coperto entrambe le classi di modello. I processi reali erano:

```text
codex --yolo --model gpt-5.6-terra -c model_reasoning_effort=high
codex --yolo --model gpt-5.6-sol   -c model_reasoning_effort=high
```

Assistente/Terra ha risposto `PODMAN-TERRA-FINAL-OK`; Capitano/Sol ha risposto
`PODMAN-SOL-FINAL-OK` dopo il reboot finale. Questo chiude sia l'avvio della TUI
sia l'uscita HTTPS e il giro di risposta del provider, non soltanto la presenza
del processo.

Per convertire un'installazione Windows esistente dalla working copy:

```powershell
pwsh -File scripts/enable-podman-windows-runtime.ps1 `
  -MachineName jht-podman -InstallDependencies -InitializeMachine
```

Il comando conserva backup recuperabili quando deve normalizzare metadata DrvFS.
Il solo punto ancora aperto prima della pubblicazione come default è ripetere la
stessa catena su macchina/account Windows puliti. Non restano incompatibilità
runtime note sul percorso misurato.
