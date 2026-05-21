# 2026-05-21 — VPS bootstrap bugs FIXED & VALIDATED su VPS fresh

## TL;DR

I 3 bug bloccanti dello startup VPS documentati il 2026-05-20 (`docs/internal/2026-05-20-vps-bootstrap-bugs.md`) sono stati **risolti e validati end-to-end** su una VPS Hetzner CPX22 vergine il 2026-05-21.

- Commit fix: `79f63324` su `master`
- Image GHCR aggiornata: `ghcr.io/leopu00/jht:latest` (build CI `26235170426`)
- VPS test: `jht-vps-test` su Hetzner fsn1, IP `49.13.5.51` (Ubuntu 24.04, CPX22 4GB)
- Provider testato: Codex (gpt-5.5 high), subscription OAuth ChatGPT
- Esito: **7 agenti su 7 partiti senza intervento manuale**

## Cosa è stato fixato

### Fix #1 — alias `codex` come provider in `start-agent.sh`

**File:** `.launcher/start-agent.sh:367`

```diff
-  openai)
+  openai|codex)
     CLI_BIN="codex"
```

**Effetto:** quando il wizard desktop scrive `active_provider: "codex"` raw nel `jht.config.json` (vedi VPS1 backup pre-patch), `start-agent.sh` non cade più nel `*` (fallback claude) ma mappa correttamente a `CLI_BIN=codex`. Allineato col pattern degli altri provider (`anthropic|claude`, `kimi|moonshot`).

### Fix #2 — pre-popolazione `trust_level="trusted"` in `~/.codex/config.toml`

**File:** `.launcher/start-agent.sh:480-501` (nuovo blocco subito dopo `mkdir -p "$AGENT_DIR/tools" "$AGENT_DIR/tmp"`)

```bash
if [ "$CLI_BIN" = "codex" ]; then
  CODEX_CONFIG_FILE="${JHT_HOME:-/jht_home}/.codex/config.toml"
  mkdir -p "$(dirname "$CODEX_CONFIG_FILE")"
  touch "$CODEX_CONFIG_FILE"
  TRUST_KEY="[projects.\"$AGENT_DIR\"]"
  if ! grep -qF "$TRUST_KEY" "$CODEX_CONFIG_FILE"; then
    printf '\n%s\ntrust_level = "trusted"\n' "$TRUST_KEY" >> "$CODEX_CONFIG_FILE"
  fi
fi
```

**Effetto:** Codex CLI mostrava al primo avvio in ogni nuova cwd il prompt blocking "Do you trust the contents of this directory?". Dentro `tmux new -s NAME 'codex ...'` il prompt restava in attesa, dopo qualche secondo codex usciva silenziosamente → pane tmux tornava a bash → i messaggi successivi venivano interpretati come comandi shell (`command not found`).

L'approccio scelto è **just-in-time per-agente** invece di pre-popolare in pid1 al boot: il fix conosce esattamente la `$AGENT_DIR` dell'agente che sta partendo, è idempotente (`grep -F`), e funziona anche per gli scout/analista/scrittore/critico spawnati on-demand dal Capitano che pid1 non vedrebbe.

### Fix #3 — `jht migrate` auto-eseguito al boot pid1

**File:** `cli/src/commands/pid1.js` (nuova funzione `runMigrate()` chiamata come primo step di `dispatch()`)

```javascript
async function runMigrate() {
  try { await access(JHT_CONFIG_PATH); }
  catch { return; } // No config yet: niente da migrare
  pid1Log('running jht migrate (idempotente)');
  await new Promise((resolve) => {
    const child = spawnLabeled('migrate', process.execPath, [JHT_ENTRY, 'migrate']);
    child.on('exit', (code) => {
      if (code === 0) pid1Log('jht migrate ok');
      else pid1Log(`jht migrate exit ${code} — proseguo, retry manuale via 'jht migrate'`);
      resolve();
    });
    child.on('error', (err) => { pid1Log(`jht migrate spawn error: ${err.message}`); resolve(); });
  });
}
```

**Effetto:** il wizard desktop scrive `jht.config.json` in formato v1; senza migrazione i campi v2-v4 (`providers` strutturato, `agents.list`, `notifications`, `analytics`) restano assenti e comandi downstream cadono nei default silenziosi. `jht migrate` è già non-interattivo + idempotente: se la config è al massimo, exit pulito con "Nessuna migrazione necessaria".

Best-effort: un fallimento qui non blocca pid1, l'utente può rieseguire `jht migrate` manualmente.

## Validazione end-to-end

### Flow di test

1. `git push origin master` con i 3 fix → CI `docker.yml` builda nuova image `:latest`
2. `hcloud server create --name jht-vps-test --type cpx22 --image ubuntu-24.04 --ssh-key <ID> --location fsn1`
3. SSH al VPS, `curl install.sh | bash` Docker-mode
4. `jht up` → pull image, container `jht` su
5. `jht setup --non-interactive --provider openai --auth-method subscription --subscription-email ...`
6. `docker restart jht` → trigger Fix #3 auto-migrate
7. `jht providers update codex` → `npm install -g @openai/codex@latest`
8. `codex login --device-auth` → OAuth ChatGPT (utente interattivo da browser)
9. `jht team start` → spawn 7 agenti (assistente, capitano, mentor, sentinella + bridge/token-meter/tg-bridge)
10. `sed "openai" → "codex"` in jht.config.json + `docker restart jht` → trigger Fix #1
11. Verifica panes Codex live + config.toml trust entries

### Evidenze raccolte

**Fix #3 — auto-migrate:**

```
[migrate]   ✓ v3 applicata
[migrate]   ✓ v4 applicata
[migrate]   Config aggiornata a versione 4
[pid1] jht migrate ok
```

Post-restart, `jht.config.json` ha `version: 4` + nuovi campi `agents`, `notifications`, `analytics`.

**Fix #2 — trust pre-pop:**

```toml
[projects."/jht_home/agents/assistente"]
trust_level = "trusted"

[projects."/jht_home/agents/sentinella"]
trust_level = "trusted"

[projects."/jht_home/agents/mentor"]
trust_level = "trusted"

[projects."/jht_home/agents/capitano"]
trust_level = "trusted"

[projects."/jht_home/agents/dottore"]
trust_level = "trusted"
```

5 entries idempotenti (nessun duplicato dopo restart multipli). Pre-fix file inesistente.

**Fix #1 — alias codex:**

Dopo sed `active_provider: "openai"` → `"codex"` raw + restart, pane CAPITANO:

```
Per ora resto in silenzio. Appena il tuo profilo è pronto accendo il motore...
Quando jht-telegram-send ritorna ok: mkdir -p /jht_home/profile && touch /jht_home/profile/capitano-welcomed.flag

  gpt-5.5 high · ~/agents/capitano
```

`docker logs jht` filtrato per `provider non riconosciuto|start FAIL|fallback a claude` → **0 match**.

### Differenza vs VPS1 (2026-05-19/20)

| Aspetto | VPS1 pre-fix | VPS-test post-fix |
|---|---|---|
| Tmux pane CAPITANO | bash shell vuota | Codex TUI live, processing welcome flow |
| `[@utente -> @assistente] [TG] tizio` | `-bash: [@utente: command not found` | messaggio elaborato dall'agente Codex |
| `~/.codex/config.toml` | Trust solo per `/jht_home/agents/mentor` (caso fortuito) | 5 entries auto-popolate al boot di ogni agente |
| `jht.config.json` versione | v1 (campi v2-v4 mancanti) | v4 dopo restart container |
| Workaround manuali necessari | 3 (sed config, manual TOML edit, jht migrate) | **0** |

## Lessons learned (gotchas durante il test)

### A. Token Hetzner "Read+Write" UI può essere read-only nei fatti

Il token `hcloud-cli-readonly-2026-05-19` mostrava i badge "Read" e "Write" nell'UI Hetzner ma silenziosamente scartava il payload `ssh_keys` sia su `hcloud server create` sia su `enable-rescue` sia via REST API diretta (4 ricreazioni fallite, sempre con "Root password: ..." in output al posto del key-only mode).

**Workaround applicato:** nuovo token con scope full-write esplicito, problema risolto al primo tentativo.

**Lesson:** quando hcloud non logga "SSH key X attached" durante create + l'output include "Root password: ...", il key payload è stato dropped. Verificare immediatamente con `ssh root@<IP>` invece di assumere successo silenzioso.

### B. SSH key con passphrase rompe `BatchMode=yes`

`~/.ssh/jht_hetzner` era cifrata con passphrase. OpenSSH verbose log mostrava:
- `Server accepts key:` ✓
- `sign_and_send_pubkey: signing using ssh-ed25519` ✓
- ...poi `Permission denied`

Causa: con `BatchMode=yes` OpenSSH non chiede la passphrase, ma genera comunque una signature invalida con la chiave non decifrata → il server la rigetta. Diagnosi rapida: `ssh-keygen -y -f <key>` chiede la passphrase → se prompt → key è encrypted.

**Workaround:** generare key effimera passphraseless dedicata all'automazione (`ssh-keygen -t ed25519 -N ""`).

**Lesson per automazione AI agent:** sempre verificare se la chiave è encrypted prima di tentare SSH non-interattivo. Default: generare key fresca passphraseless per ogni test, distruggerla a fine sessione.

### C. Cloud-init `user_data` non affidabile per SSH key injection su Hetzner Ubuntu 24.04

`--user-data-from-file` con `#cloud-config / ssh_authorized_keys:` **non** ha iniettato la chiave (testato 2 volte). Solo l'attributo `ssh_keys` nel payload create-server (con token corretto) ha funzionato.

**Lesson:** affidarsi solo al meccanismo nativo Hetzner (`--ssh-key` flag o `ssh_keys` array in REST). Niente user-data per le credenziali.

## Stato deferred (non fixati ora)

Dal doc originale `2026-05-20-vps-bootstrap-bugs.md`:

- **Bug #4/#5** (`procps`, `pkill`, `sqlite3` mancanti in image) — debug-only, non bloccanti per startup. Trade-off image size ~5 MB vs debugging speed.
- **Bug #6** (`jobs.db` non creato al boot → log spam daemon) — cosmetico, auto-risolve al primo INSERT da agente. `jht db init` non esiste come comando.

Da considerare in una pulizia successiva (non urgente).

## Riferimenti

- Bug originali: `docs/internal/2026-05-20-vps-bootstrap-bugs.md`
- Commit fix: `79f63324`
- Test VPS: `49.13.5.51` (server ID 132244720)
- CI build: `gh run view 26235170426`
- AI agent runbook: `docs/guides/AI-AGENT-INTEGRATION.md`
- VPS setup guide: `docs/guides/VPS-SETUP.md`
