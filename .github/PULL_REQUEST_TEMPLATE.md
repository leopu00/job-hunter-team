## Descrizione

<!-- Cosa fa questa PR? Perché è necessaria? -->

## Tipo di modifica

- [ ] Bug fix
- [ ] Nuova feature
- [ ] Refactor
- [ ] Documentazione
- [ ] Test
- [ ] CI/CD

## Checklist

### Codice
- [ ] Max 200 righe per commit
- [ ] Nessun file sensibile (PDF, DB, CSV, credenziali, dati personali)
- [ ] Nessun riferimento a nomi interni del team di sviluppo
- [ ] Nessun `console.log` di debug lasciato

### Frontend (se applicabile)
- [ ] Componenti verificati nel browser
- [ ] Nessun errore TypeScript (`tsc --noEmit`)
- [ ] Lint passato (`npm run lint`)
- [ ] Build completata (`npm run build`)

### Backend / Shared (se applicabile)
- [ ] Test vitest aggiunti o aggiornati
- [ ] `npm test` passa senza errori

### Git
- [ ] Branch aggiornata su master prima della PR
- [ ] Messaggio commit in formato `tipo(scope): descrizione`
- [ ] Nessun mega-commit (4+ file non correlati)

## Test eseguiti

<!-- Descrivi come hai verificato le modifiche -->

## Screenshot (se frontend)

<!-- Aggiungi screenshot se la PR modifica l'UI -->
