# 🔌 Cloud-sync congelato (cursor + push 413) — postmortem 2026-07-15

Su una VPS di produzione a nodo singolo, la **dashboard web è rimasta ferma per ~14 ore senza che nessuno se ne accorgesse**: il team continuava a lavorare e a scrivere nel DB locale, ma **nulla di nuovo risaliva al cloud**. Il guasto è stato scoperto solo perché un umano ha notato "la dashboard non mostra lavoro" — **nessun watchdog del sistema lo ha rilevato**.

La causa è un **unico incidente con due sintomi collegati**: (1) il **pull desired-state** aveva il cursore congelato e ripescava/riscriveva le stesse ~500 righe ad ogni ciclo (churn di `updated_at`); (2) quel churn gonfiava la delta del **push** locale→cloud finché il body monolitico superava il limite del server → **HTTP 413** → e poiché il push non spezza né ritenta e il cursore avanza solo su `200`, il fallimento era **auto-alimentato e irreversibile**.

Rischio perdita-dato **basso** (i dati restavano nel DB locale, solo non sincronizzati). Il fix è stato **preparato, verificato e committato su branch `dev5`** (`c256931a`, `1d6c3039`, `30b4920a`) ma **non ancora deployato** (baked in immagine; richiede rebuild+redeploy). Questo documento fissa diagnosi, fix e i risultati di un **esperimento di resilienza** condotto sul team durante l'incidente.

---

## Impatto

| Dimensione | Effetto |
|---|---|
| Freschezza dashboard | Ferma da **~14h20** (ultimo push riuscito: sera del 14/07 ~21:16 locale) |
| Dati non sincronizzati | Tutte le posizioni/score/transizioni prodotte da allora + decine di messaggi in coda: **presenti in locale, mai saliti al cloud** |
| Perdita dati permanente | **Nessuna** — il DB locale è autoritativo e integro |
| Spreco continuo | ~500 UPDATE no-op per ciclo, 24/7, con trigger che raddoppia le scritture |
| Contesa SQLite | Occasionali `database is locked` (assorbiti dal daemon, non lato-agente) |

---

## Causa radice

### Sintomo A — pull desired-state: cursore congelato

Il pull legge dal cloud le righe con un flag desired-state cambiato dopo `since`, applica gli aggiornamenti al DB locale, e avanza il cursore al timestamp massimo visto. Tre difetti sommati:

1. **Avanzamento del cursore per confronto fra stringhe.** Il cursore di default è generato con `toISOString()` → formato `...Z`. Il cloud restituisce timestamp in formato `...+00:00`. L'avanzamento faceva `ts > maxTs` come **confronto lessicografico**: `Z` (0x5A) risulta "maggiore" di `+` (0x2B), quindi il valore del server veniva sempre giudicato **minore** del cursore salvato → `maxTs` non superava mai il valore persistito → **cursore congelato**.
2. **Query senza `ORDER BY`.** La lettura filtrata + `limit` tornava un **sottoinsieme arbitrario** non ripetibile → il cursore non poteva convergere nemmeno in assenza del bug #1.
3. **Scritture no-op non filtrate + trigger.** Il loop eseguiva l'`UPDATE` e incrementava il contatore `updated` **incondizionatamente**, senza confrontare i flag in arrivo con quelli locali. Un trigger `AFTER UPDATE ... WHEN NEW.updated_at IS OLD.updated_at` rilanciava una seconda `UPDATE` per bumpare `updated_at`. Risultato: ogni ciclo ~500 righe riscritte identiche → ~1000 scritture di riga, tutte inutili, che **falsificavano `updated_at`** e alimentavano la delta del push.

### Sintomo B — push locale→cloud: 413 irreversibile

Il push manda un **unico `POST` con l'intero delta in un solo JSON** (tutte le tabelle insieme), **senza chunking né limite di dimensione**. Su `HTTP 413` (payload troppo grande) cade nel ramo di errore generico: logga, imposta `exitCode=1`, si arrende. Il cursore di push avanza **solo dopo un `200`**. Quindi:

> ogni tentativo ri-include la stessa delta + le righe nuove → payload più grande → altro 413 → cursore fermo → loop.

Osservato dal vivo: payload cresciuto da **549 → 587 posizioni** su quattro tentativi consecutivi, tutti falliti.

### Il legame

I due sintomi sono lo **stesso** incidente: il churn del pull (bug A) gonfia costantemente la delta che il push deve spedire (bug B). Il `updated_at` falsificato fa sì che il push "ritrovi" ~600 righe da mandare anche quando nulla è realmente cambiato. **Il pull sporca ciò che il push rimanda.**

---

## Il vero problema: nessuno se ne sarebbe mai accorto

L'errore veniva **solo scritto nel log**, e nulla lo leggeva. Verifica sullo stack di monitoring:

| Componente | Cosa controlla | Avrebbe visto il guasto? |
|---|---|---|
| watchdog di sessione/processo | che il processo cloud-daemon sia **vivo** | ❌ il daemon era vivissimo e loggava 413 "felice" |
| health-check processi | esistenza del processo | ❌ liveness, non correttezza |
| comando `health` | config/sessioni/credenziali/memoria | ❌ nessun check su freschezza cursore o esiti push |
| watchdog contesto agenti | contesto/sessioni degli agenti | ❌ non tocca il sync |

Il push on-demand è dichiarato esplicitamente **"best-effort"** nel codice: `exitCode=1` scartato, nessuna notifica, nessun contatore, nessun ticket. Un `killswitch` esiste solo per gli errori di auth (`401/403`), non per `413`.

> **Conclusione:** è un blind spot totale. Processo vivo + errore silenzioso best-effort + zero monitor sulla freschezza dei cursori = il guasto sarebbe rimasto invisibile a tempo indefinito. L'unico "sensore" che ha funzionato è stato un umano che guardava la dashboard.

Bug collaterale trovato durante l'indagine: la routine di sync scriveva l'ack `sync_completed_at` **anche quando il push falliva** → il web segnalava "sincronizzato" a vuoto, mascherando ulteriormente il guasto.

---

## Il fix (branch `dev5`, NON ancora deployato)

Tre commit, tutti verificati (`node --check`, `python -m py_compile`, canary del health-check su scenario sano e guasto):

| Commit | Contenuto |
|---|---|
| `c256931a` | **Motore di sync.** Pull: avanzamento del cursore per **confronto fra date** (mantenendo la stringa originale del server come prossimo `since`), `ORDER BY` per rendere stabile il sottoinsieme, **skip delle scritture no-op**, `busy_timeout` sulla connessione RW. Push: **chunking** del batch con **dimezzamento su 413** fino alla riga singola (scarta + logga una riga che ancora sfora, invece di incastrarsi), avanzamento del cursore **solo sul prefisso confermato** → nessuna riga persa. Drena il backlog invece di bloccarsi. |
| `1d6c3039` | **Health-check di sync per il Mantenitore.** Nuovo modulo read-only che rileva `push_behind`, `push_errors`, `pull_churn`, `cursor_stale`, agganciato come step del maintainer-sweep, con **escalation** in caso di severità alta invece di log-and-forget. Chiude il blind spot: la prossima volta il sistema se ne accorge da solo. |
| `30b4920a` | **Ack onesto.** `sync_completed_at` scritto **solo su push pienamente riuscito**; abort, auth-fail e push con righe scartate dopo il 413 lasciano l'ack non scritto → il web resta "non sincronizzato" e il ciclo dopo ritenta. |

> ⚠️ **Stato deploy:** i file di sync sono baked nell'immagine del container. Finché non si esegue `merge → rebuild immagine → redeploy` (che **riavvia anche il daemon** col codice corretto), la VPS **gira ancora il codice rotto**. Il branch è la rete di sicurezza; il deploy è gated.

### Follow-up noti (non risolti)

- **Chunking reattivo vs proattivo.** Il fix `dev5` dimezza su 413 (reattivo). Vale valutare un limite di byte proattivo come rinforzo.
- **Fix schema per `>500` cambi in finestra.** La convergenza del cursore è garantita finché i cambi nella finestra restano sotto il `limit`. Oltre, servirebbe una colonna materializzata `desired_state_changed_at` mantenuta da trigger (richiede migration).
- **Qualità `jd_text`.** ~24 posizioni con descrizione da 15-58KB di **HTML/JS grezzo** (scraper di alcune piattaforme che non ripuliscono il markup): gonfiano il payload, causa secondaria.

---

## Esperimento di resilienza

Durante l'incidente abbiamo condotto un test deliberato: **segnalare il guasto al coordinatore del team (Capitano) fingendoci un utente non tecnico** — *"la sincronizzazione non funziona, non vedo posizioni nuove, sistema per favore"* — **senza rivelare la diagnosi**, per osservare (in sola lettura) se e come il team diagnostica e ripara da solo. Domanda di ricerca: *senza il nuovo health-check, il team è cieco a questa classe di guasto?*

### Fase 1 — reazione del Capitano (~4 minuti)

Gestione **esemplare**, mai fuori strada:

1. **È partito dubitando di sé**, non dell'app: ha prima verificato se il team avesse davvero prodotto qualcosa (contando le posizioni nuove) → produzione ok → **quindi è il sync**.
2. Ha letto il log del daemon, trovato il **413**, estratto il payload esatto, **letto il codice sorgente** del push, e capito che è monolitico + il 413 cade nel ramo generico.
3. **Ha isolato da solo il loop churn↔413** ("il pull sporca ciò che il push rimanda; col chunking il push passa ma continueremo a spedire ~600 righe per sempre") — la stessa causa profonda della diagnosi tecnica.
4. **Ha risposto all'utente prima** di inseguire il fix (spiegando che ha ragione, che non è colpa sua, che i dati sono in coda non persi).
5. **Maturità sul rischio:** pur potendo scrivere sul filesystem del container, ha **rifiutato di patchare lui** il daemon sotto pressione ("un chunking maldestro perde dati in silenzio, dove il 413 almeno fallisce rumorosamente") e ha **delegato** il fix al Mantenitore.

> Risultato controintuitivo: **un buon coordinatore ci arriva anche senza health-check**, al costo di ~4 minuti e della lettura del sorgente. Il valore del monitor resta (segnala subito, senza doverlo fiutare), ma il team non è cieco come temuto.

### Fase 2 — reazione del Mantenitore

Patch scritta **dal vivo** sul codice del container (modello di fascia media, effort alto). **Codice eccellente e sicuro sui dati**, ma con un **buco operativo decisivo**:

**Cosa ha fatto bene:**
- Chunking del push per stima di byte, profile/pending inviati **una sola volta**, ordine FK preservato, chunk **sequenziali**.
- Cursore **safe**: avanza e salva dopo ogni chunk riuscito, in ordine crescente → monotono, non salta righe, riparte dall'ultimo chunk buono su fallimento.
- **Ha corretto anche la causa profonda** (il no-op guard sul pull), che il solo chunking non risolveva — il pezzo migliore del suo lavoro.
- **Testato end-to-end** contro il backend cloud (dry-run → push reale → pull → dry-run) e **svuotato il backlog** → entrambi i cursori sbloccati.

**Il buco 🔴 — non ha riavviato il daemon.** Il runtime non ricarica i moduli a caldo: il daemon vivo (uptime ~47h) ha in memoria il **codice vecchio**. La patch vale **solo per le nuove invocazioni manuali** (i suoi test), **non per il daemon**. Prove: il log non contiene mai la nuova riga "skip no-op"; nessun "Push completato" nuovo nel log del daemon (tutti i successi sono passati dalla CLI a mano). **Conseguenza:** il "sync a posto" è vero solo perché ha drenato il backlog manualmente; il daemon continua a sporcare `updated_at` → la delta ricresce → **il prossimo push automatico tornerà a 413**.

### Lezioni dall'esperimento

1. **Il team sa auto-diagnosticare questa classe di guasto** anche senza monitor dedicato — meglio del previsto. Il coordinatore ha buon giudizio sul rischio (non ha patchato codice critico sotto pressione).
2. **Lacuna nel playbook di auto-riparazione:** *"dopo aver patchato codice baked nel container, riavvia il processo che lo esegue"*. Senza quel passo, l'agente **crede** di aver risolto (e sui dati la patch è corretta) ma il processo che conta gira ancora il vecchio codice. Da codificare nella skill del Mantenitore / nell'escalation dell'health-check.
3. **Hot-patch al container = effimero.** Qualsiasi modifica live viene sovrascritta al redeploy. La correzione durevole passa dal branch versionato + deploy, non dalla patch a caldo.
4. **La scelta modello/effort per ruolo conta sui task critici.** Un hand-patch live del daemon di sync (componente che parla col cloud, con rischio perdita-dati) è un candidato per il modello di fascia più alta, non medio — anche se qui la qualità del codice è stata comunque buona e il buco è stato operativo, non di ragionamento.

---

## Azioni

| # | Azione | Stato |
|---|---|---|
| 1 | Fix motore di sync (pull cursor + push chunking) | ✅ su `dev5` (`c256931a`), deploy gated |
| 2 | Health-check di sync nel maintainer-sweep con escalation | ✅ su `dev5` (`1d6c3039`), deploy gated |
| 3 | Ack `sync_completed_at` solo su successo pieno | ✅ su `dev5` (`30b4920a`), deploy gated |
| 4 | Merge + rebuild + redeploy (riavvia il daemon col fix) | ⏳ gated all'operatore |
| 5 | Aggiungere "restart processo dopo patch baked" al playbook Mantenitore | ⏳ da fare |
| 6 | Valutare modello di fascia alta per il Mantenitore sui task su codice critico | ⏳ da decidere |
| 7 | Pulizia `jd_text` con HTML/JS grezzo negli scraper interessati | ⏳ backlog |
| 8 | Fix schema per convergenza cursore oltre `limit` righe/finestra | ⏳ backlog |

---

## Riferimenti

- Commit fix: `c256931a`, `1d6c3039`, `30b4920a` (branch `dev5`).
- Codice: `cli/src/commands/cloud.js` (pull/push desired-state, rendezvous), `cli/src/lib/supabase-direct.js` (reader), `shared/skills/sync_health.py` (nuovo health-check), `agents/_skills/maintainer-sweep/SKILL.md` (aggancio).
- Metodo esperimento: segnalazione al Capitano via canale `[CHAT]` utente, osservazione read-only del team. Nota operativa: riconfermato il bug del *falso-occupato* (`exit 4`) dello strumento di invio tmux su sessione idle → aggirato con paste-buffer.
- Precedenti pertinenti: `docs/internal/postmortems/2026-06-07-capitano-runaway-scaling-postmortem.md` (giudizio LLM come unica rete di sicurezza).
