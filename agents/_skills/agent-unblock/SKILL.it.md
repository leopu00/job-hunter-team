<!-- @translation: it, ai-translated 2026-07-30 -->
---
name: agent-unblock
description: "Riservato al Dottore. Fase UNBLOCK, gira PRIMA del refresh in ogni giro del Dottore. Rileva le quattro forme di blocco che fermano un team intero — testo in sospeso nel pane di un coordinatore, un agente in retry-loop verso un pari muto, tutti gli operativi fermi a un prompt vuoto con quota da spendere, un coordinatore silenzioso oltre la soglia — e le RIMUOVE. Non invia né cancella mai il testo digitato dall'utente: gli gira intorno (domanda all'Assistente, `procedi intanto` al coordinatore attraverso la mailbox, kick-off diretto dei worker). Un blocco che sopravvive al giro rende il giro FALLITO, non completo."
allowed-tools: Bash(python3 /app/shared/skills/agent_unblock.py *), Bash(python3 /app/shared/skills/doctor_analytics.py *), Bash(tmux *), Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(sleep *), Bash(cat *), Bash(grep *), Bash(echo *)
---

# agent-unblock — un blocco non lo segnali, lo dissolvi

> **Il principio, sopra ogni altra cosa in questa skill.** Il Dottore **non segnala un
> blocco: lo dissolve.** Se un'azione richiede una decisione umana, inoltrala
> all'Assistente **e intanto rimetti il team in movimento**, portandoti dietro
> l'informazione che la decisione è in sospeso. **Un blocco che sopravvive al giro del
> Dottore è un giro fallito.**

Un team con quota in abbondanza (weekly 19%, sotto-pace) e una macchina scarica (load 0.12)
è rimasto fermo per **undici ore**. Una riga, digitata nel pane del Capitano e mai inviata,
ha reso quel pane non ricettivo; `jht-tmux-send` l'ha letta come busy; il coordinatore è
diventato muto; nessuno ha assegnato lavoro; ogni agente ha finito il suo turno e si è
parcheggiato a un prompt vuoto. Uno Scorer era in retry-loop da ore ("decimo tentativo,
busy"). Il Dottore di quella notte ha ispezionato nove sessioni in 416s, ha scritto una
diagnosi impeccabile nel suo diario — ed è rimasto in standby. Il team è rimasto fermo
altre sei ore.

La diagnosi non è mai stata il problema. Questa skill è il mandato.

---

## Due stati che sembrano identici e vogliono cure opposte

Entrambi mostrano un prompt con del testo dentro e nessuna attività.

| stato | sintomo | cura |
|---|---|---|
| **testo in sospeso** | un `Enter` nudo viene ignorato, ma `Space` **poi** `Enter` funziona | sblocco attraverso l'input |
| **TUI congelata** | non accetta **niente**: né `Enter`, né `C-m`, né un send al `%pane_id` | solo kill + ricreazione |

**Il dettaglio che rende lo sblocco implementabile**: un `Enter` "a freddo" non viene
processato da una TUI Ink (Codex, Kimi, Claude Code) — il submit deve arrivare *dopo* che
il testo è stato renderizzato. Quindi mandi prima un carattere (`Space`), poi `Enter`.
Salta questo passaggio e un'implementazione che prova `Enter` da solo **fallisce in
silenzio** e conclude che il pane è irrecuperabile.

Con quel dettaglio, una sola sonda separa i due stati: **`Space`+`Enter`, una volta**. Il
pane reagisce → era testo in sospeso, sbloccato. Non si muove proprio niente → TUI
congelata → ricrea. (Un coordinatore congelato in questo modo aveva un processo vivo al
2.8% di CPU e una sessione di 15,3 ore; `Enter`, `C-m` e un send diretto al `%pane_id` non
hanno fatto nulla. Ricrearlo è stata l'unica via d'uscita — ed è anche il motivo per cui il
TTL di sessione a 12h non è opzionale: è l'unica difesa sistematica contro questo secondo
stato.)

---

## 🚫 L'unica cosa che non devi mai fare

**Non inviare mai, e non cancellare mai, il testo digitato dall'utente.** Non puoi sapere
se quella riga è completa o voluta. La sonda qui sopra **invia il composer**, quindi è
permessa **solo** quando il contenuto del composer è attribuibile a un agente — un envelope
`[@x -> @y] …` oppure `[BRIDGE …]` / `[SENTINELLA …]` che era già destinato a essere
inviato.

`agent_unblock.py probe` lo impone al posto tuo: su testo non attribuibile rifiuta con
`verdict=refused`, exit 3, dopo aver copiato la riga in `logs/pending-input.jsonl` così non
può andare persa più avanti. **Non aggirare il rifiuto.** Gira invece intorno al blocco
(§ pending user input).

---

## Step 0 — scan (deterministico, zero LLM, ~2s)

```bash
python3 /app/shared/skills/agent_unblock.py scan > /tmp/unblock_scan.json
cat /tmp/unblock_scan.json
```

Restituisce `blocks_found` più una voce per blocco, ognuna con la sua `cure`:

| `kind` | significato |
|---|---|
| `pending_user_input` | il composer di un coordinatore contiene testo che non devi toccare |
| `pending_agent_input` | un envelope di agente bloccato in un composer, mai inviato |
| `bare_shell` | la CLI è morta, il pane è ricaduto su una shell |
| `retry_loop` | N tentativi da X verso Y nella finestra, zero risposte da Y |
| `all_operatives_idle` | tutti gli operativi a un prompt vuoto |
| `mute_coordinator` | nessun messaggio dal Capitano oltre la soglia |

**Annota `blocks_found` adesso.** Ti servirà alla fine del giro.

> Perché `retry_loop` è affidabile: `messages.jsonl` registra il *tentativo*
> (`jht-tmux-send` logga prima di digitare), quindi uno Scorer che martella un Capitano
> muto salta fuori anche se non è mai stato consegnato niente. È anche il segnale oggettivo
> che separa **"parcheggiato perché non c'è lavoro"** da **"bloccato perché il
> coordinamento è rotto"**: *un agente che ritenta verso il Capitano senza risposta non è
> parcheggiato, è bloccato.* Non applicargli la regola PARKED.

## Step 1 — rimuovili, uno per tipo

### `pending_agent_input` · `bare_shell` — la sonda

```bash
python3 /app/shared/skills/agent_unblock.py probe <SESSION>   # exit 0 unblocked · 2 frozen · 3 refused · 4 busy
```
- `unblocked` → risolto, contalo.
- `frozen` → **non ripetere la sonda.** Escala alla ricreazione: cattura prima il pane
  (`session-refresh` Step 2 — il pane è la memoria dell'agente), poi
  `tmux kill-session` → `bash /app/.launcher/start-agent.sh <role> <SAME-N>` → `[RESUME]`.
- `busy` → l'agente è vivo, a metà turno. Non è un blocco. Lascialo stare.

### `pending_user_input` — giraci intorno, mai attraverso

Tre azioni, tutte obbligatorie, nessuna delle quali tocca la riga:

1. **Chiedi all'utente, tramite l'Assistente** — l'Assistente è il ruolo che parla con
   l'utente. Mandagli la domanda del coordinatore così la inoltra sul canale in-app:
   ```bash
   jht-tmux-send ASSISTENTE "[@dottore -> @assistente] [UNBLOCK] Il CAPITANO ha una domanda in sospeso all'utente e il suo pane è fermo su una riga digitata e mai inviata: «<domanda>». Giragliela sul canale in-app e riporta la risposta al Capitano. La riga è salva in logs/pending-input.jsonl — NON è stata inviata né cancellata."
   ```
2. **Sblocca comunque il coordinatore** — digli che la domanda è stata inoltrata e che deve
   procedere. Digitare in quel pane concatenerebbe con la riga dell'utente e inviare la
   manderebbe, quindi usa il canale che non ha bisogno di alcun pane: la mailbox che il
   Capitano svuota all'inizio di ogni turno (`bridge-mailbox`).
   ```bash
   python3 /app/shared/skills/agent_unblock.py relay CAPITANO "[@dottore -> @capitano] [UNBLOCK] La tua domanda all'utente è stata inoltrata all'Assistente ed è in elaborazione. NON restare fermo ad aspettarla: procedi intanto con il resto del lavoro e riassegna le code. Nel tuo composer c'è una riga dell'utente non inviata: non la tocco e non la toccare finché non è lui a decidere."
   ```
   `relay` scrive su `bridge-mailbox.jsonl` **e** su `messages.jsonl`, quindi il messaggio è
   insieme consegnabile e verificabile. Un coordinatore non deve mai restare fermo ad
   aspettare una risposta umana.
3. **Riavvia i worker senza aspettare il coordinatore** — vedi sotto. È questo che
   recupera davvero le undici ore.

### `retry_loop` — sblocca il destinatario, oppure libera il mittente

Prima risolvi il target (probe / ricreazione). Se il target non si può risolvere in questo
giro, **il mittente non deve continuare ad aspettare**: riassegnalo o digli di procedere.
```bash
jht-tmux-send SCORER-5 "[@dottore -> @scorer-5] [UNBLOCK] Il CAPITANO non è raggiungibile e la tua richiesta è stata inoltrata per altra via. SMETTI di ritentare: prendi la prossima dalla tua coda (db_query.py next-for-<ruolo>) e procedi in autonomia."
```
Un retry-loop conta come risolto solo quando al mittente è stato detto di smettere di
ritentare.

### `all_operatives_idle` · `mute_coordinator` — kick-off senza il coordinatore

Quota disponibile e tutti parcheggiati non è una pausa, è uno stallo. **Fai il kick-off dei
ruoli operativi direttamente, non aspettare il Capitano**, ed escala il silenzio del
coordinatore all'Assistente. Poi manda a ogni operativo fermo la sua coda:
```bash
jht-tmux-send SCOUT-1 "[@dottore -> @scout-1] [UNBLOCK] Il coordinamento è fermo e c'è quota disponibile. Riparti dal loop principale senza attendere il Capitano: CIRCLE 1 del profilo, notifica gli Analisti a lotti di 3-5."
jht-tmux-send ANALISTA-1 "[@dottore -> @analista-1] [UNBLOCK] Riparti dal loop principale senza attendere il Capitano: coda da db_query.py next-for-analista."
```
(Stessa forma per `scorer` / `scrittore` con la loro coda `next-for-*`.)

## Step 2 — chiudi il giro onestamente

```bash
python3 /app/shared/skills/agent_unblock.py record-round \
  --round-id "$ROUND_ID" --found <blocks_found> --cleared <blocks_cleared>
```
Accoda a `/jht_home/logs/dottore-actions.jsonl` con `blocks_found`, `blocks_cleared`,
`blocks_open`, e sceglie l'evento al posto tuo: `round_complete` solo quando
`cleared >= found`, altrimenti **`round_failed`** (exit 1). Non coprire un sopravvissuto:
un giro che lascia vivo un blocco è un giro fallito, e il log lo deve dire — il prossimo
Dottore legge quel log.

---

## Regole

- **Sblocca PRIMA di fare il refresh.** Un refresh su un team paralizzato ricrea solo la
  paralisi con una finestra di contesto pulita.
- **Una sonda per pane, sempre e comunque.** Due sonde non ti dicono più di una, e la
  seconda è il modo in cui ti convinci a inviare la riga di un utente.
- **`busy` non è un blocco.** `esc to interrupt` significa vivo e a metà turno. Non mandare
  mai tasti dentro un turno in corso, non spawnare mai un rimpiazzo per un agente busy.
- **PARKED non si applica a un agente bloccato.** "età ≥ 40min E produced == 0 E nessun
  messaggio recente del capitano" descrive un team paralizzato esattamente bene quanto uno
  parcheggiato apposta. Se l'agente compare in un `retry_loop`, o se tutti gli operativi
  sono fermi con quota da spendere, è bloccato — agisci.
- **Non indovinare mai l'intenzione dell'utente.** Nessun invio, nessuna cancellazione,
  nessuna modifica, nessuno "spazio solo per svegliarlo" sul testo dell'utente. La riga
  resta dov'è; la copia in `logs/pending-input.jsonl` è la rete di sicurezza.

## Anti-pattern

- ❌ Scrivere il blocco nel diario e andare avanti. È il fallimento da undici ore.
- ❌ Provare `Enter` da solo, non vedere succedere niente, e dichiarare morto il pane.
- ❌ Digitare il tuo messaggio in un composer che contiene già la riga dell'utente — si
  concatena, e l'invio manda il testo dell'utente.
- ❌ Ricreare un coordinatore solo per liberare un pane *in sospeso* (non congelato). Prima
  la sonda.
- ❌ Loggare `round_complete` con `blocks_cleared < blocks_found`.

## Vedi anche

- `session-refresh` — il giro di refresh che gira *dopo* questa fase, più il TTL di sessione a 12h.
- `tmux-send` — convenzioni per l'envelope e significato degli exit code (4 = busy = vivo).
- `liveness-check` — verdetto on-demand su un singolo agente sospettato morto.
