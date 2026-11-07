---
name: codex-dialog
description: Distingui un dialogo della CLI Codex gestita da un worker morto prima di recuperarlo o sostituirlo.
---
<!-- @translation: it, ai-translated 2026-11-07 -->

Usa questa skill solo per gli agenti nella **CLI terminale Codex**, non nel runtime API.
Una notifica `[CODEX-DIALOG]` indica uno stato distinto, non prova che il worker
sia morto. Il watchdog riconosce il promemoria del modello visibile, mantiene il
modello attuale e comunica se il recupero è riuscito. Non sostituisce la sessione,
non accetta richieste di fiducia, non cambia modello, non aggiorna la CLI e non concede accessi.

Leggi l'ultima osservazione registrata senza inviare input:

```bash
python3 /app/shared/skills/codex_dialog.py status SCORER-1
```

`last_observation` e `at` descrivono l'ultimo controllo, non garantiscono che
l'agente sia attualmente vivo. `codex_dialog_recovered` significa che lo stesso
pane è tornato al composer o al lavoro; `codex_dialog_ready` registra una successiva
osservazione sana senza attribuirla a un recupero automatico. `pending`, `timeout`,
`changed`, `unrecognized` e `io_error` richiedono ispezione. I codici completi
iniziano con `codex_dialog_`.

Comunica questo stato all'utente prima di decidere un recupero manuale o una sostituzione.
Non clonare, terminare o sostituire il worker in silenzio. Per un dialogo irrisolto,
chiedi una diagnosi al Dottore e spiega l'azione proposta. Non inviare mai Enter
alla cieca né scegliere un modello suggerito. I messaggi ordinari usano sempre
`tmux-send` e i suoi controlli di disponibilità. Una quota realmente esaurita,
una richiesta di login o di fiducia non sono un recupero riuscito del promemoria del modello.
