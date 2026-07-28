# Primo run notturno di un team appena creato — misure sul campo

**Data**: notte del 2026-07-27 → 28 · **Contesto**: VPS nuova (6 vCore / 12 GB), team
creato da zero la sera stessa, primo utente reale. Nessun dato identificativo qui: le
macchine e le persone sono descritte per ruolo.

Questo file raccoglie **solo ciò che è stato misurato**, non ciò che ci aspettavamo.
I bug scoperti hanno una voce propria in `BACKLOG.md`; qui restano le lezioni operative.

---

## 1. Il thrash arriva dal numero di agenti, non dalla loro velocità

Il team è stato spinto a **19 sessioni tmux** su 6 core, con tutti i worker al floor di
300s (cioè in pausa 5 minuti su 6). Risultato misurato:

```
load average   24   su 6 core     → 4× la capacità
swap           1697 MB / 2047     → 83% pieno
SSH            ~2 minuti solo per il banner exchange
grafico RAM    100% (include buff/cache: "used" reale 5.7 GB su 11.6)
```

La macchina era **irraggiungibile** e il coordinatore non era più contattabile. Ridotto il
roster a 12 sessioni, il load è tornato a **1.4 in venti minuti**, senza riavviare nulla.

**Lezione**: agenti fermi consumano comunque RAM e contendono CPU. Il freno sul *tempo*
(throttle) non compensa un eccesso di *numero*. Il tetto documentato — oltre 14 agenti =
thrash — si è verificato con precisione.

**Corollario contro-intuitivo**: dopo il taglio, con **meno** agenti e **senza** pause la
produzione è salita. Pochi worker che corrono battono molti worker che dormono, sia in
output sia in stabilità.

---

## 2. Sbloccare il throttle a valle vale il doppio che a monte

Sequenza misurata, a roster costante (12 sessioni):

| ora | throttle rimosso a | posizioni | punteggi | coda non punteggiata |
|---|---|---|---|---|
| 23:13 | — (tutti a 300s) | 76 | 35 | — |
| 23:44 | 1 Scout | 99 (+23) | 46 (+11) | 19 |
| 00:44 | Scout + Analisti + Scorer | 131 (+32) | **74 (+28)** | 17 |

Sbloccare solo il sourcing ha aumentato le **posizioni trovate** ma poco i punteggi, e ha
gonfiato la coda a valle. Sbloccando anche Analisti e Scorer i punteggi sono **raddoppiati
per unità di tempo** e la coda ha iniziato a **calare nonostante più ingressi**.

**Lezione**: ciò che l'utente vede sono le posizioni *punteggiate*. Se si toglie il freno,
va tolto prima a chi produce l'output visibile, non a chi riempie la coda. La domanda da
farsi non è "quanti Scout" ma "dov'è il tappo adesso" — e la risposta cambia nell'arco di
un'ora.

---

## 3. Il worker floor esiste in due copie che possono divergere

Tentare di far girare un worker senza pause ha rivelato tre livelli di difesa
indipendenti, nessuno documentato in un punto unico:

1. `throttle-config.py` applica `WORKER_FLOOR = 300` **in lettura**, non solo in
   scrittura: qualunque valore più basso viene restituito come 300.
2. La `THROTTLE_LADDER` ha 300 come primo gradino, quindi `quantize()` ci riaggancia
   qualsiasi richiesta anche aggirando il floor.
3. `pace_guard.py` mantiene una **propria copia** di `WORKER_FLOOR` e riscrive il valore a
   ogni tick del bridge — quindi un override manuale sopravvive meno di cinque minuti.

Le due copie di `WORKER_FLOOR` in file diversi sono il vero rischio: una modifica a uno
dei due lascia l'altro a governare in silenzio.

---

## 4. Il coordinatore ha corretto due decisioni umane, con argomenti migliori

Vale registrarlo perché è un comportamento su cui contare, e da non appiattire:

- Richiesta di far "imparare dagli score" agli Scout → tradotta in *prioritizza* +
  *escludi ciò che va male*. **Uno Scout ha rifiutato la seconda parte** chiedendo
  conferma scritta: se il sourcing filtra a monte e lo Scorer valuta alla cieca, i
  punteggi si gonfiano da soli e l'utente legge come "mercato ricco" ciò che è solo
  selezione nostra. Ordine ritirato, distinzione adottata: **priorità di ricerca** sì,
  **filtro di esclusione** no.
- Esenzione dal throttle estesa a tutti i worker → il coordinatore l'ha **ristretta** ai
  soli Scout, citando il commento nel codice sull'incidente di burn notturna: chi è fermo
  ad aspettare materiale non produce nulla se sbloccato, aggiunge solo rischio. Corretto
  nel momento in cui l'ha scritto; superato un'ora dopo, quando la coda si è riempita.

---

## 5. Costi di esercizio osservati

- La difesa in profondità **funziona e costa**: gli annunci scaduti da un aggregatore
  rispondevano `HTTP 200` con il marker di chiusura sepolto nel bundle di localizzazione.
  Il gate a monte non li ha fermati, gli Analisti sì. Costo: 4 analisi complete buttate
  per non consegnare link morti all'utente. Trade-off corretto, ma va contato.
- Resa **per fonte** su 50 posizioni: un job board 62% di arrivo a punteggio, due altre
  lane 0%. Nessun componente del sistema guarda questo dato — è emerso solo da una query
  a mano.
- Le esclusioni "di massa" che sembrano un difetto erano in gran parte **requisiti
  oggettivi** non soddisfatti (abilitazione professionale, titolo di studio obbligatorio):
  19 su 26. Ma 10 di quelle derivavano da un allargamento del mandato di ricerca verso
  un'area strutturalmente incompatibile con il profilo — budget speso su posizioni
  irraggiungibili per costruzione.

---

## Da verificare nelle prossime notti

- Il tetto reale di sessioni **senza** pause: stanotte 12 worker attivi tengono un load di
  2–3.5 su 6 core. Il limite superiore non è stato cercato.
- Se la resa a valle continua a scalare togliendo il freno, o se compare un secondo tappo
  (es. il singolo Critico, o il rate limit del provider).
- Se il ciclo di arricchimento (coordinate, logo, sito) regge quando il sourcing corre a
  pieno regime: stanotte è rimasto indietro rispetto alle posizioni trovate.
