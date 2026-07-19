---
name: game-reply-options
description: Proponi 2-5 risposte cliccabili specifiche per la conversazione nella chat del gioco quando aiutano davvero la prossima decisione. Non usarle come onboarding fisso; in tutti gli altri casi rispondi normalmente con jht-send.
allowed-tools: Bash(jht-reply-options *)
---

# Risposte suggerite generate nella chat del gioco

Quando il messaggio dell'utente porta a poche mosse chiare, chiudi il turno con
una domanda e 2–5 opzioni create per quel contesto:

```bash
jht-reply-options --prompt 'Da quale parte vuoi iniziare?' \
  'Rivediamo i ruoli obiettivo' 'Controlliamo il profilo' 'Mostrami le posizioni migliori'
```

Nel gioco diventano pulsanti, ma il testo libero resta sempre disponibile.
Il click invia l'opzione come un normale messaggio dell'utente.

Regole:

- Le opzioni sono facoltative, contestuali e mai copiate dall'onboarding offline.
- Devono essere 2–5, concise, utili e realizzabili.
- `jht-reply-options` è la risposta finale del turno: non inviare poi `jht-send`,
  altrimenti una risposta più recente farà correttamente sparire i pulsanti.
- Se la domanda è aperta o richiede una risposta diretta, usa `jht-send`.
