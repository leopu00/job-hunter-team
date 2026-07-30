<!-- @translation: it, ai-translated 2026-07-30 -->
---
name: throttle-ack
description: Firma il tuo risveglio. SEMPRE il PRIMO comando di ogni risveglio, prima di qualunque altra cosa, ogni volta che ricevi un messaggio `[RIPRENDI]` dopo una pausa di throttle. `throttle-ack <tuo-nome>` flippa il tuo flag da NOTIFIED a ACTIVE. Solo tu puoi farlo - il motore non può - ed è proprio per questo che un flag rimasto su NOTIFIED è la prova che un agente ha ricevuto la sveglia e non ha risposto, e per questo il watchdog ci scala sopra. Saltarlo fa sembrare bloccato un agente in perfetta salute.
allowed-tools: Bash(throttle-ack *), Bash(python3 /app/shared/skills/throttle_engine.py *)
---

# throttle-ack — firma il risveglio, poi torna al lavoro

```bash
throttle-ack <tuo-nome>
```

Primo comando di ogni risveglio. Poi torna **subito al tuo loop** — l'ack è una
firma, non un report.

## Perché lo fai tu e non il motore

Il motore dei throttle scrive due dei tre stati: `IN_THROTTLE` quando registri
una pausa, `NOTIFIED` quando ti ha mandato la sveglia via tmux. L'ultimo
passaggio, `NOTIFIED → ACTIVE`, è **solo tuo**.

Quell'asimmetria è tutto il punto. Ogni watchdog di questo sistema condivide un
punto cieco: guardando un pane tmux, `idle` e `bloccato` sono indistinguibili.
Con la tua firma smettono di esserlo:

| flag | significato | anomalia se dura |
|---|---|---|
| `IN_THROTTLE` | attesa legittima | no — il motore sa quanto |
| `NOTIFIED` | sveglia inviata, ack atteso | **sì → escalation dopo N min** |
| `ACTIVE` | stai lavorando | si valuta col tuo output sul DB |

Un flag fermo su `NOTIFIED` non è «forse idle»: la sveglia è arrivata e nessuno
ha risposto. È una misura, non un'ipotesi, e il watchdog la scala al Capitano.

## Le regole

- **Primo comando, sempre.** Prima di leggere la coda, prima di ogni tool, prima
  di rispondere a chiunque.
- **Poi lavora subito.** Firmare e restare fermo produce un falso «coda vuota»
  che inganna il Capitano e il pacing. Un risveglio è un segnale per *lavorare*.
- **Non usarlo per chiudere una pausa in anticipo.** Un ack mandato mentre il tuo
  timer sta ancora girando viene rifiutato (exit 1): se potessi chiudere il flag
  quando vuoi, il throttle tornerebbe a essere una cosa che decidi tu.
- Non hai bisogno di sapere quanto hai dormito, e il comando non te lo dice.

## Exit codes

- `0` — flag su `ACTIVE` (idempotente: firmare due volte è innocuo)
- `1` — ack **rifiutato** perché la tua pausa non è finita: chiudi il turno, il
  motore ti sveglia. Oppure argomenti invalidi / motore assente.

## Esempio

```
[DA @SISTEMA A @SCOUT-1] [RIPRENDI] La tua pausa è finita. PRIMO comando: `throttle-ack scout-1`...
```

```bash
throttle-ack scout-1
# THROTTLE_ACK agent=scout-1 NOTIFIED→ACTIVE
```

...e la cosa immediatamente successiva che fai è la tua prossima unità di lavoro.
