# Gli automatismi di spesa non cedono all'ordine dell'utente

**Data**: 2026-07-28 · **Origine**: una notte in cui l'utente ha chiesto esplicitamente di
consumare il più possibile ("il budget non è un vincolo, spremete"). Sono servite **cinque
deroghe successive**, ognuna con una diagnosi separata, e una è stata **annullata da un
agente** che seguiva il proprio prompt.

Il problema **non** è quanto si riesce a bruciare. È che **il sistema non ha un modo di
sapere che l'utente ha deciso diversamente**: gli automatismi che fermano il team scattano
sui numeri e basta, e l'unico modo di fermarli è smontarli a mano, uno per uno, dall'esterno.

Il comportamento predefinito resta giusto — il progetto nasce da budget evaporati in due
giorni. Manca la deroga, non il freno.

---

## I flag di halt e chi li legge

| flag | scritto da | letto da | natura |
|---|---|---|---|
| `team-halted.flag` | comando dell'utente (`team-state-reconciler`) | 7 componenti: poller, `pid1`, watchdog agenti/dottore/codex, `team.js` | **intento utente** — giusto che vinca su tutto |
| `weekly-halt.flag` | reconciler, `cloud.js` | 8 componenti | **limite del provider** — non negoziabile: oltre, l'API non risponde |
| `daily-halt.flag` | i 3 bridge (sentinel, pacing, heartbeat) | gli stessi 3 | **automatismo di spesa** — è questo che deve poter cedere |

Il punto sta tutto nella terza riga. `daily-halt` viene scritto quando
`consumato > budget_giornaliero + 5%`, dove il budget è `weekly_rimanente / finestre_rimaste`.
Nessuno dei tre bridge, prima di scriverlo, si chiede **se l'utente abbia chiesto il
contrario**.

Effetto osservato: ESC a tutte le sessioni, team in standby, e il coordinatore non più
raggiungibile — mentre l'utente aveva dato l'ordine opposto un'ora prima.

---

## Gli altri automatismi, sullo stesso schema

Non tutti passano da un flag su disco, ma tutti condividono il difetto: **decidono sui numeri
senza consultare l'intento**.

| automatismo | dove | cosa fa senza chiedere |
|---|---|---|
| **WORKER_FLOOR** | `throttle-config.py` | riporta a 300s qualunque valore inferiore, **anche in lettura** |
| **ladder** | `throttle-config.py` + `pace_guard.py` | riaggancia al gradino più vicino (era 5 min il minimo) |
| **pace_guard** | `pace_guard.py` | **riscrive** il throttle a ogni tick: un override dura meno di 5 minuti |
| **C-02** | prompt del Capitano | *"non esiste «porta il throttle a 0»"* — istruzione, non configurazione |
| **freeze_team** | Sentinella | ESC×2 a tutti su `proj>105%` o `usage≥90%` |

**Sono a strati**: togliere il primo non serve se resta il secondo, e togliere il secondo non
serve se il terzo lo riscrive cinque minuti dopo. Il sintomo è sempre lo stesso — *il throttle
torna a 300* — quindi ogni strato va diagnosticato separatamente.

**E uno vive nei prompt**: dopo aver esentato sei worker dal floor via codice, il coordinatore
ha **ristretto l'esenzione da sé**, citando C-02. Comportamento corretto dal suo punto di
vista. Significa che una deroga tecnica **non basta**: va comunicata anche agli agenti, o la
annullano in buona fede.

---

## Cosa deve cedere e cosa no

**Deve cedere** (automatismi di spesa — è una decisione economica dell'utente):
`daily-halt`, `WORKER_FLOOR`, la ladder, `pace_guard`, C-02, il gate orario.

**Non deve cedere** (danno che il budget non ripaga, o limite fisico):
- `weekly-halt` — oltre, il provider non risponde: non è una scelta
- `host_agent_cap` — tetto derivato dalla RAM; superarlo manda la macchina in thrash e **riduce**
  la produzione (verificato: 19 sessioni → load 24 su 6 core → SSH irraggiungibile)
- `SC-09` (una posizione per iterazione) — nasce da un marathon che produsse ~308kT per 3
  posizioni con dati sporchi: volume a monte = throughput **negativo** a valle
- `freeze_team` — è l'ultima rete prima del lockout del provider

Oggi le due famiglie si smontano nello stesso modo e nessuna è etichettata come tale.

---

## Cosa serve

**Un punto unico di verità sull'intento dell'utente**, che ogni automatismo di spesa consulta
**prima** di bloccare — invece di N deroghe indipendenti da smontare a mano.

Requisiti, in ordine di importanza:

1. **I produttori di halt lo leggono prima di scrivere.** Non basta rimuovere il flag dopo:
   fra la scrittura e la rimozione il team è già stato messo in ESC.
2. **Arriva anche agli agenti.** C-02 è un prompt: se il coordinatore non sa che l'utente ha
   derogato, annulla la deroga in buona fede — è già successo.
3. **Scade da solo.** Nessuno dei file creati durante la notte si disattiva da sé: restano
   accesi finché qualcuno si ricorda di cancellarli. Una deroga alla protezione di spesa deve
   avere una durata (una finestra, N ore), non essere permanente per dimenticanza.
4. **Non tocca i freni di sicurezza** dell'elenco sopra, che restano attivi anche in deroga.
5. **È esplicito nei log.** Con i freni tolti la responsabilità di non sprecare passa
   interamente al coordinatore: va scritto, non lasciato dedurre.

Lo schema più semplice che soddisfa tutto: un campo di intento nello stato del team — come
`team-halted.flag` ma di segno opposto — con scadenza, che i tre bridge e `pace_guard`
controllano prima di agire, e che il Capitano riceve nel proprio contesto.

---

## Nota a margine

Durante la notte, con tutte le deroghe attive, il consumo si è comunque fermato al 6-19%
della finestra: sourcing e analisi sono I/O-bound e non diventano token-bound togliendo
pause. **Questo non cambia nulla di quanto sopra** — un ordine dell'utente va eseguito a
prescindere da quanto renda, e sapere *dopo* che sarebbe stato inefficace non giustifica non
averlo eseguito. Va però tenuto presente da chi progetterà la deroga: serve perché il sistema
obbedisca, non perché prometta un consumo che il tipo di lavoro non produce.
