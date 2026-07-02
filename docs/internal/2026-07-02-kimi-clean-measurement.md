# 🔬 Misura pulita full-history Kimi vs Codex — 2026-07-02

> **Tipo:** snapshot forense datato (record di cosa è stato misurato oggi). La **verità
> consolidata e corrente** vive nel living doc
> [`architecture/kimi-vs-codex-economics.md`](architecture/kimi-vs-codex-economics.md) — se
> leggi per decidere, leggi quello. Questo file è il *come ci siamo arrivati*, congelato.
> **Modalità:** sola lettura sui team live (nessun intervento).

## Cosa ha ribaltato

Due affermazioni precedenti sono cadute nello stesso giorno, entrambe per lo stesso motivo
(stima frettolosa su finestra singola / asse sbagliato, non aggregato pulito):

| Affermazione precedente | Misura pulita 2026-07-02 |
|---|---|
| Coordinatori Kimi ~76% ≫ Codex ~20% | **~20% su ENTRAMBI** (Kimi 20,5% / Codex 19,2%; Capitano ~13,6% identico) |
| Budget Kimi **~17×** più piccolo di Codex | **~2×** più piccolo (stesso ordine di grandezza) |
| — | **NUOVO:** €/token Kimi ≈ Codex (prezzo 2,5× ÷ budget 2,4× ≈ pari) |

## Dati grezzi

- Fonte: `bridge-mailbox.jsonl` (554 tick betaB/Kimi, 631 betaC/Codex, mag→lug) +
  `sentinel-data.jsonl` (`weekly_usage`, `source=bridge`).
- **Quota coordinatori** (Σ cap+sent kT / Σ team kT): Kimi 20,5% · Codex 19,2%.
- **Budget** (`Σ team_kT / Σ Δusage`, per-tick `ratio=X kT/%`):
  - 5h: Kimi ~44-61 kT/% · Codex ~89-92 kT/% (→ 1,5-2×).
  - settimanale (W24-27): Kimi ~130 kT/% (~13M/sett) · Codex ~330 kT/% (~31M/sett) (→ 2,4×).
  - throughput assoluto: Kimi 117M · Codex 158M token (→ 1,35×).
- **Prezzo** (€40 Kimi / €100 Codex, da `PROVIDERS.md`): €/token ~€0,71 vs ~€0,74 ≈ pari.

## Autopsia del "17×"

Il "17×" (Kimi ~20 kT/% vs Codex ~340 kT/%) era un **errore d'asse**: il ~340 di Codex è il
numero corretto **sull'asse settimanale**; il ~20 di Kimi era rotto (reale ~130). A parità
d'asse è ~2,5×. Controprova: la **media** dei `ratio` per-tick è avvelenata dai tick con
`Δusage≈1%` (divisione per ~1 → picchi 750+ kT/%), ma quei picchi sono **identici sui due
provider** (Kimi max 755, Codex 776) → non giustificano nessuna asimmetria. Media, mediana e
aggregato `Σ/Σ` concordano per-provider (Kimi 48-72, Codex 70-89 kT/% sull'asse 5h).

## Implicazione

Il budget **non** è il limite dominante di Kimi (è ~2×, gestibile), né lo è il monitoraggio
(~20%, uguale a Codex). Il criterio vero per la de-beta è la **precisione della proiezione**
(±10-15% vs ±5% Claude) e il **comportamento** (scout rabbit-hole, thinking fragile). Con
€/token ≈ pari, Kimi è il tier mass-market a barriera d'ingresso 2,5× più bassa.

## Metodo riproducibile
Vedi il §Metodo del living doc [`architecture/kimi-vs-codex-economics.md`](architecture/kimi-vs-codex-economics.md).
