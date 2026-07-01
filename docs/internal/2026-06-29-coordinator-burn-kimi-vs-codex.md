# Coordinator-burn Kimi vs Codex — analisi consolidata

> **Ultimo aggiornamento: 2026-07-02** — ⚠️ **REVISIONE IMPORTANTE.** La misura pulita
> su tutto lo storico (tutti i tick pacing parsati) **ribalta la tesi originale**: i
> coordinatori NON pesano più su Kimi che su Codex. Vedi *Misura pulita*. Le sezioni
> "vecchie" restano per traccia ma sono superate dove indicato. Dettaglio forense
> dell'incidente writer-gate in
> [`2026-07-01-capitano-kimi-thinking-off-writer-gate.md`](./2026-07-01-capitano-kimi-thinking-off-writer-gate.md).

## TL;DR (corretto)

- **I coordinatori (Capitano+Sentinella) pesano ~UGUALE su Kimi e Codex**: ~**20% del
  budget** su entrambi, misurato su tutto lo storico (Capitano ~13,6% su entrambi,
  identico). **Non è un difetto di Kimi.**
- La vecchia lettura **"Kimi 76% vs Codex 20%" era un confronto di FASI sbagliato**: una
  finestra *coast* (team idle) di Kimi contro una finestra *attiva* di Codex. A parità di
  fase sono uguali.
- Il **"monitoraggio >70%" è reale ma vale per ENTRAMBI**, e solo in **coast**: quando i
  worker sono fermi i coordinatori sono ~95% del (poco) budget bruciato — è fisico, non
  dipende dal modello.
- **Il vero problema di Kimi è la dimensione del budget**: servono ~20 kT per muovere 1%
  di settimanale su Kimi contro ~340 kT/1% su Codex → **ogni azione costa ~17× di più in
  percentuale**. Il costo per-tick in token è simile; è il budget che è ~17× più piccolo.
- La decisione sui flag thinking (Sentinella `--no-thinking`, Capitano `--thinking ON`)
  **resta valida** (per correttezza, non per il burn), ma attacca una quota ~20% =
  **leva secondaria**, non il "70%".

## Misura pulita (2026-07-02) — la fonte di verità

Aggregando **tutti** i tick pacing dal `bridge-mailbox.jsonl` (546 betaB / 626 betaC,
maggio→luglio), quota-coordinatori (cap+sent kT / tot kT del team) **per settimana**:

```
              W24    W25    W26    W27      STORICO (tutto)
Kimi (betaB)  25,9%  25,0%  33,8%  35,5%    20,2%  (cap 13,6 + sent 6,5)
Codex(betaC) 24,3%  19,2%  20,8%  27,8%    19,2%  (cap 13,6 + sent 5,6)
```

- **Storico ~uguale**: 20,2% vs 19,2%. Capitano **13,6% su entrambi**.
- **Trend in leggera salita su ENTRAMBI** (Kimi 26→35%, Codex 24→28%): NON è un
  peggioramento dei coordinatori, è che i **dataset maturano** (betaB ha ~1100 posizioni,
  Scout spesso esausto) → i worker fanno meno → i coordinatori pesano di più *in
  proporzione*. Stesso effetto su Codex.
- **Finestre coast (worker ≈ 0)**: coordinatori **~95% su entrambi** (Kimi 96–98%, Codex
  91–99%). È qui che nasce il "70%", ed è model-independent.
- **Costo per-tick simile** tra i modelli (~35–55 kT Kimi, ~27–78 kT Codex). La differenza
  vera è la conversione in %-budget (vedi sotto).

Grafico: `docs/internal/assets/2026-07-02-coord-weekly.svg` (se presente) o rigenerabile
col *Metodo*.

## Il vero problema di Kimi: dimensione del budget (non il monitoraggio)

Dai tick: **ratio ~20 kT/% su Kimi vs ~340 kT/% su Codex**. Cioè lo stesso lavoro (stesso
numero di token) mangia **~17× più budget settimanale in percentuale** su Kimi. Il
settimanale di Kimi è piccolo in token: si esaurisce prima **a parità di lavoro**, e questo
fa *sembrare* che "il monitoraggio lo mangi" — quando in realtà è **tutto il team** a
costare tanto in %. Questa, non la quota coordinatori, è la leva strutturale per la scelta
modello/beta.

## ~~Il fenomeno (vecchia lettura, SUPERATA)~~

> ⚠️ Superata dalla *Misura pulita*. Si era osservato che "su Kimi i coordinatori dominano
> il budget molto più che su Codex" e "un tick di coordinamento costa 7–12× più". Errore di
> metodo: le due misure confrontavano fasi diverse (coast Kimi vs attivo Codex) e finestre
> singole. Resta valido solo l'**anti-pattern del pacing**: il verdetto indica come
> `top consumer` un worker throttlabile mentre in coast il vero hog è il coordinatore (non
> throttlabile) → segnale fuorviante da correggere.

## Cosa abbiamo provato — evoluzione della decisione thinking

| commit | cambiamento |
|---|---|
| `12f088d64` | `--no-thinking` per **tutti** i ruoli Kimi (Capitano incluso) |
| `7e7ecbe2b` | ristretto ai soli **coordinatori** (Capitano + Sentinella) |
| `ef6e9b291` | **revert del Capitano a thinking-ON** (resta OFF solo la Sentinella) ← attuale |

## Perché il Capitano resta thinking-ON — l'incidente writer-gate

Prova sul campo su **beta-3** (betaD, Kimi): col Capitano a thinking-OFF ha **invertito la
regola C-10** (writer-on-demand), mis-citando il prompt dello Scrittore *("il filtro è
score≥50, non `write_requested`")*, e ha ordinato **~30 CV+CL che nessun utente aveva
richiesto**, spingendo il team in `SOPRA-PACE-WEEKLY` su lavoro fantasma. A **thinking
spento** Kimi collassa su una scorciatoia plausibile-ma-sbagliata; su **modelli forti** lo
stesso gate regge (betaC/Codex rifiuta correttamente). ➡️ **Su Kimi il Capitano NON può
girare a thinking-OFF.** Dettaglio (timeline, DB, regole violate) nell'annex forense.

*(Nota: quei ~30 CV non richiesti sono lo stesso over-burn che ha fatto scattare il daily
hard-stop su beta-3 — vedi [`2026-07-01-betaD-daily-hardstop-validated.md`](./2026-07-01-betaD-daily-hardstop-validated.md).)*
NB: questa scelta è di **correttezza**, non di burn — attacca una quota ~20%, non un 70%.

## La Sentinella resta no-thinking

Compito più stretto (watchdog di soglie), meno esposto a errori di deliberazione. Il flag ha
ridotto nettamente la sua spesa senza degrado decisionale osservato; il ragionamento resta
visibile nella risposta (Instant mode) → auditabile. Da confermare sul lungo.

## Stato / da monitorare

- La quota coordinatori (~20% storico, in salita ~28–35% per maturazione dataset) è ormai
  un dato **stabile e misurabile** su entrambi i modelli — non più uno snapshot volatile.
- Le migliorie Kimi (Sentinella no-thinking dal 30/6, Capitano auto-throttle osservato 1/7)
  sono **recenti**: rimisurare la quota tra qualche settimana per vedere se l'auto-throttle
  del Capitano abbassa la sua fetta.
- Leve residue (per abbassare comunque il ~20%): **tick coordinatori meno frequenti in
  COAST**; **`top-consumer` del pacing capace di nominare i coordinatori** (oggi solo worker).
- Leva strutturale (la più impattante): il **costo-per-azione in %-budget su Kimi (~17×)** —
  è questo, non il monitoraggio, il criterio per la decisione beta.

## Le manopole nel codice (`.launcher/start-agent.sh`, ramo `kimi`)

- `THINKING_FLAG`: oggi `sentinella) --no-thinking`; il Capitano **non** è nella lista →
  thinking ON. Indicatore live nella pane Kimi: **`○` = OFF** (Instant mode), **`●` = ON**.
- Kimi non riceve l'`effort` (solo `--max-steps-per-turn 100`): unica manopola di verbosità
  è `--thinking / --no-thinking`.
- Codex: `-c model_reasoning_effort=$effort` (coordinatori a `high`).

## Metodo (riproducibile, sola lettura)

- **Fonte primaria** (quella corretta, full-history): i messaggi `kind=tick` in
  `bridge-mailbox.jsonl` contengono il breakdown per-agente `nome=…%/h [NkT/Xm …]`.
  Regex `([A-Za-z][\w-]*)=[\d.]+%/h \[([\d.]+)kT/\d+m` — nota `\d+m` (il formato vecchio
  usa finestre variabili `11m`, non solo `15m`: la regex fissa su `15m` perdeva metà storico).
  Somma per-agente per settimana → quota = (capitano+sentinella)/totale.
- `agent-usage-table.json` = serie kT/agente per bucket 5m su finestra 2h (solo recente).
- `pacing-bridge-state.json` = `last_report.agents[].kt/share` per l'ultimo tick.
- Caveat: i tick coprono le finestre con breakdown; le finestre `skip` (insufficient_samples,
  spesso idle) non sono attribuite → la quota "vera" a team molto idle è un po' più alta, ma
  il **confronto Kimi vs Codex resta valido** (stesso bias su entrambi).
- Nessun intervento sui team (osservazione, DB `mode=ro`).

## Correlati

- [`2026-07-01-capitano-kimi-thinking-off-writer-gate.md`](./2026-07-01-capitano-kimi-thinking-off-writer-gate.md) — annex forense dell'incidente.
- `2026-06-15-coordinator-burn-consumo-finding.md`, `2026-06-17-betaB-kimi-weekly-burn-finding.md`,
  `2026-07-01-cv-quality-findings-beta3.md`, `2026-07-01-betaD-daily-hardstop-validated.md`.
