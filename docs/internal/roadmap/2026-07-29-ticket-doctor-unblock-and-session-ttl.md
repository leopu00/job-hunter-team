# TICKET — Il Dottore deve sbloccare, e le sessioni devono avere un TTL di 12h

**Stato**: da implementare · **Tag**: `[DOCTOR-UNBLOCK-AND-TTL]` ·
**Correlato**: `[STEPCAP-THROTTLE-RESUME]`, `[TEAM-STANDBY-ZERO-SPEND]` ·
**Origine**: incidente 2026-07-28/29, undici ore di team fermo

---

## L'incidente

Un team con quota abbondante (weekly 19%, **SOTTO-PACE**) e macchina scarica (load 0,12)
è rimasto fermo **undici ore**, producendo zero posizioni.

Causa: nel pane del Capitano c'era una riga **digitata e mai inviata** — la risposta a una
sua domanda sul fuso orario. Quella riga rende il pane non ricettivo, `jht-tmux-send` lo
vede occupato, e i messaggi degli agenti falliscono. Da lì la catena:

```
Capitano muto → nessuno assegna lavoro → ogni agente finisce il turno
              → tutti al prompt vuoto in attesa → team fermo
```

Uno Scorer era in **retry-loop da ore** verso il Capitano («decimo tentativo, occupato»).

Il ciclo si chiude su sé stesso: quella riga era la risposta *sul fuso orario*. Non
essendo mai arrivata, il fuso è rimasto `Etc/UTC` e `working_hours` è rimasto **null** —
cioè la configurazione che il Capitano stava chiedendo non è mai stata scritta.

### Cosa ha fatto il Dottore

Il giro tecnico è stato ineccepibile: 9 sessioni ispezionate in 416s, contesti fra 4% e
34%, log su `doctor-retrospective.jsonl` e `dottore-actions.jsonl`. **Ha visto tutto** e
l'ha scritto:

> «SCORER-5 è bloccato da ore in un retry-loop verso di lui ("decimo tentativo,
> occupato"), coda vuota, nessuna risposta nella finestra»
>
> «CAPITANO lasciato intatto: nel suo input c'era una risposta non ancora inviata»

Poi **è rimasto in standby**, e il team è rimasto fermo altre sei ore.

Il problema non è la diagnosi, è il mandato: **un Dottore che rileva un deadlock e non lo
scioglie non serve a niente.** Sbloccare gli agenti è la sua ragione di esistere.

---

## Parte A — Il Dottore deve agire, non riferire

### Il caso concreto, e come andava risolto

Il Dottore non poteva inviare quella riga al posto dell'utente — giusto, non sa se il
testo è quello voluto. Ma aveva **due leve** e non ne ha usata nessuna:

1. **Chiedere all'utente tramite l'Assistente.** L'Assistente è il ruolo che parla con
   l'utente. Il Dottore doveva mandargli la domanda posta dal Capitano perché la girasse
   all'utente sul canale in-app.
2. **Sbloccare comunque il Capitano.** Scrivergli che la sua domanda è stata inoltrata
   ed è in elaborazione, e che **nel frattempo deve procedere** con il resto del lavoro.
   Un coordinatore non deve mai restare fermo in attesa di una risposta umana.

Nessuna delle due tocca il testo dell'utente né richiede di indovinare la sua volontà.
Entrambe rimettono in moto il team in meno di un minuto.

### ⚠️ Due stati che si somigliano e vogliono cure opposte

Verificato sul campo mentre si sbloccava il team. Un pane fermo può essere in due stati
diversi, indistinguibili a occhio: entrambi mostrano un prompt con del testo e nessuna
attività.

| stato | sintomo | cura |
|---|---|---|
| **testo pendente** | `send-keys Enter` ignorato, ma `Space` **poi** `Enter` funziona | sblocco via input |
| **TUI congelata** | non accetta **nulla**: né `Enter`, né `C-m`, né invio al `pane_id` | solo kill + recreate |

Sul coordinatore congelato sono stati provati `Enter`, `C-m` e l'invio diretto al
`%pane_id`: nessuna reazione, con il processo vivo al 2,8% di CPU e la sessione a 15,3
ore di età. L'unica via è stata ricrearlo.

**Il dettaglio che rende implementabile lo sblocco**: un `Enter` "a freddo" non viene
processato dalla TUI. Va mandato prima un carattere (`Space`) e poi `Enter` — è lo stesso
motivo documentato in testa a `agents/_skills/tmux-send/jht-tmux-send`:

> «Le TUI "Ink" (Codex, Kimi, Claude Code) non registrano l'Enter se arriva prima che il
> testo sia renderizzato nel prompt».

Senza questo, un'implementazione che tenta solo `Enter` **fallisce in silenzio** e conclude
che il pane è irrecuperabile. Con questo, distingue i due casi: se `Space+Enter` non
sblocca entro un tentativo, lo stato è «TUI congelata» e la risposta è il recreate — che
è anche la ragione per cui il TTL della Parte B non è opzionale, ma l'unica difesa
sistematica contro il secondo stato.

### La regola che oggi impedisce l'intervento

Dalla skill `dottore.md`, procedura del round:

```
d. PARKED check (data-driven): age≥40min AND produced==0 AND no recent
   last_captain_msg → PARKED → do NOT recreate-to-restart
```

**Questa condizione descrive esattamente l'incidente**: agenti non freschi, produzione
zero, nessun messaggio recente dal Capitano. La regola nasce per non risvegliare agenti
legittimamente in pausa, ma il suo effetto è che **il Dottore si astiene proprio quando
il team è bloccato** — il caso in cui serve di più.

Va distinto lo stato «in pausa perché non c'è lavoro» da «fermo perché il coordinamento
è rotto». Il segnale che li separa esiste ed è oggettivo: **se un agente sta ritentando
di contattare il Capitano senza risposta, non è parcheggiato, è bloccato.** Il retry-loop
dello Scorer era visibile nel suo pane.

### Comportamento richiesto

Aggiungere al round del Dottore una fase di **sblocco**, che precede il refresh:

| sintomo rilevato | azione obbligatoria |
|---|---|
| input pendente nel pane di un coordinatore | notifica all'Assistente perché interpelli l'utente **+** messaggio al coordinatore: «domanda inoltrata, procedi intanto» |
| agente in retry-loop verso un altro agente | sbloccare il destinatario; se non sbloccabile, riassegnare o istruire il mittente a procedere |
| tutti gli agenti al prompt vuoto con quota disponibile | kick-off dei ruoli operativi, senza attendere il coordinatore |
| coordinatore muto da oltre N minuti con quota disponibile | escalation all'Assistente e ripresa autonoma dei worker |

Principio da mettere in testa alla skill:

> Il Dottore **non riferisce un blocco: lo scioglie**. Se un'azione richiede una
> decisione umana, la inoltra all'Assistente **e nel frattempo rimette in moto il team**
> con l'informazione che la decisione è pendente. Un blocco che sopravvive al round del
> Dottore è un round fallito.

### Vincolo da rispettare

Il Dottore **non deve inviare testo digitato dall'utente e mai spedito**, né cancellarlo.
È l'unica cosa che ha fatto bene per una ragione giusta: non può sapere se quel testo è
completo o voluto. Lo sblocco passa dall'Assistente, non dal tasto Invio.

---

## Parte A-bis — I worker muoiono e nessuno se ne accorge

Scoperto lo stesso giorno, mentre si rimetteva in piedi il team: **quattro worker erano
morti** — ANALISTA-1, SCORER-3, SCORER-5, SCOUT-5 — con i processi terminati, non le sole
sessioni tmux rimosse (7 sessioni vive = 7 processi `claude`). Nessuna riga di log,
nessun respawn, nessuna segnalazione. Né il watchdog né il coordinatore li avevano
toccati: il primo non li guarda, il secondo l'ha dichiarato esplicitamente.

Il motivo è in una riga di `agent-watchdog.sh:39`:

```bash
AGENTS=(assistente capitano mentor sentinella)
```

**La rete di sicurezza deterministica copre solo i ruoli core.** Scout, Analisti, Scorer,
Scrittori e Critici — cioè tutti quelli che *producono* — non sono sorvegliati da nulla
che non sia un agente. Il Dottore dovrebbe accorgersene al suo round, ma il Dottore è a
sua volta un agente e può essere fermo, bloccato o non spawnato: è successo la stessa
notte.

Comportamento richiesto: il watchdog deve sorvegliare **anche i worker numerati**,
ricavandone l'elenco dal roster attivo invece che da una lista fissa, e respawnarli con
`start-agent.sh <role> <SAME-N>` quando la sessione sparisce. Con due cautele:

- **Rispettare la finestra di lavoro** — fuori orario un worker assente è normale, non va
  ricreato (a differenza del TTL della Parte B, che invece non si sospende).
- **Non combattere con il coordinatore** — se il Capitano ha ridotto il roster
  deliberatamente, il respawn lo annullerebbe. Il roster atteso va letto dallo stato
  condiviso, non dedotto dalle sessioni esistenti.

Nota di merito al coordinatore ricreato, che aveva già individuato il criterio giusto
senza che nessuno glielo suggerisse:

> «The detectable signal isn't liveness, it's production: window open + quota free +
> positions/scores flat for an hour … A live pane with a static DB is a parked worker.»

È lo stesso principio del watchdog di progresso in `[STEPCAP-THROTTLE-RESUME]`: **non
chiedere se il processo è vivo, chiedere se il database avanza.**

## Parte B — TTL di 12 ore su ogni sessione agente

### Stato attuale

Un tetto di età **non esiste**. Quello che c'è:

- `agent-watchdog.sh:42` — `SENTINELLA_MAX_CTX_AGE_H=24`, applicato **solo alla
  Sentinella**, con `session_age_h()` (`:147`) già scritto e funzionante;
- `dottore.md` — l'età serve solo a **saltare** le sessioni fresche
  (`age < 40min → skip`), mai a forzare un refresh.

Nell'incidente le sessioni avevano **38,5 · 29,5 · 27,0 · 14,5 · 14,2 ore** di vita, e
nessuna regola le ha toccate perché i contesti erano sotto il 50%.

### Comportamento richiesto

**Ogni sessione agente vive al massimo 12 ore.** Superata la soglia, il Dottore la
ricrea — `JHT_AGENT_MAX_SESSION_AGE_H`, default `12`.

Il criterio è **solo l'età**. Non conta:

- l'occupazione del contesto — una sessione al 4% dopo 30 ore va comunque ricreata;
- il fatto che l'agente stia lavorando;
- lo stato PARKED;
- qualunque euristica di salute.

La ragione è quella dell'incidente: tutte le euristiche disponibili dicevano «sano»
mentre il team era paralizzato. Un TTL non ha euristiche da sbagliare.

### Implementazione

Lo strumento **esiste già**: la skill `session-refresh` fa
`capture → interview → synthesis → kill → start-agent.sh <role> <SAME-N> → [RESUME]`.
Serve solo un secondo trigger accanto a quello del contesto:

```
se session_age_h(sessione) ≥ JHT_AGENT_MAX_SESSION_AGE_H:
    → refresh OBBLIGATORIO (bypassa skip-fresh, PARKED, soglia di contesto)
```

Riusare `session_age_h()` di `agent-watchdog.sh:147`, che fa già esattamente questo
calcolo su `#{session_created}`.

**Ridondanza necessaria.** Il Dottore è un agente: può essere fermo, bloccato o non
spawnato — è successo. Il TTL va quindi applicato **anche** da `agent-watchdog.sh`, che è
uno script e non fallisce come un LLM, esattamente come già fa per la Sentinella. Il
Dottore fa il refresh *ricco* (con retrospettiva); il watchdog è la rete di sicurezza che
garantisce il tetto **a qualsiasi costo**.

### Rischi e come coprirli

- **Kill a metà scrittura** — `session-refresh` chiude con `[RESUME]` e contesto, ed è
  già usato in produzione per il refresh da contesto. Il rischio non è nuovo.
- **Refresh simultaneo di tutto il team** — le sessioni nascono a ondate e scadrebbero
  insieme. Scaglionare: al massimo un refresh per tick del watchdog, e ordinare per età
  decrescente.
- **Gate orario** — la skill oggi salta il round fuori dalla finestra di lavoro. Nel caso
  osservato `working_hours` era **null**, e il comportamento con valore nullo va definito
  esplicitamente: **null = nessuna restrizione oraria**, non «sempre fuori orario».
  Il TTL comunque non deve essere sospeso dal gate: una sessione di 30 ore va ricreata
  anche di notte, perché il costo di un kick-off è trascurabile rispetto a una giornata
  persa.

---

## Test di accettazione

1. **TTL rispettato** — una sessione a 12h+1min viene ricreata entro un round, con
   contesto al 4% e agente attivo. Deve avvenire **anche** con il Dottore spento
   (percorso watchdog).
2. **Nessuna scappatoia** — verificare che PARKED, skip-fresh e soglia di contesto **non**
   possano annullare il TTL.
3. **Sblocco da input pendente** — simulare testo non inviato nel pane del Capitano: entro
   un round devono comparire sia il messaggio all'Assistente sia quello al Capitano
   («procedi intanto»), e il testo dell'utente deve essere **ancora lì, intatto**.
4. **Sblocco da retry-loop** — un agente che ritenta verso un destinatario muto deve
   essere sbloccato o riassegnato entro un round.
5. **Prompt vuoti con quota** — tutti gli operativi fermi e quota disponibile: il round
   deve produrre kick-off senza aspettare il coordinatore.
6. **Round fallito se il blocco sopravvive** — `dottore-actions.jsonl` deve registrare
   `blocks_found` e `blocks_cleared`; se il secondo è minore del primo, il round va
   loggato come **fallito**, non come `round_complete`.
7. **Scaglionamento** — con cinque sessioni oltre il TTL, i refresh non avvengono nello
   stesso tick.
8. **`working_hours: null`** — il round e il TTL girano normalmente.
9. **Sblocco con `Space+Enter`** — un pane con testo pendente viene sbloccato al primo
   tentativo; un pane con TUI congelata **non** viene dichiarato sbloccato per errore, ma
   escalato a recreate.
10. **Worker morto respawnato** — uccidere il processo di uno Scorer dentro la finestra di
    lavoro: la sessione deve tornare entro un tick del watchdog, **con il Dottore spento**.
11. **Worker assente fuori finestra** — stessa prova fuori orario: **nessun** respawn.
