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

## Un `$` nel testo: apici singoli o stdin

Tra virgolette doppie la shell legge `$1` e `$2` come suoi argomenti e li sostituisce con niente **prima che il tool parta**: «Plus — $20/month; Pro — $200/month» arriva all'utente come «Plus — 0/month; Pro — 00/month», e a valle nessuno può ridare le cifre. Se il testo ha un `$` (prezzi, importi), scrivilo tra apici singoli oppure passalo da stdin.

```bash
# Single quotes for the labels; the prompt from stdin: "-" reads it, the quoted delimiter keeps every $
jht-reply-options --prompt - 'Plus — $20/month' 'Pro — $100/month' <<'TXT'
Which plan do you want? Plus — $20/month; Pro — $100/month
TXT
```

Scrivi il `TXT` di chiusura in prima colonna, da solo sulla riga, senza spazi davanti (se copi il rientro il heredoc non si chiude mai: un testo che finisce con una riga `TXT` viene rifiutato, non parte niente).
