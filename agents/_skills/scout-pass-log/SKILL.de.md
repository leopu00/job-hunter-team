---
name: scout-pass-log
description: "Miss deine Suchen, damit das Team erkennt, ob eine Quelle erschöpft ist oder die Suche schlecht. Nach jeder Suche in einer Quelle: wie viele Kandidaten kamen zurück; wenn ein Kandidat die Gates verlässt: wo er geendet ist. Zwei kurze Befehle, geschlossenes Vokabular, nie Freitext."
allowed-tools: Bash(python3 /app/shared/skills/scout_pass_log.py *)
---
<!-- @translation: de, ai-translated 2026-11-02 -->

# scout-pass-log — messen, was deine Suchen liefern

Von außen kann niemand sagen, ob die Quellen eines Profils erschöpft sind oder der Scout schlecht sucht: Ein Kandidat, der vor dem INSERT ausgeschieden ist (toter Link, ein Filter, eine im Inserat gesehene Sprache), hinterließ keine Spur. Diese zwei Befehle hinterlassen je eine kurze Zeile. Sie kosten nichts und halten deine Arbeit nie auf.

## Wann

- **Nach jeder Suche in einer Quelle** (eine Kandidatenliste kam zurück): der Befehl `pass`.
- **Wenn ein Kandidat die Gates verlässt** (eingefügt, oder verworfen und warum): der Befehl `candidate`. Mit `--opened`, wenn du die vollständige JD geholt hast (der teure Schritt).

## Befehle

```bash
python3 /app/shared/skills/scout_pass_log.py pass --source greenhouse --country nl --returned 25 \
    --query-kind role --query "<the query you searched>"
python3 /app/shared/skills/scout_pass_log.py candidate --source greenhouse --country nl --outcome language --opened
python3 /app/shared/skills/scout_pass_log.py candidate --source greenhouse --country nl --outcome inserted --opened
```

## Geschlossenes Vokabular

`--source`: derselbe Slug wie bei `--source` des INSERT (`linkedin`, `greenhouse`, ...). `--country`: zwei Buchstaben (`nl`) oder `multi` / `remote`. `--query-kind`: `role` · `role_language` · `broad` · `synonym` · `level` · `city` · `company` · `generic` · `other`. `--outcome`: `inserted` · `duplicate` · `dead_link` · `closed_ad` · `seniority` · `work_auth` · `domain` · `experience` · `language` · `role` · `area` · `other`.

## Regeln

- Freitext wird abgelehnt (Exit 2, nichts geschrieben): nie einen Titel, eine Firma, einen Namen oder etwas aus dem Profil in ein Feld schreiben. Die gesuchte Query kommt nur in `--query`, um zu einem Hash zu werden; ihr Text wird nie gespeichert.
- Bei einer Ablehnung den Wert korrigieren und erneut aufrufen. Nie deshalb die Suche oder den Kandidaten überspringen.
- `language` ist das Ergebnis für einen Kandidaten, den du verwirfst, weil das Inserat eine Sprache verlangt, die der Nutzer nicht spricht, ob in der Liste oder in der JD gesehen.
- Ein Aufruf pro Suche und einer pro Kandidat, möglichst im selben Shell-Aufruf wie das Gate, das entschieden hat.
- Jede Anzeige, die du nach dem Lesen einer Liste lokal verwirfst, bekommt ihren Grund im Log, nie Schweigen: Titel außerhalb der Rollen des Profils → `role`, Ort außerhalb seiner Gebiete → `area`, dazu die übrigen (`seniority`, `language`, `experience`, `domain`, `work_auth`). Für viele Anzeigen mit demselben Grund NICHT einmal pro Anzeige aufrufen: `candidate --source S --country CC --outcome role --count 640` ist EINE Zeile für 640 (1 bis 100000; nie mit `inserted` und nie mit `--opened`, das ist je eine Zeile). Ein Portal, das mit 403, einer Login-Wand oder 410 antwortet: `pass ... --returned 0 --status closed` (`gone` bei 410, `empty` bei leerer Liste). Die Report-Spalte `unexpl` ist, was das Portal geliefert hat und niemand erklärt hat: sie muss auf 0 kommen.
