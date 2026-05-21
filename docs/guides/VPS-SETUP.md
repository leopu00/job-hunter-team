# VPS setup — JHT su Hetzner Cloud

Guida passo-passo per deployare Job Hunter Team su un VPS Hetzner Cloud
(Ubuntu 24.04 LTS). Validato end-to-end il **2026-05-06** sul tier
**CPX22** (€9.75/mo: 4 GB RAM / 2 vCPU AMD EPYC / 80 GB SSD, Helsinki).

> ⚠️ **Modalita' tech-only / manuale.** Questo documento descrive il path
> 🥉 "tier tech user": SSH manuale + `curl install.sh | bash`. La modalita'
> 🥇 "wizard non-tech" via desktop launcher e' tracciata in
> [`BACKLOG.md`](../../BACKLOG.md) come `[JHT-VPS-FRIENDLY]` (PHASE 3).
> Per un confronto onesto tra le 3 modalita' di esecuzione (PC locale /
> PC dedicato / VPS) → [`docs/guides/VPS-COMPARISON.md`](VPS-COMPARISON.md)
> *(in attesa di scrittura — `[JHT-VPS-COMPARISON-DOC]`)*.

## Riferimenti di design

- `docs/internal/vps.md` — design consolidato VPS (3 tier deployment, split CLI host/container, confronto provider, install UX, lifecycle)
- `docs/internal/bot-telegram.md` — bot Telegram multi-agente + ingest documenti

## TL;DR

```bash
# 1. Provisiona VPS Hetzner CPX22 con SSH key, Ubuntu 24.04.
ssh -i ~/.ssh/jht_key root@<VPS_IP>

# 2. Sul VPS:
curl -fsSL https://jobhunterteam.ai/install.sh | bash      # 4 step, ~1 min
exec bash -l                                                # raccoglie /etc/profile.d/jht.sh
jht up                                                      # pull image + start
jht setup --non-interactive --provider claude \
  --auth-method subscription --subscription-email tu@example.com --skip-health
jht providers update claude                                 # installa CLI provider
docker exec -it jht claude                                  # OAuth device flow Anthropic → /login
jht cloud login                                             # browser pairing VPS↔account web (consigliato)
jht team start                                              # avvia tmux Capitano
jht team status                                             # verify
```

Vedere i risultati sulla dashboard cloud:

```
Browser sul tuo PC → https://jobhunterteam.ai/positions
   (sei gia' loggato dopo `jht cloud login` — i dati appaiono
    dopo che il team ha trovato i primi job + auto-push)
```

## Step-by-step

### 1. Provisiona la VPS

Su [console.hetzner.com](https://console.hetzner.com):

- **Project**: `jht` (crea nuovo, evita Default)
- **Type**: Shared vCPU → **Regular Performance** → x86 (AMD) → **CPX22**
  - 4 GB RAM, 2 vCPU AMD EPYC, 80 GB SSD, €9.75/mo
- **Location**: Falkenstein o Helsinki (EU GDPR)
- **Image**: Ubuntu 24.04
- **SSH Keys**: carica una chiave dedicata a JHT (non riusare quella personale).
  Se non ne hai una:
  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/jht_hetzner -C "jht-vps"
  cat ~/.ssh/jht_hetzner.pub  # copia in Hetzner
  ```
- **Volumes / Firewalls / Backups**: skip per il primo test
- **Cloud config**: **lascia vuoto** (NO custom user-data)
- **Name**: `jht-test` (o quello che vuoi)
- Click **Create & Buy now**

Hetzner ti mostra l'IP IPv4. Annotalo.

### 2. SSH al VPS

Da PowerShell o Git-Bash sul tuo PC:

```bash
ssh -i ~/.ssh/jht_hetzner root@<VPS_IP>
# inserisci passphrase chiave
```

Verifica fingerprint host (anti-MITM):

```bash
# Dal tuo PC PRIMA del primo SSH:
ssh-keyscan -t ed25519 <VPS_IP> | ssh-keygen -lf -
```

Confronta il `SHA256:...` con quello mostrato nella console Hetzner (dettagli server → "Host key fingerprints").

### 3. (Opzionale ma consigliato) Aggiungi swap

Hetzner non configura swap di default. Con 8 agents JHT, picchi RAM
possono triggerare OOM kill. **2 GB di swap preventivo** salva la giornata:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h    # verifica: Swap: 2.0Gi
```

### 4. Installa JHT (one-liner)

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash
```

Il flow Docker-mode esegue 4 step:

1. **Rilevamento sistema** (Ubuntu 24.04 / apt)
2. **Container runtime** — `apt install docker.io docker-compose-v2`
3. **Verifica docker** (`docker info`)
4. **Download wrapper + compose** — scarica:
   - `~/.jht/runtime/docker-compose.yml`
   - `~/.local/bin/jht` (~165 LOC bash dispatcher)

Output finale:
```
══════════════════════════════════════════
  Installazione completata!
══════════════════════════════════════════
  Modalita' container attiva.
  Prossimi passi:
      jht up
      jht setup
```

> 💡 **Niente Node, Python, tmux sull'host VPS.** Solo `docker` +
> `bash` + il wrapper. Tutto il resto sta dentro al container `jht`.
>
> Se `jht` non e' nel PATH, il path completo e' `~/.local/bin/jht`.
> Aggiungi al `.bashrc`:
> ```bash
> echo 'export PATH="$PATH:$HOME/.local/bin"' >> ~/.bashrc
> source ~/.bashrc
> ```

### 5. `jht up` — pull immagine + start container

```bash
jht up
```

Output: `docker compose up -d` pulla l'immagine `ghcr.io/leopu00/jht:latest`
(~750 MB, ~30s su Hetzner mirror) e avvia il container `jht` long-running
con `restart: unless-stopped`. Il wrapper esegue automaticamente
`chown -R 1001:1001 ~/.jht ~/Documents/Job\ Hunter\ Team/` per allineare
i bind-mount al uid del container (`jht` user = 1001).

Verifica:

```bash
jht status            # name=/jht status=running
docker ps             # jht ... 127.0.0.1:3000->3000/tcp
free -h               # ~1 GB used dopo Next.js boot
jht logs --tail 10    # "Dashboard avviata su http://localhost:3000"
```

### 6. `jht setup` — config provider

> ⚠️ **Sul VPS usa sempre `--non-interactive`.** Il wizard interattivo
> (clack/prompts) ha un bug TTY noto via `docker exec -it`: le frecce ↑↓
> arrivano come testo letterale `^[[A` invece di essere intercettate.
> Tracciato come [BUG-CLACK-TTY-DOCKER-EXEC] nel BACKLOG. Workaround:
> tutti i flag CLI esistono, niente bisogno del wizard.

Per Claude Max (subscription):

```bash
jht setup --non-interactive \
  --provider claude \
  --auth-method subscription \
  --subscription-email tu@example.com \
  --skip-health
```

Per Codex Plus/Pro:

```bash
jht setup --non-interactive \
  --provider openai \
  --auth-method subscription \
  --subscription-email tu@example.com \
  --skip-health
```

Per Kimi:

```bash
jht setup --non-interactive \
  --provider kimi \
  --auth-method subscription \
  --subscription-email tu@example.com \
  --skip-health
```

Per API key (alternativa "metered" pay-per-use, non raccomandato — vedi
ADR-0004):

```bash
jht setup --non-interactive \
  --provider claude \
  --auth-method api_key \
  --api-key sk-ant-api03-... \
  --skip-health
```

Il config viene salvato in `~/.jht/jht.config.json`. Verifica:

```bash
cat ~/.jht/jht.config.json
jht doctor   # deve mostrare "Provider: claude"
```

### 7. `jht providers update` — installa il CLI provider nel container

```bash
jht providers update claude   # oppure: codex, kimi
```

Cosa fa: dentro al container, esegue `npm install -g @anthropic-ai/claude-code@latest`
in `/jht_home/.npm-global/` (bind-mounted). Persistente cross-restart.

> Per Codex: stesso comando, installa `@openai/codex@latest`.
>
> Per Kimi: usa `uv tool install kimi-cli` (via `pip3 install --user --break-system-packages uv` come bootstrap).

Verifica:

```bash
jht providers   # mostra "claude [ATTIVO] — modello: claude-sonnet-4-6"
                # CLI: 2.1.x   ← versione installata
```

### 8. Login OAuth provider — device flow

```bash
docker exec -it jht claude
```

Claude Code parte. Al primo run avvia OAuth device flow e mostra un URL +
codice tipo:

```
Apri questo URL nel browser:
https://claude.ai/oauth/device?code=ABCD-EFGH
```

**Apri l'URL nel browser sul TUO PC** (non sul VPS, che non ha browser
GUI), accedi col tuo account Claude Max, conferma il code. Claude Code
conferma "authenticated".

Se non parte automaticamente, dentro al prompt Claude digita `/login`.

Esci con `/quit` o `Ctrl+C` due volte.

> 💡 Il login OAuth scrive in `~/.claude/` dentro al container, che e'
> bind-mountato a `~/.jht/.claude/` sull'host VPS. Il login persiste
> cross-restart e cross-rebuild.

### 9. `jht cloud login` — collega VPS all'account web

> 💡 Senza questo step, i job trovati dal team restano SOLO sul VPS.
> Per vederli sulla dashboard `jobhunterteam.ai/positions` (o per
> backup), serve abilitare il cloud sync. Il pairing va fatto **una
> volta sola**: il token resta salvato in `~/.jht/cloud.json`.

```bash
jht cloud login
```

Il CLI mostra:

```
Apri questo URL nel browser:
  https://jobhunterteam.ai/cli-link

Codice da digitare:
  ABCD-1234

Aspetto la tua conferma… (TTL ~10 min, polling ogni 2s)
```

**Sul tuo PC** apri l'URL nel browser. Se non sei loggato, fai login con
Google o GitHub. Digita il codice mostrato dal CLI (es. `ABCD-1234`),
conferma. Il CLI sul VPS si sblocca automaticamente:

```
✓ Pairing completato
  Base URL:   https://jobhunterteam.ai
  Token name: cli-2026-05-08
  User ID:    <uuid>

Sincronizzo i dati locali al cloud...
✓ Push completato
  positions:    0 upserted   ← il team non ha ancora cercato
  scores:       0 upserted
  applications: 0 upserted
```

> 🔐 **Privacy**: il token vive solo dentro al VPS (`~/.jht/cloud.json`,
> mode 0600). Non viene MAI esposto in chiaro al di fuori del CLI →
> server (HTTPS). Puoi revocarlo da [`/settings/cloud-sync`](https://jobhunterteam.ai/settings/cloud-sync).

> 🛠 **Opzioni avanzate:**
> - `jht cloud login --name vps-marco` — suggerisce un nome al token (visibile sul web)
> - `jht cloud login --no-push` — skip push iniziale (CI/scripts)
> - `jht cloud enable --token jht_sync_xxx` — alternativa con paste manuale del token

> 🌍 **Self-hosting cloud** (per chi vuole eseguire la dashboard su un
> proprio dominio): `jht cloud login --url https://my-domain.com`. La
> dashboard deve essere deployata con le 3 routes API
> (`/api/cloud-sync/{device-init,device-poll,device-confirm}`) +
> migration `008_cloud_sync_pairing.sql` applicata.

### 10. `jht team start` — avvia gli agenti

```bash
jht team start
```

Output:
```
Avvio agenti nel container jht...
  Mode: default
  ✓ CAPITANO avviato
Risultato: 1 avviati, 0 gia attivi
  Il Capitano scalera gli altri agenti secondo le sue soglie.
```

Il **Capitano** parte da solo. **Bridge / Sentinella** lo monitorano e
scalano `Scout`, `Analista`, `Scorer`, `Scrittore`, `Critico` quando
serve, secondo budget tokens dell'subscription provider.

Verifica:

```bash
jht team status        # 1+ agenti "container jht"
jht sentinella tail    # follow live monitoring
```

### 11. Dashboard cloud — `https://jobhunterteam.ai/positions`

Dopo `jht cloud login` (step 9) i dati del team vengono pushati sulla
dashboard cloud. Sul **tuo PC**:

```
Browser → https://jobhunterteam.ai
   (sei gia' loggato dal pairing)
   ↓
   /positions  → tabella job trovati per te (filtri stack, score, status)
   /team       → organogramma agenti + chat per ognuno
   /sentinella → grafici token usage real-time
   /settings/cloud-sync → gestisci/revoca i token
```

**Quando aggiornare i dati cloud**: `jht cloud login` fa auto-push una
volta sola (al pairing). Per push successivi:

```bash
jht cloud push                       # one-shot manuale
jht cron add cloud-push '*/15 * * * *'   # ogni 15min (auto-sync)
```

> 💡 La dashboard cloud è la via consigliata. Il push è **local→cloud
> only**: i tuoi log/agent state restano sul VPS, solo positions/scores/
> applications vengono sincronizzate.

### 12. (Avanzato) Web UI direttamente sul VPS via SSH tunnel

> ⚠️ **Path tech-only.** La dashboard prod (`jobhunterteam.ai`) è la
> raccomandata. Questo path serve solo per debug del backend Next.js
> locale al VPS, o per ambienti completamente offline.

La dashboard Next.js gira su `127.0.0.1:3000` del VPS — **non esposta in
rete**. Apri un secondo terminale sul tuo PC con SSH tunnel:

```bash
ssh -i ~/.ssh/jht_hetzner -L 3000:localhost:3000 root@<VPS_IP>
```

Browser → **http://localhost:3000**.

> ⚠️ **Auth Supabase via tunnel SSH** — l'OAuth callback è configurato
> per `jobhunterteam.ai/auth/callback`, non per `localhost`. Le pagine
> pubbliche funzionano, le protette redirigono a prod. Tracciato come
> `[BUG-VPS-AUTH-TUNNEL]`. **Per usarla via tunnel** serve aggiungere
> `http://localhost:3000/**` agli additional redirect URLs nel
> dashboard Supabase project.

## Lifecycle e shutdown

Hetzner ha una **trappola di billing**: server "powered off" continuano
a fatturare. Per fermare la fattura serve `delete server` o snapshot+delete.

| Comando                       | Cosa fa                               | Costo                          | Riprendi              |
|-------------------------------|---------------------------------------|--------------------------------|-----------------------|
| `jht team stop --all`         | Ferma agents, container resta up      | €9.75/mo (VPS allocata)        | 1s, `team start`     |
| `jht down`                    | Stop + remove container, VPS up       | €9.75/mo                       | 5s, `jht up`          |
| Hetzner snapshot + delete     | Backup snapshot, distruzione VPS      | ~€0.10/mo (solo storage)       | 90s, ricrea VPS       |
| Hetzner delete server         | Distruzione totale, dati persi        | €0                             | from-scratch          |

> ⚠️ **Spegnere via Hetzner ("power off") NON ferma la fattura.** Le
> risorse restano allocate. Per pause vere → snapshot + delete.

## Update

Image:

```bash
jht upgrade   # docker compose pull + up -d
```

Wrapper + compose (in caso di nuova versione):

```bash
curl -fsSL https://raw.githubusercontent.com/leopu00/job-hunter-team/master/scripts/jht-wrapper.sh -o ~/.local/bin/jht
chmod +x ~/.local/bin/jht
curl -fsSL https://raw.githubusercontent.com/leopu00/job-hunter-team/master/docker-compose.yml -o ~/.jht/runtime/docker-compose.yml
```

## Override avanzati

Tutti via env var:

| Var                 | Default                                          | Uso                                            |
|---------------------|--------------------------------------------------|------------------------------------------------|
| `JHT_IMAGE`         | `ghcr.io/leopu00/jht:latest`                     | Test branch immagini (`:dev-1`, `:v1.0.0`, …)  |
| `JHT_RUNTIME_DIR`   | `~/.jht/runtime`                                 | Path compose                                   |
| `JHT_COMPOSE_FILE`  | `$JHT_RUNTIME_DIR/docker-compose.yml`            | Override compose specifico                     |
| `JHT_CONTAINER_NAME`| `jht`                                            | Multi-istanza (sconsigliato)                   |
| `JHT_BIND_OWNER`    | `1001:1001`                                      | Override uid/gid bind dir (Linux only)         |
| `JHT_NODE_ENTRY`    | `/app/cli/bin/jht.js`                            | Path interno CLI Node                          |

Esempio: testare immagine `dev-1` invece di `latest`:

```bash
export JHT_IMAGE=ghcr.io/leopu00/jht:dev-1
jht upgrade
```

## Troubleshooting / gotcha

### `docker compose: unknown shorthand flag: 'f'`

Su Ubuntu 24.04, `apt install docker.io` NON installa il plugin
`docker compose` v2 di default. `install.sh` aggiorna automaticamente
con `apt install docker-compose-v2`. Se per qualche motivo manca:

```bash
apt install -y docker-compose-v2
docker compose version
```

### `EACCES: permission denied, open '/jht_home/jht.config.json'`

Bind dir owned by root (uid 0) ma container gira come uid 1001. Il
wrapper esegue auto-`chown` su `up`/`upgrade`, ma se hai modificato
manualmente i path:

```bash
chown -R 1001:1001 ~/.jht ~/Documents/Job\ Hunter\ Team
```

### Wizard `jht setup` (interattivo) non riceve frecce, mostra `^[[A`

Bug TTY clack tramite `docker exec -it`. Workaround: usa
`--non-interactive` con tutti i flag.

### `jht providers update` errore "docker-compose.yml non trovato"

Comando lanciato fuori dal container. Su VPS gira **dentro** al
container (path automatico via env IS_CONTAINER=1, settato dal compose).
Se ancora fallisce, verifica:

```bash
docker exec jht env | grep IS_CONTAINER   # deve mostrare =1
```

### Hydration error JSON-LD nonce nella landing

Bug pre-esistente `[BUG-CSP-JSONLD-LANDING]` (server-rendered nonce ≠
client). Cosmetico, non blocca login. Vedi BACKLOG.

### Web UI auth non funziona via SSH tunnel `localhost:3000`

Supabase OAuth callback configurato solo per dominio prod. Workaround:
usa CLI / Telegram per gestire il team. Fix futuro: aggiungere
`http://localhost:3000` agli additional redirect URLs nel Supabase project.

### SSH `Permission denied (publickey,password)` con chiave che dovrebbe matchare

Fingerprint locale = fingerprint Hetzner ma OpenSSH rifiuta. Verifica
se la private key è cifrata con passphrase:

```bash
ssh-keygen -y -f ~/.ssh/<your-key>
# Se chiede passphrase → la key è encrypted
```

In `BatchMode=yes` (script + automazione) OpenSSH non può decifrarla →
genera signature invalida → server rigetta. Soluzioni:

- Aggiungi la key a `ssh-agent`: `eval $(ssh-agent) && ssh-add ~/.ssh/<key>`
- Oppure genera una key effimera senza passphrase per l'automazione:
  ```bash
  ssh-keygen -t ed25519 -N "" -f ~/.ssh/jht_ephemeral
  hcloud ssh-key create --name jht-ephemeral --public-key-from-file ~/.ssh/jht_ephemeral.pub
  ```

### Hetzner crea VPS ma la SSH key non risulta iniettata

Sintomo: `hcloud server create --ssh-key <name>` ritorna OK ma SSH chiede
password (e nell'output di create vedi `Root password: ...`). Causa
tipica: il token API ha permessi limitati anche se la UI mostra i badge
"Read+Write".

```bash
# Verifica scope del token corrente:
hcloud ssh-key list   # se vuoto/errato, il token non ha scope SSH
```

Genera un nuovo token con scope full Read+Write esplicito da
`console.hetzner.com/projects/<id>/security/tokens`. Cloud-init
`user_data` come fallback **non è affidabile** per l'injection chiave
su Hetzner Ubuntu 24.04 — affidati solo a `--ssh-key` / `ssh_keys` array.

## Costi mensili

| Voce                              | €/mo  |
|-----------------------------------|-------|
| Hetzner CPX22 (4 GB / 2 vCPU)     | 9.75  |
| (opt) Snapshot backup ~10 GB      | 0.12  |
| Provider AI (Claude Max x20)      | ~200  |
| **Total VPS infra**               | **~10**|
| **Total con subscription**        | **~210**|

VPS infra costa ~5% del budget. La subscription provider e' il driver
principale.

## Storia validation

[JHT-VPS-VALIDATE] chiuso il 2026-05-06 con primo bring-up end-to-end.
Bug trovati durante il bring-up e committati su `dev-1`:

| Commit       | Fix                                                                                  |
|--------------|--------------------------------------------------------------------------------------|
| `3f7cfb71`   | Wrapper bash + container-proxy passthrough IS_CONTAINER                              |
| `fee1d685`   | install.sh ridisegnato (download invece di generare wrapper inline) + compose split  |
| `c7e29cb6`   | Docs aggiornati per host/container split                                             |
| `121c6ea3`   | Research VPS providers 2026                                                          |
| `11900977`   | install.sh aggiunge `docker-compose-v2`                                              |
| `86c08174`   | `setup --non-interactive --subscription-email`                                       |
| `4b10a9db`   | `JHT_IMAGE` override env var nel compose                                             |
| `f5df9545`   | Traccia `[BUG-CLACK-TTY-DOCKER-EXEC]`                                                |
| `cb5b9bab`   | `providers update` IS_CONTAINER + `ensure_bind_owner` chown 1001                     |

Per il merge dev-1 → master quando i fix sono validati su VPS reale,
e la successiva pubblicazione `latest` su GHCR.
