# 💰 Economia Kimi vs Codex — budget · coordinatori · prezzo (living doc)

> **Living doc** (non datato): riflette lo stato **corrente** dell'analisi economica dei
> provider per la decisione "che tier mandare in beta / general availability". Aggiornato
> **in place**. Ultimo aggiornamento: **2026-07-02**.
>
> ⚠️ **PRELIMINARE.** Le cifre di budget/prezzo qui sono una **prima passata** su un banco di
> test ristretto (poche istanze, account provider ruotati nel tempo). Vanno **rivalidate**
> quando ci saranno tester separati, ognuno con un proprio singolo account e senza rotazione.
> Prendi i **rapporti** (~2-3×, €/token ≈ pari) come ordine di grandezza solido; i **valori
> assoluti** come indicativi. È materia da approfondire strada facendo.
>
> Snapshot forensi datati che l'hanno prodotto (record storici, non aggiornarli):
> [`2026-07-02-kimi-codex-exact-token-forensics.md`](../postmortems/2026-07-02-kimi-codex-token-forensics.md)
> (token **ESATTI** dai log CLI + metering-cache),
> [`2026-07-02-kimi-clean-measurement.md`](../postmortems/2026-07-02-kimi-codex-token-forensics.md) (misura
> token-meter, precedente e meno precisa),
> [`2026-06-29-coordinator-burn-kimi-vs-codex.md`](../_archive/2026-06-29-coordinator-burn-kimi-vs-codex.md)
> (coordinator-burn + thinking-flag),
> [`2026-07-01-capitano-kimi-thinking-off-writer-gate.md`](../postmortems/2026-07-01-capitano-kimi-thinking-off-writer-gate.md)
> (writer-gate).

## TL;DR

- **Coordinatori (Capitano+Sentinella) ~20% del budget, ~UGUALE su Kimi e Codex.** Non è un
  difetto di Kimi. Il "monitoraggio >70%" è reale ma vale per **entrambi** e solo in *coast*.
- **Budget di Kimi ~2,7× più piccolo di Codex (NON 17×)** sull'unica base valida (token
  *non-cached*), misurato dai log CLI **esatti** dei due provider. Stesso ordine di grandezza.
- **€/token ≈ PARI**: prezzo ~2,6× e budget ~2,7× si annullano (~€0,4/M non-cached su entrambi).
- **Il vero blocco alla de-beta di Kimi NON è il budget**, ma la **precisione della
  proiezione** (±10-15% vs ±5% Claude) e il **comportamento** (scout rabbit-hole, thinking
  fragile). Sono voci di *tuning*, in lavorazione.

## 1. Quota coordinatori — ~20%, uguale sui due modelli

Aggregando **tutti** i tick pacing del `bridge-mailbox.jsonl` (554 Kimi / 631 Codex,
maggio→luglio), quota = `(capitano+sentinella) kT / totale team kT`:

```
        storico         W24    W25    W26    W27
Kimi    20,5%           25,9%  25,0%  33,8%  35,5%   (cap 13,7 + sent 6,8)
Codex   19,2%           24,3%  19,2%  20,8%  27,8%   (cap 13,5 + sent 5,7)
```

- **Capitano ~13,6% su entrambi**, identico. Storico ~uguale (20,5 vs 19,2).
- Trend in leggera salita su **entrambi** = maturazione dataset (i worker fanno meno → i
  coordinatori pesano di più *in proporzione*), non peggioramento dei coordinatori.
- In **coast** (worker ≈ 0) i coordinatori sono ~95% su entrambi (Kimi 96-98%, Codex
  91-99%): è qui che nasce il "70%", ed è model-independent.
- La vecchia lettura "Kimi 76% vs Codex 20%" era un **confronto di fasi sbagliato** (coast
  Kimi vs attivo Codex).

## 2. Dimensione del budget — ~2,7× su token *non-cached* (misura ESATTA)

> La prima stima (~2×) veniva dal **token-meter del bridge** (euristica sui pane). I log CLI
> dei due provider registrano i token **esatti per chiamata** → rifatto su quelli. Il "17×"
> era comunque morto; con dati esatti il numero è ~2,7×.

**Fonti esatte** (log CLI dei provider):
- **Codex**: rollout JSONL, evento `token_count` → `total_token_usage`/`last_token_usage`
  (input, cached_input, output, reasoning, total). Metodo-A vs cross-check concordano al ~1%.
- **Kimi**: `wire.jsonl`, evento `StatusUpdate.payload.token_usage` (`input_other`=fresh,
  `input_cache_read`, `input_cache_creation`, `output`). Auto-consistente al **100%** (i tre
  input sommano a `context_tokens`), dedup per `message_id`.

**Il numero che conta è il NON-CACHED (fresh input + output).** Il **94-97%** dei token è
cache-read (ri-lettura del contesto ad ogni turno): headline-are il "totale con cache"
gonfierebbe di **~30×**.

**Asimmetria di metering (il punto chiave):**
```
        la quota settimanale conta la cache?          base
Codex   SÌ — token LORDI, cache a peso pieno           (regressione tok↔used_percent, R²≈0,998)
Kimi    NO — solo NON-CACHED, cache-read gratis        (calibrazione ~190k non-cached / 1%)
```
→ confrontare i **lordi** è invalido (misurano due valute diverse); l'unica base comune è il
**non-cached**.

```
NON-CACHED (fresh input + output)     Codex             Kimi (per singolo account)
──────────────────────────────────────────────────────────────────────────────────
budget settimanale                    ~48-57M           ~16-20M
rapporto Codex / Kimi                 ~2,5-3,2×   (centro ~2,7×)
throughput / giorno attivo            ~7,8M             ~4,5M      (~1,7×)
```

- **Allowance ~2,7×**, ma **throughput/giorno solo ~1,7×**: il team Kimi gira "caldo"
  (~170% del ritmo sostenibile), Codex ~100%.
- **Nota metodologica (banco di test)**: le cifre Kimi provengono da un contesto dove
  l'account veniva **ruotato** nel tempo; misure che attraversano uno switch mescolano
  **tier di budget diversi** (osservati ~16M e ~20M non-cached/sett). Vanno **segmentate** per
  account prima di calibrare (vedi §6, rilevamento switch). Da qui il range 16-20M per-account.

## 3. Prezzo per unità di lavoro — ≈ pari

Piani testati (prezzi = info pubblica del provider, verificati via web): Codex ~**$100/mese**,
Kimi ~**$39/mese** (~2,6× di prezzo).

€/M token **non-cached** (l'unica base valida, §2):
```
                     base budget sostenibile     base throughput reale
Codex ($100)         ~€0,41/M                     ~€0,39/M
Kimi  ($39)          ~€0,41-0,51/M                ~€0,26-0,30/M
```

→ **economia unitaria comparabile**: Codex compra ~2,7× il budget per ~2,6× il prezzo. Kimi
non è "più economico perché fa meno" — **stesso €/token per-abbonamento**, a barriera
d'ingresso ~2,6× più bassa. Sul throughput reale Kimi è pure un filo più economico (gira più
caldo). È questo l'argomento per il tier mass-market.

**Trade-off vero del mass-market**: la **capacità assoluta di UN abbonamento Kimi è ~2,7× più
piccola** di un Codex — non un difetto di efficienza, ma meno lavoro/settimana per singolo
utente. Per pareggiare un Codex servirebbero ~2-3 abbonamenti Kimi (≈ o oltre il prezzo Codex).

Caveat:
- **Sensibilità al prezzo Codex**: tutto regge su ~$100; a ~$200 Codex sarebbe ~2× più
  caro/token, a ~$20 ~5× più economico.
- **Range Kimi (16-20M/sett)**: dovuto a tier di account diversi nel banco di test (§2) → il
  €/token Kimi oscilla ~€0,41-0,51/M a seconda del tier. Da fissare con tester a singolo account.

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
Dettaglio: [`2026-07-01-capitano-kimi-thinking-off-writer-gate.md`](../postmortems/2026-07-01-capitano-kimi-thinking-off-writer-gate.md).
Nota: è una scelta di **correttezza**, non di burn (attacca una quota ~20%, non un 70%).

## 6. Metodo (riproducibile, sola lettura)

- **Quota coordinatori / costo per-agente**: messaggi `kind=tick` in `bridge-mailbox.jsonl`,
  breakdown `nome=…%/h [NkT/Xm …]`. Regex `([A-Za-z][\w-]*)=[\d.]+%/h \[([\d.]+)kT/\d+m` —
  nota `\d+m` (il formato vecchio usa finestre variabili `11m`, non solo `15m`). Somma
  per-agente per settimana → quota = `(capitano+sentinella)/totale`.
- **Dimensione budget — TOKEN ESATTI (preferito)**: leggere i log CLI dei provider, NON il
  token-meter. Codex → rollout `token_count` (`~/.codex/sessions/.../rollout-*.jsonl`,
  campo `total_token_usage`/`last_token_usage`). Kimi → `wire.jsonl`
  (`~/.kimi/sessions/<hash>/<uuid>/wire.jsonl`), righe `{"timestamp":…,"message":{"type":
  "StatusUpdate","payload":{"token_usage":{input_other,input_cache_read,input_cache_creation,
  output},"message_id":…}}}`; **dedup per `message_id`**. Base di confronto = **non-cached**
  (fresh input + output). MAI il totale-con-cache (94-97% è cache-read → gonfia ~30×).
- **Metering-cache asimmetrico** (verificare SEMPRE prima di confrontare): Codex conta la
  cache nella quota settimanale (regressione tokens ↔ `secondary.used_percent`, R²≈0,998);
  Kimi NO (calibrazione ~190k **non-cached** per 1%). Calibrare = `non-cached / %-settimanale
  consumato` (delta positivi di `weekly_usage` in `sentinel-data.jsonl`).
- **Rilevare gli switch di account (Kimi)**: su Kimi un reset del weekly **in anticipo**
  (gap < ~7 giorni dal precedente) **+** cambio dell'orario di reset = **switch di account**,
  non un reset legittimo (Kimi non resetta mai in anticipo; Codex sì, una volta). Ogni switch
  parte da account **esaurito** (drop 100%→~1%). **Segmentare i token tra gli switch** prima
  di calibrare: account diversi possono essere di **tier diversi** (budget non uguali).
- **Dimensione budget — token-meter (fallback, meno preciso)**: i tick contengono
  `ratio=X kT/% (team NkT / Δusage M%)`. Aggregare `Σ team_kT / Σ Δusage` (robusto), NON la
  media per-tick (avvelenata da `Δusage≈1%`). Usare solo se i log CLI non sono accessibili.
- Nessun intervento sui team (osservazione, DB `mode=ro`).

## Changelog (evoluzione della verità)

- **2026-06-15→29**: prima tesi — "su Kimi i coordinatori dominano il budget molto più che su
  Codex" + "un tick di coordinamento costa 7-12× di più" + "budget Kimi ~17× più piccolo".
  **Tutte superate**: erano confronti di fasi diverse (coast vs attivo) e un errore d'asse.
- **2026-07-02 (token-meter)**: misura pulita full-history → coordinatori **~20% uguali**
  (76%→20%); budget **~2×** (17×→2×); €/token ≈ pari. Snapshot
  [`2026-07-02-kimi-clean-measurement.md`](../postmortems/2026-07-02-kimi-codex-token-forensics.md).
- **2026-07-02 (token ESATTI)**: rifatto sui **log CLI esatti** (non più il meter) → budget
  **~2,7×** su base **non-cached**, con l'**asimmetria di metering-cache** (Codex conta la
  cache, Kimi no) e i **prezzi dei piani validati**; €/token confermato ≈ pari. Scoperto che
  il banco di test **mescola più account/tier Kimi** (segmentati via reset-anomaly).
  **PRELIMINARE**, da rivalidare con tester separati. Snapshot
  [`2026-07-02-kimi-codex-exact-token-forensics.md`](../postmortems/2026-07-02-kimi-codex-token-forensics.md).

## Correlati

- Snapshot datati: `2026-06-{15,17,22,24,25,28,29,30}-*`, `2026-07-01-*` (famiglia Kimi/pacing).
- User-facing: [`docs/about/PROVIDERS.md`](../../about/PROVIDERS.md), [`docs/about/MONITORING.md`](../../about/MONITORING.md).
- Bridge role-map: [`bridges.md`](bridges.md).
