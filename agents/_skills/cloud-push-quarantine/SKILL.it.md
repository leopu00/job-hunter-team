---
name: cloud-push-quarantine
description: Ispeziona e recupera le righe isolate dal push cloud dopo un rifiuto server, senza esporne il contenuto. Usala quando sync-health segnala push_quarantine.
allowed-tools: Bash(jht cloud quarantine *)
---

# cloud-push-quarantine — ispeziona, ritenta, risolvi

Il push lascia proseguire i dati validi e conserva per la riga rifiutata solo
metadati sicuri: tabella/tipo, identità opaca, motivo sanitizzato, tentativi e
timestamp. Non chiedere né stampare mai la riga sorgente.

1. Ispeziona con `jht cloud quarantine list`. Riporta solo conteggio, tabella,
   identità opaca, codice motivo, tentativi e timestamp.
2. Correggi la causa locale tramite il workflow proprietario. Non modificare
   `jobs.db` a mano e non creare eccezioni per una tabella o un codice errore.
3. Ritenta con `jht cloud quarantine retry <opaque-id>`. Usa il writer cloud
   canonico. Leggi l'esito e ripeti list: il successo porta a `resolved`.
4. Usa `jht cloud quarantine resolve <opaque-id> --confirm` solo dopo aver
   verificato che la riga locale sia stata rimossa o sostituita volutamente e
   che non serva un retry. La cronologia resta conservata.

`retry all` è ammesso solo dopo una correzione comune e il controllo di tutte
le tabelle elencate. Mai copiare body, titoli, path, user ID, dettagli server o
credenziali in chat, log o logbook.
