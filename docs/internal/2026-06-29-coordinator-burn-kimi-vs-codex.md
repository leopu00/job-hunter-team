# Coordinator-burn misurato: Kimi vs Codex (2026-06-29)

**TL;DR** — Sentinella + Capitano (i due coordinatori) si mangiano **~76% del budget
settimanale su Kimi (betaB)** contro **~20% su Codex (betaC)**. La causa non è il
design del team: è il **modello**. Per tick di monitoraggio (ogni 15 min) i
coordinatori Kimi costano **~7–12× più** di quelli Codex. Implicazione: il nuovo
pacing weekly fa *durare* la settimana a Kimi, ma con questo overhead gran parte
del budget la brucia il monitoraggio, non i lavori trovati/valutati.

## Contesto
Obiettivo del team betaB/Kimi: durare **1 settimana intera** col budget (record
precedente ~2,5 giorni-lavoro poi esaurito). Il nuovo monitoraggio weekly-aware
della Sentinella (retta `sustainable_burn`, `early_lockout`, COAST) è LIVE e tiene
la retta sostenibile (~1.14%/h). Ma analizzando i pane tmux di Capitano e
Sentinella è emerso che **i coordinatori sono il consumatore dominante**.

## Dati (fonte: `/root/.jht/logs/agent-usage-table.json`, sola lettura)
Tabella token per-agente del bridge, bucket 5 min, finestra 2h.

### betaB / Kimi — finestra 03:45–05:45 UTC (fase COAST, worker per lo più idle)
| Agente | kT | quota |
|---|---|---|
| Sentinella | ~276 | **55%** |
| Capitano | ~109 | **22%** |
| **Coordinatori** | **~385** | **≈76%** |
| Analista-3 (lavoro) | ~110 | 22% |
| Scorer-6 (lavoro) | ~8 | 2% |
| **Lavoro utile** | **~118** | **≈24%** |
| Totale | ~503 | |

### betaC / Codex — finestra 08:45–10:45 UTC (Scout attivo, scrape in corso)
| Agente | kT | quota |
|---|---|---|
| Scout-2 (lavoro) | ~322 | **75%** |
| Capitano | ~55 | **13%** |
| Sentinella | ~30 | **7%** |
| Analista-1 (lavoro) | ~22 | 5% |
| **Coordinatori** | **~85** | **≈20%** |
| **Lavoro utile** | **~344** | **≈80%** |
| Totale | ~429 | |

## La metrica davvero comparabile: costo per tick di monitoraggio
Lo "share" sopra è confuso dalla fase (betaB in COAST gonfia i coordinatori; betaC
con Scout attivo gonfia il lavoro). La metrica **fase-indipendente** è il costo di un
tick di solo-coordinamento (ogni 15 min):

- **Codex:** ~**11 kT/tick** (dal `pacing-bridge-state.json`: `team_kt=10.75`,
  capitano 8.7 + sentinella 2.05 in una finestra 15m senza worker).
- **Kimi:** ~**70–130 kT/tick** (Sentinella da sola: 57→63→65→70 kT a ogni tick;
  Capitano occasionale 100 kT in UNA deliberazione).

➡️ **A parità di monitoraggio, i coordinatori Kimi costano ~7–12× più di Codex.**

## Causa
Stesso prompt, stessa architettura → la differenza è il modello.
- **Sentinella su Codex** è laconica (1–9 kT/tick); **su Kimi** ragiona a blocchi
  enormi a ogni tick (catene di pensiero lunghe nel pane prima di un'azione banale).
- **Capitano su Kimi** delibera in monologhi (una decisione = ~100 kT); su Codex è
  molto più asciutto.
- Kimi K2.7 Code è intrinsecamente più verboso/costoso per ciclo di ragionamento.

## Anti-pattern collaterale (già noto, qui confermato)
Il verdetto del bridge indica spesso `top consumer: analista-3` (il worker
produttivo) e ordina di throttlarlo, mentre il vero hog è Sentinella/Capitano (non
throttlabili via `throttle-config.py`). Il Capitano stesso lo nota ("the real issue
is Capitano/Sentinel overhead") ma applica lo stesso il comando → **rallenta il
lavoro utile mentre i veri consumatori restano**. Mitigazione attuale = Sentinella
si auto-zittisce ("taccio completamente"), reattiva.

## Implicazioni / direzioni (da approfondire)
1. **Abbassare il costo per tick dei coordinatori su Kimi** è la leva che "svolta"
   il team: Sentinella meno verbosa, Capitano deliberazioni più corte, o **tick meno
   frequenti in COAST** (quando i worker sono idle non serve ragionare ogni 15 min).
2. **Capire le manopole del modello**: per Kimi se esiste un livello di
   reasoning/verbosity abbassabile; per Codex su che `model_reasoning_effort` gira
   (e se Codex è "economico" perché su effort basso). → indagine separata in corso.
3. Il `top-consumer` del verdetto pacing dovrebbe poter indicare anche i coordinatori
   (oggi punta solo ai worker throttlabili) — altrimenti il segnale è fuorviante.

## Config dei modelli — dove sono le manopole (`.launcher/start-agent.sh`)
`get_agent_info` mappa **ruolo → effort → model**. Tutti i ruoli core sono a effort
`high`; Sentinella esplicitamente: `SENTINELLA|high|sonnet` ("le decisioni meritano
effort high"); `CAPITANO|high|`.

**Come l'effort arriva (o NON arriva) al CLI, per provider:**
- **Claude:** `--effort $effort --model <opus|sonnet>` → effort applicato.
- **Codex:** `--yolo -c model_reasoning_effort=$effort` → effort applicato. Il default
  del `config.toml` è `medium`, ma il launcher forza i coordinatori a **`high`**.
  Quindi Codex Sentinella/Capitano girano a reasoning **high** e restano comunque a
  ~11 kT/tick → **la differenza con Kimi NON è il setting, è il modello** (reasoning
  gpt-5.x molto più conciso in token).
- **Kimi:** `--yolo --max-steps-per-turn 100` → **NESSUNA manopola di reasoning
  passata.** L'`effort=high` calcolato viene IGNORATO per Kimi.

**La leva per Kimi:** la CLI espone `--thinking / --no-thinking` (default: **thinking
ON**). Il "thinking" di K2.7-Code è la catena di ragionamento verbosa che genera i
60–130 kT/tick. Oggi è acceso e non controllato. `--max-steps-per-turn 100` è già lì
come guardia anti-runaway (K2.7 tende a rabbit-hole ~170k token/0 output) ma cappa la
LUNGHEZZA del turno, non la verbosità del singolo step.

**Direzioni candidate (da validare, NON ancora applicate):**
1. `--no-thinking` su Kimi, almeno per i **coordinatori**: la Sentinella è per design
   un "watchdog leggero" sopra il bridge deterministico (`sentinel-bridge.py`), quindi
   il thinking profondo è ridondante con i dati già calcolati dal bridge. Rischio basso
   su Sentinella; sul Capitano (decisioni reali) valutare con cautela / A-B.
2. Wirare per Kimi una mappa effort→thinking (es. `effort=low` → `--no-thinking`),
   così la stessa manopola `fast` vale anche per Kimi.
3. Ridurre la frequenza dei tick coordinatori in **COAST** (worker idle → non serve
   ragionare ogni 15 min).
4. Far sì che il `top-consumer` del verdetto pacing possa indicare anche i coordinatori
   (oggi punta solo ai worker throttlabili → segnale fuorviante).

## Esperimento live su betaD (2026-06-29) — VALIDATO
Manopola scoperta nel launcher: la CLI Kimi espone `--thinking / --no-thinking`
(default ON). L'`effort` calcolato per ruolo NON viene passato a Kimi (solo
`--max-steps-per-turn 100`). Test: rilanciata SOLO la Sentinella su betaD
(`203.0.113.40`, Kimi) con `--no-thinking`.

**Risultato spesa:** Sentinella **86–87 kT/h → ~18 kT/h = −78%**, stabile su ~2h.
Controllo di fase: gli altri agenti nello stesso intervallo sono andati SU (scout,
analista, scorer) → non è un calo di carico, è il flag. Indicatore CLI `●→○`.

**Risultato qualità decisionale (il punto critico):** in ~2h la Sentinella
no-thinking ha gestito 2 incidenti reali — (1) worker zombie + CPU 100% → diagnosi
corretta + KILL+respawn (C-12), non freeze globale; (2) conflitto bridge-vs-Capitano
+ weekly debt +35pp → ha applicato la gerarchia AGENTS.md ("io consiglio, lui
decide"), pesato weekly-debt vs pipeline, e raccomandato coast/zero-spawn, EVITANDO
un overspawn. Test oggettivo: **il Capitano non ha MAI respinto/corretto un suo
ordine**; anzi *"We should trust the Sentinella's weekly assessment over the bridge's
instantaneous view"*. Ragionamento ancora **visibile** nel pane (scritto in risposta,
non in thinking nascosto) → auditabile. Limiti onesti: n=2 incidenti, ~2h, nessun
A/B, entrambe decisioni conservative.

**Insight architetturale:** il sistema regge perché una **Sentinella economica
(monitor/segnale)** alimenta un **Capitano che ragiona (decisore, thinking ON)**.
Questo motiva la scelta di NON spegnere il thinking al Capitano.

## Evidenza esterna (letteratura K2, nov 2025–giu 2026)
- Moonshot ha tagliato i thinking-token del **~30%** in K2.7-Code per combattere
  l'**overthinking** → loro stessi riconoscono che il thinking spesso è overhead.
- Analisi indipendenti: alcuni modelli (incl. **Kimi K2.5**) NON beneficiano del
  thinking (overthinking); per query semplici/classificazione la raccomandazione è
  **disabilitarlo**. Critica nota: *"thinking mode sometimes wraps a simple bug fix
  in an unsolicited architectural overhaul"*.
- ⚠️ Contraddizione: un articolo dice che in K2.7 il thinking è "mandatory, cannot be
  disabled" → vale per l'**API**, NON per la **CLI**: il flag `--no-thinking` funziona
  (lo abbiamo misurato) e con ogni probabilità commuta in **"Instant mode"** (temp 0.6,
  risposte dirette). Il dato empirico batte l'articolo per il nostro setup.
- Fonti: artificialanalysis.ai/models/kimi-k2-thinking · flowtivity.ai/blog/kimi-k2-7-complete-review
  · venturebeat (K2.7-Code cuts thinking tokens 30%) · datacamp kimi-k2-thinking-guide.

## Decisione e implementazione (2026-06-29)
**Kimi: `--no-thinking` per TUTTI i ruoli TRANNE il Capitano.** Cablato in
`.launcher/start-agent.sh`, ramo `kimi|moonshot)`: `if [ "$ROLE" != "capitano" ];
then CLI_ARGS="$CLI_ARGS --no-thinking"; fi`. Codex/Claude non toccati. Il Capitano
resta thinking-ON (unico decisore multi-fattore). Deploy via immagine
(master→CI→`:latest`→`jht upgrade` sulle VPS Kimi: betaB, betaD). Atteso: taglio
~20%+ del burn TOTALE del team Kimi, con il budget risparmiato dirottato sul lavoro
(Scout/Analista) invece che sull'overhead → aiuta l'obiettivo "durare 1 settimana".
Da osservare post-deploy: che il Capitano (thinking ON) NON diventi il nuovo collo
di bottiglia, e che la qualità decisionale del team regga nel tempo (n grande).

## Metodo (riproducibile, sola lettura)
- `agent-usage-table.json` = serie kT/agente per bucket 5m, finestra 2h (la fonte).
- `pacing-bridge-state.json` = `last_report` con `agents[].kt/share` per il tick 15m.
- Pane tmux: `docker exec jht tmux capture-pane -t SENTINELLA|CAPITANO -p -S -260`.
- DB aperto `mode=ro`; nessun intervento sui team (osservazione).
