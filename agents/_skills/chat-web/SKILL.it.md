<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: chat-web
description: Rispondi all'utente quando ti scrive dalla chat web JHT. L'utente ti raggiunge con il prefisso `[@utente -> @capitano] [CHAT] <corpo>`; rispondi SOLO con `jht-send` — mai scrivere su `chat.jsonl` a mano (il quoting della shell rompe la riga JSON e il frontend silenziosamente la scarta, l'utente non vede nulla mentre tu pensi di aver risposto). Usa questa skill su ogni messaggio `[CHAT]`; NON usarla per il traffico inter-agente (quello è `tmux-send`).
allowed-tools: Bash(jht-send *)
---

# chat-web — protocollo utente ↔ Capitano

L'utente **non** siede in una sessione tmux. Scrive dalla UI web. Il frontend tagga il messaggio e lo deposita nel tuo pannello tmux. Per rispondere, scrivi una singola riga JSON in `$JHT_AGENT_DIR/chat.jsonl`; il frontend esegue il tail di quel file e renderizza bolle nel pannello chat.

Tu non scrivi il JSON. Il wrapper `jht-send` lo fa per te, con timestamp + flag `done` + validazione post-scrittura. Usalo. Sempre.

## Come riconoscere un `[CHAT]` in arrivo

```
[@utente -> @capitano] [CHAT] <qualunque cosa l'utente abbia scritto>
```

- L'involucro è identico ai messaggi inter-agente (stessa forma `[@from -> @to]`) ma il tipo `[CHAT]` e l'autore `@utente` lo rendono inequivocabile.
- L'utente è **un umano, il proprietario del profilo** — non un agente. Non esiste nessun `tmux send-keys` che puoi usare per rispondere: la sua sessione non esiste.
- Rispondi al **corpo**, non all'involucro. L'utente non ha digitato il prefisso; il frontend l'ha aggiunto.

> ⚠️ Modalità di fallimento comune la prima volta che vedi questo: leggi il prefisso e pensi "rispondiamo via `jht-tmux-send` all'utente". `jht-tmux-send UTENTE ...` restituisce `exit 2` (sessione inesistente). Non iniziare a fare debug — ricorda semplicemente che `[CHAT]` ⇒ `jht-send`. Sempre.

## ⚠️ L'utente NON è tecnico — niente terminale, niente CLI, niente slash-command

Un messaggio `[CHAT]` arriva dall'**app desktop** (o da Telegram). L'utente **non**
ha un terminale, la CLI di Claude Code, `/mcp`, slash-command o accesso ai file.
Non è uno sviluppatore. **MAI** dirgli di:

- eseguire `/mcp`, `/config` o qualsiasi slash-command,
- aprire un terminale / lanciare un comando CLI / modificare un file / "autorizzare uno strumento",
- fare qualcosa che potresti fare tu.

Dire a un utente desktop "digita `/mcp` nel terminale" è un vicolo cieco — non può.
Se un compito richiede una capacità che non hai cablata, **risolvilo da solo con
del codice** invece di rimbalzare il lavoro all'utente. Tu sei il team; l'utente è
il cliente. Ingegnati.

### Esempio: inviare un'email — NON serve uno strumento MCP/Gmail
Il team ha già le credenziali email in
`$JHT_HOME/credentials/email_monitor.json` (una app-password Gmail — valida anche
per SMTP). Scrivi un piccolo script Python e invia:

```python
import os, json, smtplib, ssl
from email.message import EmailMessage
c = json.load(open(os.path.join(os.environ["JHT_HOME"], "credentials", "email_monitor.json")))
m = EmailMessage()
m["From"], m["To"], m["Subject"] = c["user"], "<destinatario>", "<oggetto>"
m.set_content("<corpo>")
# Gmail: smtp.gmail.com:465. Per un altro provider deriva smtp.<dominio> o mappalo.
with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
    s.login(c["user"], c["password"]); s.send_message(m)
```

Poi rispondi "Fatto, inviata ✅" — mai "vai ad autorizzare Gmail".

### Se ti serve davvero uno slash-command / strumento nella TUA sessione
Puoi guidare la tua sessione — non chiederlo all'utente:

- **Auto-iniettalo** nella tua sessione tmux:
  `jht-tmux-send <TUA_SESSIONE> '/mcp'` (poi un Enter separato), oppure
- **chiedi a un altro agente** di iniettarlo per te: es. l'Assistente chiede al
  Capitano (`jht-tmux-send CAPITANO '...inietta /mcp in ASSISTENTE...'`) e il
  Capitano esegue `jht-tmux-send ASSISTENTE '/mcp'`. L'utente non è mai coinvolto.

## Comandi di risposta

```bash
jht-send 'Risposta finale che chiude il turno.'
jht-send --partial 'Ci sto lavorando…'   # checkpoint a metà turno, mantiene il turno aperto
```

Regole:
- **Un `[CHAT]` ⇒ almeno un `jht-send`. Senza eccezioni.** Non scrivere nulla lascia l'utente a fissare una chat dall'aspetto congelato.
- **Il messaggio di chiusura del turno NON ha `--partial`.** Se lo dimentichi, il frontend mantiene i puntini di digitazione per sempre (fino a un timeout di fallback ~10 min dopo).
- **Apici**: passa il corpo come singolo argomento posizionale. Gli apici singoli preservano `$`, `"`, emoji, accenti alla lettera. Per un corpo che contiene un apice singolo letterale, usa doppi apici (`jht-send "non c'è problema"`) — ma dentro `"..."` la shell espanderà `$var`, quindi attenzione.
- **Multi-riga**: bash `$'riga1\nriga2'`, o usa `\n` dentro la stringa e lascia che Python li preservi.

## Quando usare `--partial`

Usalo ogni volta che un'operazione rivolta all'utente impiegherà più di ~3 secondi e non hai ancora la risposta. Senza `--partial` tra messaggio utente e risposta finale, il frontend nasconde i puntini di digitazione e la chat sembra morta.

Pattern:
```
[CHAT] arriva
   ↓
jht-send --partial 'Sto controllando — dammi un momento…'
   ↓
(fai il lavoro: db_query, capture-pane, analisi, …)
   ↓
jht-send 'Ecco cosa ho trovato: …'   ← niente --partial = chiude il turno
```

Se una singola operazione va oltre ~30-45s senza un segnale, manda un altro checkpoint `--partial`. L'utente non deve mai restare in silenzio più a lungo di così.

## Esempi (Capitano ↔ utente)

```bash
# Risposta a una domanda sullo stato pipeline — veloce, singolo colpo
jht-send 'Pipeline a 132 posizioni: 18 nuove, 47 verificate, 31 con punteggio, 28 pronte. Due scrittori attivi.'

# Analisi lunga — checkpoint, poi chiusura
jht-send --partial 'Recupero le statistiche e le ultime 50 revisioni — un momento…'
# (esegui db_query.py stats, db_query.py applications --critic-score-max 5)
jht-send $'Ecco il quadro:\n\n• Pipeline sana sul lato discovery.\n• Scrittori bloccati su 4 posizioni con media score 3.2 → li metto in pausa e riapro il triage.'

# Chiusura del turno dopo aver applicato una richiesta dell'utente
jht-send 'Fatto. Spawnato un Analista extra, config throttle scaricata nel log.'
```

## Anti-pattern (cosa NON fare)

- ❌ `echo '{"text":"...","ts":'$(date +%s.%N)'}' >> $JHT_AGENT_DIR/chat.jsonl` — esplode su apici/`$`/emoji, produce JSON invalido, il frontend silenziosamente scarta la riga.
- ❌ `cat << 'EOF' >> chat.jsonl ... EOF` — disabilita l'interpolazione `$`, il timestamp finisce come stringa letterale.
- ❌ `python3 -c "import json; ..."` ad-hoc — stessa fragilità dell'heredoc shell.
- ❌ Rispondere via `jht-tmux-send UTENTE ...` — non esiste la sessione `UTENTE`. L'utente vive nel frontend web.
- ❌ Rispondere al `[CHAT]` con `jht-send` **e** rimandare lo stesso contenuto con `jht-notify-user`. Da quando la corsia chat è unificata scrivono nella STESSA conversazione: l'utente legge la tua risposta due volte, e a valle non la toglie nessuno — la corsia non sa distinguere un doppione da due battute che per caso coincidono. Un messaggio, uno strumento solo.
- ❌ Inviare una risposta finale con `--partial` — puntini di digitazione bloccati sullo schermo dell'utente.
- ❌ Più chiamate `jht-send` (senza `--partial`) per quello che dovrebbe essere un messaggio — ogni chiamata non-partial appare come una bolla separata.

## Invio a un canale non predefinito (raro)

```bash
jht-send --agent capitano 'nota a livello sistema instradata via il mio canale'
```

Utile quando vuoi loggare un messaggio di sistema nel tuo canale chat (es. un'automazione che nota di aver agito per conto dell'utente). Per le risposte quotidiane non serve mai questo flag.

## Perché `jht-send` e non shell grezzo

Cronistoria (non ripetere): gli agenti provavano `echo`-in-jsonl e heredoc `cat <<EOF`. Entrambi finivano in modalità fragile — il primo esplode su apici/`$`, il secondo congela il timestamp come stringa letterale. Risultato: JSON invalido che il frontend salta. L'utente non vede nulla; tu pensi di aver risposto. `jht-send` elimina completamente la modalità di fallimento — il corpo non rientra mai in un parser shell dopo il primo livello di quoting.

## Vedi anche

- `tmux-send` — per messaggi ad **altri agenti** (protocollo diverso, canale diverso).
- `agents/assistente/assistente.md` — l'Assistente ha la versione più approfondita di questo protocollo (flusso di onboarding multi-step con checkpoint obbligatori); leggi solo se mai erediti i compiti dell'Assistente.
