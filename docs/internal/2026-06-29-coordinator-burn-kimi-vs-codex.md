# Coordinator-burn su Kimi — analisi consolidata (Kimi vs Codex)

> **Ultimo aggiornamento: 2026-07-01.** Documento canonico consolidato: unisce la misura
> di coordinator-burn (2026-06-29) e l'incidente writer-gate (2026-07-01) in una sola
> narrazione + decisione + stato. Il **dettaglio forense** dell'incidente resta in
> [`2026-07-01-capitano-kimi-thinking-off-writer-gate.md`](./2026-07-01-capitano-kimi-thinking-off-writer-gate.md).

## TL;DR

Sui team **Kimi** i due coordinatori (Capitano + Sentinella) si mangiano una **quota
dominante** del budget settimanale — molto più che su **Codex** — perché K2.7-Code ragiona
in catene verbose (fatturate come output) anche per decisioni banali. Non è il design del
team: è il **modello**. Leva scoperta: la CLI Kimi espone `--thinking / --no-thinking`.

**Stato attuale** (deploy `13057f2a`):
- **Sentinella → `--no-thinking`**: compito stretto (watchdog di soglie sopra il bridge
  deterministico); netto calo di spesa senza degrado decisionale osservato.
- **Capitano → `--thinking ON`**: a thinking-OFF ha invertito il gate writer-on-demand e
  ordinato CV non richiesti (vedi sotto) → il ragionamento gli è **necessario**.

> ⚠️ **La distribuzione del budget del Capitano NON è ancora un dato stabile.** Le misure
> fatte finora sono *snapshot* di singole finestre e non vanno lette come "il prezzo".
> Dopo le nuove implementazioni va **ri-caratterizzata su una finestra lunga** prima di
> trarne conclusioni o cifre di riferimento. Vedi *Stato / da monitorare*.

## Il fenomeno (qualitativo)

- Su **Kimi** i coordinatori dominano il budget; su **Codex** il grosso va al lavoro utile
  (scout/analista/scorer). Stesso prompt, stessa architettura → la differenza è il modello:
  Sentinella/Capitano su Codex sono asciutti, su Kimi deliberano in monologhi lunghi anche
  prima di un'azione banale.
- Un tick di solo-coordinamento (ogni 15 min) su Kimi costa **parecchie volte** più che su
  Codex. In fase **COAST** (worker idle) diventa idle-burn puro: budget che sale senza che
  nessuno lavori.
- **Anti-pattern del pacing (da correggere):** il verdetto del bridge indica come
  `top consumer` un worker *throttlabile* (es. l'analista) e ordina di frenarlo, mentre il
  vero hog è il **coordinatore** (Capitano/Sentinella), che `throttle-config.py` non può
  frenare → si rallenta il lavoro utile mentre i veri consumatori restano.

*(Le misure granulari originali — kT/tick e share per-agente del 2026-06-29 — erano snapshot
di finestra e NON sono riportate qui come cifre di riferimento; la procedura per ri-misurarle
è in "Metodo". La versione con le tabelle numeriche resta nella git history.)*

## Cosa abbiamo provato — evoluzione della decisione

| commit | cambiamento |
|---|---|
| `12f088d64` | `--no-thinking` per **tutti** i ruoli Kimi (Capitano incluso) |
| `7e7ecbe2b` | ristretto ai soli **coordinatori** (Capitano + Sentinella) |
| `ef6e9b291` | **revert del Capitano a thinking-ON** (resta OFF solo la Sentinella) ← attuale |

## Perché il Capitano resta thinking-ON — l'incidente writer-gate

Prova sul campo su **beta-3** (betaD, Kimi): col Capitano a thinking-OFF ha **invertito la
regola C-10** (writer-on-demand), mis-citando il prompt dello Scrittore *("il filtro è
score≥50, non `write_requested`")*, e ha ordinato la scrittura di **~30 CV+CL che nessun
utente aveva richiesto**, spingendo il team in `SOPRA-PACE-WEEKLY` su lavoro fantasma. Il
prompt del Capitano vietava esattamente questo in più punti (C-10, anti-pattern V6,
"notifica l'utente, non auto-promuovere"): a **thinking spento** Kimi collassa su una
scorciatoia plausibile-ma-sbagliata, senza la catena che l'avrebbe corretta. Sui **modelli
forti** lo stesso gate regge (betaC/Codex rifiuta correttamente lo Scrittore senza
`write_requested`).

➡️ **Il coordinamento è un compito di ragionamento: su Kimi il Capitano NON può girare a
thinking-OFF.** Timeline, stato DB, regole violate e costo puntuale nell'annex forense.

*(Nota: quei ~30 CV non richiesti sono lo stesso over-burn che ha poi fatto scattare il
daily hard-stop su beta-3 — vedi [`2026-07-01-betaD-daily-hardstop-validated.md`](./2026-07-01-betaD-daily-hardstop-validated.md).)*

## La Sentinella resta no-thinking

Compito più stretto e meno esposto a errori di deliberazione strutturale. Il flag ha ridotto
nettamente la sua spesa **senza degrado decisionale osservato** (in test ha gestito incidenti
reali — worker zombie/CPU, conflitto bridge-vs-Capitano — applicando la gerarchia "io
consiglio, lui decide" senza mai essere corretta dal Capitano). Il ragionamento resta
**visibile** nella risposta (Instant mode) → auditabile. Da confermare che regga sul lungo.

## Stato / da monitorare (il punto aperto)

Con le nuove implementazioni deployate (`13057f2a`: Capitano thinking-ON + heartbeat-bridge +
daily hard-stop), la priorità è **caratterizzare su una finestra LUNGA come si distribuisce
davvero il budget del Capitano** — non da singoli snapshot. Solo dopo ha senso decidere se
serve un'altra leva. Candidate (se il costo del Capitano resta alto):

1. **Tick coordinatori meno frequenti in COAST** — a worker idle non serve ri-deliberare ogni 15 min.
2. **`top-consumer` del pacing capace di nominare anche i coordinatori** (oggi punta solo ai
   worker throttlabili → segnale fuorviante).
3. **Deliberazioni del Capitano più corte** (via prompt), senza spegnere il thinking.

## Le manopole nel codice (`.launcher/start-agent.sh`, ramo `kimi`)

- `THINKING_FLAG`: oggi `sentinella) --no-thinking`; il Capitano **non** è nella lista →
  thinking ON. Indicatore live nella pane Kimi: **`○` = OFF** (Instant mode), **`●` = ON**.
- Kimi non riceve l'`effort` calcolato (solo `--max-steps-per-turn 100`, guardia anti
  rabbit-hole): l'unica manopola di verbosità è `--thinking / --no-thinking`.
- Codex: `-c model_reasoning_effort=$effort` (coordinatori forzati a `high`, restano comunque
  asciutti → la differenza con Kimi è il **modello**, non il setting).

## Evidenza esterna (letteratura K2, sintesi qualitativa)

Moonshot stessa ha ridotto i thinking-token in K2.7-Code per combattere l'**overthinking**;
analisi indipendenti raccomandano di **disabilitare il thinking** per task
semplici/classificazione (dove "wrappa un fix banale in un rework architetturale"). Il flag
CLI `--no-thinking` funziona (commuta in "Instant mode") — verificato sul campo, indipendente
dall'articolo che lo dà per "non disattivabile" (vale per l'API, non per la CLI).

## Metodo (riproducibile, sola lettura)

- `agent-usage-table.json` = serie kT/agente per bucket 5m, finestra 2h (la fonte).
- `pacing-bridge-state.json` = `last_report.agents[].kt/share` per il tick 15m.
- Pane: `docker exec jht tmux capture-pane -t SENTINELLA|CAPITANO -p -S -260`.
- DB aperto `mode=ro`; nessun intervento sui team (osservazione).

## Correlati

- [`2026-07-01-capitano-kimi-thinking-off-writer-gate.md`](./2026-07-01-capitano-kimi-thinking-off-writer-gate.md) — annex forense dell'incidente.
- `2026-06-15-coordinator-burn-consumo-finding.md`, `2026-06-17-betaB-kimi-weekly-burn-finding.md`,
  `2026-07-01-cv-quality-findings-beta3.md`, `2026-07-01-betaD-daily-hardstop-validated.md`.
