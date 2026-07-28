# Perché è difficile bruciare in fretta, anche quando l'utente lo chiede

**Data**: 2026-07-28 · **Origine**: una notte passata a cercare di far consumare a un team
tutto il budget disponibile, su richiesta esplicita dell'utente ("non mi frega niente del
budget, spremete il più possibile"). Ci sono volute **cinque deroghe successive**, e non è
bastato.

Il comportamento predefinito è **giusto**: il progetto nasce da incidenti reali in cui il
budget si esauriva in due giorni. Il problema è un altro — quando l'utente chiede
espressamente il contrario, **non esiste un modo per accordarglielo**. Ogni freno va
smontato singolarmente, alcuni non sono raggiungibili senza modificare il codice, e uno vive
nelle istruzioni degli agenti invece che nella configurazione.

---

## Inventario dei freni

Livello **C** = codice · **P** = prompt/istruzioni agente · **H** = vincolo hardware.

| # | Freno | Liv. | Cosa fa | Come si deroga oggi |
|---|---|---|---|---|
| 1 | **Daily hard-stop** | C | se `consumato > budget_giorno + 5%` manda ESC a **tutte** le sessioni e scrive `daily-halt.flag` | nessuna, prima del 2026-07-27 → aggiunta `JHT_DAILY_HARDSTOP=0` |
| 2 | **WORKER_FLOOR** | C | throttle minimo 300s per i worker, applicato **in lettura**: qualunque valore inferiore torna 300 | nessuna → aggiunto `config/throttle-floor-exempt.txt` (per agente) |
| 3 | **Ladder** | C | primo gradino 300s: `quantize()` riagganciava a 5 min anche scrivendo il file a mano | nessuna → ladder estesa a 1/2/3 min (2026-07-28) |
| 4 | **pace_guard** | C | ricalcola e **riscrive** il throttle a ogni tick del bridge: un override manuale dura < 5 min | `JHT_PACE_GUARD=0` (spegne tutto) → ora rispetta le esenzioni |
| 5 | **C-02** | **P** | *"i worker non scendono sotto i 5min, quindi **non esiste** «porta il throttle a 0»… MAI azzerare il throttle"* | nessuna: è un'istruzione, non una config |
| 6 | **SC-09** | **P** | una posizione per iterazione, mai mass-batch — nato dal marathon (~308kT per 3 posizioni) | nessuna, ed è giusto così (vedi sotto) |
| 7 | **host_agent_cap** | H | tetto worker calcolato dalla **RAM**: `(GB − riserva) / GB_per_agente − 5 core` | nessuna, ed è giusto così |
| 8 | **Gate orario** | C | fuori dalle working hours nessuna LLM viene svegliata | cambiare le working hours |
| 9 | **weekly_locked** | C | a weekly esaurito sospende il pacing giornaliero | nessuna (è il limite del provider) |
| 10 | **freeze_team** | C | emergenza Sentinella: ESC×2 a tutti su `proj>105%` o `usage≥90%` | nessuna |
| 11 | **soft_pause_team** | C | pausa graceful su FATAL della Sentinella | nessuna |
| 12 | **first-run-burst** | P | l'**unica** deroga documentata, e vale solo per la prima finestra di un utente nuovo | — |

---

## Le due famiglie, che oggi sono mescolate

**Freni di spesa** (1, 2, 3, 4, 5, 8): esistono per non bruciare il budget. Se l'utente
dichiara che il budget non è un vincolo, **dovrebbero poter cedere** — è una sua decisione
economica, non una questione di correttezza.

**Freni di sicurezza** (6, 7, 9, 10, 11): proteggono da danni che il budget non ripaga —
thrash della macchina, dati sporchi, lockout del provider. **Devono restare** anche sotto
richiesta esplicita: il #7 è un limite fisico di RAM, il #6 impedisce che il volume a monte
produca *throughput negativo* a valle.

Oggi le due famiglie si smontano allo stesso modo — cioè a mano, una per una — e nessuna
delle due è etichettata come tale.

---

## Cosa lo rende difficile, in concreto

**Sono indipendenti e a strati.** Togliere il #1 non serve se resta il #2; togliere il #2
non serve se il #4 lo riscrive cinque minuti dopo. Durante la notte le deroghe sono servite
tutte e quattro, in sequenza, e ognuna ha richiesto una diagnosi separata perché il sintomo
era identico: *il throttle torna a 300*.

**Uno dei freni vive nei prompt.** Il #5 non è configurabile: è scritto nelle istruzioni del
coordinatore. Anche a codice completamente sbloccato, il Capitano legge *"non esiste portare
il throttle a 0"* e si comporta di conseguenza — cosa che è **successa davvero**: dopo aver
esentato sei worker, il coordinatore ha ristretto l'esenzione da sé, citando la regola.
Comportamento corretto dal suo punto di vista, ma significa che una deroga di configurazione
non basta: va comunicata anche agli agenti.

**Il costo è invisibile finché non misuri.** Nessuno dei freni segnala "ti sto rallentando":
il team sembra semplicemente lento.

---

## Quello che ho verificato, e che cambia la domanda

Vale la pena dirlo, perché ridimensiona l'intero problema: **anche a freni tolti, il team
non è riuscito a saturare la finestra**. Con throttle a 0 su sei worker, il consumo si è
fermato al 6-19% della finestra da 5 ore.

Il motivo è strutturale: scouting e analisi girano su modelli economici e passano la maggior
parte del tempo **ad aspettare risposte HTTP**. Non c'è throttle da togliere che trasformi
lavoro I/O-bound in consumo di token. L'unica leva realmente pesante è la **scrittura dei CV
in Opus**, che nel run osservato era disattivata per ordine dell'utente.

Quindi la domanda "come brucio più in fretta" ha due risposte diverse:

- **togliere freni** → guadagno modesto, rischio concreto (thrash a 19 sessioni, load 24)
- **cambiare tipo di lavoro** → è lì che sta il consumo vero

---

## Proposta

**Un interruttore unico e a termine**, che dichiari l'intento invece di smontare i freni uno
per uno:

- copre in un colpo i freni di **spesa** (1, 2, 3, 4) e passa la deroga anche agli **agenti**,
  perché il #5 è un prompt e va informato — altrimenti il coordinatore la annulla da solo
- **non tocca** i freni di sicurezza (6, 7, 9, 10, 11), che restano attivi anche in sprint
- **scade da solo**: a finestra o a ore. Nessuno dei file di deroga creati stanotte si
  disattiva da sé, e restano accesi finché qualcuno si ricorda di cancellarli
- **dice cosa sta facendo**: con i freni tolti, la responsabilità di non sprecare passa
  interamente al coordinatore, e va scritto — non lasciato dedurre

Nota di realismo: prima di costruirlo, vale la pena chiedersi se serva davvero, dato il
punto precedente. Un interruttore che promette di bruciare tutto e produce +13% di finestra
è peggio di nessun interruttore, perché sposta la colpa sul team invece che sul tipo di
lavoro.
