# JHT bot Telegram — design, scelta canale, ingest documenti

**Doc consolidato il 2026-05-13** unificando:
- `2026-05-12-document-channels-decision.md` — scelta canale doc (Telegram = Opzione B primaria)
- `2026-05-12-telegram-document-ingest-design.md` — spec implementazione `tg-bridge.py` + `jht-telegram-send`
- Tema A di `2026-05-12-open-questions-bot-and-vps-setup.md` (poi cancellato) — design multi-agente + decisioni 2026-05-13

> Quando i 3 doc divergono, vince la decisione più recente.

---

## 🎯 TL;DR

**Setup bot (decisione 2026-05-13 rev2 — tutti e 3 obbligatori = Opzione 2):**
- 🤖 **Assistente + Capitano + Mentor bot = TUTTI OBBLIGATORI** in onboarding (3 step BotFather forzati). 3 token nel config (`channels.telegram.bots.{assistente,capitano,mentor}`), 3 `/start` separati prima del primo team start.
- Ogni agente parla all'utente sul suo bot dedicato → notifiche separate Telegram-native, contesto pulito, "tag" implicito dal canale.
- Scartate: Opzione 1 (un bot router), Opzione 3 (topic mode forum), Opzione 4 (@-tag in chat unica).

**Comportamento runtime (decisioni 2026-05-13 sera):**
- 🔢 **Notifiche batch Capitano**: default N=10 ready, configurabile post-onboarding (no domanda nel wizard). Edge case "team silenzioso" → segnali di vita iniziali nelle prime ore.
- ⏰ **Working hours**: default team 24/7 + notifiche appena qualcosa di importante. Utente configura slot/giorni per limitare lavoro+notifiche.
- 🆘 **`/stop` dal bot**: ferma team agents ma NON killa il container (dashboard resta accessibile).

**Canale documenti utente ↔ VPS (decisione 2026-05-12):** Telegram bot bidirezionale come **canale primario beta**. Zero costi, già infrastruttura nostra, allegati nativi fino a 20 MB. Roadmap: in v1 affiancare relay cloud (S3/R2) per togliere Telegram come dipendenza obbligatoria. Tailscale come opzione "no cloud relay" per privacy-sensitive.

---

## 👥 Agenti utente-facing

- 👨‍💼 **Assistente** — onboarding profilo, tech support, drop-zone documenti
- 👨‍✈️ **Capitano** — direzione team, fine-tuning ricerca/scoring, priorità candidature
- 🧙‍♂️ **Mentor** — mentore di crescita, posizionamento strategico

Il resto del team (Scout, Analista, Scorer, Scrittore, Critico, Sentinella) **non parla direttamente con l'utente**: ricevono ordini dal Capitano.

---

## 🤖 Setup bot — 4 opzioni valutate

### Opzione 1 — Un bot solo, Assistente è router

```
                ┌─────────────────────────┐
   👤 utente ───▶│  @jht_<user>_bot        │───▶ ASSISTENTE (router)
                └─────────────────────────┘            │
                                                       ├──▶ Capitano (forward)
                                                       └──▶ Mentor  (forward)
```

✅ 1 token, 1 wizard step | ✅ già implementato
🔴 Notifiche in 1 chat → mute selettivo impossibile | 🔴 routing manuale via prefix `/cap` `/mentor` ambiguo | 🔴 contesto mescolato

### Opzione 2 — N bot dedicati per agente

```
   👤 utente ──▶ @jht_<user>_assistente_bot ──▶ ASSISTENTE
            └─▶ @jht_<user>_capitano_bot ───▶ CAPITANO
            └─▶ @jht_<user>_mentor_bot ────▶ MENTOR
```

✅ Notifiche separate (Telegram nativo) | ✅ contesto pulito | ✅ tag implicito dal canale
🔴 Wizard chiede 3× `/newbot` a `@BotFather` faticoso | 🟡 3× token nel config | 🟡 3× `/start`

### Opzione 3 — Gruppo Telegram con topic (Forum mode)

```
   👤 utente ┌─ #📥 Assistente  ─▶ ASSISTENTE
       in    ├─ #🎯 Capitano    ─▶ CAPITANO
   gruppo ──┤ #🧭 Mentor      ─▶ MENTOR
    JHT     └─ #📣 Team-log    ─▶ broadcast (read-only)
```

✅ 1 solo bot | ✅ topic = sub-canale Telegram nativo | ✅ notifiche per topic configurabili
🟡 Bot API: `message_thread_id` + `is_topic_message` | 🟡 setup wizard più articolato (creare gruppo + abilitare topic + invitare bot + dare admin)

### Opzione 4 — Un bot, routing via @-tag

```
   👤 utente: "@capitano alza score posizioni Roma"
                  │
         ┌────────┴────────┐
   parse @<role>       default
         ▼                 ▼
       CAPITANO        ASSISTENTE
```

✅ 1 bot | 🟡 dipende dall'utente che ricorda i tag | 🔴 mix conversazionale rumoroso

### Matrice decisione

| Opz | Setup utente | UX quotidiana | Effort dev | Scala |
|-----|--------------|---------------|------------|-------|
| 1 — un bot router | 🟢 1 step | 🟡 rumoroso | 🟢 zero | 🟢 |
| 2 — N bot dedicati | 🔴 3 step BotFather | 🟢 pulita | 🟡 wizard + multi-token | 🟢 |
| 3 — Topic mode | 🟡 1 step + gruppo | 🟢🟢 ottimo | 🟡 bridge topic-aware | 🟢 |
| 4 — @-tag in chat | 🟢 1 step | 🟡 abitudine | 🟢 piccolo router | 🟢 |

### ✅ Decisione finale 2026-05-13 rev2 — Opzione 2 (tutti e 3 obbligatori)

> **Cambio idea 2026-05-13 sera**: l'idea iniziale dell'ibrido (Assistente obbligatorio + Capitano/Mentor opt-in) è stata superata. Per garantire la stessa UX a tutti gli utenti e separare i contesti fin da subito, **tutti e 3 i bot sono obbligatori** in onboarding.

- **Assistente bot + Capitano bot + Mentor bot** = TUTTI OBBLIGATORI
  - Wizard chiede 3× `/newbot` a `@BotFather`
  - 3 token salvati in `channels.telegram.bots.{assistente,capitano,mentor}`
  - 3 `/start` separati (uno per ogni bot) prima di poter completare il setup
  - Routing: ogni agente parla all'utente sul suo bot dedicato (no forward, no router)

**Trade-off accettato**: setup più lungo (~3 minuti BotFather) in cambio di notifiche separate Telegram-native, contesto pulito per ogni agente, mute selettivo nativo.

---

## 🔧 Decisioni di design (2026-05-13)

Sotto-decisioni emerse dopo aver fissato lo schema ibrido.

### 1. 🔔 Notifiche batch del Capitano

Il Capitano notifica l'utente ogni **N posizioni in stato `ready`**. **Default N=10**, **configurabile dopo onboarding** dalle impostazioni (UI dashboard + `jht config` CLI). L'utente non lo deve decidere durante l'onboarding: parte col default, e se ritiene di ricevere troppe/poche notifiche lo cambia.

**Routing notifica**: direttamente sul bot Capitano (sempre configurato — vedi setup obbligatorio sopra).

**Formato notifica:**
- Top-N posizioni ordinate per score/voto **decrescente**
- Per ogni posizione: link all'offerta + breve descrizione
- Le offerte con rating più alto in cima

**⚠️ Edge case "team silenzioso"**: con N=10, prima che la coda si riempa l'utente può non ricevere notifiche per ore e pensare che il team sia rotto. Servono **segnali di vita iniziali** nelle prime ore (prima notifica anticipata a soglia ridotta, o heartbeat dell'Assistente "il team sta cercando"). Forma esatta del kick-off da rifinire in fase di implementazione.

### 2. 🧠 Memoria conversazione e cambio macchina

- **Cambio VPS** è scenario da evitare (non un caso da supportare in prima classe)
- **Sync DB** = per ora **SOLO le posizioni** (`jobs.db`)
- **Memoria agenti**: decisione **rimandata** (vediamo se serve sincronizzarla in futuro)

### 3. 📡 Cross-agent visibility

L'**Assistente vede il contenuto delle sessioni degli altri agenti** via `tmux capture-pane`.

Quindi quando l'utente parla direttamente al Capitano (con bot opt-in attivo), l'Assistente può comunque sapere cosa è successo se l'utente glielo chiede. **No silos.**

### 4. 📣 Broadcast read-only (non necessario)

Non serve un canale separato "team-log" passivo: il Capitano stesso copre il caso del broadcast tramite le notifiche batch del punto 1. Sentinella/Scout parlano al Capitano, non all'utente.

### 5. 🌍 Lingua

- **Set in onboarding desktop**, traduzione **completa** di tutto il team (prompt, output, notifiche)
- Cambio lingua a runtime → **richiede riavvio del team**

### 6. 🚨 Fallback Telegram down → cloud sync

Quando Telegram bot è non configurato/down/rate-limited:

1. Messaggio destinato all'utente → l'agente chiama `jht-notify-user --agent <id>` (skill `notify-user`). La riga finisce in `pending_user_messages` con `delivered_via='web'` se Telegram non risponde (timeout 25s).
2. DB sincronizza con Supabase via `[JHT-DESKTOP-SYNC]` / `jht cloud daemon` (interval default 30s sul VPS).
3. Dashboard `/(protected)/dashboard` legge `pending_user_messages` (filtro `delivered_via='web' AND acknowledged_at IS NULL`) e mostra una card per ogni messaggio non letto, con bottoni "segna come letto" / "rispondi".
4. Quando l'utente risponde via dashboard, `POST /api/pending-messages/[id]/reply` scrive `user_reply` + `user_reply_at`.
5. Al prossimo tick l'agente chiama la skill `user-reply-check` (tool `jht-check-user-replies --agent <id>`) che ritorna le risposte non ancora viste e le marca `agent_seen_reply_at`. **Questo è il "marker" prompt-injection**: l'output del tool finisce nel contesto dell'agente al loop successivo.
6. L'agente risponde con `jht-notify-user --no-telegram` per restare nel canale web (mandare la stessa risposta anche via TG confonderebbe l'utente, che vive il thread sulla dashboard).

Riusa l'infra cloud sync già esistente, niente secondo canale push da aggiungere. Schema dettagliato in `agents/_manual/db-schema.md` § `pending_user_messages` (V5).

### 7. ⚖️ Rate limit

Non implementato lato JHT: ereditato dai **limiti del piano subscription** del provider AI (Claude Max, Kimi, ecc.). Il provider rate-limita, JHT non aggiunge un secondo livello.

### 8. 🎭 Tono agenti

Status quo: emergente dal prompt di ogni agente, **non definito a priori** in questa fase.

### 9. ⏰ Working hours (decisione 2026-05-13 sera)

- **Default**: il team **lavora 24/7** e notifica appena ha qualcosa di importante da comunicare.
- **Configurabile** dall'utente: può definire **working hours** (slot orari + giorni della settimana) durante l'onboarding e modificarli successivamente.
- Quando l'utente imposta working hours, valgono per **lavoro E notifiche**: fuori finestra il team è in pausa e non manda nulla.
- Trade-off accettato: il default "sempre on" può sembrare invadente, ma rispecchia la vision "team che lavora come un dipendente full-time"; chi vuole un dipendente part-time configura.

**Implementazione**: necessita config (timezone utente + slot orari) + gate sui tick del Capitano + gate sulle notifiche. Non ancora implementata.

### 10. 🆘 Comando `/stop` dal bot Telegram (decisione 2026-05-13 sera)

L'utente può fermare il team via comando bot. Il comando **ferma gli agenti** (Capitano + scaled agents non vengono più ticchettati) ma **NON killa il container**: il container resta su, la web :3000 resta raggiungibile, lo stato del DB è intatto.

- `/stop` (o `/pause team`) → ferma team agents, lascia container vivo
- Riavvio: `/start` dal bot (o `jht team start` da CLI / pulsante dashboard)
- Importante: NON è uno `jht down` — quello richiede setup completo per ripartire. `/stop` è un freeze, non un teardown.

---

## 📥 Canale documenti utente ↔ VPS

**Contesto**: setup beta su VPS. L'utente carica documenti (CV preesistente, PDF profilo, lettere referenze, screenshot) per nutrire gli agenti, e scarica documenti generati (CV per candidatura X, cover letter, report). Vincolo: **nessuna interazione SSH lato utente dopo il pairing iniziale**.

### Vincoli

- ❌ No SSH lato utente nel flusso quotidiano
- ❌ No storage massiccio su Supabase (costo + scalabilità)
- ❌ VPS non esposta pubblicamente (solo `127.0.0.1:3000`)
- ✅ Disco VPS abbondante (Hetzner CPX22 = 80 GB SSD)
- ✅ Telegram bridge già esistente (Capitano bidirezionale)
- ✅ Cloud pairing token già esistente (`~/.jht/cloud.json`, `cloud-sync`)

### Opzioni valutate

| Opz | Sintesi                                          | UX 👤 | Effort 🔧 | Costo ☁️ | Scala 📈 | Sicurezza 🔐 |
|-----|--------------------------------------------------|-------|-----------|----------|----------|--------------|
| A   | Upload web → DB transit → VPS pulla → DELETE     | 🟢    | 🟡        | 🟡       | 🟡 < 1k  | 🟢           |
| B   | **Telegram bot bidirezionale** ⭐                | 🟢    | 🟢        | 🟢 0     | 🟢       | 🟢           |
| C   | HTTPS pubblico diretto su VPS                    | 🟢    | 🔴        | 🟡       | 🟢       | 🔴           |
| D   | Relay cloud (S3/R2) + cloud-sync pull            | 🟢    | 🟡        | 🟢 €/GB  | 🟢       | 🟢           |
| E   | Tailscale tra browser utente e VPS               | 🟡    | 🟢        | 🟢 0     | 🟢       | 🟢🟢         |
| F   | Mailbox dedicata + IMAP poll                     | 🟡    | 🟡        | 🟡       | 🟢       | 🟡           |

### Decisione

**Adesso (beta) → Opzione B: Telegram** come canale primario.

Già infrastruttura nostra (Capitano bridge), zero costi, bidirezionale, allegati nativi fino a 20 MB (50 MB con Bot API self-hosted, sufficiente per CV/PDF). Il flow `setup` configura Telegram nei primi step → all'utente arriva subito un messaggio "mandami il tuo CV qui" → gli agenti lo ricevono dentro la VPS senza che l'utente apra una shell.

**Perché:**
- Effort minimo (estensione del bridge esistente)
- Robustezza: TLS Telegram + auth via chat_id pinato al pairing utente
- Bidirezionale gratis: l'utente riceve CV generati sullo stesso canale dove ha mandato l'input
- Funziona anche da mobile, indipendente dal browser

**Limiti accettati per la beta:**
- 20 MB/file (raro che un CV superi)
- Dipendenza Telegram come account (mitigata con secondary channel più sotto)
- No "libreria documenti" navigabile dal sito (rimedio in v1)

### Possibile secondary in beta — WhatsApp Cloud API

Per chi non usa Telegram. Stesso pattern (bot bidirezionale, allegati), ma su WhatsApp Business Cloud API. Da valutare costi (Meta fattura per conversation, ~$0.005-0.08 a seconda del Paese) e onboarding numero verificato.

**Decisione**: rimandato. Valutare dopo aver visto quanti beta tester rifiutano Telegram. Se >2/10, attiviamo.

### Future (post-beta) — A + D + E, non mutualmente esclusive

Telegram **non sarà escluso** quando aggiungeremo questi canali. Resta come opzione, perché è quella più "no-setup" per molti utenti.

**D — Relay cloud S3/R2 + cloud-sync pull** *(raccomandato come v1)*
Quando dobbiamo togliere Telegram come dipendenza obbligatoria. L'utente carica via dashboard → bucket transit (TTL 10 min, presigned PUT) → la VPS pulla via `cloud-sync` client (riusa il token di pairing già esistente) → bucket purge. DB Supabase tiene SOLO l'indice (sha, filename, location_on_vps).
**Trigger di adozione**: prima volta che un beta tester chiede "voglio caricare 20 PDF in un colpo" o "voglio una libreria documenti sul sito".

**A — DB transit** *(fallback, scartato come primario)*
Variante più semplice ma trasforma Postgres in coda binaria. Tenibile come piano B se D è troppo costoso. **Default**: non lo facciamo, D è meglio.

**E — Tailscale** *(per power-user e self-hoster)*
Mesh VPN tra PC utente e VPS. Dashboard locale-like, sicurezza massima, zero esposizione pubblica. Trade-off: l'utente deve installare un'app in più. Lo offriremo come "modalità avanzata" nel wizard del desktop launcher (`[JHT-VPS-FRIENDLY]`).
**Trigger di adozione**: quando il desktop launcher per VPS è pronto e vogliamo dare un'alternativa "no cloud relay" ai privacy-sensitive.

### Cosa NON facciamo (mai)

- ❌ **C** — esporre Next.js direttamente sull'IP pubblico della VPS senza reverse proxy maturo, cert mgmt, abuse handling. Apre superficie di attacco e ci porta nel territorio di "manutenzione infra utente" che vogliamo evitare.
- ❌ **F** — mailbox dedicata. Latenza 30-120s, deliverability incerta, sensazione "vecchio". Non vale l'effort.

---

## 🛠️ Implementazione ingest Telegram

### Flow end-to-end

```
👤 telefono              📡 Bot API                🖥️ container jht                 🤖 Assistente
   ┌──────┐  /start    ┌───────────┐             ┌────────────────────┐         ┌──────────────┐
   │ user │ ─────────▶ │ Bot       │             │                    │         │              │
   │  📎  │  +file     │ getFile   │ long-poll   │ tg-bridge.py       │ tmux    │ ASSISTENTE   │
   └──────┘ ─────────▶ │           │ ◀─────────  │  ↓ download        │ ──────▶ │ (claude TUI) │
                       └───────────┘             │ profile/inbox/     │         │              │
                                                 │ <filename>         │         └──────┬───────┘
                                                 └────────────────────┘                │ read + sort
                                                                                       ▼
                                                                          profile/sources/<file>
                                                                          + candidate_profile.yml
                                                                          + summaries/*.md
                                                                                       │ reply
                                                                                       ▼
                                                                          jht-telegram-send ...
```

### Componenti

#### 1. `tg-bridge.py` (`.launcher/`)

Pattern simile a `sentinel-bridge.py`. Long-poll Telegram Bot API → `jht-tmux-send ASSISTENTE`.

- Token + chat_id whitelist letti da `$JHT_HOME/jht.config.json` (`channels.telegram`)
- Offset persistente in `$JHT_HOME/tg-bridge-state.json` (sopravvive restart)
- Singleton: `kill` preesistenti via `/proc/*/cmdline` scan (no pkill)
- Dispatch per kind:
  - `text` → envelope `[@utente -> @assistente] [TG] <body>`
  - `document` → `getFile` + download in `profile/inbox/`, envelope `[TG-DOC] path=... name=... mime=... size=...`
  - `photo` → versione più grande, salva come `photo-<id>.jpg`, envelope `[TG-DOC]`
  - `voice` → salva come `voice-<id>.ogg`, envelope `[TG-DOC]` con `duration`
- Skip `/start` (è solo attivazione bot anti-spam)
- Limite hard 20 MB/file (limite Bot API): oltre → `[TG-DOC-REJECT]` all'Assistente che chiede all'utente di rimandare
- Download failure → `[TG-DOC-ERROR]`

#### 2. `jht-telegram-send` (`agents/_tools/`)

Wrapper bash + `curl` per **outbound**. Riusa token + chat_id dal config.

- Risoluzione: env var → `credentials/telegram_bot.json` → `channels.telegram` config
- Chunking automatico a 4000 char (limite Bot API 4096)
- Retry HTTP transitorio
- Flag `--html`, `--markdown`, `--chat-id <id>`
- Symlink automatico in `/usr/local/bin` via Dockerfile (riga 109-111)

#### 3. Skill `telegram-send` (`agents/_skills/telegram-send/`)

Documenta il wrapper per l'Assistente. Distribuita via `start-agent.sh` quando legge `skills.list`.

#### 4. Role `tg-bridge` in `start-agent.sh`

Short-circuit role analogo a `bridge` / `worker`: spawn `tg-bridge.py` in background via `setsid`, log su `/tmp/tg-bridge.log`.

#### 5. Bootstrap V7 (CLI + web)

Ordine post-fix:
```
0. ASSISTENTE       (tmux + welcome Telegram)
1. TG-BRIDGE +5s    (inbound consegna su ASSISTENTE)
2. SENTINELLA +3s
3. BRIDGE +20s      (sentinel + pacing, target CAPITANO)
4. CAPITANO +5s
```

### Wizard flow (setup pre-team-start)

`promptTelegramRequired` riscritto: invece di chiedere `chat_id` all'utente (che lo doveva leggere da `@userinfobot`), il wizard:

1. Chiede solo `bot_token`
2. `getMe` → risolve `@<bot_username>`
3. Mostra deep-link `https://t.me/<bot_username>?start=jht`
4. Long-poll `getUpdates` (15 min timeout, skip backlog) → cattura `chat_id` automaticamente al primo messaggio
5. Salva `{bot_token, chat_id}` nel config

**Beneficio collaterale**: il `/start` è obbligatorio per uscire dal wizard → al primo `jht-telegram-send` dell'Assistente la chat è già "aperta" → no `chat not found` error (root cause storica del 2026-05-12).

### Anti-pattern e gotcha noti

- ❌ **Non lanciare `jht-tmux-send` con messaggio multi-line da bash heredoc** — quoting fragile. Il wrapper accetta single arg con quotes singole; il bridge Python passa text-mode-safe via argv.
- ❌ **Non scaricare file > 20 MB direttamente**: Telegram Bot API limita a 20 MB con il bot token standard. Per file più grandi servirebbe self-hosted Bot API server (out of scope beta).
- ❌ **Non rispondere via `jht-send` a un `[TG]`**: l'utente è sul telefono, la dashboard web non è aperta. Skill `chat-web` vs `telegram-send` — leggi il prefix `[CHAT]` vs `[TG]` per decidere.

### Cose ancora NON fatte (per la beta)

- **Audio transcription** dei voice note: il file finisce in `inbox/voice-*.ogg` ma l'Assistente non ha un OCR/STT automatico. Per ora chiede all'utente di trascrivere a mano.
- **Photo OCR**: idem per immagini di documenti. L'Assistente potrebbe usare Claude vision tool, ma non è cablato.
- **Risposte con allegato**: outbound CV/cover-letter generati. Per ora `jht-telegram-send` manda solo testo. `sendDocument` su Bot API supportato, ma wrapper non lo espone. Estensione futura: `jht-telegram-send-doc <path>`.
- **Multi-utente**: il design ipotizza 1 VPS = 1 utente (whitelist su `chat_id` singolo nel config). Open platform → richiederà mapping `chat_id → user_id` su DB.

---

## 🗺️ Roadmap implementativa

1. **Adesso** → design + build ingest documenti via Telegram (Opz B) — `tg-bridge.py`, `jht-telegram-send`, skill, bootstrap V7
2. **Estensione multi-bot** → wizard per opt-in Capitano/Mentor bot, config `channels.telegram.bots.{assistente,capitano,mentor}`, routing per agente
3. **Notifiche batch Capitano** → ogni N posizioni `ready`, top-N per score con link + descrizione (default N=10, da rifinire)
4. **Fallback cloud sync** → marker DB + prompt injection per rispondere via dashboard web quando Telegram down
5. **Post-beta feedback** → valutare WhatsApp secondary (trigger: >2/10 beta tester rifiuta TG)
6. **v1 pubblica** → implementare Opz D (relay cloud S3/R2)
7. **Desktop launcher VPS** → integrare Opz E (Tailscale) come opzione avanzata

---

## 🔗 Riferimenti

- `docs/internal/vps.md` — design VPS (host/container split, providers, install UX)
- `docs/internal/vps.md` § "Setup wizard decisions" — decisioni VPS setup desktop wizard lockate il 2026-05-13
- `docs/internal/INFRA.md` — overview canali utente↔team
- `docs/internal/2026-05-01-bridge-and-token-monitoring.md` — bridge attuale
- `.launcher/tg-bridge.py` — implementazione bridge
- `.launcher/start-agent.sh` § ruolo `tg-bridge`
- `agents/_tools/jht-telegram-send` — outbound wrapper
- `agents/_skills/telegram-send/SKILL.md` — skill agente
- `agents/assistente/assistente.md` § "Ingest documenti Telegram"
- `cli/src/commands/team/start.js` — bootstrap V7
- `web/app/api/team/start-all/route.ts` — bootstrap V7 web
- `cli/wizard/setup-steps.js` § `promptTelegramRequired` — wizard auto-chat-id
- `telegram-bridge/src/` — codice bridge corrente
- `shared/channels/telegram-channel.ts` — abstraction lato shared
- `BACKLOG.md` — `[JHT-VPS-FRIENDLY]`, `[JHT-DESKTOP-SYNC]`
