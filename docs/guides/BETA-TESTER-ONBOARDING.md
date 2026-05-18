# 🧪 Beta tester onboarding — preparazione 2026-05-18

Piano operativo per attivare il primo beta tester esterno su VPS condivisa,
**preparato a 2026-05-18 in preparazione del kick-off pianificato per i prossimi giorni**.

> Questo doc cattura le decisioni di setup. La guida user-facing per il beta
> tester resta [`BETA.md`](BETA.md). Questo è il "behind the scenes" lato
> maintainer (Leone).

---

## 🎯 Requisiti utente (Leone)

| Requisito | Decisione |
|---|---|
| 🌍 Lingua beta tester | NON italiana — supportare en/de/fr/es/pt/zh in minimo (al momento app desktop ha en/it/hu) |
| 💳 Account Hetzner | quello di Leone (paga lui, beta tester gratis) |
| 🔧 SSH access debug | Leone deve poter SSH-are sulla VPS in modo indipendente dal beta tester (per fix in produzione) |
| 🖥 Setup VPS | il beta tester usa la sua app desktop dal suo PC (non terminale, no comandi manuali) |
| 🔐 SSH key | NON condivisa Leone↔beta tester (chiave privata personale, mai trasferita). Entrambi hanno chiavi separate, entrambi nelle `authorized_keys` del root VPS |

---

## 🪜 Flusso operativo proposto

### 📅 Day −1 — Preparazione VPS lato Leone (Mac locale)

1. **Genera coppia SSH dedicata al beta tester** (in caso debba revocarla):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/jht_beta_<tester-name>_ed25519 -N "" \
     -C "jht-beta-<tester-name>-2026-05"
   ```

2. **Crea VPS Hetzner** (account Leone, manuale via [console.hetzner.com](https://console.hetzner.com)):
   - Plan: CPX22 €9.75/mo (€5.99 base + €0.61 IPv4 + VAT IT) — già validato per JHT
   - DC: Norimberga (vicino UE, latenza decente verso utente italiano/europeo)
   - SSH keys da aggiungere alla VPS al boot (Hetzner UI):
     - 🔑 `jht_beta_<tester-name>_ed25519.pub` ← chiave del beta tester (NUOVA)
     - 🔑 `leone_personal_ed25519.pub` ← chiave debug Leone (sua personale, riusabile per più VPS)

3. **Login iniziale + install.sh** (Leone via SSH):
   ```bash
   ssh -i ~/.ssh/jht_beta_<tester-name>_ed25519 root@<vps-ip>
   curl -fsSL https://jobhunterteam.ai/install.sh | bash
   # questo crea ~/.jht/runtime/docker-compose.yml + scarica image :latest
   # NON fa il wizard interattivo perché useremo il pairing del desktop
   ```

4. **Pre-config minimal** (Leone, sulla VPS):
   ```bash
   # imposta tipo host = vps (richiesto da pid1.js)
   cat > /root/.jht/host.env <<'EOF'
   JHT_HOST_TYPE=vps
   JHT_LANG=en
   JHT_USER_TZ=Europe/Rome  # default, beta tester lo cambierà col suo wizard
   EOF
   ```

5. **Verifica accesso debug Leone separato dal beta tester**:
   ```bash
   ssh -i ~/.ssh/leone_personal_ed25519 root@<vps-ip> 'docker ps'
   # dovrebbe funzionare anche se beta tester sostituisce la sua key
   ```

### 📤 Day 0 — Passaggio al beta tester (canale sicuro)

Leone manda al beta tester via **Signal / Bitwarden Send / 1Password share** (NON email/Slack plaintext):

| Item | Cosa |
|---|---|
| IP VPS | es. `46.224.59.127` |
| File chiave privata | `jht_beta_<tester-name>_ed25519` (NO `.pub`) |
| Link installer | `https://jobhunterteam.ai/download` |
| Username/password | OAuth Google/GitHub a scelta del beta tester (account JHT suo) |

### 🖥 Day 0 — Setup beta tester (sul suo PC)

1. **Installa app desktop JHT** dal link
2. **All'avvio**: scegli lingua dal picker (en/de/fr/es/...) — l'app salva la scelta in `Application Support/jht-desktop/preferences.json`
3. **Sign-in** con OAuth Google/GitHub (account JHT del beta tester)
4. **Wizard step "Setup VPS"**:
   - opzione "Connect to existing VPS" (= ex `[JHT-DESKTOP-RECLAIM]` da riabilitare)
   - paste IP VPS
   - paste contenuto della chiave privata che ha ricevuto da Leone
   - L'app:
     - salva la key in `~/Library/Application Support/jht-desktop/ssh/jht_ed25519` (perms 0600)
     - genera pairing token dalla sua Supabase session
     - esegue `ssh root@<ip> 'docker exec jht jht cloud pair --token <token>'`
     - VPS ora linked all'account JHT del beta tester
5. **Setup wizard container** (via SSH tunnel desktop → VPS):
   - lingua (en/de/fr/...)
   - timezone (Asia/Shanghai, Europe/Berlin, ecc.)
   - 3 token Telegram bot (BotFather)
   - active_provider (Kimi €40 / Claude / Codex)
   - login OAuth provider (terminale embedded nel desktop)
6. **Team start**: app esegue `docker exec jht jht team start`
7. **Welcome message** sui 3 bot Telegram in lingua scelta

### 🔧 Day +N — Debug Leone (indipendente)

```bash
# Leone sul suo Mac, accesso indipendente dal beta tester
ssh -i ~/.ssh/leone_personal_ed25519 root@<vps-ip>

# tutti gli interventi come hai già fatto:
docker exec jht tmux list-sessions
docker logs --tail 50 jht
docker exec jht python3 /app/shared/skills/db_query.py stats
# ...

# se serve hot-patch:
scp -i ~/.ssh/leone_personal_ed25519 file.py root@<vps-ip>:/tmp/
ssh -i ... 'docker cp /tmp/file.py jht:/app/...'
```

---

## 🛠 Gap nel codice da chiudere PRIMA del beta kick-off

### 🔴 BLOCKING (devono essere fatti)

#### 1. Riabilitare desktop "Connect to existing VPS"

Annullata 2026-05-13 ([`[JHT-DESKTOP-RECLAIM]`](../../BACKLOG.md)). Va riabilitata
ma con scope ridotto:
- Input: IP + chiave privata pasted dall'utente
- Output: salva entrambi in `Application Support/jht-desktop/`, lancia pairing
- NO Hetzner API (Leone ha già creato la VPS)

**File da toccare**:
- `desktop/vps/index.js` — nuovo entry point `connectToExisting({ip, sshPrivateKey})`
- `desktop/renderer/` — nuovo step wizard "Connect to existing"
- `desktop/renderer/modules/translations.js` — labels en/it/hu

**Effort stimato**: 4-6h

#### 2. Allargare lingue supportate desktop

Oggi: en/it/hu. Target minimo per beta: **en + 3 lingue maggiori EU/global**:
- 🇫🇷 fr (francese)
- 🇩🇪 de (tedesco)
- 🇪🇸 es (spagnolo)
- 🇨🇳 zh (cinese semplificato — se beta tester asiatico)

**File da toccare**:
- `desktop/renderer/modules/translations.js` — aggiungere blocchi `fr:`/`de:`/`es:`/`zh:`
- `scripts/host-setup.sh` — accettare anche fr/de/es/zh nel picker (anche se l'install è automatizzato dal desktop, è bene non avere mismatch)
- Per i messaggi degli agenti: già `JHT_LANG` propagato al container — gli LLM rispondono nella lingua scelta del prompt (Kimi/Claude/Codex multi-lingua nativo)

**Effort stimato**: 2-3h se traduzioni AI-generate, 1 giorno se human review

#### 3. Multi-SSH key in `install.sh`

Oggi `install.sh` non gestisce multi-chiave: usa quelle messe nel boot Hetzner. Per il flow nostro va bene (Leone aggiunge 2 chiavi nel portale Hetzner al provisioning, l'installer non tocca le `authorized_keys`). MA serve documentare esplicitamente questo in `VPS-SETUP-WIZARD.md`.

**Effort stimato**: 30 min (solo doc)

### 🟡 NICE-TO-HAVE (può aspettare beta+1)

- Encoding password OAuth Telegram bot in lingua scelta (BotFather risponde in en sempre, ma il beta tester non-en potrebbe confondersi)
- Welcome message del Capitano/Mentor/Assistente nella lingua scelta (già supportato lato prompt, da verificare empiricamente)
- Tutorial in-app per il beta tester (steps cliccabili nella dashboard prima di iniziare)
- Lingua nel profilo `candidate_profile.yml::language` per generazione CV multi-lingua

### 🟢 NO-OP (gia OK)

- ✅ `JHT_USER_TZ` settato dal wizard host-setup.sh — beta tester può essere in qualsiasi fuso
- ✅ `JHT_LANG` propagato a docker-compose env
- ✅ Pairing token in `install.sh` — già funziona per legare VPS a account JHT
- ✅ Container Docker image — è already i18n-ready (i prompt agenti sono in en/it ma facilmente trad)

---

## 📅 Checklist kick-off (Leone, da fare il giorno del beta)

```
□ Account Hetzner — VPS CPX22 creata, IP annotato
□ Coppia SSH jht_beta_<tester>_ed25519 generata
□ Pubblica SSH personale leone_personal_ed25519.pub disponibile (riusabile)
□ Entrambe le pubkey aggiunte ad authorized_keys VPS (via Hetzner UI al boot)
□ SSH iniziale OK con BOTH chiavi (verifica ssh -i ...beta... + ssh -i ...leone...)
□ install.sh eseguito + host.env pre-configurato vps mode
□ Container :latest pulled + jht in piedi (docker ps)
□ Pairing token: VPS ancora "unpaired" (cloud.json non esiste) — pronto per il primo pairing dell'app
□ Beta tester ha ricevuto via canale sicuro: IP + chiave privata + link installer + istruzioni in sua lingua

Post-kick-off:
□ Verifica beta tester ha ricevuto 3 welcome Telegram (Assistente/Capitano/Mentor)
□ Verifica `cloud daemon` su VPS sta pushando dati alla dashboard web del beta tester
□ Leone SSH indipendente per debug funziona
□ docs/sessions/<data>-beta-tester-<nome>-kickoff/ creato per tracking
```

---

## 🚧 Rischi identificati + mitigazioni

| Rischio | Mitigazione |
|---|---|
| Beta tester perde la chiave SSH | Leone usa la sua key per fare reset accesso, rigenera nuova coppia, manda al beta via canale sicuro |
| Beta tester revoca la propria pubblica per errore | Leone ha la SUA chiave separata, accesso indipendente garantito |
| Wizard desktop in lingua mai testata (es. zh) | Default fallback en per stringhe mancanti (già implementato in `translations.js` t() function) |
| Fuso orario non gestito (es. UTC-11 Polynesia) | `format_time.py` accetta qualsiasi IANA timezone, validata con `zoneinfo.ZoneInfo()` |
| OAuth Telegram bot in lingua nativa BotFather | Documentare nei "first steps": BotFather risponde sempre in en, è normale |
| Beta tester non capisce errori in shell embedded | App desktop deve catturare stderr + tradurre i 5-10 errori più comuni via t() |
| Hetzner bloccata da quota (account Leone) | Backup plan: account Hetzner ha 100€/mese di buffer; budget per 3+ beta tester contemporanei |

---

## 🔗 Documenti collegati

- [`BETA.md`](BETA.md) — guida pubblica beta tester (cosa cerchiamo, cosa ottieni)
- [`VPS-SETUP-WIZARD.md`](VPS-SETUP-WIZARD.md) — flow desktop wizard standard (self-service)
- [`VPS-SETUP.md`](VPS-SETUP.md) — flow tech-only manuale via SSH
- [`docs/internal/vps.md`](../internal/vps.md) — design VPS providers + 3-tier UX
- [`BACKLOG.md`](../../BACKLOG.md) `[JHT-DESKTOP-RECLAIM]` (annullata, da rivedere)

---

## ✅ Decisioni aperte (da confermare con Leone prima del kick-off)

1. **Quale beta tester / target persona?** — vedi `BETA.md` matrice 10 celle, priorità Kimi €40 / non-italiano
2. **Lingua minima da supportare per il primo beta?** — Suggerisco solo `en` se il primo beta tester ha la language stack che il team Kimi gestisce bene
3. **Quanto budget Hetzner allocato?** — €10-15/mese × N beta tester paralleli. Setup 3 beta in parallelo = €30/mese budget.
4. **Modalità "import existing VPS" deve permettere anche standalone (no Leone)?** — Utile per power-user che provisionano da soli su altri provider (DigitalOcean, AWS), non solo Hetzner-Leone.
