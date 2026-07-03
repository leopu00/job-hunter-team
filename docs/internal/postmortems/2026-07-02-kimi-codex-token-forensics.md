# 📊 Kimi vs Codex — misura del consumo token (2026-07-02)

Due misure eseguite nella stessa giornata: la prima (token-meter euristico, full-history) ribalta le stime della linea coordinator-burn — coordinatori ~20% del budget e uguali su Kimi e Codex, budget Kimi ~2× più piccolo (non 17×); la seconda (token esatti dai log CLI, dedup per message_id) affina i rapporti: allowance Kimi ~2,7×, €/token ≈ pari, 94–97% dei token è cache-read.

> ⚠️ Snapshot datati. La verità consolidata e mantenuta vive nel living doc
> [`../architecture/kimi-vs-codex-economics.md`](../architecture/kimi-vs-codex-economics.md).

---

> **Parte 1 — misura pulita col token-meter (euristica full-history)** · origine: `2026-07-02-kimi-clean-measurement.md` — contenuto integrale, non riscritto.

## 🔬 Misura pulita full-history Kimi vs Codex — 2026-07-02

> **Tipo:** snapshot forense datato (record di cosa è stato misurato oggi). La **verità
> consolidata e corrente** vive nel living doc
> [`architecture/kimi-vs-codex-economics.md`](../architecture/kimi-vs-codex-economics.md) — se
> leggi per decidere, leggi quello. Questo file è il *come ci siamo arrivati*, congelato.
> **Modalità:** sola lettura sui team live (nessun intervento).
>
> ⚠️ **Superato in precisione (stessa giornata)** da
> `2026-07-02-kimi-codex-exact-token-forensics.md`:
> quella misura usa i **token esatti** dei log CLI (qui invece il **token-meter** euristico del
> bridge). La direzione (coordinatori ~uguali, budget ~2×→2,7×, €/token ≈ pari) è confermata.

### Cosa ha ribaltato

Due affermazioni precedenti sono cadute nello stesso giorno, entrambe per lo stesso motivo
(stima frettolosa su finestra singola / asse sbagliato, non aggregato pulito):

| Affermazione precedente | Misura pulita 2026-07-02 |
|---|---|
| Coordinatori Kimi ~76% ≫ Codex ~20% | **~20% su ENTRAMBI** (Kimi 20,5% / Codex 19,2%; Capitano ~13,6% identico) |
| Budget Kimi **~17×** più piccolo di Codex | **~2×** più piccolo (stesso ordine di grandezza) |
| — | **NUOVO:** €/token Kimi ≈ Codex (prezzo 2,5× ÷ budget 2,4× ≈ pari) |

### Dati grezzi

- Fonte: `bridge-mailbox.jsonl` (554 tick Kimi, 631 Codex, mag→lug) +
  `sentinel-data.jsonl` (`weekly_usage`, `source=bridge`).
- **Quota coordinatori** (Σ cap+sent kT / Σ team kT): Kimi 20,5% · Codex 19,2%.
- **Budget** (`Σ team_kT / Σ Δusage`, per-tick `ratio=X kT/%`):
  - 5h: Kimi ~44-61 kT/% · Codex ~89-92 kT/% (→ 1,5-2×).
  - settimanale (W24-27): Kimi ~130 kT/% (~13M/sett) · Codex ~330 kT/% (~31M/sett) (→ 2,4×).
  - throughput assoluto: Kimi 117M · Codex 158M token (→ 1,35×).
- **Prezzo** (€40 Kimi / €100 Codex, da `PROVIDERS.md`): €/token ~€0,71 vs ~€0,74 ≈ pari.

### Autopsia del "17×"

Il "17×" (Kimi ~20 kT/% vs Codex ~340 kT/%) era un **errore d'asse**: il ~340 di Codex è il
numero corretto **sull'asse settimanale**; il ~20 di Kimi era rotto (reale ~130). A parità
d'asse è ~2,5×. Controprova: la **media** dei `ratio` per-tick è avvelenata dai tick con
`Δusage≈1%` (divisione per ~1 → picchi 750+ kT/%), ma quei picchi sono **identici sui due
provider** (Kimi max 755, Codex 776) → non giustificano nessuna asimmetria. Media, mediana e
aggregato `Σ/Σ` concordano per-provider (Kimi 48-72, Codex 70-89 kT/% sull'asse 5h).

### Implicazione

Il budget **non** è il limite dominante di Kimi (è ~2×, gestibile), né lo è il monitoraggio
(~20%, uguale a Codex). Il criterio vero per la de-beta è la **precisione della proiezione**
(±10-15% vs ±5% Claude) e il **comportamento** (scout rabbit-hole, thinking fragile). Con
€/token ≈ pari, Kimi è il tier mass-market a barriera d'ingresso 2,5× più bassa.

### Metodo riproducibile
Vedi il §Metodo del living doc [`architecture/kimi-vs-codex-economics.md`](../architecture/kimi-vs-codex-economics.md).

---

> **Parte 2 — token esatti dai log CLI (preliminare)** · origine: `2026-07-02-kimi-codex-exact-token-forensics.md` — contenuto integrale, non riscritto.

## 🔬 Token ESATTI Kimi vs Codex — forense dai log CLI (2026-07-02)

> **Snapshot forense datato** (record del lavoro fatto oggi). La **verità consolidata e
> corrente** vive nel living doc
> [`architecture/kimi-vs-codex-economics.md`](../architecture/kimi-vs-codex-economics.md) — se
> leggi per decidere, leggi quello. Questo è il *come ci siamo arrivati*, congelato.
>
> ⚠️ **PRELIMINARE.** Prima passata su un banco di test ristretto con account provider ruotati.
> I **rapporti** (~2-3×, €/token ≈ pari) sono solidi; i **valori assoluti** sono indicativi.
> Da rifare con tester separati, un solo account ciascuno, nessuna rotazione.
> **Modalità:** sola lettura sui team (nessun intervento).

### Novità rispetto alla misura token-meter (stessa giornata)

La misura precedente (`2026-07-02-kimi-clean-measurement.md`)
usava il **token-meter del bridge** (euristica sui pane tmux). Qui si leggono i **token esatti
per chiamata** dai log CLI dei due provider. Direzione confermata, precisione molto migliore.

### 1. Le fonti esatte

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

### 2. La scoperta chiave: cache + metering asimmetrico

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

### 3. I numeri (base non-cached)

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

### 4. Prezzo (info pubblica dei provider)

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

### 5. Rilevare gli switch di account (metodo utile)

Su Kimi **un reset del weekly in anticipo** (gap < ~7 giorni dal precedente) **+ cambio
dell'orario di reset** = **switch di account**, non un reset legittimo (Kimi non resetta mai in
anticipo; Codex sì, una volta). Ogni switch parte da account **esaurito** (drop 100%→~1%).
Segmentando i token tra gli switch, il banco di test mostrava **due tier di budget Kimi**
(~16M e ~20M non-cached/sett) → per questo il per-account è un **range 16-20M**, non un valore
unico. **Segmentare sempre per account prima di calibrare.**

### 6. Limiti (perché è PRELIMINARE)

- Banco di test ristretto, **account ruotati** → le cifre Kimi mescolano più account/tier; il
  numero per-abbonamento "pulito" richiede tester separati, un account ciascuno.
- Il run Codex era **in corso** (giorno finale parziale); i budget settimanali sono calibrati
  su % arrotondate a intero (±5-10%).
- Prezzi = info pubblica dei provider al momento della misura; da riconfermare nel tempo.
- Materia **da approfondire strada facendo**, non un verdetto definitivo.

### Ricetta riproducibile (sola lettura)

Per evitare quoting fragile: scrivere il parser in locale e passarlo allo stdin del python nel
container → `ssh <host> 'docker exec -i jht python3 -' < parser.py`. Base = **non-cached**
(fresh input + output), dedup Kimi per `message_id`, calibrazione = non-cached / delta-positivi
di `weekly_usage`. Dettaglio nel §6 del living doc.
