<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: profile-summaries
description: Write the 4 narrative Markdown summaries under `$JHT_HOME/profile/summaries/` that complement the structured YAML. The Writers downstream NEED these — a YAML alone produces sterile CVs because it has no voice, no narrative, no positioning. Owned by the Assistente. Filenames are FIXED (the frontend ignores anything else); always written in the user's first person ("sono uno sviluppatore…"); always rewritten in full (Write, not Edit append) — these are snapshots of the present, not append-only logs.
allowed-tools: Bash(mkdir -p *)
---

# profile-summaries — die Stimme des Kandidaten auf der Festplatte

Das strukturierte YAML eignet sich hervorragend für Filter und Matches, sagt aber nichts darüber aus, *wer* der Kandidat ist. Die 4 MD-Dateien in `summaries/` tragen die Erzählung, die die Schreiber brauchen, um Lebensläufe zu erstellen, die wie eine Person klingen, nicht wie eine Checkliste.

## Die 4 Dateien (Dateinamen sind FEST)

| Datei            | UI-Titel für den Benutzer   | Was sie enthält                                                             | Längenlimit |
|------------------|----------------------------|-----------------------------------------------------------------------------|-------------|
| `about.md`       | **Wer du bist**             | Persönliche Zusammenfassung: aktuelle/angestrebte Rolle, Jahre, Branche, Alleinstellungsmerkmal | ~400 Zeichen |
| `preferences.md` | **Erzählte Präferenzen**    | Arbeitsweise, Umzugsbereitschaft, Vergütung, Arbeitszeiten, Arbeitsumfeld  | ~400 Zeichen |
| `goals.md`       | **Ziele und Traumjob**      | Was in den nächsten 1–3 Jahren gesucht wird, Traum-Kontext/Unternehmen     | ~500 Zeichen |
| `strengths.md`   | **Stärken**                 | 2–4 konkrete Qualitäten mit jeweils kurzem Beispiel                         | ~500 Zeichen |

Pfad: `$JHT_HOME/profile/summaries/<file>.md`. Erstelle das Verzeichnis, falls es fehlt:
```bash
mkdir -p "$JHT_HOME/profile/summaries"
```

Andere Dateinamen (z. B. `about-mario.md`, `goals_v2.md`) werden vom Frontend **stillschweigend ignoriert**.

## Stilregeln (bindend)

- **Einfaches Markdown**: Absätze durch Leerzeile getrennt, `**fett**` zum Hervorheben, Listen nur wenn sie die Lesbarkeit verbessern.
- **Keine Tabellen, keine `#`-Überschriften** — diese MDs leben in UI-Karten, die bereits betitelt sind.
- **Länge**: Halte das Limit ein. Keine Textwände.
- **Erste Person des Benutzers**: `"ich bin ein Entwickler…"`, `"ich bevorzuge Remote-Arbeit…"`. Niemals dritte Person (`"Mario ist…"`).
- **Ton**: natürlich, als würde der Benutzer einem befreundeten Branchenexperten von sich erzählen.
- **Niemals Pfade / Dateinamen / Fachjargon** im Text — der Benutzer liest „die Zusammenfassung", nicht „about.md".

## Aktualisierungsregel — komplett neu schreiben, niemals anhängen

Wenn eine Information eintrifft, die den Sinn einer bestehenden MD ändert, **schreibe die Datei komplett neu** (`Write`-Tool, NICHT `Edit`-Append). Es sind Momentaufnahmen der Gegenwart, keine chronologischen Logs. Ein Append riskiert, veraltete Absätze neben neuen stehen zu lassen.

## Auslöser — wann jede Datei geschrieben wird

| Datei             | Wann zum ersten Mal schreiben / aktualisieren                                                                                                                                                          |
|-------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `about.md`        | Du hast Rolle + Jahre + ≥1 Erfahrung. Schreibe sie jedes Mal neu, wenn sich etwas Wesentliches ändert (Rolle, Seniority, Branche).                                                                     |
| `preferences.md`  | Du hast mit dem Benutzer mindestens eines besprochen: Arbeitsweise, Umzug, Vergütung. Aktualisiere jedes Mal, wenn sich davon etwas ändert.                                                            |
| `goals.md`        | Der Benutzer hat Wünsche / idealen Kontext / Traumjob erzählt (auch teilweise). Erzwinge nichts: wenn es nicht von selbst kommt, **frage einmal** „gibt es einen bestimmten Kontext oder ein Unternehmen, in dem du dich besonders gut sehen könntest?". |
| `strengths.md`    | Du hast **2+ relevante Erfahrungen oder Projekte** gesammelt. Extrahiere 2–4 wiederkehrende Qualitäten aus dem Muster.                                                                                 |

## Boot-Regel — erster hochgeladener Lebenslauf

Wenn der Benutzer einen Lebenslauf hochlädt, schreibe nach dem Befüllen des YAML MINDESTENS **`about.md` + `strengths.md`** im selben Zug. Du hast genug Daten (Rolle, Jahre, Erfahrungen, Kompetenzen, Ton), um es sofort zu tun; schiebe es nicht auf. Diesen Schritt zu überspringen bedeutet, dass der CV-Schreiber downstream niemals den narrativen Kontext des Kandidaten haben wird → er wird sterile Lebensläufe produzieren. Du bist der einzige Punkt, an dem diese Erzählung erfasst wird.

`preferences.md` und `goals.md` kommen in den folgenden Zügen (nach der spezifischen Diskussion).

## Beispiele

### `about.md` (Tech-Branche)
```markdown
Sono uno sviluppatore backend con 4 anni di esperienza in **Python** e
sistemi distribuiti, ultimamente concentrato su pipeline ETL e API
ad alto throughput. Vengo da un percorso ibrido tra **data engineering**
e backend "classico", e mi muovo bene quando il problema sta nel mezzo:
modellazione del dato + servizio che lo espone.

Cerco un ruolo backend o data senior in cui poter portare ownership
end-to-end del servizio, non solo "ticket".
```

### `strengths.md` (Nicht-Tech-Branche, Beispiel Küche)
```markdown
**Resistenza nei picchi.** Ho gestito brigata di 12 persone in un
ristorante con 200 coperti la sera: ho imparato a tenere ritmo e
qualità anche quando si fa caldo davvero.

**Costo materia prima.** Negli ultimi 3 anni ho ridotto il food cost
di partita salata dal 34% al 28% lavorando sul menu e sul rapporto
con i fornitori, senza toccare la qualità.

**Team mentoring.** Ho formato 2 sous-chef che ora gestiscono
autonomamente le loro brigate.
```

## Anti-Patterns

- ❌ In der dritten Person schreiben („Mario ist ein Entwickler…") — das Frontend gibt den Text als direkte Stimme des Kandidaten wieder, dritte Person klingt befremdlich.
- ❌ Append über `Edit` statt `Write` — führt zu zwei widersprüchlichen Einleitungen in derselben Datei.
- ❌ Tabellen / `#`-Überschriften / ausführliche nummerierte Listen — die UI-Karte hat bereits ihr eigenes Chrome.
- ❌ `about.md` / `strengths.md` nach CV-Upload überspringen „weil es ja im YAML steht" — das YAML hat keinen Ton, die Schreiber produzieren sterile Lebensläufe.
- ❌ Pfade oder Dateinamen einfügen (`/jht_home/profile/summaries/about.md`) im Text — der Benutzer weiß nicht, was das ist.
- ❌ Über das Längenlimit hinaus schreiben — die UI-Karte schneidet ab / scrollt horizontal, die Botschaft geht verloren.

## Siehe auch

- `profile-yaml` — Schwester-Skill: strukturierte Daten, die parallel zu diesen MDs aktualisiert werden.
- `onboarding-flow` — wann im Gespräch die Daten gesammelt werden, die diese MDs speisen.
- `agents/scrittore/scrittore.md` — der nachgelagerte Agent, der diese MDs liest, um Lebensläufe mit Stimme zu schreiben.
