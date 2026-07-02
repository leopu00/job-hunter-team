# 🔬 Token ESATTI Kimi vs Codex — forense dai log CLI (2026-07-02)

> **Snapshot forense datato** (record del lavoro fatto oggi). La **verità consolidata e
> corrente** vive nel living doc
> [`architecture/kimi-vs-codex-economics.md`](architecture/kimi-vs-codex-economics.md) — se
> leggi per decidere, leggi quello. Questo è il *come ci siamo arrivati*, congelato.
>
> ⚠️ **PRELIMINARE.** Prima passata su un banco di test ristretto con account provider ruotati.
> I **rapporti** (~2-3×, €/token ≈ pari) sono solidi; i **valori assoluti** sono indicativi.
> Da rifare con tester separati, un solo account ciascuno, nessuna rotazione.
> **Modalità:** sola lettura sui team (nessun intervento).

## Novità rispetto alla misura token-meter (stessa giornata)

La misura precedente ([`2026-07-02-kimi-clean-measurement.md`](2026-07-02-kimi-clean-measurement.md))
usava il **token-meter del bridge** (euristica sui pane tmux). Qui si leggono i **token esatti
per chiamata** dai log CLI dei due provider. Direzione confermata, precisione molto migliore.

## 1. Le fonti esatte

- **Codex** — rollout JSONL (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`): evento
  `token_count` con `total_token_usage` (cumulativo di sessione) e `last_token_usage` (turno):
  `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`,
  `total_tokens`. Somma dell'ultimo `total_token_usage` per file vs somma dei `last_token_usage`
  concordano a **~1%**.
- **Kimi** — `wire.jsonl` (`~/.kimi/sessions/<hash>/<uuid>/wire.jsonl`): righe
  `{"timestamp":…,"message":{"type":"StatusUpdate","payload":{"token_usage":{"input_other",
  "input_cache_read","input_cache_creation","output"},"message_id":…}}}`. **Auto-consistente al
  100%** su decine di migliaia di chiamate (i tre input sommano a `context_tokens`), **dedup per
  `message_id`** (zero duplicati). La stima preliminare "Kimi non logga i token esatti" era
  **sbagliata**: li logga, solo con nomi campo non-OpenAI.

## 2. La scoperta chiave: cache + metering asimmetrico

- Il **94-97%** dei token è **cache-read** (ri-lettura del contesto ad ogni turno). Il "totale
  con cache" (miliardi) è fuorviante: **~30× il lavoro reale**. Il numero che conta è il
  **NON-CACHED = fresh input + output**.
- I due provider **misurano la quota settimanale su valute diverse**:

```
        la quota settimanale conta la cache?      evidenza
Codex   SÌ — token LORDI, cache a peso pieno       regressione token ↔ used_percent, R²≈0,998
Kimi    NO — solo NON-CACHED, cache-read gratis    calibrazione ~190k non-cached / 1% (stabile)
```

→ confrontare i **lordi** è invalido; l'unica base comune è il **non-cached**.

## 3. I numeri (base non-cached)

```
NON-CACHED (fresh input + output)     Codex             Kimi (per singolo account)
──────────────────────────────────────────────────────────────────────────────────
totale sul run osservato              ~235M (≈29g)      ~52M (≈12g attivi, ~2,7 quote-sett)
budget settimanale                    ~48-57M           ~16-20M
rapporto Codex / Kimi                 ~2,5-3,2×    (centro ~2,7×)
throughput / giorno attivo            ~7,8M             ~4,5M      (~1,7×)
```

- **Allowance ~2,7×**, **throughput/giorno ~1,7×**: il team Kimi gira "caldo" (~170% del ritmo
  sostenibile), Codex ~100%.
- Il **"17×"** delle stime precedenti è definitivamente **morto**: con dati esatti è ~2,7×.

## 4. Prezzo (info pubblica dei provider)

Piani testati: Codex ~**$100/mese**, Kimi ~**$39/mese** (~2,6×). €/M token non-cached:

```
                 base budget sostenibile     base throughput reale
Codex ($100)     ~€0,41/M                     ~€0,39/M
Kimi  ($39)      ~€0,41-0,51/M                ~€0,26-0,30/M
```

→ **economia unitaria comparabile**: ~2,7× il budget per ~2,6× il prezzo. €/token
per-abbonamento ≈ pari; sul throughput reale Kimi un filo più economico (gira più caldo).
Il vero trade-off mass-market: **un singolo abbonamento Kimi ha ~2,7× meno capacità** di un
Codex (servono ~2-3 account Kimi per pareggiarne uno).

## 5. Rilevare gli switch di account (metodo utile)

Su Kimi **un reset del weekly in anticipo** (gap < ~7 giorni dal precedente) **+ cambio
dell'orario di reset** = **switch di account**, non un reset legittimo (Kimi non resetta mai in
anticipo; Codex sì, una volta). Ogni switch parte da account **esaurito** (drop 100%→~1%).
Segmentando i token tra gli switch, il banco di test mostrava **due tier di budget Kimi**
(~16M e ~20M non-cached/sett) → per questo il per-account è un **range 16-20M**, non un valore
unico. **Segmentare sempre per account prima di calibrare.**

## 6. Limiti (perché è PRELIMINARE)

- Banco di test ristretto, **account ruotati** → le cifre Kimi mescolano più account/tier; il
  numero per-abbonamento "pulito" richiede tester separati, un account ciascuno.
- Il run Codex era **in corso** (giorno finale parziale); i budget settimanali sono calibrati
  su % arrotondate a intero (±5-10%).
- Prezzi = info pubblica dei provider al momento della misura; da riconfermare nel tempo.
- Materia **da approfondire strada facendo**, non un verdetto definitivo.

## Ricetta riproducibile (sola lettura)

Per evitare quoting fragile: scrivere il parser in locale e passarlo allo stdin del python nel
container → `ssh <host> 'docker exec -i jht python3 -' < parser.py`. Base = **non-cached**
(fresh input + output), dedup Kimi per `message_id`, calibrazione = non-cached / delta-positivi
di `weekly_usage`. Dettaglio nel §6 del living doc.
