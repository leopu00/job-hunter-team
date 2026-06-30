---
name: captain-diary
description: Daily handoff diary for the Captain. The Captain is restarted often (context-refresh, new work window, reboot) and otherwise loses the day's hard-won pacing lessons — repeating the same mistakes (e.g. 3 Scouts at once → an unbrakable spike → a 5h coast to repay the debt). Read the PREVIOUS day's notes at startup (handoff), and APPEND a one-line note whenever something significant happens during the day (a scaling decision, a spike, a kill, a lesson). One append-only file per day.
allowed-tools: Bash(python3 /app/shared/skills/captain_diary.py *)
---

# captain-diary — passaggio del testimone tra Capitani

Un file per giorno in `$JHT_HOME/logs/captain-diary-YYYY-MM-DD.md`, append-only.
Serve a **non ripartire da zero ogni riavvio**: le lezioni di pacing di oggi
passano al Capitano di domani.

## Al risveglio (SEMPRE, prima di lavorare)

Leggi le note del Capitano del giorno precedente:

```bash
python3 /app/shared/skills/captain_diary.py handoff
```

Stampa le note di **ieri** (o dell'ultimo giorno lavorato) + ciò che è già
annotato **oggi**. Erediti le lezioni → **non rifare gli stessi errori**. Se non
c'è nulla, sei il primo: inizia ad annotare.

## Durante il giorno — annota gli eventi SIGNIFICATIVI

Una riga, quando succede qualcosa da cui si impara. NON il diario di tutto:
solo ciò che servirebbe al Capitano di domani.

```bash
python3 /app/shared/skills/captain_diary.py add "20:05 — 3 Scout insieme: picco \
infrenabile in 15 min, 5h di coast per ripagare il debito. Lezione: max 1 Scout \
poi 30 min di osservazione (C-02)."
```

Cosa vale la pena annotare:
- decisioni di scaling che sono andate male (o bene) — quanti worker, che throttle, cosa è successo;
- un picco non frenabile e come l'hai recuperato;
- un kill e perché;
- un pattern emerso (es. "lo Scout sul sito X consuma il doppio");
- qualunque cosa che, se la sapessi domani, eviterebbe un errore.

## Rivedere solo oggi

```bash
python3 /app/shared/skills/captain_diary.py today
```

## Regola

- Il diario è il **testimone**: leggilo al boot, alimentalo durante il giorno.
- Note **brevi e azionabili** (un fatto + la lezione), non un log verboso.
- L'orario lo mette lo strumento: tu scrivi solo il fatto e la lezione.
