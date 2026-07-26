<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: profile-yaml
description: "Maintain `$JHT_HOME/profile/candidate_profile.yml` — the structured candidate data the entire team consumes. The frontend polls this file every ~2s; an invalid YAML makes the user's left panel go silently blank. Owned by the Assistente. Use this skill on EVERY new piece of information from the user (text or uploaded file): write incrementally, validate immediately, talk to the user only after the validator says VALID_PROFILE. Also covers `ready.flag` (the unlock for the \"Vai alla dashboard\" button) with its strict 3-step verify-then-announce protocol."
allowed-tools: Bash(jht profile validate *), Bash(python3 *), Bash(mkdir -p *), Bash(date *), Bash(test *), Bash(rm -f *)
---

# profile-yaml — einzige Quelle der Wahrheit über den Kandidaten

Das Team liest `candidate_profile.yml` für jeden CV, jeden Score, jede Match-Entscheidung. Wenn Sie die Datei korrekt halten, funktioniert der Rest des Systems; wenn Sie sie veralten lassen, produzieren die Writers sterile CVs und der Scorer bewertet Positionen falsch.

## Pfad & Eigentümerschaft

| Pfad                                          | Wer schreibt         | Wer liest                |
|-----------------------------------------------|----------------------|--------------------------|
| `$JHT_HOME/profile/candidate_profile.yml`     | **Assistente** (Sie), Capitano, Benutzer über die Web-UI | alle anderen Agenten (nur lesen — T10) |
| `$JHT_HOME/profile/ready.flag`                | **Assistente** (Sie) | das CTA-Gate des Dashboards |

Erstellen Sie das Verzeichnis, falls es nicht existiert:
```bash
mkdir -p "$JHT_HOME/profile"
```

## Live-Aktualisierung — inkrementell, nach JEDER relevanten Eingabe

Das Frontend fragt die Datei alle ~2s ab. Warten Sie nicht bis zum Ende des Gesprächs; **jedes Mal, wenn der Benutzer Ihnen ein neues Datum gibt, schreiben Sie es sofort**.

- "ich heiße Mario" → schreiben Sie `name: Mario` sofort.
- "ich suche eine Stelle als Koch" → aktualisieren Sie `target_role: cuoco` sofort.
- Datei mit Erfahrungsdetails hochgeladen → nach dem Read aktualisieren Sie **alle** Felder in einem einzigen Write.

Jedes neue Datum = ein `Write` oder `Edit` auf der Datei. Dann validieren. Dann die Konversation fortsetzen.

## Pflichtvalidierung nach JEDEM Write/Edit

Validieren Sie gegen das **kanonische Schema** (nicht nur "ist das YAML parsebar"): siehe die Skill
[`profile-schema`](../profile-schema/SKILL.md) für das vollständige Schema.

```bash
jht profile validate
# direkter Fallback:
# python3 /app/shared/skills/validate_profile.py "$JHT_HOME/profile/candidate_profile.yml"
```

`VALID_PROFILE` → weiter. `INVALID_PROFILE` → lesen Sie die `ERROR:`-Meldungen (Feld + Grund),
korrigieren Sie das Feld, validieren Sie erneut. Die `WARN:`-Meldungen (Legacy-Schlüssel, z.B. `languages[].name` statt
`language`) blockieren nicht, sollten aber behoben werden, wenn Sie diesen Abschnitt bearbeiten.

**Setzen Sie die Konversation mit dem Benutzer NICHT fort, bis `VALID_PROFILE` erscheint.** Ein kaputtes Profil
leert das gesamte linke Panel; der Benutzer denkt, die App sei abgestürzt.

Wenn Sie vergessen haben, den Validierungsschritt hinzuzufügen, können Sie sicher sein, dass die Datei kaputt ist — es gibt kein "wahrscheinlich ok". Führen Sie ihn immer aus.

## YAML-Sicherheitsregeln

Der Parser des Frontends ist strikt. Fünf Regeln, die jedes aufgetretene Problem verhindern:

1. **Block-Scalar (`|-` oder `>-`) für jeden Text > 60 Zeichen** — Beschreibungen, Zusammenfassungen, freie Notizen, Stärken. Inline-Strings brechen bei Kommas, Doppelpunkten, Anführungszeichen, Zeilenumbrüchen, Klammern.
   ```yaml
   summary: |-
     Hier können Sie langen Text schreiben, auch mit Kommas, Doppelpunkten, Apostrophen,
     Zeilenumbrüchen, Klammern: der Parser nimmt es so, wie es ist.
   ```
2. **Inline-Strings mit Sonderzeichen in Anführungszeichen setzen** — wenn Sie einen String inline lassen müssen und er `"`, `:`, `#`, `&`, `*`, `>`, `|`, `%`, `@` enthält, umschließen Sie ihn mit doppelten Anführungszeichen (`"…"`) oder wechseln Sie zum Block-Scalar.
3. **Leerzeichen nach jedem `:`** — `role: Senior` ✅ · `role:Senior` ❌.
4. **Einrückung mit 2 Leerzeichen, niemals Tabs** — Listenpunkte werden auf derselben Spalte eingerückt wie das erste Inhaltszeichen des Elternelements.
5. **Keine langen Geviertstriche / typografische Anführungszeichen** — Einfügen aus Rich-Text-Editoren injiziert `—`, `"`, `"`. Ersetzen Sie durch einfache `-`, `"`, oder verwenden Sie Block-Scalar.

## Mindestschema (das Minimum)

Das Frontend hat einen Fallback, der "Vai alla dashboard" freischaltet, wenn diese Felder vorhanden + nicht leer sind (damit der Benutzer fortfahren kann, noch bevor Sie `ready.flag` erstellen). Füllen Sie alle aus:

```yaml
name: <Vorname Nachname>
target_role: <Zielrolle>
location: <Stadt oder Gebiet>
experience_years: <int>
has_degree: <true|false>
seniority_target: <junior|mid|senior>
industry: <Branche>

skills:
  primary: [...]              # >= 2 Einträge
  secondary: [...]

languages:                    # >= 1 Eintrag
  - language: <Name>
    level: <A1..C2 | native>

candidate:
  name: <gleich wie oben>
  target_role: <gleich wie oben>
  contacts:
    email: ...
    phone: ...
    linkedin: ...
    github: ...
  experience:                 # >= 1 Eintrag, jeder mit company/role/years/summary
    - company: ...
      role: ...
      years: ...              # z.B. "Mär 2022 - laufend" — für tatsächliche Dauer verwendet
      summary: |-
        ...
  education:                  # >= 1 Eintrag, jeder mit institution/degree/year
    - institution: ...
      degree: ...
      year: ...

preferences:                  # EXAKTE SCHLÜSSEL — das Frontend sucht genau diese
  work_mode: <remoto|ibrido|in sede|flessibile>
  work_mode_flexibility: <optional, Freitext>
  relocation: <true|false|"per la giusta posizione">
  salary_annual_eur: <z.B. "30-35k" | null>

sector_details:
  <freie Schlüssel, snake_case — siehe Abschnitt unten>
```

Die Schlüssel `preferences.work_mode`, `preferences.relocation`, `preferences.salary_annual_eur` werden vom Frontend wörtlich gelesen, um den Abschnitt "Arbeitspräferenzen" zu füllen. Alternative Namen (`work_location`, `flexible`, `remote`) bleiben geschrieben, sind aber für den Benutzer unsichtbar.

Vollständiges Schema + Beispiele: `docs/examples/candidate_profile.yml.example` (zur Dokumentation, **NICHT die Werte kopieren** — siehe Anti-Halluzination).

## `sector_details` — freie Schlüssel für die Branche des Benutzers

Generischer Key/Value-Bereich, den das Frontend als Liste anzeigt. Die Schlüssel wählen Sie basierend auf dem Beruf des Benutzers. Reale Beispiele:

```yaml
# Küche
sector_details:
  specializzazione: Pasticceria
  brigate: "ristoranti grandi (10+ persone in cucina)"
  patenti: ["HACCP", "antincendio rischio medio"]
  ruolo_attuale: "Capo partita salata"

# Gesundheitswesen
sector_details:
  specializzazione_infermieristica: "Area critica"
  iscrizione_albo: "OPI Roma n. 12345"
  reparti: ["Pronto soccorso", "Terapia intensiva"]
  turni_abituali: "notturni + festivi"

# Bau / Anlagen
sector_details:
  patenti: ["CAP carrello elevatore", "PES/PAV", "patentino ponteggi"]
  specializzazione: "Impianti elettrici industriali"
  anni_cantiere: 12

# Unterricht
sector_details:
  classe_concorso: "A-12 (Italiano, Storia)"
  anni_ruolo: 8
  specializzazione_sostegno: true
```

Regeln:
- Schlüssel in `snake_case`, kurz und lesbar.
- Fügen Sie nur Schlüssel mit tatsächlichen Werten des Kandidaten ein. Wenn unbekannt → weglassen (niemals `null` / `""`).
- Werte: String, Zahl, Boolean, Array von Strings.
- Branche nicht in der Liste → erfinden Sie die passenden Schlüssel selbst, basierend darauf, was in diesem Beruf wichtig ist. Z.B. LKW-Fahrer: `patente: CE+CQC`, `anni_alla_guida: 15`, `tratte_abituali: [...]`.

## `ready.flag` — Freischaltung "Vai alla dashboard"

Der Button ist standardmäßig deaktiviert. Das Frontend aktiviert ihn, WENN:
- `$JHT_HOME/profile/ready.flag` existiert (das explizite Flag, das SIE erstellen), **ODER**
- das Backend erkennt, dass das Mindestschema bereits vollständig ist (automatischer Fallback).

Daher ist der Button oft bereits durch den Fallback freigeschaltet, wenn das Profil vollständig ist — **kündigen Sie die Freischaltung nicht an, wenn nicht Sie das Flag erstellt haben**.

### Wann das Flag erstellen (3 STRIKTE Schritte, niemals überspringen, niemals die Reihenfolge ändern)

```bash
# 1. Erstellen Sie das Flag mit UTC-Zeitstempel
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$JHT_HOME/profile/ready.flag"

# 2. ÜBERPRÜFEN Sie, dass die Datei wirklich existiert (kann lautlos fehlschlagen:
#    Berechtigungen, fehlendes Verzeichnis, Festplattenquota usw.)
test -f "$JHT_HOME/profile/ready.flag" && echo FLAG_OK || echo FLAG_MISSING

# 3. NUR wenn Schritt 2 = FLAG_OK → senden Sie die Nachricht im Chat.
#    Falls FLAG_MISSING → beheben (z.B. mkdir -p) und ab Schritt 1 wiederholen.
#    Kündigen Sie die Freischaltung NIEMALS ohne FLAG_OK im vorherigen Schritt an.
```


### 4. Benachrichtigen Sie den Capitano — hier startet das Team

Erst nach `FLAG_OK`, und nur einmal:

```bash
jht-tmux-send CAPITANO "[@assistente -> @capitano] [PROFILO-PRONTO] Kandidatenprofil vollstandig und validiert — das Team kann starten."
```

Der Capitano schaut nicht in die Profildatei: solange niemand es ihm sagt, lasst
er den Benutzer beim ersten Start vor einem fast stillstehenden Buro sitzen.
Diese Nachricht ist der Trigger seiner Skill `first-run-burst` (vollstandiges
Roster sofort statt schrittweisem Hochfahren). Ohne sie sieht der Benutzer am
ersten Tag alle zehn Minuten eine Position und halt die Anwendung fur kaputt.

### Anti-Halluzination von Schritt 2

Es ist bekannt, dass ein LLM dazu neigt, "ich habe X gemacht" zu schreiben, auch wenn der Tool-Call nicht ausgeführt wurde. Der `test -f` existiert genau dafür, um Sie zu unterbrechen, falls Sie die Erstellung übersprungen haben: Sie sehen `FLAG_MISSING` und erinnern sich, zurückzugehen. **Vertrauen Sie nicht Ihrer Erinnerung, vertrauen Sie nur der Ausgabe von `test -f`.**

### Wann das Flag entfernen

Wenn während des Gesprächs festgestellt wird, dass ein Feld der Blockier-Checkliste falsch oder fehlend ist (z.B. der Benutzer sagt "ach nein, diese Erfahrung war gar nicht wirklich meine"):

```bash
rm -f "$JHT_HOME/profile/ready.flag"
```

Und informieren Sie den Benutzer: "Ich habe den Button wieder auf Warten gesetzt — lassen Sie uns diesen Punkt klären, bevor wir fortfahren".

### Das Flag NICHT erstellen, wenn

- die letzte Profilvalidierung `INVALID_PROFILE` ausgegeben hat (auch nur einmal nach dem letzten Write);
- fehlen: Name, Zielrolle, Stadt, Erfahrungsjahre, E-Mail;
- fehlen: Fähigkeiten (≥2), Sprachen (≥1), Erfahrungen (≥1), Abschlüsse (≥1).

## ⚠️ Anti-Halluzination — die kritische Regel

**NIEMALS `docs/examples/candidate_profile.yml.example` oder `docs/examples/candidate_profile.hr.yml.example` als Wertequelle lesen.** Diese Dateien dokumentieren die *Struktur*, nicht den Kandidaten. Wenn Sie sie lesen, riskieren Sie, "Mario Rossi" / "mario.rossi@example.com" in das echte Profil zu schreiben.

Verwenden Sie AUSSCHLIESSLICH:
- was der Benutzer Ihnen im Chat gesagt hat
- was Sie aus einem CV / hochgeladenen Datei extrahiert haben

Wenn Sie ein Feld nicht kennen: **lassen Sie `""` oder weglassen**, erfinden Sie niemals einen plausiblen Wert.

## Anti-Patterns

- ❌ Profil in Ihr cwd `$JHT_AGENT_DIR` schreiben statt in `$JHT_HOME/profile/` — das Frontend findet es nicht.
- ❌ Validierung überspringen "war doch nur eine kleine Änderung" — jeder Write kann YAML kaputt machen, immer.
- ❌ YAML / JSON / Pfade im Chat zeigen — der Benutzer ist nicht-technisch (siehe `assistente.md` Abschnitt Benutzersprache).
- ❌ Freischaltung ankündigen ohne `test -f` — das ist die klassische Halluzination "ich habe X gemacht" ohne es getan zu haben.
- ❌ Append (Edit) in bestehenden Abschnitten ohne den Kontext zu prüfen — das YAML muss kohärent neu geschrieben werden, nicht willkürlich gepatcht.

## Siehe auch

- `profile-summaries` — die 4 erzählenden MDs, die parallel zum YAML geschrieben werden.
- `onboarding-flow` — das Gesprächsprotokoll, das entscheidet, wann was aktualisiert wird.
- `chat-web` — wie die Bestätigung an den Benutzer kommuniziert wird (1 Zeile, kein Pfad, kein Fachjargon).
- `agents/_team/team-rules.md` T10 — das Profil ist für andere Agenten nur lesbar, wörtliches Zitat.
