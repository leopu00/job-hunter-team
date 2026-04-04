# Contributing

## Setup

```bash
git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team

# Dipendenze web
cd web && npm install && cd ..

# Dipendenze test
cd tests/js && npm install && cd ../..

# Dipendenze shared/cron
npm install --prefix shared/cron

# Setup configurazione
jht setup
```

## Branch

- Lavora su un branch dedicato: `git checkout -b fix/descrizione` o `feat/descrizione`
- **Non pushare direttamente su `master`**
- Apri una Pull Request e aspetta la review

## Commit

Formato: `tipo(scope): descrizione breve`

| Tipo | Quando usarlo |
|------|---------------|
| `feat` | Nuova funzionalità |
| `fix` | Bug fix |
| `docs` | Solo documentazione |
| `refactor` | Refactor senza nuove feature |
| `test` | Aggiunta o modifica test |
| `ci` | CI/CD |
| `chore` | Task di manutenzione |

Regole:
- 1 commit = 1 unità logica di lavoro
- Max 200 righe per commit
- Nessun dato sensibile nel commit message

## Checklist pre-PR

- [ ] `tsc --noEmit` passa senza errori (nella cartella `web/`)
- [ ] `npm run lint` passa (nella cartella `web/`)
- [ ] `npm test` passa (nella cartella `tests/js/`)
- [ ] Nessun file sensibile incluso (PDF, DB, credenziali, dati personali)
- [ ] Branch aggiornata su `master` prima di aprire la PR

## Nuovi agenti

Prima di aggiungere un nuovo agente, leggi [`shared/docs/add-agent.md`](../shared/docs/add-agent.md).

## Segnalare bug

Usa il template [Bug Report](ISSUE_TEMPLATE/bug_report.md).

## Proporre feature

Usa il template [Feature Request](ISSUE_TEMPLATE/feature_request.md).
