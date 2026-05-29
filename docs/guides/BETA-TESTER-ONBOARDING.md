# 🧪 Beta tester onboarding — preparazione 2026-05-18

Piano operativo per attivare il primo beta tester esterno su VPS condivisa,
**preparato a 2026-05-18 in preparazione del kick-off pianificato per i prossimi giorni**.

> Questo doc cattura le decisioni di setup. La guida user-facing per il beta
> tester resta [`BETA.md`](BETA.md). Questo è il "behind the scenes" lato
> maintainer.

---

## 🎯 Requisiti utente

| Requisito | Decisione |
|---|---|
| 🌍 Lingua beta tester | en / it / hu — **stabilizzare le 3 esistenti, NO nuove lingue** |
| 💳 Account Hetzner | account maintainer (paga lui, beta tester gratis) |
| 🔧 SSH access debug | beta tester condivide la sua chiave privata con maintainer via canale sicuro (Signal) — maintainer fa setup locale con quella chiave |
| 🖥 Provisioning VPS | maintainer + beta tester insieme dalla UI Hetzner (mentre sono in call), niente automation |
| 👥 Trust model | beta tester = amico di maintainer → identità SSH condivisa OK, no ceremony multi-chiave |

---

## 🪜 Flusso operativo

### 📅 Day −1 — Provisioning VPS (maintainer + beta tester insieme)

**Setting**: call Telegram/Signal, screen sharing dal beta tester che guarda maintainer provisionare.

1. **maintainer crea VPS Hetzner** (account maintainer, manuale via [console.hetzner.com](https://console.hetzner.com)):
   - Plan: CPX22 €9.75/mo (€5.99 base + €0.61 IPv4 + VAT IT) — già validato per JHT
   - DC: Norimberga (vicino UE, latenza decente)
   - SSH keys al boot: nessuna inizialmente (le aggiungerà l'app desktop del beta tester con la propria pubkey)

2. **maintainer annota IP** e lo passa al beta tester via chat di sessione.

### 🖥 Day 0 — Setup beta tester (sul suo PC, app desktop)

1. **Installa JHT Desktop** dal link `https://jobhunterteam.ai/download`
2. **All'avvio**: scegli lingua dal picker (en / it / hu) — l'app salva la scelta in `~/Library/Application Support/jht-desktop/preferences.json::locale`
3. **Sign-in** OAuth Google/GitHub (account JHT del beta tester)
4. **Wizard "Setup VPS"** (flusso standard self-service):
   - paste IP VPS ricevuto da maintainer
   - app genera coppia SSH `~/Library/Application Support/jht-desktop/ssh/jht_ed25519` (perms 0600)
   - app guida il beta tester a incollare la pubkey sul portale Hetzner (Console → Server → SSH keys → Add key → Reboot)
   - dopo il reboot, app si collega via SSH, esegue `curl ... install.sh | bash`, completa wizard container in-app:
     - lingua (già scelta sopra, propagata a `JHT_LANG`)
     - timezone (`JHT_USER_TZ`, picker IANA)
     - 3 token Telegram bot (BotFather)
     - active_provider (Kimi €40 / Claude / Codex)
     - login OAuth provider (terminale embedded nel desktop)
5. **Team start**: app esegue `docker exec jht jht team start`
6. **Welcome message** sui 3 bot Telegram nella lingua scelta (en/it/hu)

### 🔑 Day 0 — Condivisione chiave SSH con maintainer (per debug)

Setup terminato, il beta tester invia a maintainer la chiave privata tramite **Signal / Bitwarden Send / 1Password share** (NON email/Slack plaintext):

| Item | Path da inviare |
|---|---|
| 📄 Chiave privata | `~/Library/Application Support/jht-desktop/ssh/jht_ed25519` (file binario, non `.pub`) |
| 📋 IP VPS | già nota dalla session di provisioning |

maintainer la salva localmente:
```bash
cp ~/Downloads/jht_ed25519 ~/.ssh/jht_beta_<tester-name>_ed25519
chmod 600 ~/.ssh/jht_beta_<tester-name>_ed25519
```

E verifica accesso:
```bash
ssh -i ~/.ssh/jht_beta_<tester-name>_ed25519 root@<vps-ip> 'docker ps'
```

> 🔒 **Trust model esplicito**: beta tester e maintainer usano la **stessa** identità SSH (root). Va bene perché:
> - beta tester = amico di maintainer, no concerns di compartimentalizzazione
> - canale sicuro (Signal E2E) per il trasferimento iniziale
> - VPS dedicata al beta test, no dati di altri utenti su quello stesso server
> - se mai serve revoca: maintainer via Hetzner UI rigenera VPS o sostituisce la pubkey

### 🔧 Day +N — Debug maintainer

```bash
# maintainer sul suo Mac, accesso indipendente al VPS del beta tester
ssh -i ~/.ssh/jht_beta_<tester-name>_ed25519 root@<vps-ip>

# tutti gli interventi come hai già fatto:
docker exec jht tmux list-sessions
docker logs --tail 50 jht
docker exec jht python3 /app/shared/skills/db_query.py stats
# ...

# se serve hot-patch:
scp -i ~/.ssh/jht_beta_<tester-name>_ed25519 file.py root@<vps-ip>:/tmp/
ssh -i ... 'docker cp /tmp/file.py jht:/app/...'
```

---

## 🛠 Gap nel codice da chiudere PRIMA del beta kick-off

### 🔴 BLOCKING (devono essere fatti)

#### 1. Stabilizzazione i18n it/en/hu — perimetro completo

Lingue esistenti (en/it/hu): l'app desktop le supporta già (`web/messages/{en,it,hu}.json`, `desktop/renderer/modules/translations.js` con 343 chiavi × 3 lingue, 0 missing). Ma i pezzi container-side sono **mostly hardcoded in italiano**.

| Componente | Stato attuale | Target |
|---|---|---|
| 🖥 Desktop renderer | ✅ en/it/hu 343 chiavi | OK |
| 📦 Welcome Telegram (3 bot) | ❌ hardcoded IT | i18n via `JHT_LANG` |
| 🤖 Prompt agenti (10 ruoli) | 🟡 mostly IT, mentor/critico EN | baseline EN + `.it.md` + `.hu.md` |
| ⚙️ Wizard CLI `jht setup` | ❌ hardcoded IT | i18n via `JHT_LANG` |
| 📜 `host-setup.sh` picker | 🟡 en/it solo | aggiungere hu |
| 🩺 Agent prompts loader | ✅ già scaffolded (start-agent.sh:497-516) | OK, manca solo i contenuti |
| 🔧 Bot commands `/start /help` | ❌ hardcoded IT | i18n |
| 📊 Auto-report PNG + caption | ❌ hardcoded IT | i18n |

**Effort stimato**: 1-2 giorni (vedi sezione "Sprint stabilizzazione i18n" sotto)

#### 2. Verifica welcome E2E in HU

Il beta tester potrebbe scegliere ungherese. Mai testato runtime: spawn container con `JHT_LANG=hu`, verificare welcome telegram + prima risposta Capitano.

**Effort stimato**: 30 min (smoke test)

#### 3. Documentare flow SSH key in `BETA.md`

Aggiornare la guida pubblica per riflettere il modello "beta tester invia chiave a maintainer via Signal".

**Effort stimato**: 15 min (solo doc)

### 🟠 DA FARE AL KICK-OFF (durante setup del beta tester)

#### Shadow observer mode sui bot Telegram di maintainer

Per **monitorare il beta tester in tempo reale** durante i primi giorni (vedere auto-report Capitano, risposte agli agenti, errori) senza che il beta tester sappia di essere osservato.

**Pattern scelto**: Scenario C "shadow observer" — auto-report broadcast a tutti i chat_id whitelisted, ma risposte agli utenti sticky (= solo chi ha scritto riceve la reply). Beta tester e maintainer hanno conversation paralleli che non si vedono.

**Cosa serve modificare** (effort ~2h):

1. **Schema config** (`jht.config.json`): aggiungere `observer_chat_ids: []` accanto a `chat_id`:
   ```json
   {
     "channels": { "telegram": { "bots": {
       "capitano": {
         "bot_token": "...",
         "chat_id": "<beta_tester_chat>",
         "observer_chat_ids": ["<leone_chat>"]
       }
     }}}
   }
   ```

2. **Whitelist** (`.launcher/tg-bridge.py:288-329`): set `allowed_chats = {primary} + observers` e usare `chat_id not in allowed_chats` per il filtro.

3. **Outbound broadcast** (`agents/_tools/jht-telegram-send`):
   - Auto-report / welcome / notifiche team-wide → loop su `chat_id + observer_chat_ids`
   - Risposta a un messaggio in arrivo → solo al chat_id mittente (sticky)

4. **Setup**: beta tester crea i 3 bot via wizard standard → maintainer aggiunge a mano il proprio chat_id in `observer_chat_ids` via SSH:
   ```bash
   ssh -i ... root@<vps-ip>
   docker exec jht jq '.channels.telegram.bots |= map_values(.observer_chat_ids = ["<leone_chat>"])' \
     ~/.jht/jht.config.json > /tmp/c.json && mv /tmp/c.json ~/.jht/jht.config.json
   docker exec jht jht team stop --all && docker exec jht jht team start  # ricarica config
   ```

**Trade-off accettato** (vedi `docs/sessions/2026-05-18-supabase-disk-io-investigation/README.md` per dettagli architettura simili):
- ✅ Trasparenza totale per maintainer
- ✅ Beta tester non vede maintainer scrivere
- ⚠️ Beta tester potrebbe notare che gli auto-report arrivano "altrove" (improbabile, dichiarare nel patto beta che maintainer monitora)

**Riferimento implementazione**: vedere conversazione 2026-05-18 (Scenario A/B/C trade-off completa).

### 🟡 NICE-TO-HAVE (può aspettare beta+1)

- 📚 Tutorial in-app multi-step per il beta tester (steps cliccabili nella dashboard)
- 🌐 Lingua nel profilo `candidate_profile.yml::language` per generazione CV multi-lingua
- 📧 BotFather risponde sempre in en — guidare il beta tester nelle istruzioni in-app

### 🟢 NO-OP (già OK)

- ✅ `JHT_USER_TZ` settato dal wizard host-setup.sh — beta tester può essere in qualsiasi fuso
- ✅ `JHT_LANG` propagato a docker-compose env
- ✅ Pairing token in `install.sh` — già funziona per legare VPS a account JHT
- ✅ Loader `<role>.<locale>.md` in `start-agent.sh` — già scaffolded dal 2026-05-06
- ✅ `agents/_team/*` e `agents/_manual/*` già in EN
- ✅ **CV upload robusto** — skill `parse-cv` (pdftotext+pandoc) pre-process,
  fallback vision multimodal su scansioni, gestione formati .pdf/.docx/.odt/.rtf
- ✅ **Multiple CV uploads** — Assistente unifica, chiede chiarimenti su
  discrepanze hard (years, employer), take-latest silent su soft conflicts
- ✅ **User silence** — Assistente fa reminder ~6h, escalation gentile,
  team idle finché blocking checklist 10 campi non soddisfatta
- ✅ **Random username bot** — wizard genera 3 suffix indipendenti
  `<role>_<tag>_<random>_bot` con regen-on-collision se BotFather rifiuta

---

## 🚀 Sprint stabilizzazione i18n (1-2 giorni)

Master language = **inglese**. IT è override `<role>.it.md`. HU via AI translation (rifinitura post-launch).

### Fase 1 — Infrastruttura (mezza giornata)

- [ ] `shared/locales/{en,it,hu}.json` — stringhe corte (welcome, errori, bot commands)
- [ ] `shared/i18n.sh` — helper `t(key)` per script bash
- [ ] `shared/i18n.py` — helper `t(key)` per Python (auto_report, bridges)

### Fase 2 — Prompt agenti (1 giorno)

Per ognuno dei 10 ruoli (`capitano scout analista scorer scrittore critico sentinella assistente dottore mentor`):

```bash
git mv agents/<role>/<role>.md agents/<role>/<role>.it.md  # preserva IT
# Crea NUOVO agents/<role>/<role>.md = traduzione EN del .it.md
# Crea agents/<role>/<role>.hu.md = traduzione AI HU del .md (EN)
```

Smoke test: `JHT_LANG=hu` → verifica `start-agent.sh::resolve_identity_template` carichi `<role>.hu.md`.

### Fase 3 — Stringhe corte (mezza giornata)

- [ ] `welcome-send.sh` legge `JHT_LANG`, seleziona blocco welcome dalle `locales/<lang>.json`
- [ ] `host-setup.sh` picker: aggiungere `3) Magyar`
- [ ] `cli/wizard/setup.js` + `setup-steps.js`: stringhe da locales
- [ ] Telegram bot commands `/start /help /status`: stringhe da locales
- [ ] `auto_report.py`: PNG title + caption da locales

### Fase 4 — Test E2E (mezza giornata)

- [ ] Container fresco con `JHT_LANG=en` → flusso completo welcome → wizard → team start → prima risposta Capitano in EN
- [ ] Container fresco con `JHT_LANG=hu` → idem in HU
- [ ] Container fresco con `JHT_LANG=it` → idem in IT (regression test)

---

## 📅 Checklist kick-off (maintainer, da fare il giorno del beta)

```
□ Account Hetzner — VPS CPX22 creata insieme al beta tester (call), IP annotato
□ Sprint stabilizzazione i18n chiuso (en/it/hu), tag :buster→:latest deployato
□ Beta tester ha:
  □ scaricato app desktop dal link
  □ scelto lingua (en/it/hu)
  □ completato wizard setup
  □ ricevuto 3 welcome Telegram nella lingua scelta
□ Beta tester ha inviato a maintainer via Signal:
  □ file chiave privata SSH (~/Library/Application Support/jht-desktop/ssh/jht_ed25519)
□ maintainer verifica accesso debug:
  □ ssh -i ~/.ssh/jht_beta_<tester>_ed25519 root@<ip> 'docker ps' → OK
  □ docker exec jht tmux list-sessions → 4+ sessioni attive
  □ db_query.py stats → state_transitions > 0

Post-kick-off (Day +1):
□ Verifica auto-report Telegram ogni 2h funzionante
□ Verifica agent-watchdog non spegne nulla per zombie falso positivo
□ docs/sessions/<data>-beta-tester-<nome>-kickoff/ creato per tracking
□ Daily check-in 24h: il beta tester ha avuto problemi? cosa non era chiaro?
```

---

## 🚧 Rischi identificati + mitigazioni

| Rischio | Mitigazione |
|---|---|
| Beta tester sceglie lingua non ancora testata runtime (es. hu) | Sprint i18n include smoke test E2E per tutte e 3 le lingue |
| Beta tester perde la chiave SSH locale | App rigenera + ri-invia a maintainer tramite re-pairing |
| Beta tester revoca la pubkey dal Hetzner UI per errore | maintainer ha lo stesso account Hetzner, può aggiungere una nuova chiave dal portale |
| Fuso orario non gestito (es. Pacifico) | `format_time.py` accetta qualsiasi IANA timezone, validata con `zoneinfo.ZoneInfo()` |
| BotFather risponde in en al beta tester hu | Documentare nei "first steps" in-app: BotFather risponde sempre in en, è normale |
| Welcome Telegram in lingua mai testata runtime | Smoke test Fase 4 sprint i18n |
| Hetzner bloccata da quota (account maintainer) | Budget €30/mese basta per 3 beta tester paralleli (CPX22 €9.75 cad) |

---

## 🔗 Documenti collegati

- [`BETA.md`](BETA.md) — guida pubblica beta tester
- [`VPS-SETUP-WIZARD.md`](VPS-SETUP-WIZARD.md) — flow desktop wizard standard (self-service)
- [`VPS-SETUP.md`](VPS-SETUP.md) — flow tech-only manuale via SSH
- [`docs/internal/2026-05-06-agent-prompts-i18n.md`](../internal/2026-05-06-agent-prompts-i18n.md) — design i18n prompt agenti
- [`docs/internal/vps.md`](../internal/vps.md) — design VPS providers + 3-tier UX

---

## ✅ Decisioni lockate (2026-05-18 dopo confronto con maintainer)

1. **Lingue supportate**: **solo en/it/hu** (stabilizzazione 3 esistenti, NO nuove). Master language = **EN**.
2. **Trust SSH**: beta tester (amico) invia chiave privata a maintainer via Signal. **Identità SSH condivisa**. NO `[JHT-DESKTOP-RECLAIM]` "Connect to existing VPS" (ne creiamo una nuova ogni volta).
3. **Provisioning VPS**: maintainer + beta tester insieme in call dalla UI Hetzner (account maintainer).
4. **Budget**: €10/mese × beta tester. Setup 3 beta in parallelo = €30/mese.
