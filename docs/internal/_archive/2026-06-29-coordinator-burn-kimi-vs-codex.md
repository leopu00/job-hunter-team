# Coordinator-burn Kimi vs Codex — indagine (snapshot 2026-06-29 → 07-01)

> **Snapshot storico.** Questo file registra l'indagine coordinator-burn e l'evoluzione della
> decisione thinking-flag di quei giorni (29/06 → 01/07). ⚠️ Le sue conclusioni
> **quantitative** sono state **superate** dalla misura pulita del 02/07: i coordinatori pesano
> ~20% **uguale** su Kimi e Codex, il budget di Kimi è ~2× (non 17×) più piccolo, il €/token è
> ≈ pari. **La verità corrente e consolidata è nel living doc**
> [`architecture/kimi-vs-codex-economics.md`](../architecture/kimi-vs-codex-economics.md); la
> misura che l'ha prodotta è in [`2026-07-02-kimi-clean-measurement.md`](../postmortems/2026-07-02-kimi-codex-token-forensics.md).
> Resta qui, congelato, ciò che è genuinamente d'epoca: l'ipotesi iniziale e le prove sui
> flag thinking.

## ~~Il fenomeno (vecchia lettura, SUPERATA)~~

> ⚠️ Superata dalla misura pulita (02/07). Si era osservato che "su Kimi i coordinatori
> dominano il budget molto più che su Codex" e "un tick di coordinamento costa 7–12× più".
> Errore di metodo: le due misure confrontavano fasi diverse (coast Kimi vs attivo Codex) e
> finestre singole. Resta valido solo l'**anti-pattern del pacing**: il verdetto indica come
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
hard-stop su beta-3 — vedi [`2026-07-01-betaD-daily-hardstop-validated.md`](../postmortems/2026-07-01-betaD-daily-hardstop-validated.md).)*
NB: questa scelta è di **correttezza**, non di burn.

## La Sentinella resta no-thinking

Compito più stretto (watchdog di soglie), meno esposto a errori di deliberazione. Il flag ha
ridotto nettamente la sua spesa senza degrado decisionale osservato; il ragionamento resta
visibile nella risposta (Instant mode) → auditabile. Da confermare sul lungo.

## Dove sono finite le conclusioni (02/07)

Le sezioni quantitative — quota coordinatori (~20% uguale), dimensione del budget (~2×),
prezzo per token (≈ pari), le manopole nel codice e il metodo riproducibile — sono state
**consolidate nel living doc** [`architecture/kimi-vs-codex-economics.md`](../architecture/kimi-vs-codex-economics.md).
Erano state scritte in questo file il 02/07 e sono state spostate lì per non far accumulare
a uno snapshot datato una settimana di correzioni successive.

## Correlati

- Living doc corrente: [`architecture/kimi-vs-codex-economics.md`](../architecture/kimi-vs-codex-economics.md).
- Snapshot misura pulita: [`2026-07-02-kimi-clean-measurement.md`](../postmortems/2026-07-02-kimi-codex-token-forensics.md).
- Annex writer-gate: [`2026-07-01-capitano-kimi-thinking-off-writer-gate.md`](../postmortems/2026-07-01-capitano-kimi-thinking-off-writer-gate.md).
- Famiglia: `2026-06-15-coordinator-burn-consumo-finding.md`, `2026-06-17-betaB-kimi-weekly-burn-finding.md`,
  `2026-07-01-cv-quality-findings-beta3.md`, `2026-07-01-betaD-daily-hardstop-validated.md`.
