# Coordinator-burn Kimi vs Codex — analisi consolidata

> **Ultimo aggiornamento: 2026-07-02** — ⚠️ **REVISIONE IMPORTANTE (2 correzioni).**
> (1) La misura pulita su tutto lo storico **ribalta la tesi originale**: i coordinatori
> NON pesano più su Kimi che su Codex (~20% su entrambi). (2) Anche il "budget di Kimi
> ~17× più piccolo" è stato **corretto**: misurato con 3 metodi indipendenti il budget di
> Kimi è **~2× più piccolo di Codex, non 17×** (stesso ordine di grandezza) — il "17×"
> nasceva da un errore d'asse. Vedi *Misura pulita* e *Dimensione del budget*. Le sezioni
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
- **Il budget di Kimi è più piccolo di quello di Codex, ma solo ~2×** (stesso ordine di
  grandezza), **NON 17×**. Tre metodi indipendenti concordano: settimanale di Kimi
  ≈**13M token** contro ≈**31M** di Codex (~2,4×); asse 5h ~1,5-2×; throughput assoluto
  ~2×. Il "17×" di una stima precedente era un **errore d'asse** (confrontava il weekly di
  Codex ~330 kT/% con un numero Kimi rotto ~20 al posto del reale ~130). Vedi
  *Dimensione del budget*.
- **Cosa tiene davvero Kimi in beta NON è il budget** (che è gestibile a ~2×), ma la
  **precisione/comportamento**: oscillazione della proiezione ±10-15% (vs ±5% Claude),
  scout rabbit-hole (36 tool/turno), fragilità del thinking (ha rotto il writer-gate),
  thrash del pacing. Sono problemi di *tuning*, in lavorazione — non un muro di capacità.
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

## Dimensione del budget (misura pulita v2, 2026-07-02) — ~2×, NON 17×

La prima versione di questo doc diceva "budget Kimi ~17× più piccolo" (ratio ~20 kT/% Kimi
vs ~340 kT/% Codex). **È stato un errore d'asse**: il ~340 di Codex è il numero corretto
**sull'asse settimanale**, ma il ~20 di Kimi era rotto — il reale settimanale di Kimi è
**~130 kT/%**. Confrontando gli **stessi assi**, il rapporto è **~2,4×**, non 17×.

Il bridge stesso logga `ratio=X kT/%` (`team_kT / Δusage`) in ogni tick. Aggregando in modo
robusto (`Σ team_kT / Σ Δusage`, no media outlier-sensibile) su tutto lo storico:

```
Metodo (provider-indipendente)      Kimi (betaB)      Codex (betaC)    rapporto
────────────────────────────────────────────────────────────────────────────────
5h    Σ(kT)/Σ(Δusage)               ~44-61 kT/%       ~89-92 kT/%       ~1,5-2×
      → budget 5h implicito         ~4-6M token       ~9M token
settimanale (W24-27, stabile)       ~130 kT/%         ~330 kT/%         ~2,4×
      → budget settimanale          ≈13M token/sett   ≈31M token/sett
throughput assoluto (recente)       ~15M token/sett   ~31M token/sett   ~2×
```

- I tre metodi convergono su **~2× (range 1,5-2,5×)**. Codex ha un budget in token circa
  **doppio** di Kimi, **stesso ordine di grandezza**. Il throughput assoluto totale sullo
  storico lo conferma: **117M token (Kimi) vs 158M (Codex) = 1,35×**.
- Perché nasceva il "17×": la media dei `ratio` per-tick è avvelenata dai tick con
  `Δusage≈1%` (divisione per ~1 → picchi 750+ kT/%), **identici su entrambi i provider**
  (Kimi max 755, Codex max 776) → non spiegano nessuna asimmetria. L'aggregato `Σ/Σ` li
  neutralizza. Media/mediana/aggregato per-provider **concordano tutti** (Kimi 48-72, Codex
  70-89 kT/% sull'asse 5h).

**Implicazione per la decisione beta.** Un budget ~2× più piccolo è un handicap **modesto e
gestibile** col pacing weekly-aware — **non** il criterio disqualificante. Ciò che tiene
Kimi in beta è la **precisione** (oscillazione proiezione ±10-15% vs ±5% Claude → occasionali
sforamenti del 100%) e il **comportamento** (scout rabbit-hole, thinking fragile che ha rotto
il writer-gate, thrash del pacing). Sono voci di *tuning* in lavorazione, non un muro di
capacità in token.

## Prezzo per unità di lavoro (Kimi vs Codex) — ≈ pari

Incrociando la dimensione del budget con i prezzi documentati (`docs/about/PROVIDERS.md`:
Kimi Pro ~€40, Codex Plus/Pro ~€100):

```
                        Kimi Pro        Codex Plus/Pro     rapporto
──────────────────────────────────────────────────────────────────
prezzo / mese           €40             €100               2,5×
budget settimanale      ~13M token      ~31M token         2,4×
budget mensile (~4,3sn) ~56M token      ~135M token        2,4×
€ / milione di token    ~€0,71          ~€0,74             ~1,05×  (≈ PARI)
```

Il rapporto prezzo (2,5×) e il rapporto budget (2,4×) **quasi si annullano** → il costo per
token è **praticamente identico**. Kimi non è "più economico perché fa meno": ha la **stessa
efficienza €/token di Codex**, a una barriera d'ingresso **2,5× più bassa**. È questo
l'argomento economico per il tier mass-market — stesso valore/€, prezzo assoluto minore.

Caveat:
- **Rapporto robusto, assoluto approssimato.** I ~13M/~31M sono in unità token-meter
  (stima euristica) con lo **stesso bias su entrambi** → il rapporto €/token regge;
  €0,71/€0,74 è indicativo.
- **Sensibilità al prezzo Codex.** Con i €100 documentati sono pari; se Codex fosse ChatGPT
  Plus (~$20) sarebbe ~5× più economico/token, se Pro (~$200) Kimi sarebbe ~2× più economico.
- **Riconciliazione col quota-provider.** `PROVIDERS.md` dichiara Kimi "~320M/mese": è la
  quota grezza teorica; l'effettivo **usabile** misurato è ~56M/mese (~1/6) per pacing
  (working-hours + target 88% + no-100%) e per il token-meter. Per il €/token conta
  l'effettivo, non il pubblicitario.

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
- Il budget di Kimi (~2× più piccolo di Codex, **non** 17×) è un handicap gestibile: **non**
  è il criterio disqualificante per la beta. Il criterio vero è la **precisione della
  proiezione** (±10-15% Kimi vs ±5% Claude) e il **comportamento** (scout rabbit-hole,
  thinking fragile) — è lì che va il tuning.

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
- **Dimensione budget** (kT per 1% di budget): i tick contengono `ratio=X kT/%
  (team NkT / Δusage M%)`. Aggregare **`Σ team_kT / Σ Δusage`** su tutti i tick (robusto);
  NON la media dei `ratio` per-tick (avvelenata da `Δusage≈1%`). Per l'asse settimanale:
  incrociare `Σ team_kT` (mailbox) con la somma dei delta positivi di `weekly_usage`
  (`sentinel-data.jsonl`, `source=bridge`). 5h e settimanale devono concordare in ordine
  di grandezza.
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
