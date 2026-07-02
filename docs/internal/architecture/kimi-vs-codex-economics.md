# 💰 Economia Kimi vs Codex — budget · coordinatori · prezzo (living doc)

> **Living doc** (non datato): riflette lo stato **corrente** dell'analisi economica dei
> provider per la decisione "che tier mandare in beta / general availability". Aggiornato
> **in place**. Ultimo aggiornamento: **2026-07-02**.
>
> Snapshot forensi datati che l'hanno prodotto (record storici, non aggiornarli):
> [`2026-07-02-kimi-clean-measurement.md`](../2026-07-02-kimi-clean-measurement.md) (misura
> pulita full-history), [`2026-06-29-coordinator-burn-kimi-vs-codex.md`](../2026-06-29-coordinator-burn-kimi-vs-codex.md)
> (indagine coordinator-burn + evoluzione thinking-flag),
> [`2026-07-01-capitano-kimi-thinking-off-writer-gate.md`](../2026-07-01-capitano-kimi-thinking-off-writer-gate.md)
> (incidente writer-gate).

## TL;DR

- **Coordinatori (Capitano+Sentinella) ~20% del budget, ~UGUALE su Kimi e Codex.** Non è un
  difetto di Kimi. Il "monitoraggio >70%" è reale ma vale per **entrambi** e solo in *coast*.
- **Budget di Kimi ~2× più piccolo di Codex (NON 17×)**, stesso ordine di grandezza.
- **€/token ≈ PARI**: prezzo 2,5× (€40 vs €100) e budget 2,4× si annullano.
- **Il vero blocco alla de-beta di Kimi NON è il budget**, ma la **precisione della
  proiezione** (±10-15% vs ±5% Claude) e il **comportamento** (scout rabbit-hole, thinking
  fragile). Sono voci di *tuning*, in lavorazione.

## 1. Quota coordinatori — ~20%, uguale sui due modelli

Aggregando **tutti** i tick pacing del `bridge-mailbox.jsonl` (554 betaB / 631 betaC,
maggio→luglio), quota = `(capitano+sentinella) kT / totale team kT`:

```
                storico         W24    W25    W26    W27
Kimi  (betaB)   20,5%           25,9%  25,0%  33,8%  35,5%   (cap 13,7 + sent 6,8)
Codex (betaC)  19,2%           24,3%  19,2%  20,8%  27,8%   (cap 13,5 + sent 5,7)
```

- **Capitano ~13,6% su entrambi**, identico. Storico ~uguale (20,5 vs 19,2).
- Trend in leggera salita su **entrambi** = maturazione dataset (i worker fanno meno → i
  coordinatori pesano di più *in proporzione*), non peggioramento dei coordinatori.
- In **coast** (worker ≈ 0) i coordinatori sono ~95% su entrambi (Kimi 96-98%, Codex
  91-99%): è qui che nasce il "70%", ed è model-independent.
- La vecchia lettura "Kimi 76% vs Codex 20%" era un **confronto di fasi sbagliato** (coast
  Kimi vs attivo Codex).

## 2. Dimensione del budget — ~2×, NON 17×

Il bridge logga in ogni tick `ratio = team_kT / Δusage` (= kT per 1% di budget). Aggregato
robusto `Σ team_kT / Σ Δusage` su tutta la storia, tre metodi indipendenti:

```
Metodo                              Kimi (betaB)      Codex (betaC)    rapporto
────────────────────────────────────────────────────────────────────────────────
5h    Σ(kT)/Σ(Δusage)               ~44-61 kT/%       ~89-92 kT/%       ~1,5-2×
      → budget 5h implicito         ~4-6M token       ~9M token
settimanale (W24-27, stabile)       ~130 kT/%         ~330 kT/%         ~2,4×
      → budget settimanale          ≈13M token/sett   ≈31M token/sett
throughput assoluto (recente)       ~15M token/sett   ~31M token/sett   ~2×
throughput assoluto (totale)        117M token        158M token        1,35×
```

I tre metodi convergono su **~2× (range 1,5-2,5×)**, stesso ordine di grandezza.
Il "17×" di una stima precedente era un **errore d'asse**: confrontava il weekly di Codex
(~330 kT/%, corretto) con un numero Kimi rotto (~20 al posto del reale ~130). A parità
d'asse: 330/130 ≈ 2,5×. La media dei `ratio` per-tick è avvelenata dai tick con `Δusage≈1%`
(picchi 750+ kT/%), **identici sui due provider** (Kimi max 755, Codex 776) → non spiegano
asimmetrie; l'aggregato `Σ/Σ` li neutralizza.

## 3. Prezzo per unità di lavoro — ≈ pari

Prezzi documentati (`docs/about/PROVIDERS.md`): Kimi Pro ~€40, Codex Plus/Pro ~€100.

```
                        Kimi Pro        Codex Plus/Pro     rapporto
──────────────────────────────────────────────────────────────────
prezzo / mese           €40             €100               2,5×
budget settimanale      ~13M token      ~31M token         2,4×
budget mensile (~4,3sn) ~56M token      ~135M token        2,4×
€ / milione di token    ~€0,71          ~€0,74             ~1,05×  (≈ PARI)
```

Il rapporto prezzo (2,5×) e il rapporto budget (2,4×) **quasi si annullano** → costo per
token **praticamente identico**. Kimi non è "più economico perché fa meno": ha la **stessa
efficienza €/token di Codex** a barriera d'ingresso **2,5× più bassa** → è questo l'argomento
per il tier mass-market.

Caveat:
- **Rapporto robusto, assoluto approssimato**: i ~13M/~31M sono in unità token-meter (stima
  euristica) con lo **stesso bias su entrambi** → il rapporto €/token regge; €0,71/€0,74 è
  indicativo.
- **Sensibilità al prezzo Codex**: con i €100 documentati sono pari; se Codex fosse ChatGPT
  Plus (~$20) sarebbe ~5× più economico/token, se Pro (~$200) Kimi sarebbe ~2× più economico.
- **Riconciliazione col quota-provider**: `PROVIDERS.md` dichiara Kimi "~320M/mese" = quota
  grezza teorica; l'effettivo **usabile** misurato è ~56M/mese (~1/6) per pacing
  (working-hours + target 88% + no-100%) e per il token-meter. Per il €/token conta
  l'effettivo, non il pubblicitario.

## 4. Il vero limite di Kimi (non il budget)

Budget ~2× più piccolo = handicap **modesto e gestibile** col pacing weekly-aware. Ciò che
tiene Kimi in beta è:

- **Precisione della proiezione**: oscillazione ±10-15% (vs ±5% Claude) → occasionali
  sforamenti del 100% → serve buffer (target 88% invece di 92-95%).
- **Comportamento**: scout rabbit-hole (36 tool/turno vs ~8 Codex), thinking fragile (a
  thinking-OFF il Capitano ha rotto il writer-gate, vedi §5), thrash del pacing.

Sono problemi di *tuning* in lavorazione, non un muro di capacità in token.

## 5. Decisione thinking-flag (Kimi)

`.launcher/start-agent.sh` ramo `kimi`: **Sentinella `--no-thinking`, Capitano `--thinking ON`**.
Indicatore live nella pane: `○` = OFF (Instant), `●` = ON. Kimi non riceve l'`effort` (solo
`--max-steps-per-turn 100`); Codex usa `-c model_reasoning_effort=high` sui coordinatori.

Evoluzione: `12f088d64` (tutti OFF) → `7e7ecbe2b` (solo coordinatori OFF) → `ef6e9b291`
(**revert Capitano a ON**). Perché il revert: su beta-3, col Capitano a thinking-OFF, Kimi ha
**invertito la regola C-10** (writer-on-demand) e ordinato **~30 CV+CL non richiesti** → team
in SOPRA-PACE su lavoro fantasma. A thinking spento Kimi collassa su scorciatoie
plausibili-ma-sbagliate; modelli forti (Codex) reggono lo stesso gate. **Su Kimi il Capitano
NON può girare a thinking-OFF.** La Sentinella resta OFF (compito più stretto, meno esposta).
Dettaglio: [`2026-07-01-capitano-kimi-thinking-off-writer-gate.md`](../2026-07-01-capitano-kimi-thinking-off-writer-gate.md).
Nota: è una scelta di **correttezza**, non di burn (attacca una quota ~20%, non un 70%).

## 6. Metodo (riproducibile, sola lettura)

- **Quota coordinatori / costo per-agente**: messaggi `kind=tick` in `bridge-mailbox.jsonl`,
  breakdown `nome=…%/h [NkT/Xm …]`. Regex `([A-Za-z][\w-]*)=[\d.]+%/h \[([\d.]+)kT/\d+m` —
  nota `\d+m` (il formato vecchio usa finestre variabili `11m`, non solo `15m`). Somma
  per-agente per settimana → quota = `(capitano+sentinella)/totale`.
- **Dimensione budget** (kT per 1%): i tick contengono `ratio=X kT/% (team NkT / Δusage M%)`.
  Aggregare **`Σ team_kT / Σ Δusage`** (robusto), NON la media dei `ratio` per-tick
  (avvelenata da `Δusage≈1%`). Asse settimanale: incrociare `Σ team_kT` (mailbox) con la
  somma dei delta positivi di `weekly_usage` (`sentinel-data.jsonl`, `source=bridge`). 5h e
  settimanale devono concordare in ordine di grandezza.
- **Attenzione alle scale provider**: `weekly_usage` è 0-100% su **entrambi** ma calcolato
  diversamente — Codex = `rate_limits.secondary.used_percent`; Kimi = `used`/`limit`
  scala-100. Le finestre `skip` (insufficient_samples, spesso idle) non sono attribuite → la
  quota "vera" a team molto idle è un po' più alta, ma il confronto Kimi-vs-Codex resta
  valido (stesso bias su entrambi).
- Nessun intervento sui team (osservazione, DB `mode=ro`).

## Changelog (evoluzione della verità)

- **2026-06-15→29**: prima tesi — "su Kimi i coordinatori dominano il budget molto più che su
  Codex" + "un tick di coordinamento costa 7-12× di più" + "budget Kimi ~17× più piccolo".
  **Tutte superate**: erano confronti di fasi diverse (coast vs attivo) e un errore d'asse.
- **2026-07-02**: misura pulita full-history → coordinatori **~20% uguali** (76%→20%); budget
  **~2×** (17×→2×); aggiunto il finding **€/token ≈ pari**. Vedi lo snapshot forense
  [`2026-07-02-kimi-clean-measurement.md`](../2026-07-02-kimi-clean-measurement.md).

## Correlati

- Snapshot datati: `2026-06-{15,17,22,24,25,28,29,30}-*`, `2026-07-01-*` (famiglia Kimi/pacing).
- User-facing: [`docs/about/PROVIDERS.md`](../../about/PROVIDERS.md), [`docs/about/MONITORING.md`](../../about/MONITORING.md).
- Bridge role-map: [`bridges.md`](bridges.md).
