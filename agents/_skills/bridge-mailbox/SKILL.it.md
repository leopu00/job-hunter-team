<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: bridge-mailbox
description: Svuota i verdetti bridge pendenti all'INIZIO di ogni turno del Capitano — azione OBBLIGATORIA prima di fare qualsiasi altra cosa. Durante un turno lungo, `jht-tmux-send` dal bridge può fallire con rc=3 (testo mai apparso nel pannello) e un verdetto `[BRIDGE PACING]` o `PIPELINE STALLED` viene silenziosamente perso. Il bridge appende OGNI verdetto a una mailbox JSONL così puoi recuperarli. Saltare questo svuotamento significa agire su misurazioni obsolete mentre un verdetto più recente giace non letto.
allowed-tools: Bash(python3 /app/shared/skills/bridge_mailbox.py *)
---

# bridge-mailbox — recupera i verdetti mancati

Il bridge ti parla tramite tmux, ma la consegna tmux può fallire silenziosamente durante un turno lungo (problemi di rendering TUI Codex / Kimi, eri dentro una lunga tool call, ecc.). Per assicurarsi che nessun verdetto venga perso, il bridge **appende anche** ogni tick a una mailbox JSONL in `$JHT_HOME/logs/bridge-mailbox.jsonl`. La svuoti all'inizio di ogni turno.

## L'azione obbligatoria come prima cosa

Prima di *qualsiasi altra cosa* — prima di leggere messaggi, prima di decidere azioni, prima di aprire un'altra skill — esegui:

```bash
python3 /app/shared/skills/bridge_mailbox.py drain
```

Output possibili:
- `no pending verdicts` → mailbox vuota, procedi normalmente con il turno.
- una o più righe formattate come tick tmux live (`[BRIDGE PACING] ...`, `PIPELINE STALLED ...`, `[BRIDGE ALERT] ...`).

`drain` consuma le voci (vengono marcate come lette in caso di successo) — rieseguirlo restituisce `no pending verdicts` finché il bridge non ne appende di nuove.

## Come applicare i verdetti svuotati

Processa TUTTE le righe, ma **agisci solo sull'ultima**. Le precedenti sono già obsolete — le metriche si sono mosse da allora. Due eccezioni in cui una riga precedente è ancora rilevante:

1. **`PIPELINE STALLED` recente (< 30 min) e ancora pertinente** (proj è ancora basso, team_kt è ancora basso adesso). Agisci sul playbook (riaccendi la pipeline a monte) anche se un successivo `[BRIDGE PACING]` valido è arrivato dopo. Gli stalli sono stati, non eventi — devono essere risolti, non solo misurati.
2. **Un `[PAUSA TEAM]` / `[HARD FREEZE]` che ti sei perso**. Se ce n'è uno in coda e non hai ancora mandato `[RIPRENDI]`, il team è ancora congelato — gestiscilo con `sentinel-orders` *prima* dell'ultimo pacing.

Per il caso routinario (una o più righe `[BRIDGE PACING]`):
- leggi ogni riga per mantenere il contesto temporale (puoi vedere come il trend si è evoluto mentre eri occupato)
- apri la skill `bridge-pacing` una volta e applica solo la calibrazione dell'**ultimo** verdetto

## Altri comandi (debug / ispezione)

```bash
python3 /app/shared/skills/bridge_mailbox.py status   # quanti pendenti vs totali
python3 /app/shared/skills/bridge_mailbox.py peek     # leggi senza consumare
```

Usa `peek` quando sospetti qualcosa di strano e vuoi guardare senza impegnarti — NON marca le voci come lette.

## Anti-pattern

- ❌ Saltare lo svuotamento "perché il turno sembra breve" — i fallimenti rc=3 sono imprevedibili; un tick mancato durante un turno lungo è il caso tipico.
- ❌ Agire su ogni riga svuotata in sequenza — rigiocheresti cambi di throttle obsoleti, combatteresti le tue stesse calibrazioni passate, e faresti oscillare il team.
- ❌ Eseguire `drain` a metà turno solo per "vedere cosa è arrivato" — drain consuma; se non sei pronto ad agire sulle righe, usa `peek` invece.
- ❌ Trattare l'output di `peek` come autorevole — `peek` mostra le voci pendenti, ma il pannello tmux live potrebbe già contenerne di più recenti che il JSONL non ha ancora raggiunto. Lo svuotamento a inizio turno è ciò che ti dà il quadro coerente.

## Vedi anche

- `sentinel-orders` — instrada `[PAUSA TEAM]` / `[HARD FREEZE]` / `[RIPRENDI]` una volta svuotati.
- `bridge-pacing` — formula da applicare sull'ultima riga `[BRIDGE PACING]`.
- `pipeline-triage` — playbook per `PIPELINE STALLED` (riaccendi pipeline a monte).
