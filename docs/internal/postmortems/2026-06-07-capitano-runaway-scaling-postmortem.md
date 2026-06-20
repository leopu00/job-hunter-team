# 📈 Capitano runaway-scaling — postmortem 2026-06-07

Sulla VPS beta di betaA (`203.0.113.10`, `ubuntu-2gb-hil-1-betaC`, profilo `betaA@example.com`) il Capitano ha scalato il team a **14 agenti** (5 Scout, 4 Analisti, 2 Scorer + Capitano/Assistente/Mentor) mentre il **weekly cap Codex era al 92%** a metà ciclo e la produzione era in **calo** (spazio di ricerca esaurito). Senza intervento il team avrebbe consumato l'8% residuo di weekly in poche ore, finendo **bloccato ~3 giorni** fino al reset (11/06 00:34 UTC), proprio quando il lavoro utile scarseggiava.

La causa non è un bug isolato ma una **combinazione strutturale**: abbiamo rimosso di proposito il cap fisso sugli spawn (commit `031035cfe`) delegando la moderazione a una "guardia budget"; ma quella guardia ha **due buchi weekly-blind nel regime "team idle"**, entrambi a livello di codice nei bridge. Cap rimosso + guardia bucata = niente ferma meccanicamente lo scaling.

Nessun fix è stato applicato: questo documento serve a fissare diagnosi ed evidenze per decidere il rimedio strutturale. Lega con [PACING-WEEKLY-EXHAUSTION] in `BACKLOG.md` e con i precedenti `2026-05-21-halt-weekly-incident.md`, `2026-05-21-vps1-run-postmortem.md`, `2026-06-03-diagnosi-pacing-weekly.md`, `2026-06-05-pacing-migration-plan.md`.

---

## Stato osservato (snapshot 2026-06-07 ~12:58 UTC)

| Metrica | Valore | Fonte |
|---|---|---|
| Agenti tmux attivi | 5 Scout · 4 Analisti · 2 Scorer · Capitano · Assistente · Mentor (14) | `tmux ls` nel container `jht` |
| Consumo finestra 5h | usage 25%, proj 38%, status `SOTTOUTILIZZO` | `logs/sentinel-data.jsonl` (tick) |
| Reset finestra 5h | 15:10 UTC (17:10 Roma) | tick `reset_at` |
| Consumo weekly | **92%** | tick `weekly_usage` |
| Reset weekly | 11/06 00:34 UTC (02:34 Roma) | tick `weekly_reset_at_unix` 1781138050 |
| Working hours | 08:00–20:00 Europe/Rome, 7/7 (06–18 UTC) | `jht.config.json` |
| Throttle anti-collisione oggi | 66 eventi | `logs/throttle-events.jsonl` |
| Spawn recenti | SCOUT-4 (10:31), ANALISTA-4 (10:39), SCOUT-5 (12:45) | tmux session create-time |

**Produzione per giorno** (DB locale `/root/.jht/jobs.db`):

| Giorno | Positions | Scored |
|---|---|---|
| 03/06 | 25 | 22 |
| 04/06 | 55 | 49 |
| 05/06 | 51 | 45 |
| 06/06 | 30 | 25 |
| 07/06 (parziale) | 21 | 15 |

~180 posizioni totali (97 scored, 82 escluse, 3 in coda), 146/146 aziende analizzate. Distribuzione score: 105 a 70+, 33 a 50-69, 11 a 40-49, 7 sotto 40.

**Due segnali chiave:** produzione in calo **mentre** gli agenti aumentano (rendimenti decrescenti); `logs/scout-dedup.log` pieno di duplicati level1/2/3 e annunci morti → spazio di ricerca in esaurimento. Il team è stato sovra-staffato proprio quando il lavoro utile diminuiva.

**Messaggio live del pacing bridge** (`logs/pacing-bridge-state.json`):
> `[BRIDGE PACING] PIPELINE STALLED — usage=23% proj=36% reset_in=2.43h team_kt=0.0 … Applica regola PIPELINE VUOTA + UNDERSHOOT ORA: (1) … (2) spawna SCOUT se range vuoto; (3) ANALISTA … (4) SCORER … `

Il bridge raccomandava di **spawnare di più** con il weekly al 92%.

---

## Catena causale

### 1. Rimozione del cap fisso — commit `031035cfe`

`feat(capitano): spawn worker bounded-by-budget invece di cap fisso (#4)` — leopu00, **gio 4 giu 22:40 +0200**.

Ha sostituito le `Max instances` fisse in `agents/capitano/capitano.md`:

| Ruolo | Prima | Dopo |
|---|---|---|
| Scout | 2 | budget-bound (≤6) |
| Analista | 2 | budget-bound (≤6) |
| Scorer | 1 | budget-bound (≤3) |
| Scrittore | 3 | budget-bound (≤4) |

e ha aggiunto la nota operativa: *"i worker scalabili non hanno un cap fisso — decidi tu quanti spawnarne in base al budget. I numeri ≤N sono tetti di sicurezza anti-runaway, non target né limiti operativi. La guardia è il budget, non il count."*

**Motivazione** (dal commit): un beta-user aveva ordinato "spawn a third Scout", ineseguibile col cap=2. Scelta deliberata e sensata; il punto è che ha spostato l'intero peso della moderazione sulla "guardia budget" (regole C-07 throttle + C-09 weekly-awareness + skill `pipeline-triage`).

Verificato: in `master`, mai ripristinato, baked in `:latest` il 5/6. Team betaA avviato 5/6 14:39 → gira con cap rimosso. I 5 Scout osservati sono **sotto** il tetto ≤6, quindi il "tetto anti-runaway" non è nemmeno scattato. Fa parte dello stesso wave di aggiornamento del 4-5 giugno: `031035cfe` (cap), `31901c676`/`fbae680cc` (migrazione pacing weekly Phase 0/1), `f4bc6c183` (C-09 gate-weighted), `97cb35214` (cold-start web-first).

### 2. Buco #1 — `pacing-bridge.py`, branch PIPELINE STALLED è weekly-blind

`.launcher/pacing-bridge.py` (~L467-501). Quando il team consuma poco (`delta_usage <= 0 or team_kt <= 0`) il bridge entra in un **return anticipato**: se `team_kt < 5` AND `proj < 70` emette il verdetto `pipeline_stalled` con hint *"Riaccendere pipeline da monte"* → nudge a spawnare Scout/Analisti.

Questo branch **non legge mai `weekly_usage`**. Il calcolo weekly-aware (`_compute_dynamic_target`, che usa `weekly_used_pct` per spalmare il budget residuo) gira solo nel path normale **dopo** quel return. Conseguenza perversa: proprio quando il team rallenta perché il weekly è quasi esaurito, il bridge lo interpreta come "pipeline ferma" e spinge ad accelerare.

### 3. Buco #2 — `sentinel-bridge.py` non calcola uno status weekly-binding

`.launcher/sentinel-bridge.py` propaga `weekly_usage` / `weekly_reset_at` nel sample, ma **non calcola `proj_weekly` né emette uno status weekly-binding**. Il calcolo `proj_binding = max(proj_primary, proj_weekly)` e l'emissione di **ATTENZIONE WEEKLY** sono delegati al *prompt* della Sentinella (regola **S-06** in `agents/sentinella/sentinella.md` L151).

In Phase 1 (regime normale) la Sentinella manda solo INFO → nessun ordine di freno duro → la regola **C-09** del Capitano (*"su ATTENZIONE WEEKLY → riduci throttle / pausa-spawn"*) non si attiva mai. Coerente con lo status osservato `SOTTOUTILIZZO` al 92% weekly: la logica weekly-aware esiste, ma vive in un prompt che in Phase 1 non frena, non in codice che blocca.

---

## Sintesi

> Il 4 giugno il cap fisso sugli spawn è stato rimosso delegando la moderazione a una "guardia budget". Quella guardia ha un buco nel regime idle: **entrambi i bridge sono weekly-blind quando il team è fermo**. Con il cap rimosso *e* la guardia bucata, niente impedisce meccanicamente al Capitano di scalare a 5 Scout / 4 Analisti mentre il weekly è al 92% e lo spazio di ricerca è esaurito.

Il `031035cfe` da solo non avrebbe causato il runaway (il budget *avrebbe dovuto* frenare). I buchi #2/#3 da soli non l'avrebbero causato (il cap fisso avrebbe tenuto). È la **combinazione** a rimuovere ogni freno.

## Fattori contribuenti

- **Spazio di ricerca esaurito** non riconosciuto: con tutte le aziende analizzate e gli Scout che trovano duplicati, lo "stallo" è *legittimo* (niente da fare), non un undershoot da riempire. Il bridge non distingue "idle perché finito il lavoro" da "idle per bug".
- **Possibile inflazione di score** (105/156 a 70+): da verificare separatamente, fuori scope.
- **66 throttle anti-collisione/giorno**: sintomo diretto di sovra-staffing — troppi agenti sullo stesso lavoro residuo.

## Perché gli avvisi sono stati "ignorati" (non è disobbedienza)

Indagine su `bridge-mailbox.jsonl` + `sentinel-log.txt`: al Capitano non è mai arrivato un STOP weekly chiaro.

1. **Il bridge sapeva ma prescriveva una dose omeopatica.** Ogni tick riportava `vel_target=0.00%/h (chiudere a 0% al reset)` — sapeva che non c'era budget. Ma il verdetto era sempre `SFORO → -25%, jht-throttle set <top-consumer> +10 | NO global reset, NO throttle a tutti`. Throttlare un solo agente di una tacca ogni 15 min con 14 agenti = whack-a-mole: il "top consumer" ruota (scout-6 → scorer-2 → analista-4 → scout-1), il burn complessivo non scende.
2. **La Sentinella ha gridato con la metrica sbagliata.** `status=ATTENZIONE` con `proj=334-425%`, ma quel `proj` è il PRIMARY (5h), proprio la metrica che il prompt dice al Capitano di IGNORARE come "INFO volatile". L'allarme autoritativo **ATTENZIONE WEEKLY (S-06) non è mai stato emesso** (il codice non lo calcola).
3. **Il numero-chiave non era visibile.** Il tick porta `weekly_usage` ma NON `weekly_remaining_pct` / `weekly_active_hours` (i campi che C-09/S-06 dicono di leggere → inesistenti). Il weekly era sepolto in `vel_target=0`, mai esposto come allarme.
4. **Un segnale concorrente spingeva a crescere.** Nei buchi idle il branch STALLED diceva "spawna SCOUT".

## Anatomia live (capture-pane, sera 07/06)

Il capture corregge la lettura: il Capitano **si è auto-corretto** nel pomeriggio. Testuale dal suo pane: *"weekly 99/target 0 richiede un restart minimo e molto throttled, non una riapertura piena"*; ha rifiutato di spawnare, riusato solo SCOUT-1 (throttle 300s), batch=3, declassato i worker a `gpt-5.4-mini`, messo SCOUT-3 in standby. **È weekly-aware nel giudizio.**

Tre implicazioni:
- **Il danno è front-loaded.** L'over-scaling è avvenuto prima; quando il weekly è diventato critico era già troppo tardi. → il pacing weekly deve vincolare presto e di continuo.
- **Nessun riflesso di kill.** Le 5 sessioni Scout sono tutte vive: SCOUT-1 attivo, SCOUT-2 parcheggiato, SCOUT-3 standby, **SCOUT-4/5 zombie bloccati al dialog Codex "Switch to gpt-5.4-mini"** (un throttle non li sblocca, serve kill+respawn). Il Capitano ha throttle/stop/standby/downgrade ma mai kill.
- **La sicurezza dipende solo dal giudizio LLM.** Lo STALLED diceva "spawna" anche a weekly 99%; solo l'override del Capitano ha evitato il peggio. Fragile.

**Esito confermato:** `weekly=100%`, `"You've hit your usage limit … try again Jun 11th 00:34"` su CAPITANO e SENTINELLA → team frozen fino al reset weekly.

## Analisi quantitativa (log grezzi)

**Curva di burn weekly** (sostenibile ≈ +14%/giorno su 84h attive):

| Giorno | weekly inizio→fine | Δ |
|---|---|---|
| 03/06 | 3% → 19% | +16% |
| 04/06 | 19% → 31% | +12% |
| 05/06 | 31% → 59% | **+28%** |
| 06/06 | 59% → 79% | +20% |
| 07/06 | 79% → 100% | +21% |

Burn medio ~19%/giorno (+35-100% sopra-pace); già 59% a metà settimana. Le sessioni del 7 mattina (SCOUT-4 10:31, ANALISTA-4 10:39, SCOUT-5 12:45) sono state create a weekly **88-92%**: il Capitano scalava ancora nel range alto, ha clampato solo a ~97-99% (~10 punti troppo tardi).

**Bridge pacing** — 209 tick: **118 SFORO (56%)**, 8 MARGINE, 1 ALLINEATO; 34 PIPELINE STALLED; **42 menzioni "spawna", 0 "kill", 0 "freeze"**. Rimedio sempre `throttle +10` su 1 agente a rotazione (top-consumer: analista-1 ×19, scorer-1 ×17, dottore ×15, …). Il vocabolario del bridge non contiene la contrazione.

**Throttle** — 929 eventi: `applied_sec` **mai oltre 610s (~10 min)**, quasi tutti 10-120s, guidati da `proj` PRIMARY (Phase2), non dal weekly. Lo strumento `throttle.py` supporta `MAX_SLEEP=3600` (1h) ma il ladder del prompt si ferma a 600s → soffitto de-facto 10 min.

**Note:** `token-meter-state.json` non esiste su questa VPS (consumo per-agente calcolato live nel bridge; la ref C-11 punta a un file inesistente qui). Il `[BRIDGE TICK]` mostra `weekly=100%` in chiaro ma lo `status` resta `SOTTOUTILIZZO` (calcolato sul proj primary) → il weekly è testo decorativo, non un driver di stato.

## Fix proposti (NON applicati)

Principio unificante: **il throttle modula la VELOCITÀ, il kill modula la CAPACITÀ; quando il throttle satura, la leva giusta è il kill, non throttlare di più.**

1. **Throttle fino a 1h** — estendere il ladder nel prompt (C-07 + `suggested_throttle_s` Sentinella) da max 600s a, es., `600, 900, 1200, 1800, 2700, 3600`. Lo strumento `throttle.py` (`MAX_SLEEP=3600`) lo supporta già: è un fix solo-prompt, rischio ~zero.
2. **Kill-on-saturation** — regola attiva nel prompt Capitano: se il throttle di un worker è già alto E `vel_team > vel_target` per K tick → **kill 1 worker** della categoria top-consumer, poi rilascia il throttle sui superstiti. Criterio "non serve" misurabile: `cadenza 0.00/min` per N tick (brucia, zero check) + scout-dedup ratio alto + coda a valle che non cresce. Aggiungere "kill" al vocabolario dei verdetti del bridge.
3. **Scaling simmetrico e graduale** — esplicitare "scala 1 → osserva 2-3 tick → eventualmente +1"; soprattutto aggiungere la **discesa** (oggi il Capitano sa salire ma non scendere). Gestire gli zombie al dialog rate-limit con kill+respawn, non throttle.
4. **Weekly early-binding + meccanico** — `pacing-bridge`: nel branch STALLED leggere `weekly_usage` e se alto emettere "COAST / non spawnare". `sentinel-bridge`: calcolare `proj_weekly` in **codice** ed esporre `weekly_remaining_pct` nel tick + escalare uno status weekly-binding (ATTENZIONE WEEKLY) anche in Phase 1, invece di delegarlo solo al prompt S-06. Far sì che lo `status` del tick dipenda da `max(proj_primary, proj_weekly)`, non solo dal primary.
5. **cap soft per-categoria** — limite per ruolo che si attiva quando `weekly_remaining` < soglia (es. max 2 Scout se weekly > 80%): compromesso tra cap fisso e budget-bound puro.
6. **riconoscimento search-exhaustion** — quando lo `scout-dedup` ratio è alto, trattare la coda vuota come "lavoro finito", non come undershoot da riempire con più Scout.

## Riferimenti

- Commit: `031035cfe` (cap removal), `f4bc6c183`, `fbae680cc`, `31901c676` (wave pacing weekly).
- Prompt: `agents/capitano/capitano.md` (C-07, C-09), `agents/sentinella/sentinella.md` (S-06).
- Codice: `.launcher/pacing-bridge.py`, `.launcher/sentinel-bridge.py`.
- Precedenti: `docs/internal/postmortems/2026-05-21-halt-weekly-incident.md`, `docs/internal/postmortems/2026-05-21-vps1-run-postmortem.md`, `docs/internal/postmortems/2026-06-03-diagnosi-pacing-weekly.md`, `docs/internal/roadmap/2026-06-05-pacing-migration-plan.md`.
