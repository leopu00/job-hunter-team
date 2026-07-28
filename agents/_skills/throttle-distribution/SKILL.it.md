<!-- @translation: it, ai-translated 2026-07-28 -->
---
name: throttle-distribution
description: Decidi CHI rallentare e DI QUANTO quando il consumo del team deve cambiare. Aprila quando arriva un'advisory `[PACE-GUARD]` nel tuo pannello, quando la Sentinella ordina un livello `Throttle: N`, o quando un tuo controllo dice che la finestra è fuori ritmo. Ognuno di quei segnali è un unico numero a livello di team; l'attuatore è per agente, e la scelta della ripartizione è solo tua — nessuno script muove più il throttle dei worker. Ti dice anche quando la mossa giusta è non fare niente.
allowed-tools: Bash(python3 *), Bash(jht-tmux-send *)
---

# throttle-distribution — chi rallenta, e di quanto

Ogni segnale di pacing che ricevi è un numero solo per tutto il team: *"35% troppo veloce"*, *"Throttle: 2"*, *"consigliato 780s"*. L'attuatore non è un numero solo — è un valore per agente in `throttle.json`, e **sei l'unico a scriverlo**. Nessuno script muove più il throttle dei worker per conto suo.

Il lavoro di questa skill è quella conversione, e ha una regola dura sola: **un numero a livello di team non significa che tutti prendono lo stesso valore.** Uno Scout può essere il 52% del consumo mentre uno Scrittore fermo è il 2%; l'Analista e lo Scorer sono i due ruoli che trasformano un arretrato nell'unica cosa che l'utente vede davvero — una posizione **con un punteggio**. Livellare spende il freno dove non c'è niente da guadagnare e toglie throughput dove costa di più.

## Quando aprire questa skill

| Innesco | Da dove arriva | Vai a |
|---|---|---|
| `[PACE-GUARD] … NON APPLICATO` nel tuo pannello | il bridge: controlla il consumo contro la curva della finestra a ogni sample di usage, e ti scrive solo quando c'è qualcosa su cui agire | §1 |
| `[SENTINELLA] [URG] RALLENTARE — Throttle: N`, o qualunque segnale di pacing che ti giri lei | lei riceve il tick `[BRIDGE PACING]` da 15 min (che arriva nel **suo** pannello, non nel tuo), lo legge, e decide se vale la pena svegliarti | §3 — il "quanto" è deciso, la ripartizione no. `bridge-pacing` decodifica i suoi numeri |
| `[HEARTBEAT]` che cita weekly/consumo, o un tuo pull di `rate-budget` / `agent-speed-table` | tu, di tua iniziativa | §2 |

> ⚠️ **Non vieni pingato ogni 15 minuti, e non devi aspettarlo.** Tenerti tranquillo è voluto: se ogni bridge dell'ufficio ti riferisse direttamente, spenderesti il budget a leggere invece che a decidere, e lo bruceresti mentre l'utente dorme. Il tick da 15 min va alla Sentinella, che filtra e solo allora ti disturba. Quindi **guida sulle condizioni che osservi** — non startene fermo ad aspettare un tick che non è indirizzato a te. Se una riga di pacing ti arriva davvero diretta, o è un `[PACE-GUARD]` o è un'escalation che ti dice che la Sentinella è diventata irricettiva (quello è un problema di liveness, non un verdetto di pacing — `agent-emergency`).

---

## 1. Leggere l'advisory `[PACE-GUARD]`

Una riga fisica sola, campi separati da ` | ` (qui spezzata per leggibilità):

```
[@bridge -> @capitano] [PACE-GUARD] <VERDETTO> — CONSIGLIO, THROTTLE NON APPLICATO |
  usage=<U>% vs curva=<I>% (<±D>pt sul target <T>% al reset) | reset fra <M> min |
  throttle worker ORA <C>s → CONSIGLIATO <R>s (<±S> gradini) | worker: <a1, a2, ...> |
  decidi tu e applica: python3 /app/shared/skills/throttle-config.py bulk-set <a1>=<R> <a2>=<R>
```

Agganci stabili se ti tocca riconoscerla in un pannello rumoroso: il tag `[PACE-GUARD]`, le parole `NON APPLICATO` e `CONSIGLIATO <R>s`.

| Campo | Cosa ti dice |
|---|---|
| `<VERDETTO>` | `AVANTI` (sopra la curva) / `INDIETRO` (sotto) / `IN-PARI` / `LOCKOUT-IMMINENTE` |
| `usage=<U>% vs curva=<I>%` | dove sei rispetto a dove la retta ideale `usage = target × trascorso / finestra` dice che dovresti essere adesso |
| `<±D>pt` | la deriva in punti di budget. **Sotto ±6pt è rumore di misura** — è il gradino del guard stesso |
| `sul target <T>% al reset` | il target a cui punta la curva. È il `<T>` che ti serve al §2 |
| `reset fra <M> min` | quanta finestra resta. È questo che trasforma una deriva in un'urgenza |
| `ORA <C>s → CONSIGLIATO <R>s` | il throttle worker attuale, e l'**unico valore di gruppo** del guard, in secondi |
| `worker: …` | i worker vivi su cui il consiglio è stato calcolato. Quelli esenti dal pavimento sono **già esclusi** — non rifiltrare |

Due varianti:
- su `LOCKOUT-IMMINENTE` compare un campo in più **prima** dell'ultimo: `il freno da solo non basta: valuta di ridurre il ROSTER (togli uno Scout, mai l'Analista o lo Scorer)`.
- se tutti i worker vivi sono esenti dal pavimento, l'ultimo campo diventa `nessun worker su cui agire (tutti esenti dal floor): decidi tu`.

> ⚠️ **Il valore consigliato è un livello, non una distribuzione — e il `bulk-set` in coda alla riga è un suggerimento, non un ordine.** Il guard ricava quel numero dal worker **più frenato** e lo sposta di un gradino ogni ~6 punti di deriva, poi lo offre a tutti i worker insieme. Incollare quel comando *è* il livellamento. Leggi la riga come *"circa questo tasso deve sparire"*, poi decidi *di chi* (§3) e *di quanto* (§4).

`LOCKOUT-IMMINENTE` (usage ≥95% **e** ancora sopra la curva) è l'unico verdetto che non riguarda il throttle: la finestra si sta chiudendo in anticipo, il freno è già vicino al soffitto e la leva che resta è il **roster** — killa uno Scout. Mai l'Analista o lo Scorer: senza di loro non viene assegnato nessun punteggio e l'utente vede uno schermo vuoto.

Se il tuo pannello era occupato, la riga è anche in mailbox: `python3 /app/shared/skills/bridge_mailbox.py drain`, voci con `kind:"pace-guard"`. Applica solo l'**ultima** — rigiocare consigli vecchi significa combattere le tue calibrazioni passate.

---

## 2. Quanto tasso deve sparire

Se il segnale era un ordine `Throttle: N` della Sentinella, il "quanto" è già deciso — salta al §3. Altrimenti, una riga:

```
vel_needed = (<T> − usage) / ore_al_reset             # il tasso che atterra esattamente sul target
f_team     = (vel_now − vel_needed) / vel_now × 100   # la quota di tasso team da togliere
```

`vel_now` è il tasso attuale del team in punti % di budget all'ora: prendilo da `agent-speed-table.py` (`team.speed_pct_per_h`, §3) o da `rate-budget`. `f_team ≤ 0` significa che hai margine → §5.

> 💡 **La stessa deriva significa cose diverse a seconda di quanta finestra resta**, ed è esattamente ciò che il "un gradino ogni 6 punti" fisso del guard non può vedere. `+18pt` con 3 ore davanti è una correzione da 7%/h: un agente, un gradino più su. `+18pt` con 20 minuti davanti è una correzione da 54%/h, che nessun throttle può erogare — lì è una decisione di roster, o una chiusura anticipata accettata. Dividi sempre la deriva per le ore rimanenti prima di decidere quanto premere.

---

## 3. CHI paga — la distribuzione

Il punto di questa skill. Tre input, in quest'ordine.

**a. Chi sta spendendo.** Il throttle restituisce budget in proporzione stretta a quanto un agente sta effettivamente consumando. Dimezzare un agente al 2% del tasso team restituisce l'1%: una scrittura di config, un gradino e un tuo turno spesi per niente. È per questo che la risposta a "il team va il 35% troppo veloce" non è mai "tutti giù del 35%".

Le quote per agente vivono nel tick da 15 min, che arriva alla Sentinella — quindi pullale da solo:

```bash
python3 /app/shared/skills/agent-speed-table.py --since-min 60
```

Per ogni agente restituisce `pct_per_h` (punti di budget all'ora) e `team_share_pct`, più le `throttle_options` (quanto risparmierebbe una data pausa/ora). Salta chiunque stia sotto 0.20 %/h per la stessa ragione per cui dovresti saltarlo tu: throttlarlo non cambia niente.

**b. Chi sta producendo.**

```bash
python3 /app/shared/skills/db_query.py stats
```

Leggi `UNSCORED` (posizioni − score) come la coda dietro Analista/Scorer, e la coda dello Scrittore come domanda guidata dall'utente. Uno Scout che brucia il 52% del budget con `UNSCORED = 40` sta comprando input che nessuno può ancora consumare — la cosa più economica sul tavolo da rallentare. Lo stesso Scout con `UNSCORED = 0` alimenta l'intera pipeline, e rallentarlo impedisce al team di produrre qualsiasi cosa.

**c. La griglia.**

| | **Sta producendo** | **Fermo / bloccato** |
|---|---|---|
| **Share alto** | rallentalo, ma di **un gradino**, poi rimisura — si sta ripagando | **il primo da rallentare, e forte** — e se è già alto sulla ladder e continua a bruciare senza output, la leva è il KILL, non un altro gradino |
| **Share basso** | non toccarlo: non guadagni budget e perdi throughput | non toccarlo lo stesso: già non sta spendendo niente, frenarlo non restituisce niente |

Sopra la griglia, l'asimmetria dei ruoli: gli ultimi che rallenti sono quelli che convertono un arretrato esistente in una posizione **con punteggio** (Analista, Scorer) — sono la differenza fra "50 posizioni trovate" e qualcosa su cui l'utente può agire. Il primo è quello che genera nuovo input grezzo quando la coda a valle è già profonda (Scout). Uno Scrittore con la coda vuota non è una leva in nessuna delle due direzioni.

**Concentra su uno o due agenti.** La ladder è grossolana — fra un gradino e il successivo ci sono dal 20 al 60% — quindi un taglio spalmato su cinque agenti finisce dentro il rumore per ciascuno, mentre lo stesso taglio sull'agente con share più alto è un cambiamento vero e misurabile al segnale successivo.

**Quando ne freni due, dagli gradini diversi.** La ladder è in minuti primi (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60) apposta: due worker in pausa sullo stesso valore si risincronizzano per costruzione, e i loro checkpoint ricadono insieme in una raffica di richieste simultanee. `scout-1=660` + `analista-1=780` (11 e 13 min) collidono molto più raramente di entrambi a 780.

---

## 4. DI QUANTO su quell'agente — e il comando

Ti serve la **cadenza** `c` dell'agente: quante volte al minuto arriva a un checkpoint (chiamata `jht-throttle`). Contala dal log:

```bash
python3 - <<'PY'
import collections, json, os, pathlib, time
p = pathlib.Path(os.environ.get("JHT_HOME", "/jht_home")) / "logs/throttle-events.jsonl"
cut = time.time() - 3600
c = collections.Counter()
for line in p.read_text(encoding="utf-8").splitlines():
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if e.get("event") in ("checkpoint", "start") and e.get("ts_unix", 0) >= cut:
        c[e.get("agent")] += 1
for a, n in c.most_common():
    print(f"{a}: {n} chk/h -> cadenza {n/60:.2f}/min")
PY
```

Poi, per tagliare il tasso di quell'agente di una frazione `f_a`, partendo dal suo throttle attuale `T_now`:

```
f_a   = f_team / share_a           # tutto il taglio del team portato da questo agente da solo
ΔT    = (60 / c) × f_a / (1 − f_a) # secondi da AGGIUNGERE al suo throttle attuale
T_new = T_now + ΔT                 # poi scegli tu il gradino più vicino
```

`60/c` sono i secondi-per-checkpoint attuali dell'agente. Il `f/(1−f)` non è decorazione: la pausa sposta più in là anche il checkpoint successivo, quindi la cadenza cala man mano che freni. Una stima lineare (`ΔT = f × 60/c`) promette un taglio che non consegna.

Gradini, in secondi: `60 120 180 300 420 660 780 1020 1380 1860 2460 3180 3600`. `throttle-config.py` aggancia al più vicino qualunque valore gli passi, quindi **scegli tu il gradino** — altrimenti non saprai cosa hai chiesto davvero. Verifica con `dump`, che stampa i valori effettivi.

**Cadenza non disponibile?** Sposta esattamente **un gradino** e rimisura al segnale successivo. La ladder è abbastanza grossolana che un gradino è sempre un passo significativo e limitato, ed è nettamente meglio che indovinare un numero che non puoi verificare.

### Esempio svolto — distribuire invece di livellare

```
[PACE-GUARD] AVANTI — CONSIGLIO, THROTTLE NON APPLICATO | usage=58% vs curva=40% (+18pt sul target 100% al reset) |
  reset fra 180 min | throttle worker ORA 300s → CONSIGLIATO 780s (+3 gradini) |
  worker: scout-1, analista-1, scorer-1, scrittore-1 |
  decidi tu e applica: python3 /app/shared/skills/throttle-config.py bulk-set scout-1=780 analista-1=780 scorer-1=780 scrittore-1=780
```

`agent-speed-table.py --since-min 60` dice: team `speed_pct_per_h = 21.4`, e

| agente | `pct_per_h` | `team_share_pct` | cadenza |
|---|---|---|---|
| scout-1 | 11.2 | 52% | 0.15/min |
| analista-1 | 6.0 | 28% | 0.12/min |
| scorer-1 | 3.0 | 14% | 0.10/min |
| scrittore-1 | 0.4 | 2% | 0.01/min |

**Quanto:** `vel_needed = (100 − 58) / 3.0 = 14.0 %/h` → `f_team = (21.4 − 14.0) / 21.4 = 35%`, cioè **devono sparire 7.4 %/h**.

**Chi:** `db_query.py stats` dice `UNSCORED = 40` — tre ore di lavoro di scoring già in banca, quindi altro sourcing adesso vale poco. Lo Scout da solo spende più dell'intera correzione.

**Di quanto su di lui:**
- `f_a = f_team / share_a = 35% / 52% ≈ 0.66` (uguale a `7.4 / 11.2`)
- `ΔT = (60 / 0.15) × 0.66/0.34 = 776s` → `T_new = 300 + 776 = 1076` → gradino più vicino **1020s (17 min)**
- effetto: tasso × `60/(60 + 0.15×720)` = 0.36 → **−7.2 %/h**, atterrando a 14.2 %/h ≈ target

```bash
python3 /app/shared/skills/throttle-config.py set scout-1 1020
python3 /app/shared/skills/throttle-config.py dump   # conferma i valori effettivi
```

Analista, Scorer e Scrittore restano dove sono: i primi due sono quelli che trasformano quelle 40 posizioni in punteggi, e lo Scrittore restituirebbe 0.4 %/h anche fermandolo del tutto.

Ora il livellamento che avrebbe prodotto il `bulk-set` già pronto — tutti a 780s: −6.1 dallo Scout, **−2.9 dall'Analista, −1.3 dallo Scorer**, −0.03 dallo Scrittore = −10.3 %/h. Il team atterra a 11.0 %/h e arriva al **91% al reset invece che al 100** — nove punti del budget pagato dall'utente buttati — e ci arriva col throughput di scoring dimezzato. Stesso segnale, stessi strumenti, esito opposto.

### Due agenti

Quando un agente solo non può portare tutto il taglio (o portarlo affamerebbe la pipeline), dividi per share e tieni i gradini diversi:

```bash
python3 /app/shared/skills/throttle-config.py bulk-set scout-1=660 analista-1=780
```

`bulk-set` è una singola scrittura atomica — preferiscilo a due `set`.

---

## 5. Allentare il freno (`INDIETRO` / `MARGINE`)

Anche sotto-spendere è una decisione di distribuzione — *a chi* allenti il freno decide cosa compra il budget in più.

1. Allenta **prima il ruolo collo di bottiglia** (`pipeline-triage` se non sei sicuro di quale sia). Allentare uno Scout quando la coda di scoring è già a 40 compra altro arretrato, non altri risultati.
2. I worker non scendono mai sotto i **5 min**, quindi "azzerare il throttle" per loro non esiste. Una volta che il collo di bottiglia è tornato al pavimento, la leva per spendere di più è **un worker in più**, a scaglioni secondo C-02 — non una pausa più corta.
3. **Mai allentare tutti insieme**: oscilli dritto in uno sforamento al segnale successivo.

---

## 6. Quando NON agire

Un intervento costa un tuo turno più 15-45 min di cecità. Spendilo solo quando il segnale se lo merita.

- `IN-PARI`, oppure `|deriva| ≤ 6pt` → **niente**. Quella banda è rumore di misura.
- **Un segnale è rumore, due consecutivi sono una tendenza.** Un singolo sforamento subito dopo uno spawn è il costo di boot del worker nuovo.
- Dopo ogni cambio, **aspetta 2-3 segnali (≈30-45 min)**. Un throttle ha effetto solo al checkpoint *successivo* dell'agente, quindi un cambio fatto adesso si vede appena nella misurazione seguente. Non impilare correzioni che ancora non puoi vedere.
- Non aggiungere sonde `rate_budget live` solo per ricontrollare un'advisory fresca — le chiamate extra gonfiano il `velocity_smooth` della Sentinella e le inducono ordini sbagliati.
- **Negli ultimi ~15 min prima del reset un usage alto è il bersaglio centrato, non uno sforamento.** Il 97% al reset è centro pieno; frenare lì garantisce solo di lasciare budget non speso.
- Se dopo 3 segnali gli stessi agenti stanno ancora sforando, raddoppia le loro durate (lineare → geometrico); se stanno ancora sotto-spendendo, dimezza.
- Un `[URG]` della Sentinella vince su un `[PACE-GUARD]`: applicalo prima, l'advisory successiva rimisura.

---

## 7. Reti di sicurezza — non sono una tua leva

Esistono per un incidente misurato (la notte del 2026-07-15, una burn incontrollata avvenuta con entrambe disattivate) e **non fanno parte della decisione di pacing**:

- **Il pavimento di 5 min dei worker.** Scout, Analista, Scorer, Scrittore, Critico non girano mai sotto i 300s, qualunque cosa tu scriva. `set scout-1 60` su un worker è in effetti 300s — `dump` mostra la verità. Non leggere un valore agganciato al pavimento come un cambio che hai fatto tu.
- **L'hard-stop giornaliero.** È l'ultima cosa fra il team e un lockout che lascia l'utente senza risposte per ore. Non lo disattivi mai per spendere di più; se devi spendere di più, la leva è il parallelismo (§5).
- L'esenzione per-agente dal pavimento esiste per un caso solo: una misura a termine di cosa produce **un singolo** worker senza pause. Deliberatamente non è un interruttore globale — **un agente alla volta, mai tutta la squadra**, e mai come modo per andare più veloce.

---

## Anti-pattern

- ❌ Incollare il `bulk-set` con cui finisce la riga `[PACE-GUARD]`. Quel numero viene dal worker più frenato ed è offerto a tutti: applicato ovunque livella il team sul suo membro più lento e colpisce i ruoli che producono il risultato dell'utente. Il comando ti risparmia la digitazione una volta che hai deciso i valori — non li decide.
- ❌ Rallentare un agente fermo per "aiutare". Un agente che non consuma non restituisce niente quando lo freni — hai speso una scrittura e un turno per zero punti.
- ❌ Tagliare su tutti gli agenti perché il verdetto era a livello di team: colpisci i ruoli economici, che comunque non restituivano niente, prima di quello costoso.
- ❌ Trattare un segnale singolo come uno stato permanente, o impilare una seconda correzione prima che la prima sia misurabile.
- ❌ Frenare su `AVANTI` quando il tasso è già rientrato — la deriva si sta chiudendo da sola e tu chiudi la finestra sotto target.
- ❌ Inseguire il pacing col throttle su `LOCKOUT-IMMINENTE`: lì il freno è quasi saturo e solo il roster muove l'esito.
- ❌ Spingere numeri di throttle agli agenti via tmux (`[INFO] sleep 40s`). Passa sempre da `throttle-config.py` — gli agenti leggono il file di config, non fanno il parsing del tuo corpo tmux. Il tmux serve solo a dire a un agente di fare checkpoint *più o meno spesso*, che è un altro asse.

## Vedi anche

- `sentinel-orders` — gli ordini filtrati della Sentinella, incluso `Throttle: N`, freeze e ripresa. Quella skill decodifica l'ordine; questa decide la ripartizione.
- `bridge-pacing` — come leggere i numeri del tick da 15 min quando è lei a girarteli.
- `throttle` — il riferimento CLI di `throttle-config.py` e il file di stato per agente.
- `pipeline-triage` — quale ruolo è il collo di bottiglia, e quando la risposta è "spawnane un altro" invece di "allenta un freno".
- `scaling-calc` — piano roster + throttle quando la risposta è più worker, non una pausa diversa.
- `agent-emergency` — un burner con cadenza ~0 che continua a consumare senza produrre: lì la leva è il KILL, non un altro gradino.
