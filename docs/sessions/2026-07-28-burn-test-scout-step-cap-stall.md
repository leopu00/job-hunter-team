# Test di spinta — lo Scout si ferma sul cap di step e nessuno lo riprende

Data: 2026-07-28 · VPS di test della flotta, provider Kimi K3, deroga `jht burn` attiva.

## Sintesi

Durante un test di spinta con budget non vincolante, la produzione è scesa a
6 posizioni/ora con load a 0,27 su 4 core. Il collo di bottiglia **non era**
né il budget né la CPU né il contesto: l'unico Scout attivo era fermo,
in attesa di un input che nessun componente del sistema è incaricato di mandare.

## Il guasto

Il pane dello Scout terminava con:

```
Max number of steps reached: 100
Send another message to continue where it left off.
```

È il cap `max_steps=100` introdotto contro i rabbit-hole. Fa il suo lavoro —
interrompe l'agente — ma lascia la sessione **viva e inerte**: tmux la vede,
i watchdog la contano come sana, e il ciclo non riparte finché un umano non
scrive nel pane.

Effetto a cascata: niente sourcing → coda Analisti vuota (confermato dal loro
stesso pane: «Coda next-for-analista ora vuota») → niente da scorare.
Tre ruoli su quattro fermi per un solo agente in attesa.

## Perché nessuno lo riprende

Sulla macchina girano `agent-watchdog.sh` e `doctor-watchdog.sh`, più i tre
bridge (sentinel, pacing, heartbeat). **Non esiste** il file
`logs/idle-nudge.jsonl` e non esiste alcun processo di idle-nudge.

I watchdog presenti verificano che la **sessione esista**, non che stia
**progredendo**. Una sessione bloccata sul cap di step supera ogni controllo:
il processo c'è, il pane risponde, il tmux è sano. Il sistema non ha modo di
distinguere «sta pensando» da «aspetta un input che non arriverà mai».

## Cosa NON era il problema

Tre ipotesi verificate e scartate sul campo:

- **Contesto saturo** — gli agenti erano al 5,9-10,1% di 1M token. Ampio margine.
- **Modello degradato** — tutti su `agent (K3 ●)`, `default_model = "kimi-code/k3"`.
- **Freno hardcoded sulla soglia di finestra** — vedi sotto, ipotesi smentita.

## Conferma a distanza di ore: lo stallo è permanente e il budget continua a bruciare

Rimisurato circa tre ore dopo, senza alcun intervento. Lo Scout è ancora sul cap, e il
dato che lo prova non è il pane ma il **contatore di contesto**: `10.1% (105.5k/1m)`,
identico al byte a tre ore prima. Un agente che pensa consuma contesto; uno fermo no.
È l'indicatore più affidabile per distinguere «sta lavorando a lungo» da «è congelato»,
e costa una sola `capture-pane`.

Nel frattempo, con **zero posizioni prodotte nell'ultima ora**:

```
finestra 5h    19% → 25%   (+6 punti)
weekly         48% → 49%
produzione      0 posizioni
```

Sei punti di finestra bruciati per nessun output. Il consumo non si ferma quando la
pipeline si ferma, perché a consumare non sono i worker: il coordinatore continua a
rispondere ai tick di pacing e della Sentinella, che arrivano ogni 5-15 minuti
indipendentemente dal fatto che ci sia qualcosa da coordinare. La Sentinella glielo ha
detto in chiaro nello stesso periodo — `CAPITANO 15%/h (76% share, 0chk) — sei TU il
top-consumer` — e lui l'ha confermato: «coordination churn — many turns responding to
every tick with tool calls».

**Conseguenza per il pacing**: le metriche di spesa non sanno distinguere un team che
lavora da un team fermo che si osserva. Un test di spinta condotto in questo stato
misura il costo del coordinamento a vuoto, non la capacità produttiva. Un indicatore di
spesa **per posizione prodotta** renderebbe la differenza visibile al primo tick.

## Sblocco: il throttle era il freno vero, non lo Scout

Su ordine dell'utente il coordinatore è stato avvisato. Ha diagnosticato da solo, in un
turno, e ha riconosciuto che la regola per questo caso **esiste già** (`C-08 ter`:
sbloccare con `Continua`) — insieme al proprio errore: «My miss: I should have caught
this». Il che sposta il problema: non manca la conoscenza, manca chi guarda. Un agente
fermo non emette segnali, e nessuno interroga i pane finché un umano non lo chiede.

Sbloccare lo Scout però **non è bastato**. Il freno che teneva ferma la produzione era
il throttle: **600-900 secondi** su tutti e quattro i worker, con la macchina al 4% di
carico. Portato a **180s**:

| | prima | dopo |
|---|---:|---:|
| posizioni / 10 min | 0 | 11 → 14 |
| posizioni / ora | 0 | 53 |
| punteggi / ora | 0 | 10 |
| load (4 core) | 0,35 | 1,45 |

Nota sulla deroga: con `BURN-INTENT` attivo `effective()` restituisce il valore
richiesto **senza applicare il `WORKER_FLOOR` da 300s**, quindi i 180s sono reali e non
riportati a 300. È il comportamento voluto e ha funzionato senza forzature manuali —
la deroga fa quello per cui è stata scritta.

### Il consumo si è spostato da coordinamento a produzione

Il dato più interessante non è il volume ma **chi** spende. A pipeline ferma il
coordinatore era il top-burner col 76% di share. A pipeline in moto sparisce dalla
classifica:

```
analista-2   2.11 kT/min      analista-1   1.35 kT/min
scorer-3     1.10 kT/min      scout-1      0.45 kT/min
```

Stessa spesa oraria, natura opposta. Ne segue che **il burn alto non è di per sé un
sintomo né positivo né negativo**: senza sapere chi consuma non se ne può concludere
nulla, e oggi nessun automatismo del pacing fa quella distinzione. Rafforza la proposta
dell'indicatore di spesa per posizione prodotta.

## Esito: la finestra da 5 ore protegge il weekly (allarme rientrato)

A pipeline lanciata, le proiezioni del pacing indicavano un rischio grave: weekly al 61%
in salita a ~12%/h, `weekly_pace_ratio` 13,74 e `proj_weekly` **874%** — cioè quasi nove
volte il budget settimanale. Su quei numeri il residuo del 39% sarebbe finito in poco
più di tre ore, con `weekly-halt` (non derogabile) e team fermo fino al reset, cinque
giorni dopo.

**Non è successo, e non poteva succedere.** La finestra da 5 ore ha saturato prima:

```
finestra 5h   93% 95% 97% 99% 99% 100% 100% 100% 100% 100%   ← satura, tutto si ferma
weekly        63% 63% 63% 64% 64%  64%  64%  64%  64%  64%   ← si appiattisce con lei
```

Il weekly è salito di **3 punti in un'ora** e si è fermato da solo. Il `pace_ratio` è
sceso da 13,74 a 5,32 senza che nessuno intervenisse.

Il motivo è strutturale: le due quote sono annidate. Non si può bruciare il weekly più
in fretta di quanto la finestra da 5 ore lasci consumare, e la finestra impone una pausa
forzata a ogni saturazione. **Il rischio weekly in una singola giornata è quindi molto
minore di quanto le proiezioni suggeriscano.**

### Come leggere `proj_weekly` e `pace_ratio`

Entrambi estrapolano il ritmo istantaneo su tutta la settimana **ignorando le pause che
la finestra imporrà**. Sono indicatori di *velocità corrente*, non previsioni: un valore
di 874% non significa che si arriverà a 874%, significa «al ritmo di questo istante,
senza freni, saresti a 874%» — una condizione che non si verifica mai. Vanno letti come
un tachimetro, non come un'autonomia residua.

Errore da non ripetere: quelle proiezioni sono state riportate all'utente come un rischio
imminente a tre ore, chiedendo una decisione economica che non era necessaria. Il freno
esisteva già e ha funzionato.

## Correlato: il freno all'83% era una decisione, non una soglia

La finestra precedente si era appiattita bruscamente intorno all'83% e aveva
chiuso all'88%, lasciando il 12% inutilizzato. Sembrava una soglia nel codice.
Il pane del Capitano dimostra il contrario: aveva applicato di sua iniziativa
un freno 600/900s, e ragionava esplicitamente sul **weekly** come vincolo vero,
non sulla finestra da 5 ore:

> «Weekly is the real constraint: +12%/h weekly pace is too hot (would hit
> weekly-halt near deroga end). Adding more brake would under-fill the window
> while weekly is the binding concern. Decision: HOLD.»

Il ragionamento è corretto e mostra autonomia sana (rifiuta il gradino
suggerito dalla guard, fa i conti, sceglie di non intervenire ogni tick).
Ma ha una conseguenza pratica: **finché il weekly è in SOPRA-PACE, la deroga
sulla finestra da 5 ore non basta a far spingere il team**. Sono due freni
distinti e la deroga ne toglie uno solo.

## Implicazioni

1. Serve un watchdog di **progresso**, non di esistenza: se un pane non cambia
   per N minuti e termina con un marcatore di attesa noto, va nudgeato.
   Il cap di step è la causa più frequente, ma non l'unica.
2. Il cap di step dovrebbe **auto-continuare** un numero limitato di volte
   prima di arrendersi, invece di fermarsi al primo colpo.
3. La deroga di burn va estesa al vincolo weekly, altrimenti resta inefficace
   in tutta la seconda metà della settimana.
4. Un solo Scout attivo rende il sourcing un single point of failure: il suo
   stallo azzera l'intera pipeline a valle.

## Metodo

Nota trasversale: in un giro precedente avevo dichiarato «la finestra ha chiuso
senza saturare» partendo da una lettura a −30 minuti, senza rileggere lo storico.
Il dato reale (88%, con appiattimento negli ultimi sei tick) era disponibile nel
`sentinel-data.jsonl` e diceva una cosa diversa. Le curve vanno lette dal log,
mai estrapolate dall'ultimo campione.
