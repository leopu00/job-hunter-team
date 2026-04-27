# 🔒 Security documentation — JHT

Questa cartella raccoglie l'analisi di sicurezza del repo e il piano di hardening pre open-source.

## Indice

| File | Scopo |
|------|-------|
| [`01-pre-launch-review.md`](01-pre-launch-review.md) | Audit completo pre-launch: 27 finding (5 critical / 9 high / 8 medium / 5 low), tooling usato, priorità di remediation |
| [`02-openclaw-comparison.md`](02-openclaw-comparison.md) | Confronto sistematico con OpenClaw: come un progetto agentic maturo affronta gli stessi problemi, file-per-file |
| [`03-implementation-tradeoffs.md`](03-implementation-tradeoffs.md) | Trade-off di ogni fix proposto: costo dev, UX impact, perf, funzionalità persa, raccomandazione |
| [`04-threat-model.md`](04-threat-model.md) | Threat model esplicito JHT: cosa è in scope, cosa no, deployment assumptions, decisioni di trust |
| [`05-checklist.md`](05-checklist.md) | Checklist actionable dei fix da implementare. Si spunta `[x]` quando il commit è mergiato in `master` |
| [`06-post-fix-comparison.md`](06-post-fix-comparison.md) | Comparazione post-fix con OpenClaw: gap chiuso da -78 a -25, security score 30% → 74%, dettaglio 12 aree |

## Come si legge

1. Parti da `01-pre-launch-review.md` → la lista dei problemi.
2. Vai a `02-openclaw-comparison.md` per capire **come si risolvono in pratica**.
3. Leggi `03-implementation-tradeoffs.md` per decidere **quali risolvere subito** e quali rinviare.
4. `04-threat-model.md` è il documento da pubblicare nel `SECURITY.md` alla root al momento dell'open-source — chiude metà delle false-positive prima che arrivino.
5. `05-checklist.md` è lo stato di esecuzione fix-per-fix (sha del commit che chiude ogni voce).
6. `06-post-fix-comparison.md` chiude il cerchio: cosa è cambiato vs OpenClaw dopo lo sprint.

## Stato

- **Audit iniziale:** 2026-04-27 11:00 su branch `dev-1` @ `65f2ec4a` — 27 finding.
- **Implementation sprint:** 2026-04-27 14:54-16:55 — 4 agenti Claude in parallelo (worktrees `dev-1`..`dev-4`), 31/34 task chiusi (91%) in ~95 min.
- **Merge in `master`:** sha `7a2cb6ae` (2026-04-27 21:18).
- **Comparazione post-fix:** [`06-post-fix-comparison.md`](06-post-fix-comparison.md) — gap chiuso da -78 a -25 punti.
- **Tooling iniziale:** gitleaks 8.30.1, npm audit, pip-audit, sub-agent code review.
- **Nuovi tool integrati:** detect-secrets, actionlint, zizmor, npm-audit-prod, Dependabot Docker.

## Phase status (audit findings, 34 task originali)

| Phase | Stato | Dettagli |
|-------|-------|----------|
| **Phase 1** (bloccanti pre-launch) | ✅ 9/9 | C1-C5, H1, H2, H8, H9 |
| **Phase 2** (entro 2 settimane post-launch) | ✅ 12/12 | H3-H6, M1-M8 |
| **Phase 3** (hardening continuo) | 🟡 10/13 | manca: L1 (CSP prod), `tests/security/`, `jht doctor security` |

## Gap critici residui prima del public release

3 task. Solo `L1` è in comune con la lista Phase 3 sopra: **SSRF** e **resolve-system-bin** sono **gap aggiuntivi non-audit** (emersi dal confronto OpenClaw, non dai 27 finding originali) — tracciati come sezione separata in [`05-checklist.md`](05-checklist.md).

1. 🔴 **SSRF dispatcher generico** — `shared/net/ssrf.ts` mancante (~1 giorno effort)
2. 🟡 **`resolve-system-bin` strict** — wrapper anti PATH-hijacking (~4h)
3. 🟡 **CSP hash-based prod** (L1) — manuale Next.js (~4h)
