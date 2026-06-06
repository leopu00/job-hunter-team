<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: mentor-patterns
description: Die fünf Muster, nach denen der Mentor in den Aufzeichnungen sucht, um zu entscheiden WANN er spricht. Stille ist der Standard; nur ein echtes, wiederkehrendes Muster verdient ein Wort. Dieser Skill gibt die kanonische Erkennungsmethode für jedes Muster (DB-Abfrage + Schwelle), damit der Mentor nie von einem einzelnen Datenpunkt aus spricht. Nur lesend — schreibt nie in die DB. Zuständig: Mentor.
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(grep *), Bash(awk *)
---

# mentor-patterns — was die Aufzeichnungen verraten

Der Mentor beobachtet Mengen, nicht einzelne Punkte. Fünf Muster sind es wert, darüber zu sprechen; alles andere ist Rauschen.

## Muster A — Skill-Lücke zwischen Profil und Markt

Skills, die wiederholt in JD-Anforderungen auftauchen, aber in `candidate_profile.yml > skills` fehlen. Wenn sie auch in **hochbewerteten** Positionen auftauchen, ist die Lücke **kostspielig** (das Schließen würde Einreichungen ermöglichen, nicht Rauschen).

### Erkennung

```bash
# 1. Die letzten 30 Positionen mit ihren Anforderungen + Score abrufen
python3 /app/shared/skills/db_query.py positions --limit 30 \
    --status scored,checked --order-by created_at:desc

# 2. Anforderungen tokenisieren, mit profile.skills.primary + .secondary vergleichen
# 3. Tokens zählen, die NICHT im Profil sind und in N Positionen vorkommen
```

### Schwelle

Nur sprechen, wenn ein fehlender Skill in **≥ 5 Positionen der letzten 30** erscheint UND **≥ 1 davon Score ≥ 65** hat (in Reichweite des Einreichungs-Gates).

### Beispielausgabe

> *"<Name>, ich habe gezählt. **Docker** erscheint in zwölf der letzten dreißig Positionen in den Aufzeichnungen. Neun davon haben einen Score zwischen 65 und 78 — in Reichweite des Einreichungs-Gates, es nie überschreitend. Ein Handwerk trennt dich von einem Drittel des Weges vor dir."*

## Muster B — Wiederkehrende Ausschlüsse

Zählung von `ESCLUSA: [TAG]`-Markierungen in `positions.notes` über die letzten 30 Tage. Wenn ein Tag dominiert, ist die Suchrichtung fehlausgerichtet.

### Erkennung

```bash
python3 /app/shared/skills/db_query.py positions --status excluded --limit 50 \
    --order-by last_checked:desc \
    | grep -oE 'ESCLUSA: \[(SENIORITY|STACK|GEO|LINGUA|LINK_MORTO|SCAM)\]' \
    | sort | uniq -c | sort -rn
```

### Schwelle

Nur sprechen, wenn **ein Tag ≥ 40% der Ausschlüsse ausmacht** UND Gesamtausschlüsse ≥ 20 in den letzten 30 Tagen.

### Interpretation

| Dominanter Tag  | Wahrscheinliche Ursache                                          | Vorgeschlagener Schritt                          |
|-----------------|----------------------------------------------------------|------------------------------------------|
| `[SENIORITY]`   | Zu hoch (oder zu niedrig) für das Level des Kandidaten angesetzt | `seniority_target` im Profil anpassen    |
| `[LINGUA]`      | Eine einzige Sprache schließt ganze Märkte aus           | Sprache hinzufügen oder geografischen Scope verkleinern |
| `[GEO]`         | `work_mode` / `relocation` nicht im Einklang mit der Suche | Präferenzen mit dem Nutzer neu besprechen |
| `[STACK]`       | Rauschen durch angrenzende Stacks erreicht das Team      | Scout-Filter über den Capitano verschärfen |
| `[LINK_MORTO]` (>40%) | Quellenqualitätsproblem, nicht Kandidatenproblem   | An den Capitano weiterleiten, das ist ein Scout-Problem |

## Muster C — Niedrigscore "Parkband" (40-49)

Das reichhaltigste Signal: Positionen im Parkband sind **Fast-Treffer**. Eine Score-Komponente hält sie zurück. Diese Komponente ist der **Hebel**.

### Erkennung

```bash
# Alle 40-49 Positionen mit ihrer Score-Aufschlüsselung abrufen
python3 /app/shared/skills/db_query.py scores \
    --min-total 40 --max-total 49 --limit 30
```

Für jede die **niedrigste einzelne Komponente** identifizieren (`stack_match` / `experience_fit` / `remote_fit` / `salary_fit` / `strategic_fit`). Aggregieren: welche Komponente ist der Hebel für die meisten Positionen?

### Schwelle

Nur sprechen, wenn **≥ 5 Positionen im Parkband dieselbe niedrige Komponente teilen** UND diese Komponente < 50% ihres Gewichtslimits ist.

### Interpretation

| Hebel-Komponente  | Was es bedeutet                                                       |
|-------------------|-----------------------------------------------------------------------|
| `stack_match`     | Skill-Lücke (Gegenprüfung mit Muster A)                              |
| `experience_fit`  | Senioritäts-Mismatch (Gegenprüfung mit Muster B `[SENIORITY]`)       |
| `salary_fit`      | Gehaltsvorstellung des Kandidaten driftet vom Markt ab                |
| `remote_fit`      | Geografische Präferenzen zu eng                                       |
| `strategic_fit`   | Stack/Sektor-Bonus erodiert — die Nische verblasst oder war noch nicht stark |

## Muster D — Post-Einreichungs-Feedback

Wenn `applications.applied = true`, tragen die Ergebnis-Trichter die Wahrheit.

### Erkennung

```bash
# Eingereichte Bewerbungen in den letzten 60 Tagen
python3 /app/shared/skills/db_query.py applications --applied true \
    --order-by applied_at:desc --limit 30
```

Nach `response` gruppieren: `interview` / `rejected` / `ghosted` / `null` (noch keine Antwort). Berechne:
- Interview-Rate = Interviews / eingereicht
- Ablehnungsrate = abgelehnt / eingereicht
- Ghost-Rate = geghostet (`now - applied_at > 30d` UND keine Antwort) / eingereicht

### Schwelle

Nur bei **≥ 10 eingereichten Bewerbungen** im Fenster sprechen (sonst Stichprobe zu klein).

### Interpretation

| Beobachtetes Muster                                    | Schritt                                                                  |
|-------------------------------------------------|-----------------------------------------------------------------------|
| Ablehnungen teilen Firmenart / Senioritätslücke | Suche neu ausrichten (Skill-Lücke oder Senioritätslücke, siehe Muster A/B) |
| Ghosting > 60% ohne spezifisches Cluster        | CV sticht nicht heraus ODER Markt übersättigt → CV mit Critic reviewen / aggressive Einreichungen pausieren |
| Interviews existieren → suchen was sie gemeinsam haben | **Gold**: die JD-Form, Firmengröße, den Stack replizieren         |

## Muster E — Review-Urteil-Trends

Wenn der Critic CVs ablehnt, die nichts Konkretes haben, worauf sie stehen können. Der `critic_score` des Critic lebt in `applications` nach der 3-Runden-Schleife.

### Erkennung

```bash
python3 /app/shared/skills/db_query.py applications \
    --critic-score-max 5 --order-by written_at:desc --limit 20
```

Die `critic_notes` nach wiederkehrendem Fehlermodus clustern (z.B. "no metrics", "stack mismatch", "About too generic").

### Schwelle

Nur sprechen, wenn **≥ 5 aktuelle CVs Score < 6** haben UND dieselbe Art von Bemerkung in ≥ 3 davon erscheint.

### Interpretation

Ein wiederkehrender `critic_score < 5` mit ähnlichen Notizen bedeutet NICHT "der Writer ist schlecht" — es bedeutet **das Profil sagt nicht genug**. Der Fix liegt upstream:
- About ist zu generisch → den Nutzer nach einem konkreten Karriere-Wendepunkt fragen
- Keine Metriken → den Nutzer nach Zahlen befragen (Food Cost %, Latenz-Reduktionen, Mitarbeiteranzahl, eingesparte Stunden)
- Stack-Mismatch → `skills.primary` gegen tatsächliche JD-Anforderungen neu prüfen

## Muster-Gegenprüfung

Muster verstärken sich gegenseitig. Starkes Signal:
- **A + C** (Skill-Lücke + niedrige Komponente bei `stack_match`) → fast sicher sprechenswert.
- **B `[SENIORITY]` + C `experience_fit`** → Senioritäts-Fehlausrichtung, einmal erwähnen.
- **D abgelehnte Cluster + E critic_score < 5** → CV-Problem, als Muster E eskalieren.

Vermeide **A allein** wenn der Skill in nur 5/30 Positionen erwähnt wird und keine hoch scort — das ist Rauschen, still bleiben.

## Kadenz-Erinnerung

Dieser Skill sagt **wie zu erkennen**. WANN zu sprechen wird vom Mentor-Prompt bestimmt:
- 🌅 Erstes Aufwachen — schneller Durchgang durch die Aufzeichnungen, eine Beobachtung wenn sie es verdient
- 🌗 Täglich — stiller Durchgang, nur sprechen wenn ein Muster die Schwelle überschreitet
- 🌕 Wöchentlich — Zusammenfassung auch wenn nichts brennt (verwende `mentor-output`-Skill, wöchentliches Format)
- 📞 Auf Anfrage — die Frage des Nutzers mit den vorhandenen Daten beantworten

Wenn du nichts Muster-würdiges zu sagen hast, **sag nichts**. Stille ist eine Antwort.

## Anti-Patterns

- ❌ Sprechen nachdem ein einzelner Treffer erkannt wurde (1 Position mit `Docker`-Anforderung) — Stichprobe zu klein, wirkt wie Herumfuchteln.
- ❌ Über die gesamte DB aggregieren (z.B. letzte 6 Monate) — alte Positionen verzerren das aktuelle Marktsignal. An den letzten 30 Tagen festhalten, es sei denn explizit Trends verglichen werden.
- ❌ Das runde `experience_years`-Feld für Muster B/C-Argumentation verwenden — ECHTE Jahre aus `candidate.experience[].years` berechnen (gleiche Regel wie der Analyst).
- ❌ Von Web-Daten sprechen ohne zuerst ein aufzeichnungs-basiertes Muster — die Aufzeichnungen sind der Trigger, das Web ist die Verifizierung (siehe `WebSearch` / `WebFetch` Bestätigungsschritt in `mentor.md`).
- ❌ Schwarzmalen ("das führt nirgendwohin") ODER Jubeln ("du schaffst das!") — beides verletzt die Stimme des Mentors. Zahlen, dann eine Frage. Siehe `mentor-output`-Skill.

## Siehe auch

- `mentor-output` — WIE die Nachricht formuliert wird, sobald ein Muster bestätigt ist.
- `db-query` — Wrapper-Interna.
- `agents/mentor/mentor.md` — Orchestrator-Prompt + Kadenz.
- `agents/_team/team-rules.md` T10 — Profil ist nur lesend, auch für den Mentor.
