# Daily hard-stop — prima accensione live + falla dello standby (betaB/Kimi, 2026-07-02)

Prima volta che il **daily hard-stop** (`[BRIDGE ALERT] ⛔ DAILY-CAP SFORATO` in
`sentinel-bridge.py`, fix #2 del coordinator-burn) scatta **in produzione** su betaB.
Ha funzionato nella sostanza — ha tagliato il burn e protetto il weekly — ma
l'indagine ha scoperto **due difetti** da chiudere.

## Contesto: la notte 01→02/07

- Finestra 20:00→08:00 Roma (18:00→06:00 UTC). Apertura weekly **58%**.
- Lavoro reale solo nella prima parte: **7 posizioni** trovate + analizzate, **0 score**
  (nessuno Scorer spawnato). Ultima attività DB **02:17 Roma**.
- Poi burn di **overhead** a 0 output (Mentor + Mantenitore sweep + Capitano con
  **thinking ON** — scelta del 01/07, vedi `2026-07-01-capitano-kimi-thinking-off-writer-gate.md`).
- **01:50 UTC (03:50 Roma): il hard-stop scatta.** Flag `logs/daily-halt.flag`:
  `consumed=14% · cap=13.4% · budget=8.4%`. ESC a tutte le 8 sessioni, standby.
- Chiusura weekly **74%** (+16pp), resta 26%, reset 5/07 → SOTTO-PACE. Nessun esaurimento.

Il flag ha fatto il grosso: prima del halt ~1.75%/h, dopo ~0.5%/h. Ma non è stato il
"silenzio totale fino al reset" che volevamo.

## Bug 1 — scatta a 14, non a 13.4 (quantizzazione)

Il cap ha la virgola (`8.4 + 5 = 13.4`) ma il **contatore di consumo del provider è
granulare a % INTERE** (…13 → 14 → 15…): non esiste il campione "13.4".

- a **13%** è sotto cap (13 < 13.4) → nessun allarme;
- al primo campione a **14%** è sopra → scatta.

⇒ ~**0.6pp di sforo "di quantizzazione" inevitabile**, più la latenza del tick
(~5–15 min tra un campione e l'altro). **Non è un bug di logica**, è la risoluzione del
dato. Da tenere presente: il cap effettivo è `ceil` del cap teorico. Se si volesse
azzerare l'overshoot, il trigger andrebbe su `consumed >= floor(cap)` o su una stima
sub-punto della velocità (probabilmente non ne vale la pena).

## Bug 2 — lo standby PERDE: i risvegli da throttle non guardano il flag 🔴

`ESC + daily-halt.flag` **silenzia i bridge** (verificato: dopo l'alert delle 01:50,
**zero messaggi bridge** — pacing e heartbeat gate-ati dal flag → muti). Ma il flag
**non è letto da nessuno lato-agente**, e il leak viene da lì. Sequenza dai log:

```
01:50  bridge → ALERT (ultimo msg del bridge, poi silenzio)
02:03  analista-2 → capitano [READY] "throttle 900s terminato, coda vuota"   ← SI SVEGLIA
02:04  capitano  → analista-2 [URG]  "DAILY-CAP sforato, STANDBY 3600s"       ← RISPONDE
03:05  analista-2 → capitano [READY] "standby 3600s terminato…"               ← si sveglia
03:05  capitano  → analista-2 [INFO] "resta in standby"                       ← risponde
04:05 / 05:06  … stesso giro, ~1×/ora …
```

**Meccanismo:** l'ESC interrompe il turno *corrente*, ma ogni agente resta su un
**timer di throttle** (900s → 3600s). Quando il timer scade, la CLI Kimi **gli dà un
turno** → l'agente si sveglia, pinga il Capitano (`[READY]` "throttle finito, coda
vuota"), e il **Capitano risponde** (è un core interattivo, NON halted, per giunta
thinking ON). Ogni giro = 2+ turni LLM. Ripetuto ~1×/ora → i **+2pp** osservati
(daily consumed 14 → 15 dopo il halt).

Nessuno dei tre passi — risveglio agente, ping, risposta Capitano — controlla
`daily-halt.flag`. Quindi lo "standby" non è silenzio: è un **battito orario
risveglio→ping→risposta** che perde ~1–2%/notte.

### Fix da fare (2 mosse + 1 cintura)

1. **Lato agente (worker):** al risveglio, prima di pingare, `test -f daily-halt.flag`.
   Se presente → **non pingare il Capitano**, rientra in throttle massimo e basta.
   (Prompt worker + eventuale guardia nella skill di loop.)
2. **Lato Capitano:** se `daily-halt.flag` è presente, **ignora i `[READY]`** dei
   worker (sono risvegli da timer, non lavoro): niente risposta, resta zitto finché il
   bridge non toglie il flag. Alla riapertura, un solo `[RIPRENDI]`.
3. **Cintura di sicurezza (bridge):** ri-mandare `ESC` a qualunque sessione che emette
   messaggi mentre il flag è attivo (net contro risvegli imprevisti).

Effetto atteso: lo standby diventa **vero silenzio** fino al reset del budget
giornaliero → il residuo ~1–2%/notte va a ~0.

## Nota trasversale

Lo sforo di quella notte **non è dei worker** (7 posizioni poi parcheggiati sul mercato
secco), ma dell'**overhead coordinatori/manutenzione** (Mentor + Mantenitore +
Capitano-thinking-ON). Il hard-stop lo cattura, ma conferma che il coordinator-burn
resta il primo driver di costo. Da incrociare con la valutazione del **thinking ON sul
Capitano** (se fa sforare il daily ogni notte a basso output, la scelta va rivista).

Vedi `[PACING-DAILY-HALT-STANDBY-LEAK]` in `BACKLOG.md` e
`project_coordinator_burn_remediation` (memoria).
