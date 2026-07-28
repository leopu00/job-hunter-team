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
