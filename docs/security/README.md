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

## Come si legge

1. Parti da `01-pre-launch-review.md` → la lista dei problemi.
2. Vai a `02-openclaw-comparison.md` per capire **come si risolvono in pratica**.
3. Leggi `03-implementation-tradeoffs.md` per decidere **quali risolvere subito** e quali rinviare.
4. `04-threat-model.md` è il documento da pubblicare nel `SECURITY.md` alla root al momento dell'open-source — chiude metà delle false-positive prima che arrivino.

## Stato

- Audit eseguito: **2026-04-27** su branch `dev-1` @ `65f2ec4a`.
- Nessun fix è stato committato. Solo documentazione.
- Tooling usato: gitleaks 8.30.1, npm audit, pip-audit, manual code review (3 sub-agent + verifica diretta).
