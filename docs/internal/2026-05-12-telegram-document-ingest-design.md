# Telegram document ingest — design

**Data**: 2026-05-12
**Scelta canale**: vedi [`2026-05-12-document-channels-decision.md`](./2026-05-12-document-channels-decision.md) — Telegram (Opzione B) come canale primario beta.

## Flow end-to-end

```
👤 telefono              📡 Bot API                🖥️ container jht                 🤖 Assistente
   ┌──────┐  /start    ┌───────────┐             ┌────────────────────┐         ┌──────────────┐
   │ user │ ─────────▶ │ Bot       │             │                    │         │              │
   │  📎  │  +file     │ getFile   │ long-poll   │ tg-bridge.py       │ tmux    │ ASSISTENTE   │
   └──────┘ ─────────▶ │           │ ◀─────────  │  ↓ download         │ ──────▶ │ (claude TUI) │
                       └───────────┘             │ profile/inbox/      │         │              │
                                                 │ <filename>          │         └──────┬───────┘
                                                 └────────────────────┘                │ read + sort
                                                                                       ▼
                                                                          profile/sources/<file>
                                                                          + candidate_profile.yml
                                                                          + summaries/*.md
                                                                                       │ reply
                                                                                       ▼
                                                                          jht-telegram-send ...
```

## Componenti

### 1. `tg-bridge.py` (`.launcher/`)

Pattern simile a `sentinel-bridge.py`. Long-poll Telegram Bot API → `jht-tmux-send ASSISTENTE`.

- Token + chat_id whitelist letti da `$JHT_HOME/jht.config.json` (`channels.telegram`)
- Offset persistente in `$JHT_HOME/tg-bridge-state.json` (sopravvive restart)
- Singleton: `kill` preesistenti via `/proc/*/cmdline` scan (no pkill)
- Dispatch per kind:
  - `text` → envelope `[@utente -> @assistente] [TG] <body>`
  - `document` → `getFile` + download in `profile/inbox/`, envelope `[TG-DOC] path=... name=... mime=... size=...`
  - `photo` → prende la versione più grande, salva come `photo-<id>.jpg`, envelope `[TG-DOC]`
  - `voice` → salva come `voice-<id>.ogg`, envelope `[TG-DOC]` con `duration`
- Skippa `/start` (è solo l'attivazione bot anti-spam, non un messaggio reale)
- Limite hard 20 MB/file (limite Bot API): oltre → `[TG-DOC-REJECT]` all'Assistente che chiede all'utente di rimandare
- Download failure → `[TG-DOC-ERROR]`

### 2. `jht-telegram-send` (`agents/_tools/`)

Wrapper bash + `curl` per **outbound**. Riusa token + chat_id dal config.

- Risoluzione: env var → `credentials/telegram_bot.json` → `channels.telegram` config
- Chunking automatico a 4000 char (limite Bot API 4096)
- Retry HTTP transitorio
- Flag `--html`, `--markdown`, `--chat-id <id>`
- Symlink automatico in `/usr/local/bin` via Dockerfile (riga 109-111)

### 3. Skill `telegram-send` (`agents/_skills/telegram-send/`)

Documenta il wrapper per l'Assistente. Distribuita via `start-agent.sh` quando legge `skills.list`.

### 4. Role `tg-bridge` in `start-agent.sh`

Short-circuit role analogo a `bridge` / `worker`: spawn `tg-bridge.py` in background via `setsid`, log su `/tmp/tg-bridge.log`.

### 5. Bootstrap V7 (CLI + web)

Ordine post-fix:
```
0. ASSISTENTE       (tmux + welcome Telegram)
1. TG-BRIDGE +5s    (inbound consegna su ASSISTENTE)
2. SENTINELLA +3s
3. BRIDGE +20s      (sentinel + pacing, target CAPITANO)
4. CAPITANO +5s
```

## Wizard flow (setup pre-team-start)

`promptTelegramRequired` riscritto: invece di chiedere chat_id all'utente (che lo doveva leggere da `@userinfobot`), il wizard:

1. Chiede solo `bot_token`
2. `getMe` → risolve `@<bot_username>`
3. Mostra deep-link `https://t.me/<bot_username>?start=jht`
4. Long-poll `getUpdates` (15 min timeout, skip backlog) → cattura `chat_id` automaticamente al primo messaggio
5. Salva `{bot_token, chat_id}` nel config

**Beneficio collaterale**: il `/start` è obbligatorio per uscire dal wizard → al primo `jht-telegram-send` dell'Assistente la chat è già "aperta" → no `chat not found` error (root cause storica del 2026-05-12).

## Anti-pattern e gotcha noti

- ❌ **Non lanciare `jht-tmux-send` con messaggio multi-line da bash heredoc** — quoting fragile. Il wrapper accetta single arg con quotes singole; il bridge Python passa text-mode-safe via argv.
- ❌ **Non scaricare file > 20 MB direttamente**: Telegram Bot API limita a 20 MB con il bot token standard. Per file più grandi servirebbe self-hosted Bot API server (out of scope beta).
- ❌ **Non rispondere via `jht-send` a un `[TG]`**: l'utente è sul telefono, la dashboard web non è aperta. Skill `chat-web` vs `telegram-send` — leggi il prefix `[CHAT]` vs `[TG]` per decidere.

## Cose ancora NON fatte (per la beta)

- **Audio transcription** dei voice note: il file finisce in `inbox/voice-*.ogg` ma l'Assistente non ha un OCR/STT automatico. Per ora chiede all'utente di trascrivere a mano.
- **Photo OCR**: idem per immagini di documenti. L'Assistente potrebbe usare Claude vision tool, ma non è cablato.
- **Risposte con allegato**: outbound CV/cover-letter generati. Per ora `jht-telegram-send` manda solo testo. `sendDocument` su Bot API supportato, ma wrapper non lo espone. Estensione futura: `jht-telegram-send-doc <path>`.
- **Multi-utente**: il design ipotizza 1 VPS = 1 utente (whitelist su `chat_id` singolo nel config). Open platform → richiederà mapping `chat_id → user_id` su DB.

## Riferimenti

- `.launcher/tg-bridge.py` — implementazione bridge
- `.launcher/start-agent.sh` § ruolo `tg-bridge`
- `agents/_tools/jht-telegram-send` — outbound wrapper
- `agents/_skills/telegram-send/SKILL.md` — skill agente
- `agents/assistente/assistente.md` § "Ingest documenti Telegram"
- `cli/src/commands/team/start.js` — bootstrap V7
- `web/app/api/team/start-all/route.ts` — bootstrap V7 web
- `cli/wizard/setup-steps.js` § `promptTelegramRequired` — wizard auto-chat-id
