# 🧊 Il team congelato da un `Enter` a freddo — postmortem 2026-08-03

Su una VPS beta il team è stato **fermo il 90% del tempo per cinque giorni** senza che nessun watchdog lo rilevasse. Il contatore delle posizioni continuava a salire, quindi dall'esterno il sistema sembrava vivo: in realtà produceva **un quinto** di quello che produceva prima.

La causa è un dettaglio di terminale: una TUI Ink (Claude Code, Codex, Kimi) **ignora un `Enter` inviato "a freddo"** via `tmux send-keys`. Il messaggio resta scritto nel composer e non parte mai. Da lì in poi tre difese che avrebbero dovuto raccoglierlo hanno fallito una dopo l'altra, e il guasto è diventato permanente e silenzioso.

I fix per i punti 1-3 sono **scritti e testati sul branch di sviluppo**, ma l'immagine in esecuzione sulla VPS è del **29/07** e non ne contiene nessuno: serve rebuild + `docker pull` + restart.

---

## Impatto

| Dimensione | Effetto |
|---|---|
| Produzione | **-80%**: 148 posizioni il 28/07 → 20-40/giorno dal 29/07 in poi |
| Durata | **5 giorni** (29/07 → 03/08), non rilevata |
| Coordinatore | Capitano **muto per 8h14m**, congelato con un ordine dell'utente mai consegnato |
| Worker | 10 sessioni su 11 con testo pendente nel prompt, contemporaneamente |
| Perdita dati | **Nessuna** — solo lavoro mai svolto |
| Rilevamento | **Zero allarmi**. `stepcap-watchdog` ha riportato `stalled: 0` per tutti e 5 i giorni |

---

## Come si presentava

Il pane di un agente resta così, indefinitamente:

```
● The 20-minute throttle wait is running in the background. I'll be notified
  when the wait completes and will re-check the queue then.

✻ Cogitated for 11m 57s · 1 shell still running

─────────────────────────────────────────────────────────────────
❯ riprendi il loop quando finisce l'attesa
─────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on · 1 shell · ← for agents
```

Il turno è finito, il messaggio di ripresa è **visibile nel composer**, e non parte. L'agente non è morto: la TUI risponde, il processo consuma CPU, `tmux has-session` dice di sì. È **vivo e muto**.

---

## Causa radice — quattro anelli, tutti rotti

### 1. `Enter` a freddo non viene processato

Verificato sul campo durante l'incidente, su una sessione bloccata:

| sequenza inviata | esito |
|---|---|
| `send-keys Enter` | ❌ nessun effetto, il testo resta nel composer |
| `send-keys C-m` | ❌ nessun effetto |
| `send-keys -l " "` poi `send-keys Enter` | ✅ **il turno parte** |

Un `Enter` isolato non basta: la TUI ha bisogno di **un carattere qualunque** che la riporti a ridisegnare il composer prima di avere qualcosa da committare. La sequenza `Space`+`Enter` è l'unica affidabile.

Questo è già noto e già corretto in `jht-tmux-send` (tre tentativi con `Space` prima di ogni `Enter`, poi `exit 5` "vivo ma muto") e in `agent_unblock.py`. Ma il fallimento resta **frequente**: anche con la versione corretta, alcuni invii finiscono comunque appesi. Il wrapper li registra in `logs/pending-input.jsonl`, quindi la traccia c'è — **manca chi la legge**.

### 2. La cura si autoesclude: `draft_user`

`agent_unblock.py scan` classifica un pane con testo pendente come `draft_user` e prescrive:

> `"cure": "relay al coordinatore + domanda all'Assistente; NON toccare il testo"`

La regola ha un senso preciso: se il testo l'ha scritto **l'utente**, premere `Enter` al posto suo significa inviare a nome suo un messaggio che potrebbe non voler più mandare. Ma la classificazione **non distingue** un draft umano da un nudge automatico rimasto appeso, e nella pratica quasi tutti sono nudge. Risultato: lo strumento che sa esattamente come sbloccare (`Space`+`Enter`, ce l'ha implementato) si **vieta di usarlo** e delega a un umano che non sa di doverlo fare.

### 3. Il rilevamento è cieco: `stalled: 0`

`stepcap-watchdog` cerca dei **marcatori testuali** nel pane per decidere se un agente è fermo. La tabella dei marcatori è popolata **solo per un provider**; per gli altri è una tupla vuota, quindi `find_marker` torna sempre `None` e ogni agente resta classificato `phase: idle` — cioè sano.

```json
{"event": "heartbeat", "watched": 5, "stalled": 0}
{"event": "heartbeat", "watched": 5, "stalled": 0}
{"event": "heartbeat", "watched": 5, "stalled": 0}
```

Cinque giorni di `stalled: 0` con il team fermo. Un contatore che non può mai essere diverso da zero non è un monitor: è decorazione.

### 4. Il guardiano è ostaggio

Il **Dottore** è l'agente che dovrebbe girare e sbloccare gli altri. Al momento della diagnosi aveva **lui stesso** il prompt bloccato con `resta in standby, ricontrolla tra 20 minuti`. Stessa cosa per il Mantenitore. Il ruolo di sblocco è affidato a un agente soggetto **allo stesso identico guasto** che deve curare — senza nessun meccanismo esterno che lo risvegli.

---

## Perché sembrava che funzionasse

Perché **qualcosa lo sbloccava per caso**, e nessuno aveva collegato le due cose:

- `agent-watchdog` ammazza e ricrea ogni worker al compimento di **12h di età** (TTL puro: contesto, stato e attività non contano). 52 ricreazioni registrate. Un agente appena ricreato parte pulito e produce **finché non si ricongela**.
- L'utente, scrivendo dall'interfaccia del gioco, digitava nei pane e senza saperlo ne sbloccava qualcuno.

Il team quindi lavorava **a singhiozzo**, in finestre fra un `recreate` e il blocco successivo. Il grafico delle posizioni saliva, e questo bastava a far sembrare tutto normale.

> ⚠️ **La lezione**: un TTL kill+recreate maschera i guasti di liveness. Rende un sistema rotto indistinguibile da uno lento.

---

## Difetti secondari emersi

| Cosa | Dettaglio |
|---|---|
| Sessione coordinatore assente | La sessione `SENTINELLA` non esisteva; `tmux has-session -t SENTINELLA` diceva di sì perché **fa match per prefisso** su `SENTINELLA-WORKER`. Ogni controllo di esistenza basato su `has-session` è quindi inaffidabile per i nomi con prefisso comune. |
| Mittente in retry cieco | Il pacing bridge ha ritentato 6 volte verso una sessione inesistente, senza mai escalare. |
| Attesa che non si sveglia | Gli agenti si parcheggiano su `jht-throttle 1200` lanciato in background e dichiarano "sarò notificato a fine attesa". **Non è vero**: nessuno li risveglia. Il turno finisce lì. |
| Immagine indietro | L'immagine in esecuzione era del 29/07; il `:latest` pubblicato era del 30/07 e non era mai stato scaricato. Un tag `latest` **non garantisce** che il nodo stia girando l'ultima build. |

---

## Fix

| # | Dove | Stato |
|---|---|---|
| 1 | `jht-tmux-send`: `Space`+`Enter`, verifica del submit, `exit 5` distinto, traccia in `pending-input.jsonl` | ✅ in immagine |
| 2 | `stepcap-watchdog`: rilevamento **senza marcatore** — pane immobile per N giri = stallo, con gate su halt/fuori orario | ✅ scritto, ❌ non deployato |
| 3 | Chat web e CLI: consegna via `jht-tmux-send` invece di `tmux send-keys` grezzo, con exit code mappati a risposte distinte | ✅ scritto, ❌ non deployato |
| 4 | `start-agent.sh` (ramo worker): attesa del REPL invece di `✓ avviato` incondizionato | ✅ scritto, ❌ non deployato |
| 5 | `agent_unblock`: distinguere draft umano da nudge automatico, e sbloccare i secondi da solo | ❌ **da fare** |
| 6 | Un risvegliatore **esterno** agli agenti che legga `pending-input.jsonl` e agisca | ❌ **da fare** |

---

## Azioni immediate applicate

Sblocco manuale ripetuto delle sessioni via `jht-tmux-send`, con verifica di `esc to interrupt` dopo ogni invio. Efficace ma **temporaneo**: le sessioni si ribloccano entro 5-10 minuti. Non è un rimedio, è un secchio bucato.

---

## Cosa portarsi via

1. **Un contatore che non può salire non è un monitor.** `stalled: 0` per cinque giorni andava trattato come un guasto del monitor, non come una buona notizia.
2. **Il kill+recreate periodico nasconde i guasti di liveness.** Va tenuto, ma affiancato da una metrica di produzione: *quanto* ha prodotto un agente fra un recreate e l'altro, non *se* esiste.
3. **Chi cura non può essere soggetto alla stessa malattia.** Lo sblocco deve avere almeno un anello deterministico fuori dagli agenti LLM.
4. **Una cura che si autoesclude per prudenza va misurata.** `NON toccare il testo` ha protetto zero draft umani e bloccato decine di nudge.
5. **`latest` non è una garanzia.** Serve un controllo esplicito digest-locale vs digest-registry nel giro di health.
