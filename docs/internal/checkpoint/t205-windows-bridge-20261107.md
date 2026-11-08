# T205: ponte Windows e migrazione T214

## Fatto

Le chiamate Podman machine hanno deadline, output limitato e un Job Object privato per chiamata. Il processo nasce sospeso e viene assegnato al job prima dell’avvio; il timeout termina solo quel job. I dati obbligatori vengono rifiutati prima di rilasciare la proprietà dei processi.

La readiness conserva un solo start, il codice originale e la deadline di 30 secondi. I successi consentiti preservano gli helper; i rifiuti controllano la chiusura del job. Sono incluse le guardie di download, manifest, disinstallazione e i testi delle code chat concluse.

## Limiti e ripresa

Il ponte PowerShell è una correzione temporanea. **La logica andrà in Rust con T214**, mantenendo deadline, ownership, ABI, codici, traduzioni e prove negative. L’installazione legacy richiede il primo passaggio tramite installer aggiornato.

I pre-gate non attestano la nuova immagine, un primo punteggio o il rilascio. Le qualifiche GitHub e real Podman appartengono al composto esatto; non sono trasferite dai vecchi candidati.

## Custodia

- Ref locale: `refs/archive/windows-bridge-candidate-20261107`
- SHA: `784ca384d6f9d5ddca993a4717af24598ae252ad`
- Il riferimento conserva anche il materiale storico; dump e observer non entrano nel prodotto o nella storia di questa composizione.
