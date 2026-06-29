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

## Metodo (riproducibile, sola lettura)
- `agent-usage-table.json` = serie kT/agente per bucket 5m, finestra 2h (la fonte).
- `pacing-bridge-state.json` = `last_report` con `agents[].kt/share` per il tick 15m.
- Pane tmux: `docker exec jht tmux capture-pane -t SENTINELLA|CAPITANO -p -S -260`.
- DB aperto `mode=ro`; nessun intervento sui team (osservazione).
