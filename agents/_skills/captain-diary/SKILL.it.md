<!-- @translation: it, ai-translated 2026-08-03 -->
---
name: captain-diary
description: "Diario di consegna quotidiano per il Capitano. Il Capitano viene riavviato spesso (context-refresh, nuova finestra di lavoro, reboot) e altrimenti perde le lezioni di pacing conquistate a fatica durante la giornata — ripetendo gli stessi errori (es. 3 Scout in una volta → uno spike infrenabile → 5h di marcia lenta per ripagare il debito). All'avvio leggi le note del giorno PRECEDENTE (handoff) e AGGIUNGI una nota di una riga ogni volta che durante la giornata succede qualcosa di significativo (una decisione di scaling, uno spike, un kill, una lezione). Un file append-only al giorno."
allowed-tools: Bash(python3 /app/shared/skills/captain_diary.py *)
---

# captain-diary — la consegna tra Capitani

Un file al giorno in `$JHT_HOME/logs/captain-diary-YYYY-MM-DD.md`, append-only.
Il suo compito è impedirti di **ricominciare da capo a ogni riavvio**: le lezioni
di pacing di oggi vengono consegnate al Capitano di domani.

## Al risveglio (SEMPRE, prima di lavorare)

Leggi le note lasciate dal Capitano del giorno precedente:

```bash
python3 /app/shared/skills/captain_diary.py handoff
```

Stampa le note di **ieri** (o quelle dell'ultimo giorno lavorato) più quanto è
già registrato **oggi**. Erediti le lezioni → **non ripetere gli stessi
errori**. Se non c'è niente, sei il primo: comincia a registrare.

## Durante la giornata — registra gli eventi SIGNIFICATIVI

Una riga, ogni volta che succede qualcosa che porta una lezione. NON un diario
di tutto: solo ciò che servirebbe al Capitano di domani.

```bash
python3 /app/shared/skills/captain_diary.py add "20:05 — 3 Scout in una volta: spike \
infrenabile entro 15 min, 5h di marcia lenta per ripagare il debito. Lezione: max 1 Scout \
poi 30 min di osservazione (C-02)."
```

Cosa vale la pena registrare:
- decisioni di scaling andate male (o bene) — quanti worker, quale throttle, cos'è successo;
- uno spike che non sei riuscito a frenare e come ne sei uscito;
- un kill e il perché;
- un pattern emerso (es. "lo Scout sul sito X consuma il doppio");
- qualsiasi cosa che, se la sapessi domani, eviterebbe un errore.

## Rivedere solo oggi

```bash
python3 /app/shared/skills/captain_diary.py today
```

## Regola

- Il diario è il **testimone**: leggilo al boot, alimentalo durante la giornata.
- Le note devono essere **brevi e azionabili** (un fatto + la lezione), non un log prolisso.
- Il timestamp lo aggiunge il tool: tu scrivi solo il fatto e la lezione.
