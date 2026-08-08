# Perché C-21 non si vede all'opera — misure su cinque squadre (2026-08-08)

Domanda posta ([SOURCE-YIELD-MEMORY], punto (b)): l'utente non ha mai visto due
Scout lavorare *insieme*, mentre C-21 prescrive esattamente una divisione del
territorio. Tre ipotesi da separare con i dati, **prima** di scrivere codice:

* **(a)** il Capitano non scala mai oltre uno Scout;
* **(b)** la skill `scout-coord` non viene mai aperta;
* **(c)** la divisione avviene ed è invisibile nell'ufficio.

Le misure vengono dai log di cinque squadre in produzione (~7-14 giorni per
squadra, tutte con orario 09:00-21:00). Le squadre sono anonime qui — la mappa
alias→profilo vive fuori dal repo pubblico. Tre sonde in **sola lettura**:
`agent-vitals.jsonl` (campione ogni ~30s degli agenti vivi: è la misura esatta
della concorrenza, non una deduzione dagli spawn), il DB di coordinamento e il
roster.

## (a) — FALSA su tre squadre su cinque

| Squadra | Campioni con ≥2 Scout vivi | Max concorrenti | Ore con ≥2 Scout |
|---|---|---|---|
| A | **77,2 %** | 3 | 135,3 |
| B | **62,3 %** | 4 | 105,3 |
| C | 15,8 % | 5 | 28,4 |
| D | 0,2 % | 2 | 0,2 |
| E | 0,0 % | 2 | 0,0 |

Su A e B due o tre Scout hanno convissuto per la maggior parte del tempo
osservato — 135 e 105 ore. Su C il picco è stato di **cinque**. L'ipotesi «non
scala mai» descrive solo D ed E, dove lo Scout resta uno (e su D il team è
fermo per tre quarti del tempo: `0 Scout vivi` nel 74,5 % dei campioni).

Quindi: **la squadra coordinata parte**, e su due squadre è la norma.

## (b) — FALSA: il DB di coordinamento è scritto, da settimane

| Squadra | Assegnazioni | Scout distinti | Prima riga | Ultima riga |
|---|---|---|---|---|
| A | 55 | 7 | 2026-06-27 | 2026-08-03 |
| B | 18 | 6 | 2026-07-27 | 2026-08-04 |
| C | 58 | 7 | 2026-07-09 | 2026-08-04 |
| D | 59 | 7 | 2026-06-03 | 2026-08-04 |
| E | 55 | 7 | 2026-05-20 | 2026-08-02 |

La skill viene aperta e la riga viene scritta. Non è ignoranza del meccanismo.

## Quello che le due risposte insieme rivelano

Il coordinamento è **scritto ma non vissuto**: esiste come rito di boot, non
come accordo fra pari vivi.

| Squadra | Righe scritte in solitudine (nessun altro Scout entro 15 min) | Coppie simultanee | Di cui **sovrapposte** (stesso cerchio o stessa fonte) | Finestre con ≥2 Scout vivi coperte da una partizione a due |
|---|---|---|---|---|
| A | 24/55 (44 %) | 18 | **14 (78 %)** | 1 su 2 |
| B | 16/18 (89 %) | 1 | 0 | 1 su 6 |
| C | 30/58 (52 %) | 30 | 9 (30 %) | 2 su 4 |
| D | 47/59 (80 %) | 8 | 3 (38 %) | 0 su 3 |
| E | 37/55 (67 %) | 14 | 5 (36 %) | 1 su 1 |

Due letture, entrambe misurate:

1. **La divisione non segue la concorrenza.** Su A, 135 ore con 2-3 Scout vivi
   hanno prodotto **una sola** finestra in cui due Scout diversi avevano una
   assegnazione fresca; su B, 105 ore e sei finestre ne hanno prodotta una. Le
   righe si scrivono all'avvio e poi restano lì mentre il roster cambia sotto.
2. **Quando due Scout si registrano davvero insieme, spesso prendono lo stesso
   territorio.** Dal 30 % (C) al 78 % (A) delle coppie simultanee condivide
   almeno un cerchio o una fonte — cioè viola la garanzia che C-21 esiste per
   dare («mai due Scout sulla stessa coppia cerchio/tier»).

A corredo: la tabella `claims` (anti-collisione per `job_id`) è a **zero** su
quattro squadre su cinque (3 righe sulla quinta), e `scout_workspace.json`
porta al massimo **un** claim di fonte, sempre di un solo agente. I due
meccanismi anti-collisione esistono e non vengono usati.

## (c) — VERA, e per costruzione

Nessun file sotto `game/` legge `scout_coordination.db` né
`scout_workspace.json` (grep sull'intero albero). L'ufficio **non può**
mostrare la divisione: non la legge. Quindi l'osservazione dell'utente («non
ho mai visto due Scout lavorare insieme») resta vera anche nelle 135 ore in
cui due Scout stavano davvero lavorando insieme.

## Un difetto trovato strada facendo

Su una squadra il DB contiene una assegnazione **attiva** intestata allo scout
`--help`: `scout_coord.py assign` prende `sys.argv[2]` come nome senza
validarlo, quindi un `assign --help` scrive una riga fantasma che poi risulta
in vigore. Va corretto insieme al resto: una riga così sporca `show`, e chi
legge la distribuzione vede un partecipante che non esiste.

## Conseguenze per il ticket

L'ordine del backlog era: prima capire perché C-21 non si vede, poi decidere
se ottimizzare la strategia di divisione. La risposta è che **non è la
strategia il problema**: la squadra coordinata parte, la skill viene aperta, e
il territorio viene comunque calpestato due volte perché l'accordo non viene
rinegoziato quando il roster cambia — e nessuno, utente compreso, può
accorgersene, perché l'ufficio non mostra la divisione.

Nell'ordine, prima di [SOURCE-YIELD-MEMORY]:

1. **rendere osservabile la divisione** (l'ufficio legge e mostra chi ha cosa):
   senza questo ogni misura successiva è cieca — vale anche per la resa per
   fonte, che si vorrebbe usare per riordinare le lane;
2. **rinegoziare quando il roster cambia**, non solo al boot: un nuovo Scout che
   entra deve trovare (o produrre) una partizione valida con chi c'è già;
3. **validare il nome dello scout** in `scout_coord.py` (il difetto qui sopra).

La memoria di resa per fonte resta ferma: con la divisione che non tiene, una
resa misurata per lane misurerebbe soprattutto quante volte due Scout hanno
lavorato la stessa fonte.
