<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: mentor-patterns
description: Die sechs Muster, nach denen der Mentor in den Aufzeichnungen sucht, um zu entscheiden WANN er spricht. Stille ist der Standard; nur ein echtes, wiederkehrendes Muster verdient ein Wort. Dieser Skill gibt die kanonische Erkennungsmethode für jedes Muster (DB-Abfrage + Schwelle), damit der Mentor nie von einem einzelnen Datenpunkt aus spricht. Nur lesend — schreibt nie in die DB. Zuständig: Mentor.
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/feedback_query.py *), Bash(grep *), Bash(awk *)
---

# mentor-patterns — was die Aufzeichnungen verraten

Der Mentor beobachtet Mengen, nicht einzelne Punkte. Sechs Muster sind es wert, darüber zu sprechen; alles andere ist Rauschen.

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

## Muster F — Wiederkehrende Gründe in den Worten des Nutzers

Im Web beurteilt der Nutzer Positionen (wenig interessant / interessant / sehr interessant, dazu "ausschließen") und kann **warum** schreiben, als Freitext: `reason` (≤ 500 Zeichen) und `comment` (≤ 2000). Dieser Text ist der einzige Ort, an dem er mit eigenen Worten sagt, was er will. Position für Position gelesen ist es eine Anekdote; zusammengezählt ist es eine Tatsache. Zehnmal "zu senior" sind nicht zehn Meinungen über zehn Anzeigen — es ist ein einziger Satz über die Suche.

Der Unterschied zu Muster B ist wichtig: dort sind es die Ausschlüsse der **Agenten** (`ESCLUSA: [TAG]` in `positions.notes`), hier ist es das Urteil des **Nutzers**. Zwei verschiedene Ströme; wenn sie übereinstimmen, siehe den Abschnitt zur Gegenprüfung.

Dieses Feedback lebt in der Cloud (`position_feedback`), nicht in `jobs.db`: es ist das einzige Muster, das nicht über `db_query.py` läuft.

**`RAW_DISPLAY_BOUNDARY`** — clustere rohe `reason` / `comment`, aber gib sie niemals weiter. Jede user-facing Deutung darf nur `display_reason` / `display_comment` und sanitizte Themen-`label` / `examples` verwenden; Maschinenschlüssel, IDs und `no-signal:*`-notes bleiben intern.

### Erkennung

```bash
# Die Themen in den vom Nutzer geschriebenen Gründen, letzte 30 Tage
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3

# Dasselbe Feedback unaggregiert; nur display_reason/display_comment lesen
python3 /app/shared/skills/feedback_query.py recent --days 30
```

`themes` gruppiert Freitext nach einfacher Ähnlichkeit — keine exakte Übereinstimmung nötig. Kleinschreibung, Akzente weg, Interpunktion und Funktionswörter weg, jedes Wort auf die ersten 5 Zeichen gekürzt (`senior` / `seniority` / `seniore` / `séniorité` landen auf demselben Schlüssel), dann werden Einzelwörter und benachbarte Paare nach **verschiedenen Positionen** gezählt. Ein Paar gewinnt gegen seine Teile, wenn es dieselben Positionen abdeckt: "zu senior" sagt mehr als "senior", und genau dafür bleiben Verstärkungswörter erhalten.

Pro Thema kommen zurück: `positions`, `events`, `share` (Anteil der Positionen mit Text), `actions` (wie sich das Thema auf like / dislike / hide / star verteilt), interne `legacy_ids` und bis zu 3 sanitizte Display-`examples`.

Es ist grob gebaut, und man sieht es: entfernte Synonyme bleiben getrennt (`Gehalt` und `RAL` sind zwei Themen). Lies die `examples` und verbinde mit dem Kopf, was das Werkzeug nicht konnte.

Trägt der Payload eine geschlossene `note`-Enum (`no-signal:*`), gibt es kein Aggregat: schweige, gib den Code nie weiter und baue das Bild nicht aus Einzelabfragen mit `check` wieder zusammen.

### Schwelle

Sprich nur, wenn **alle drei** zutreffen:

- **≥ 8 Feedback-Events tragen Text** (`events_with_text`). Einen Grund zu schreiben kostet den Nutzer Mühe, dieses Volumen liegt also eine Größenordnung unter jedem maschinell erzeugten Zählwert — unter 8 sagt ein Prozentsatz aber nichts (bei 3 Texten ist ein Thema schon ein Drittel).
- Das Thema deckt **≥ 4 verschiedene Positionen** ab (`positions`, nie `events`: dieselbe Anzeige zweimal zu beurteilen bleibt eine Meinung, und Events zu zählen ließe eine hartnäckige Anzeige wie einen Trend aussehen).
- Der **`share` des Themas ist ≥ 0,30**. Freitext verteilt denselben echten Einwand über Synonyme, die Dominanz ist also bauartbedingt verdünnt; Muster B darf 40% verlangen, weil seine Tags ein geschlossenes Vokabular sind. Bei kleinem Volumen bindet die 4-Positionen-Regel, bei großem der Anteil — so ist es gemeint.

Darunter: nichts sagen. Ein "zu senior" ist eine Bemerkung zu einer Anzeige.

### Deutung

Das Thema sagt, wo man hinschauen muss; die Aufzeichnungen sagen, ob es ein Problem ist.

| Themenfamilie (Beispiele)                        | Worauf es zeigt                                                          |
|--------------------------------------------------|--------------------------------------------------------------------------|
| Seniorität ("zu senior", "zu junior")            | Die in `seniority_target` erklärte Stufe vs. wie der Markt sie nennt      |
| Stack ("Legacy-Java", "kein PHP")                | `skills.primary` — erklärter und gewünschter Stack driften auseinander (mit A gegenprüfen) |
| Vergütung ("Gehalt zu niedrig", "keine Spanne")  | Gehaltserwartung vs. ausgeschriebene Spannen (mit C `salary_fit` gegenprüfen) |
| Ort ("vor Ort", "zu weit", "kein Remote")        | `work_mode` / `relocation` (mit C `remote_fit` gegenprüfen)               |
| Firma / Branche ("Agentur", "Beratung")          | Eine Präferenz, die nie ins Profil geschrieben wurde                      |
| Die Anzeige selbst ("vage", "keine Infos")       | Anzeigenqualität, nicht Passung — nur eine Zeile wert, wenn sie dominiert, und als Rauschen, nicht als Hebel |

**Der Befund, der einen Satz wert ist, ist der Widerspruch.** Kreuze die `legacy_ids` des Themas mit ihren Scores (`db_query.py scores`). Wenn der Nutzer weiterhin Positionen ablehnt, die der Scorer über 70 gesetzt hat, ist der Score nicht kaputt — er misst treu die Passung zu einem **Profil, das nicht mehr beschreibt, was der Nutzer will**. Das Profil ist für dich nur lesbar (T10): du nennst die Zahl und stellst die Frage, entscheiden tut er.

### Beispielausgabe

> *"<Name>, in den letzten dreißig Tagen hast du bei neunzehn Positionen einen Grund geschrieben. Bei sieben davon — mehr als ein Drittel — waren es dieselben Worte: **zu senior**. Fünf dieser sieben hatte der Scorer über 70 gesetzt: er las dein Profil, das immer noch ein Senior-Ziel angibt. Hat sich das Ziel verschoben, oder waren diese sieben einfach schlecht geschriebene Anzeigen?"*

## Muster-Gegenprüfung

Muster verstärken sich gegenseitig. Starkes Signal:
- **A + C** (Skill-Lücke + niedrige Komponente bei `stack_match`) → fast sicher sprechenswert.
- **B `[SENIORITY]` + C `experience_fit`** → Senioritäts-Fehlausrichtung, einmal erwähnen.
- **D abgelehnte Cluster + E critic_score < 5** → CV-Problem, als Muster E eskalieren.
- **F + B zum selben Thema** (der Nutzer lehnt wegen Seniorität ab UND die Agenten schließen mit `[SENIORITY]` aus) → das Problem ist die erklärte Stufe, nicht der Markt. Das stärkste Signal überhaupt, weil es aus zwei unabhängigen Strömen kommt.
- **F + C am selben Hebel** (`salary_fit` / `remote_fit`) → Score-Modell und Nutzer zeigen auf dieselbe Reibung. Ein Satz, nicht zwei.
- **F gegen hohe Scores** → Profil-Drift, siehe Deutung von Muster F.

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
- ❌ **Muster F in eine Suchanweisung verwandeln.** Gib dem Scout oder dem Capitano niemals ein "hör auf, X zu bringen", das aus den Vorlieben des Nutzers abgeleitet ist. Eine Pipeline, die nur fischt, was gefällt, bläht ihre eigenen Scores auf, und der Nutzer glaubt am Ende, der Markt sei reich, obwohl die Pipeline für ihn ausgewählt hat. Muster F richtet sich **an den Nutzer**: was sich in seinem Profil ändert, entscheidet er, und du bist ohnehin nur lesend (T10).
- ❌ Ein zurückgezogenes Urteil vorhalten. `themes` lässt Positionen, deren letztes Event `clear` ist, bereits draußen; hol sie nicht mit `--include-cleared` zurück, nur um eine Schwelle zu erreichen.
- ❌ Einen einzelnen rohen Kommentar zitieren, als wäre er ein Muster. Sanitizte `examples` geben einem Thema eine Stimme, **nachdem** es die Schwelle überschritten hat; sie sind nicht der Befund.

## Siehe auch

- `mentor-output` — WIE die Nachricht formuliert wird, sobald ein Muster bestätigt ist.
- `db-query` — Wrapper-Interna.
- `feedback-query` — der Leser für das Nutzer-Feedback in der Cloud (Muster F); der Scorer fragt dieselbe Quelle Position für Position ab.
- `agents/mentor/mentor.md` — Orchestrator-Prompt + Kadenz.
- `agents/_team/team-rules.md` T10 — Profil ist nur lesend, auch für den Mentor.
