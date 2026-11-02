---
name: scout-coverage
description: "Cerca i portali nazionali core delle lingue del profilo PRIMA di qualunque fonte minore, e sappi quanto del piano è fatto. `next` indica il portale, il paese da registrare e il tipo di query da fare; un portale è coperto con 3 passate e 3 query diverse, e «esausto» richiede i portali core coperti. Lancia `next` all'inizio di ogni ricerca."
allowed-tools: Bash(python3 /app/shared/skills/scout_coverage.py *) Bash(python3 /app/shared/skills/scout_pass_log.py *)
---

# scout-coverage — dove cercare prima, e quanto è fatto

Cerca PRIMA dove stanno i mercati del profilo e sappi quanto ne è fatto. Una prova reale ha interrogato 105 fonti una volta ciascuna e non ha mai aperto i portali nazionali principali della lingua dell'utente: «esausto» è stato dichiarato col mercato di casa intatto. Questa skill dà l'elenco (portali nazionali di ogni lingua che il profilo parla, prima i core, poi quelli English-first e remote) e il contatore sul tuo registro delle passate.

## 1. Chiedi cosa viene dopo, a ogni ricerca

`next` stampa una riga JSON: il portale (`source`, `country`, `tier`), il TIPO di query (`query_kind`: `role_language` = il titolo nella lingua del portale, `role` = il titolo in inglese, `synonym` = un titolo vicino, `level` = il titolo con una parola di livello della lingua, elencate in `level_terms`, `city` = il titolo con un luogo, elencati in `cities`), cosa hai (`have`) contro cosa serve (`need`) e la riga `log` da usare dopo. Cerca esattamente quello, poi registra la passata con lo stesso `--query-kind`. `plan_done: true` vuol dire piano finito: passa alle altre fonti.

```bash
# the next thing to search: portal, country to log, kind of query, and the line to log it with
python3 /app/shared/skills/scout_coverage.py next

# the whole plan for this profile (once), and how much of it is done (any time)
python3 /app/shared/skills/scout_coverage.py plan
python3 /app/shared/skills/scout_coverage.py status

# after the search: the same portal, country and kind that `next` named
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --query-kind role_language --query "<the query you ran>" --returned 12
# a portal that answers 403 / a login wall / a challenge (closed) or 410 (gone): ONE pass closes it
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --returned 0 --status closed
```

## Regole

- Prima i core, poi i minori: nessuna fonte minore finché `next` nomina un portale core.
- Un portale è COPERTO con 3 passate e 3 query DIVERSE (una nella lingua del portale se non è l'inglese). La stessa query tre volte conta una volta: cambia il tipo, non le parole.
- Un portale che risponde 403, 410, un muro di login o una challenge è CHIUSO con UNA passata registrata `--status closed` (o `gone` per il 410): dillo e passa oltre, non insistere.
- `exhausted` (`scout_exhaustion.py check`) richiede i portali core coperti oltre a fonti, query e minuti: `core_missing` dice dove devi ancora andare.
- Del profilo non si scrive mai niente: il registro ha slug, codici paese, tipi e conteggi.
