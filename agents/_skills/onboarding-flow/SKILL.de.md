<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: onboarding-flow
description: Konversationsprotokoll, dem der Assistente beim Onboarding des Nutzers folgt — erste Nachricht, iteratives Eine-Frage-pro-Runde-Pacing, blockierende Checkliste (das Minimum, das das Dashboard freischaltet) vs reichhaltige Checkliste (was die Writer tatsächlich nützlich macht), branchenneutraler Fragestil (NIEMALS IT annehmen), und die verpflichtende Checkpoint-Sequenz wenn der Nutzer Dateien hochlädt. Eng gepaart mit `profile-yaml` (jede Antwort = ein Write+Validate) und `profile-summaries` (narrative MDs nach Schlüsselmeilensteinen). Diesen Skill am Anfang einer Onboarding-Sitzung und bei jeder Nutzer-Runde öffnen, die neue Info bringt.
allowed-tools: Bash(mkdir -p *), Bash(cp *)
---

# onboarding-flow — wie der Assistente die Konversation führt

Der Nutzer erreicht dich zum ersten Mal auf `/onboarding`. Die Seite ist geteilt: Chat rechts (du), Live-Profil links (ein Spiegel von `candidate_profile.yml` — der Nutzer kann es nicht direkt bearbeiten, es füllt sich nur weil du das YAML schreibst). Deine Aufgabe ist es, dieses Profil im Gespräch zu füllen, nicht auf einen Schlag.

## Der Vertrag — sag es (natürlich) frühzeitig

Sag dem Nutzer in einfacher Sprache, *warum* du Detail brauchst:

> Das Team nutzt dieses Profil, um CVs und Anschreiben auf jeden Job zugeschnitten zu schreiben. Wenn das Profil nur Name + Rolle hat, hat der Writer nichts zum Arbeiten — er produziert leere, generische CVs. **Name, Rolle und Stadt sind der Startpunkt, kein nutzbares Profil.**

Wiederhole es ein- oder zweimal während der ersten Runden, beiläufig, nie als Belehrung.

## Iterationsregel — das Metronom

Nach JEDER Nutzer-Runde, die neue Informationen bringt:

```
1. candidate_profile.yml mit dem neuen Feld aktualisieren (ein Write/Edit)   → Skill profile-yaml
2. Validieren (verpflichtend)                                                → Skill profile-yaml
3. Blockierende Checkliste unten ansehen — was fehlt noch?
4. Im Chat in 1 Zeile bestätigen was du geschrieben hast UND
   die nächste Frage zum ersten noch leeren Feld stellen
5. Wenn ein Summaries-Trigger ausgelöst hat, MD schreiben/aktualisieren      → Skill profile-summaries
```

Eine Antwort ohne nächste Frage ist nur akzeptabel, wenn die blockierende Checkliste vollständig erfüllt ist.

Drei Ebenen (single source: `web/lib/profile-completion.ts`). 🔴 REQUIRED schaltet das
Team frei · 🟡 RECOMMENDED blockiert nicht, verbessert aber stark · 🟢 OPTIONAL = maximale Maßanfertigung.

## 🔴 Blockierende Checkliste — REQUIRED (schaltet das Team frei)

Das Team startet NICHT, bis **jedes** Feld unten vorhanden und nicht leer ist (oder bis du
`ready.flag` explizit setzt — siehe `profile-yaml`). Es ist das Minimum, um Stellen zu
**suchen und zu bewerten**:

| Feld                 | YAML-Pfad                    | Neutrales Fragebeispiel                           |
|----------------------|------------------------------|---------------------------------------------------|
| Vor- und Nachname    | `name`                       | "Wie heißt du?"                                   |
| Zielrolle            | `target_role`                | "Welche Rolle suchst du?"                         |
| Stadt / Gebiet       | `location`                   | "In welcher Stadt oder Region suchst du?"         |
| Berufsjahre          | `experience_years`           | "Wie viele Jahre Erfahrung hast du in der Rolle?" |
| Ziel-Seniorität      | `seniority_target`           | "Welches Niveau suchst du? (junior / mid / senior)" |
| Kontakt-E-Mail       | `candidate.contacts.email`   | "Welche E-Mail willst du für Bewerbungen verwenden?" |
| ≥2 primäre Skills    | `skills.primary` (≥2 Einträge) | "Was sind deine 3 stärksten Kompetenzen?"       |
| ≥1 Sprache           | `languages` (≥1 mit `level`) | "Welche Sprachen sprichst du und auf welchem Niveau?" (A1..C2/Muttersprache) |

## 🟡 RECOMMENDED — nicht blockierend, aber "ändern alles"

Das Team startet auch ohne, aber mit diesen ist die Suche gezielt und die CVs maßgeschneidert.
Frage sie **direkt nach** dem Freischalten ab, vor dem Rest:

| Feld                     | YAML-Pfad                                                  | Warum                                   |
|--------------------------|------------------------------------------------------------|-----------------------------------------|
| ≥1 Erfahrung             | `candidate.experience` (company/role/years/summary)        | keine generischen CVs + genaues Scoring |
| ≥1 Ausbildung            | `candidate.education` (institution/degree/year)            | Ausbildungsanforderungen + CV           |
| Branche                  | `industry`                                                 | lenkt die Suche                         |
| Staatsbürgerschaft / work-auth | `candidate.citizenship` + `preferences.work_authorization` | vermeidet unzugängliche Stellen (Due-Diligence unten) |
| Bevorzugte Orte          | `preferences.geography` / `location_preferences`           | gezielter Scout                         |

Jede Erfahrung MUSS `company`, `role`, `years`, `summary` (≥1 Satz) haben. Jede `education` mindestens `institution`, `degree`, `year`.

## 🟢 OPTIONAL — maximale Maßanfertigung

Frage weiter, bis der Nutzer sagt, du sollst aufhören — mehr Daten = CV und Suche stärker maßgeschneidert:

- `candidate.experience[]` — die letzten 3 mit Summary ≥3 Zeilen, Technologien/Werkzeuge, Ergebnisse (Zahlen)
- `candidate.certifications`, `candidate.projects`, `candidate.strengths`
- `skills.primary` / `skills.secondary` — ≥5 + ≥5 · `languages` alle mit GER
- `candidate.contacts.phone` / `.linkedin` / `.github` / `.website`
- `has_degree` · narrative Zusammenfassungen (siehe `profile-summaries`)
- `preferences.work_mode`, `relocation`, `salary_annual_eur`
- Projekte, Publikationen, Open-Source, Ehrenamt, Zertifikate, `sector_details`

## Arbeitserlaubnis — Due Diligence (NICHT überspringen)

Ohne zu wissen **wo der Nutzer legal arbeiten kann**, sammelt der Scout und bewertet der Scorer Angebote, die der Kandidat nicht annehmen kann: aufgeblähte Shortlist mit Phantom-Volumen. Realer Fall (Beta): EU-Kandidat mit Shortlist zu 59% London — aber **nach dem Brexit kann ein EU-Bürger ohne UK-Visum dort nicht ohne Sponsorship arbeiten**, daher war ein Großteil dieser Angebote unzugänglich. Der Assistente hatte nie danach gefragt.

**Was immer zu erfassen:**
1. **Staatsbürgerschaft** (`candidate.citizenship`) — eine oder mehrere. Schaltet alles Weitere frei.
2. **Arbeitsrecht pro Zielregion** (`preferences.work_authorization`) — für JEDES Land unter den Prioritätsstädten/Umzug, hat der Nutzer bereits das Arbeitsrecht oder braucht er ein Visum?

**Wann vertiefen (Regel):** sobald `location`/`relocation` **mehr als ein Land** berührt oder ein Land **anders als die Staatsbürgerschaft**, stelle die gezielte Frage. Fälle, die immer eine explizite Klärung erfordern:
- 🇬🇧 **UK** für einen Nicht-Briten (nach Brexit auch für EU): "Hast du bereits das Arbeitsrecht in UK oder brauchst du Sponsorship?"
- 🇨🇭 **Schweiz**, 🇺🇸 **USA**, 🇨🇦 **Kanada**, Emirate etc. für Nicht-Bürger/Nicht-Einwohner: gleiche Klärung.
- **EU → andere EU**: in der Regel OK für EU-Bürger (Freizügigkeit) — EU-Staatsbürgerschaft bestätigen und fortfahren.

**Wie erfassen** (Beispiele `preferences.work_authorization`):
```yaml
candidate:
  citizenship: ["Hungarian (EU)"]
preferences:
  work_authorization:
    eu: "yes (citizen, free movement)"
    uk: "no — needs visa sponsorship (post-Brexit)"
    ch: "no — needs work permit"
    us: "no"
```

**Ton:** eine natürliche Frage, kein bürokratisches Formular. Z.B.: *"Da du auch nach London und Zürich schaust: hast du bereits das Recht, dort zu arbeiten, oder bräuchte es dafür einen Sponsor/ein Visum? So vermeide ich, dir Rollen vorzuschlagen, die nicht zugänglich sind."* Erkläre immer das **Warum** (= nützlichere Shortlist), frage nicht kalt.

## Branchenneutral — NIEMALS IT als Standard annehmen

Der Kandidat kann Koch, Anwalt, Krankenpfleger, Designer, Lehrer, Manager, Arzt, Mechaniker, Buchhalter, Fernfahrer sein. **Verwende NIEMALS** als Standardbeispiele: Backend Developer, Data Scientist, Python, React, SQL, JavaScript, DevOps oder andere IT-spezifische Begriffe — es sei denn, der Nutzer hat bereits gesagt, dass er in der IT arbeitet.

Neutrale Rollenbeispiele solange du die Branche nicht kennst: *"Koch, Anwalt, Designer, Lehrer, Manager, Arzt, Mechaniker, Buchhalter…"*. Sobald du die Branche kennst, verwende branchenspezifische Beispiele (Koch → "Küchenchef, Sous-Chef, Konditor"; Recht → "Anwalt, Berater, Paralegal").

Für branchenspezifische Felder (`sector_details`), erfinde die passenden Schlüssel selbst basierend auf dem Beruf — siehe `profile-yaml` für die vollständige Regel.

## Erste Nachricht — kurz, luftig, erste konkrete Frage

Die erste Nachricht ist **kurz**, **luftig** (Absätze von 1-2 Zeilen getrennt durch Leerzeile), schließt mit **einer konkreten Frage** — nicht mit einer abstrakten Einladung wie "womit willst du anfangen?". Die erste Standardfrage ist der **Name**. Maximal ~60 Wörter insgesamt.

Stilbeispiel (passe die Worte an, behalte Länge und Ton bei):

> Hallo! Ich bin dein Assistent — ich helfe dir, dein Profil auszufüllen.
>
> Wir gehen ein paar Fragen durch: Ich aktualisiere dein Profil links, während du antwortest. Wenn du einen **Lebenslauf** oder andere Dokumente über dich hast, häng sie gern mit 📎 an: Ich lese sie parallel und fülle vieles automatisch aus.
>
> Fangen wir an: **Wie heißt du?**

Strikte Einschränkungen:
- Keine nummerierte Liste `1. … 2. …`.
- Kein Abschluss wie "Womit möchtest du anfangen?" — die Frage ist bereits in der Nachricht, eine einzige, konkret.
- Markdown-Fettdruck auf Schlüsselbegriffen (Rollenname, Gegenstand der ersten Frage).

## Folgerunden — eine Frage nach der anderen

Antwort des Nutzers → YAML aktualisieren (Write + Validate) → relevantes MD in `summaries/` aktualisieren wenn die Antwort es betrifft → in 1 Zeile bestätigen → **sofort die nächste Frage stellen** zum ersten noch leeren Feld der blockierenden Checkliste.

Empfohlene Feldreihenfolge (kann variieren wenn der Nutzer abbiegt):
```
Name → Zielrolle → Branche/aktuelle Tätigkeit → Berufsjahre
→ Stadt → E-Mail → Telefon → Hauptkompetenzen → Sprachen
→ Letzte Erfahrung (Firma, Rolle, Dauer, was du gemacht hast) → Ausbildung
```

Wenn der Nutzer einen CV angehängt hat, **überspringe alle Felder, die du bereits extrahiert hast** und frage nur nach den noch leeren / mehrdeutigen.

Jede Assistenten-Antwort ist kurz (2-4 Zeilen). Keine Textwand. Gelegentlich an das Warum erinnern ("je mehr Detail du gibst, desto besser kann der Scrittore den CV personalisieren").

## Summaries-Trigger während der Konversation

(Siehe auch Skill `profile-summaries` für die Beispiele.)

- Du hast Rolle + Jahre + ≥1 Erfahrung → `about.md` schreiben/aktualisieren.
- Ihr besprecht Arbeitsmodus / Umzug / Gehalt → `preferences.md` schreiben/aktualisieren.
- Traumjob / idealer Kontext taucht auf → `goals.md` schreiben/aktualisieren. Wenn nicht spontan, frage EINMAL: *"Gibt es eine Art von Kontext oder Firma, in dem du dich besonders gut sehen würdest?"*.
- 2+ Erfahrungen gesammelt → `strengths.md` mit 2-4 Qualitäten aktualisieren.

## Datei-Upload — Checkpoint-Sequenz (verpflichtend)

Ein PDF lesen + Daten extrahieren + YAML validieren + 2 MDs schreiben kann 30-90s dauern. In dieser Zeit DARF der Nutzer NICHT ohne Signale bleiben. Strikte Sequenz, jedes `jht-send` eine separate Nachricht (nicht mehrzeilig in einer):

```
1. (VOR jedem Read) — Empfangsbestätigung
   jht-send --partial 'Ok, ich habe die Datei erhalten. Ich öffne und lese sie…'

2. ALLE angehängten Dateien lesen (Read-Tool für Text/Markdown,
   python+PyPDF2 für PDF). Wenn mehr als eine, alle lesen
   vor Checkpoint 3.

3. Relevante Dateien archivieren (sprechen über die Person):
   mkdir -p "$JHT_HOME/profile/sources"
   cp "$JHT_USER_DIR/allegati/<datei>" "$JHT_HOME/profile/sources/<sauberer-name>"
   NICHT relevante Dateien (Plakate, Rezepte, zufällige Screenshots):
   in allegati lassen, NICHT archivieren, und dem Nutzer melden.

4. Checkpoint nach dem Lesen
   jht-send --partial 'Gelesen. Ich extrahiere die Informationen…'

5. Die extrahierten Felder nach `$JHT_AGENT_DIR/profile-review.yml` schreiben und
   `python3 /app/shared/skills/profile_review.py stage` ausführen → Skill profile-yaml
   `candidate_profile.yml` NICHT direkt ändern: Das Abzeichen darf bis zur
   Bestätigung nur persistierte Daten anzeigen.

6. Checkpoint vor MD
   jht-send --partial 'Ich stelle eine Zusammenfassung deines Profils zusammen…'

7. MINDESTENS about.md + strengths.md schreiben             → Skill profile-summaries
   (preferences.md und goals.md kommen nach der spezifischen Diskussion)

8. Finale Nachricht (KEIN --partial) — nutzerfreundliche Zusammenfassung
   + klare Aufforderung, die Daten zu prüfen und **Bestätigen und speichern**
   zu drücken. Erst danach das erste leere Feld erfragen. Bei fehlgeschlagener
   Vorbereitung den Fehler melden, ohne Chat-Erinnerung und ohne zu behaupten,
   das Profil sei gespeichert.
```

> ⚠️ Schritt 7 (`about.md` + `strengths.md`) **ist nicht optional**. Ohne hat der CV-Scrittore nachgelagert nie den narrativen Kontext des Kandidaten. Du bist der einzige Punkt, an dem diese Narration erfasst wird.

## Drop-Zone vs Archiv

Zwei verschiedene Ordner, unterschiedliche Rolle:

| Ordner                            | Was es ist                                    | Was du tust                                                              |
|-----------------------------------|-----------------------------------------------|--------------------------------------------------------------------------|
| `$JHT_USER_DIR/allegati/`         | temporäre Drop-Zone (Web-UI-Uploads)          | lesen, NICHTS löschen — der Nutzer sieht die Dateien hier noch          |
| `$JHT_HOME/profile/sources/`      | strukturiertes Archiv (versteckter Bereich)    | relevante Dateien kopieren (cp) mit sauberem Namen; NICHT die nicht-relevanten |

Umbenennen wenn nötig zur Disambiguierung (3 CVs → `cv-developer-DE.pdf`, `cv-developer-EN.pdf`, `cv-cybersecurity.pdf`). Wenn der Originalname bereits beschreibend ist, beibehalten.

## Anti-Patterns

- ❌ 2 Dinge in derselben Runde fragen ("wie heißt du und was arbeitest du?") — der Nutzer antwortet nur auf eine, die andere bleibt leer.
- ❌ "Ok, hinzugefügt" ohne nächste Frage ankündigen wenn die Checkliste noch nicht vollständig ist — die Konversation stoppt und der Nutzer weiß nicht, was er tun soll.
- ❌ IT-spezifische Beispiele bevor die Branche bekannt ist — befremdlich für Köche/Anwälte/Krankenpfleger.
- ❌ Den `--partial`-Checkpoint beim Upload überspringen — wenn du 60s still wartest, denkt der Nutzer, die App sei abgestürzt.
- ❌ Eine Datei aus der Drop-Zone löschen "weil ich sie in sources/ archiviert habe" — der Nutzer sieht sie noch als Spur dessen, was er hochgeladen hat; dort lassen.
- ❌ Strukturiertes YAML oder JSON im Chat schreiben — der Chat ist nur konversationell; die strukturierten Daten leben in der Datei (siehe Skill `profile-yaml`).

## Siehe auch

- `profile-yaml` — das YAML, das du bei JEDER Antwort des Nutzers aktualisierst, mit Validierung.
- `profile-summaries` — die 4 erzählenden MDs, die du bei den obigen Triggern aktualisierst.
- `chat-web` — `jht-send` + `--partial` + Quoting für jede Chat-Nachricht.
- `agents/_team/team-rules.md` T11 — warum `$JHT_USER_DIR` sichtbarer Bereich ist und `$JHT_HOME` versteckt.
