---
name: cv-disk-audit
description: Healthcheck periodico (Dottore) per riconciliare CV su disk e cv_pdf_path nel DB. Identifica orfani (file su disk senza riga DB) e ghost (riga DB con cv_pdf_path che punta a file inesistente). Notifica il Capitano sui mismatch così l'utente non perde top PASS invisibili e non vede "CV da scrivere" per CV già scritti.
allowed-tools: Bash(python3 *), Bash(find *), Bash(stat *), Bash(jht-tmux-send *)
---

# cv-disk-audit — riconciliazione disk↔DB sui CV

Bug #26 ha mostrato il pattern: lo Scrittore genera il PDF, viene
killato (EMERGENZA freeze 2026-05-17 04:43) prima dell'UPDATE DB. Il
file resta su `/jht_user/cv/`, ma `applications.cv_pdf_path` resta NULL.
Sisal 7.5/10 (top PASS della finestra) era diventato *"CV da scrivere"*
sulla dashboard utente — invisibile.

Il fix preventivo (atomic write in `cv-structure` skill) impedisce
nuovi orfani. Questa audit ricuce quelli già esistenti e cattura ogni
nuova divergenza che dovesse comparire (es. utente sposta a mano un
PDF, watchdog uccide il Writer durante il rename).

## Quando lanciarla

Trigger Dottore (end-of-round, fuori budget critico):
- Sempre nel primo giro dopo un EMERGENZA / kill di uno Scrittore.
- Altrimenti ~ogni 4 giri Dottore (≈2h, dato il giro 30 min).

Il Dottore esegue questa skill DOPO `liveness-check` e PRIMA di
`cache-prune` — l'audit è informativo, non distruttivo.

## Procedura

```bash
# 1. Snapshot disk
DISK_PDFS=$(find /jht_user/cv -maxdepth 1 -type f -name '*.pdf' 2>/dev/null | sort)

# 2. Snapshot DB (cv_pdf_path != NULL)
DB_PDFS=$(python3 /app/shared/skills/db_query.py cv-pdf-paths 2>/dev/null | sort)

# 3. Diff
ORFANI=$(comm -23 <(echo "$DISK_PDFS") <(echo "$DB_PDFS"))     # disk ma non DB
GHOST=$(comm -13 <(echo "$DISK_PDFS") <(echo "$DB_PDFS"))      # DB ma non disk

# 4. Report al Capitano (deterministico, niente LLM)
if [ -n "$ORFANI$GHOST" ]; then
  msg="[@dottore -> @capitano] [REPORT] CV audit mismatch — "
  msg="${msg}orfani=$(echo "$ORFANI" | grep -c .) "
  msg="${msg}ghost=$(echo "$GHOST" | grep -c .)"
  jht-tmux-send CAPITANO "$msg"
  # Log dettagli
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "{\"ts\":\"$ts\",\"orfani\":$(echo "$ORFANI" | jq -R . | jq -s .),\"ghost\":$(echo "$GHOST" | jq -R . | jq -s .)}" \
    >> /jht_home/logs/cv-disk-audit.jsonl
fi
```

`db_query.py cv-pdf-paths` (da implementare): scrive 1 path per riga di
tutte le applications con `cv_pdf_path IS NOT NULL`. Una linea
script-friendly per il `comm`.

## Cosa fa il Capitano col report

Riceve `[REPORT] CV audit mismatch — orfani=2 ghost=0`. Apre
`/jht_home/logs/cv-disk-audit.jsonl`, legge gli orfani, e per ciascuno
prova il match euristico:

1. `CV_<Candidato>_<position_id>_<...>.pdf` — naming nuovo bug #25 →
   estrae `position_id`, fa `db_update.py application <pid> --cv-pdf-path <path>`.
2. `CV_<Candidato>_<Company>.pdf` — naming vecchio → cerca application
   draft di quella company senza cv_pdf_path. Se ne trova una sola →
   ricollega. Se ne trova più di una → segnala all'utente (Sisal vs
   Leadtech vs Company 033: caso ambiguo del 2026-05-17).

Il Capitano NON cancella file (mai). Sposta in `/jht_user/cv/_orphan/`
se vuole archiviare senza perdere.

## Anti-patterns

- ❌ Auto-ricollegare un orfano con `cv_pdf_path` quando ci sono più
  application draft per la stessa azienda — ambiguità, lascia decidere
  l'utente.
- ❌ Cancellare un orfano: i CV sono spesa cognitiva alta, archivia
  sempre invece di `rm`.
- ❌ Eseguire l'audit dentro EMERGENZA: il Dottore deve girare solo
  end-of-round in regime normale.

## See also

- `cv-structure` § PDF generation (W-03 atomic write, bug #26)
- `application-flow` Step 6 (naming con position_id, bug #25)
- `db-update` § Single-writer gate (bug #21)
- `liveness-check` (eseguita prima nello stesso giro Dottore)
