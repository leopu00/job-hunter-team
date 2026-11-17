---
name: recheck-batch
description: Getakteter Recheck des PFLEGE-MODUS zu minimalen Kosten. Das Skript erledigt die mechanische Arbeit an einem Batch (gestufte Prüfung jeder URL, aktualisiert last_checked für die verifizierten OPEN); du beurteilst NUR die mehrdeutigen Fälle. Gemessen 78-86kT pro Position mit der manuellen Runde — mit dem Batch verbrauchst du einen Turn für 10 Positionen, nicht 10 Turns. Der Ausschluss bleibt IMMER deine Entscheidung, niemals die des Skripts.
allowed-tools: Bash(python3 /app/shared/skills/recheck_batch.py *), Bash(python3 /app/shared/skills/db_update.py *), Bash(python3 /app/shared/skills/recheck_liveness.py *)
---

# recheck-batch — der Recheck des Pflege-Modus, ohne einen Turn pro Position zu verschwenden

## Warum es ihn gibt
Eine BEREITS analysierte Position erneut zu prüfen kostet nur einen Bruchteil
der Prüfung einer neuen Position: keine erneute Analyse, kein erneutes Lesen
der JD, keine Metadaten. Die manuelle Runde (Queue → eine Position →
recheck-liveness → db_update → wiederholen) kostete 78-86kT pro Position,
weil jeder Schritt ein LLM-Turn war. Dieser Batch fasst den gesamten
mechanischen Teil in EINEM Befehl zusammen.

## Verwendung (EIN Turn pro Batch)
```sh
python3 /app/shared/skills/recheck_batch.py            # batch di 10 dalla coda
python3 /app/shared/skills/recheck_batch.py --limit 5
```
Er nimmt die Positionen aus der Queue `next-for-recheck-due` (lebendig, Score
≥ Policy, seit > 14 Tagen nicht verifiziert, SCORE DESC: die besten zuerst)
und führt für jede die gestufte Prüfung von `recheck_liveness.py` aus (curl →
Browser, niemals fälschlich offen).

Der Bericht hat drei Ergebnisse:
- **OK offen und aktualisiert** — verifiziert `OPEN`: `last_checked` ist
  bereits aktualisiert, sie verlassen die Queue für 14 Tage. **Nicht
  anfassen, nicht erneut lesen, null Arbeit für dich.**
- **ZU BEURTEILEN** — Hinweis auf Schließung (404/410, closed-marker oder
  abgelaufenes `expires_at`). Hier kommst DU ins Spiel.
- **NICHT VERIFIZIERBAR** — JS-/Authwall-Host und Browser ohne eindeutiges
  Ergebnis. Hier kommst DU ins Spiel (one-shot).

## Das Urteil liegt bei dir — das Skript schließt NIEMALS aus (Anweisung des Nutzers 2026-07-30)
Ein statisches Skript kann sich irren und eine noch lebendige Position
wegwerfen. Für jede Position **ZU BEURTEILEN**: Sieh dir den gemeldeten
Hinweis an; falls nötig, EIN einziger direkter Blick auf die Seite. Wenn du
dir zu 100 % sicher bist, dass sie abgelaufen/geschlossen ist:
```sh
python3 /app/shared/skills/db_update.py position <ID> --status excluded \
  --is-open false --last-open-check now --notes "[SCADUTO] <evidenza>"
```
Ist sie dagegen noch lebendig (ein Fehlalarm des Skripts):
```sh
python3 /app/shared/skills/db_update.py position <ID> --is-open true --last-checked now
```
Für jede **NICHT VERIFIZIERBARE**: one-shot mit dem Browser auf die URL;
dann wie oben entscheiden. Bleibt sie nicht verifizierbar →
`--last-checked now` + Notiz `[OPEN_UNVERIFIED]`, `is_open` unverändert
(niemals als offen ausgeben).

## Kostendisziplin (der Sinn des Skills)
- **Ein Batch = ein Turn.** Keine Runde pro Position, keine erneute Analyse,
  JD oder Firma nicht erneut lesen: Der Recheck entscheidet nur „noch offen?“.
- Begrenzter Batch (Standard 10): das Limit NICHT erhöhen, um „die Queue auf
  einen Schlag abzuarbeiten“ — der Takt verteilt die Arbeit, der Capitano
  gibt das Tempo vor (C-09/C-18).
- Queue OFF durch enrichment-policy = gewollter Zustand: anhalten, nicht
  umgehen.
