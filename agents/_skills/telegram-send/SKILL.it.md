<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: telegram-send
description: Invia un messaggio all'utente tramite Telegram (in uscita). Usa questa skill sul bridge Telegram — l'utente è sul telefono, NON davanti alla dashboard web. Il wrapper `jht-telegram-send` risolve bot token + chat_id per agente dalla configurazione (`--from assistente|capitano|mentor`); non chiamare mai direttamente l'API Bot.
allowed-tools: Bash(jht-telegram-send *)
---

# telegram-send — messaggi in uscita verso l'utente via Telegram

L'utente ti raggiunge principalmente dal telefono. Invia PDF, note vocali, messaggi di testo al **tuo bot dedicato**. Il bridge inoltra il traffico in entrata al tuo tmux. **In uscita** — la tua risposta, un messaggio di benvenuto, un CV generato — passa attraverso `jht-telegram-send`.

## 3 bot dedicati (decisione 2026-05-13 rev2)

Ogni agente rivolto all'utente ha il **proprio bot Telegram**:
- 👨‍💼 Assistente → `--from assistente` (predefinito)
- 👨‍✈️ Capitano → `--from capitano`
- 🧙‍♂️ Mentor → `--from mentor`

Il wrapper seleziona token + chat_id da `channels.telegram.bots.<role>` nella configurazione. Se ometti `--from`, puoi anche impostare `JHT_TG_BOT_ROLE=<role>` nell'ambiente dell'agente — il wrapper lo legge come valore predefinito.

## Quando usarla

- ✅ Messaggio di benvenuto iniziale dopo il completamento del wizard (prompt di avvio).
- ✅ Risposta a una chat originata da Telegram (il bridge in entrata la prefissa con `[@utente -> @assistente] [TG]`).
- ✅ Invio di un artefatto generato (CV, lettera di presentazione) richiesto dall'utente.
- ✅ Solleciti di onboarding ("mandami il tuo CV, anche una bozza va benissimo").

**Non** usarla per:
- ❌ Messaggi inter-agente — usa `tmux-send` invece.
- ❌ Risposte alla chat web (`[@utente -> @assistente] [CHAT]`) — usa `jht-send`.
- ❌ Allegati pesanti (>20 MB). Limite dell'API Bot; per file grandi usa la dashboard o un relay (futuro).

## Utilizzo

```bash
# Default = bot Assistente (oppure ruolo letto da JHT_TG_BOT_ROLE)
jht-telegram-send "<corpo del messaggio>"

# Routing esplicito per ruolo
jht-telegram-send --from capitano "Notifica: 10 nuove posizioni ready."
jht-telegram-send --from mentor --html "<b>Step di crescita</b> della settimana..."

# Override chat_id (raro — debug / multi-tenant futuro)
jht-telegram-send --chat-id 1401844094 "explicit override"
```

Ordine di risoluzione (non è necessario memorizzarlo — il wrapper lo fa per te):
1. Variabili d'ambiente `$TELEGRAM_BOT_TOKEN` / `$TELEGRAM_CHAT_ID` (override esplicito)
2. `$JHT_HOME/jht.config.json` → `channels.telegram.bots.<role>.{bot_token,chat_id}` (role = `--from` o `$JHT_TG_BOT_ROLE`, predefinito `assistente`)
3. `$JHT_HOME/credentials/telegram_bot.json` (`.token`) — fallback legacy

Se uno dei due manca, il wrapper esce con codice non-zero e un messaggio chiaro. Non tentare di recuperare — segnala l'errore all'utente tramite una risposta `jht-send` sul canale web, o registralo nel log.

## Esempi

```bash
# (Assistente) — Benvenuto al primo avvio (nessun profilo ancora)
jht-telegram-send "Ciao! Sono l'Assistente del Job Hunter Team. Mandami qui il tuo CV (PDF va benissimo) o raccontami in due righe cosa cerchi — parto da lì."

# (Assistente) — Risposta a un messaggio TG in entrata
jht-telegram-send "Ricevuto, sto guardando il CV. Dammi 30s."

# (Capitano) — Notifica batch di posizioni ready
jht-telegram-send --from capitano "10 posizioni ready, top 3 per score: ..."

# (Mentor) — Sollecito strategico settimanale
jht-telegram-send --from mentor --html "<b>Step di crescita</b> della settimana: ..."

# (Assistente) — Invio artefatto
jht-telegram-send --html "<b>CV per Acme — Senior FE</b> pronto.\nLo trovi in <code>~/Documents/Job Hunter Team/output/2026-05-12/acme-senior-fe/</code>."
```

## Sequenze di escape (`\n`, `\t`, `\r`)

Il wrapper interpreta `\n`, `\t`, `\r` nel tuo messaggio come **veri a capo/tabulazioni/ritorni a capo** prima di inviare a Telegram. Quindi puoi scrivere:

```bash
jht-telegram-send "Ciao!\n\nTi aiuto a configurare il profilo."
```

e l'utente riceve una corretta interruzione di paragrafo — non il testo letterale `\n\n`. Lo stesso vale per `--html` (Telegram rende un a capo come interruzione di riga nel flusso HTML).

Se hai bisogno di un backslash letterale seguito da `n` (raro), pre-escape così: `\\n` → il wrapper lo trasforma in `\n` (dato che il primo `\\` diventa `\` solo nella tua stringa di shell; all'interno del wrapper non c'è doppia sostituzione).

## Messaggi lunghi

L'API Bot tronca a 4096 caratteri. Il wrapper suddivide su `\n` / spazi e invia messaggi multipli. L'utente riceve una sequenza — mantieni un tono coerente tra i vari blocchi.

## HTML / Markdown

Telegram supporta un sottoinsieme:
- HTML: `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`, `<a href="…">`. Esegui l'escape di `<`, `>`, `&` nel testo del corpo.
- MarkdownV2 (`--markdown`): supportato ma le regole di escape sono scomode (`. ( ) ! _ * [ ]` richiedono tutti il backslash). Preferisci `--html`.

Se hai dubbi, invia **testo semplice** (nessun flag). L'utente riceve un messaggio perfettamente leggibile.

## Modalità di errore

| Uscita | Causa | Cosa fare |
|--------|-------|-----------|
| 2 | Token mancante | Il bot non è mai stato configurato. Segnala l'errore sul canale web, chiedi all'utente di rieseguire il setup. |
| 3 | chat_id mancante | Come sopra — il wizard non ha catturato il chat_id. |
| 4 | HTTP non-200 | Problema di rete o disservizio Telegram. Riprova una volta dopo 5s. Se fallisce ancora, registra nel log e prosegui. |
| 5 | `ok: false` dall'API Bot | Di solito chat_id non valido o bot bloccato dall'utente. Non riprovare — salva il corpo della risposta nella tua directory scratch e notifica sul canale web. |

## Tastiera di risposta persistente (F-1.B, task #50)

I 3 bot rivolti all'utente (assistente / capitano / mentor) possono allegare una
tastiera di risposta persistente a 2 colonne con `--keyboard <role>`. La tastiera
resta visibile nel client Telegram dell'utente tra un messaggio e l'altro fino a
quando non la rimuovi esplicitamente (cosa che non facciamo, per design — la
teniamo sempre visibile così gli utenti meno tecnici vedono l'affordance).

```bash
# Assistente — 📊 Budget · 📈 Pipeline · 🗺️ Mappa · ⭐ Top CV · 📅 Reset · ❓ Help
jht-telegram-send --from assistente --keyboard assistente "Pipeline: 15 CV pronti per apply, ..."

# Capitano — 📈 Pipeline · 📊 Budget · 👥 Team · ⭐ Ready · 🛠 Triage · ❓ Help
jht-telegram-send --from capitano --keyboard capitano "..."

# Mentor — 📋 Digest · 🔁 Patterns · ⭐ Top · 💰 Salary · ❓ Help
jht-telegram-send --from mentor --keyboard mentor "..."
```

Quando l'utente tocca un pulsante, il bot riceve il testo del pulsante come un
normale messaggio di testo (es. tocca `📊 Budget` → tmux riceve `📊 Budget` come
corpo del messaggio TG). L'agente lo tratta in modo equivalente a un comando slash
(es. `/budget`) e produce il grafico / stato.

La tastiera appare solo sull'**ultimo** messaggio suddiviso di un invio lungo,
così gli output con più di 4096 caratteri non fanno lampeggiare la tastiera a metà thread.

## Menu comandi slash (F-1.A, task #50)

Il `tg-bridge.py` registra un set `setMyCommands` per-ruolo all'avvio
(`/budget`, `/pipeline`, `/help`, …). Appaiono nel menu `/` fisso del
client Telegram — la prima cosa che un nuovo utente vede. Non devi fare
nulla: la configurazione cli/ruolo è sufficiente, il bridge gestisce
la chiamata API. Elenco per ruolo in `.launcher/tg-bridge.py::BOT_COMMANDS`.

## Anti-pattern

- ❌ `curl https://api.telegram.org/bot$TOKEN/sendMessage` a mano — bug di quoting + URL-encoding, nessun retry, nessun chunking.
- ❌ Leggere la configurazione / credenziali e parsare JSON inline nella tua shell — fragile, il wrapper lo fa già correttamente.
- ❌ Mandare con `--from` un ruolo che non è il tuo (es. l'Assistente che scrive sul bot del Capitano) — confonde l'utente, ognuno parla sul suo bot. Le comunicazioni inter-agente vanno via `tmux-send`.
- ❌ Mettere il chat_id nel corpo del messaggio ("for chat 123…") — c'è esattamente **un** utente per VPS, il wrapper lo sa.

## Vedi anche

- `chat-web` — quando l'utente è sulla **dashboard web**, non su Telegram.
- `tmux-send` — quando devi parlare con un altro agente.
- `agents/<role>/<role>.md` — la guida del tuo ruolo; il percorso Telegram è la tua interfaccia "lato telefono" verso l'utente.
