---
name: scout-language-gate
description: "Wähle Länder und Suchanfragen nach den Sprachen des Profils und verwirf einen Kandidaten, dessen Inserat eine Sprache verlangt, die der Nutzer nicht spricht, BEVOR du das ganze Inserat holst. `plan` einmal, `screen` für jeden Kandidaten mit Titel und Snippet. Realer Lauf: 100 von 100 Kandidaten eines Portals wurden nach dem vollen Abruf wegen Sprache verworfen."
allowed-tools: Bash(python3 /app/shared/skills/scout_language.py *)
---
<!-- @translation: de, ai-translated 2026-11-02 -->

# scout-language-gate — erst die Sprache, dann der Abruf

Die Sprache ist der Schnitt, der am häufigsten einen Kandidaten tötet, NACHDEM Suche, Abruf des ganzen Inserats und manchmal der INSERT schon bezahlt sind. Diese Skill wendet ihn im Code an, vor dem Abruf, anhand dessen, was die Liste schon zeigt. Sie erfindet nichts: Sie verwirft nur auf Beweis, und eine Sprache, die das Profil spricht, ein englisches Inserat oder ein zu kurzer Text werden nie verworfen.

## 1. Die Suche planen

`plan` gibt jedem Land einen Modus. `local`: Das Profil spricht dort eine Arbeitssprache. `english_friendly`: Rollen auf Englisch sind üblich und das Profil spricht Englisch: such dort, mit den ausgegebenen Zusätzen (`English-speaking`, `international team`, `English required`). `english_only`: Nur englische Inserate lohnen das Öffnen. Nichts wird ausgeschlossen (Priorität ja, Ausschluss nein, SC-04): Beginne mit der ausgegebenen `order` und verbrauche die ersten Durchgänge nicht auf `english_only`-Ländern. Es listet auch die `portals`: Jobportale in der Sprache ihres Landes, die das Profil nicht lesen kann (jobs.ch, jobup, jobnet, stepstone-de...), sind `skip`, ebenso EURES in einem Land, dessen Sprache das Profil nicht spricht (`eures`): such sie nicht (`portal --source S --country CC` antwortet für eines, Exit 10 = skip). ATS-Listen werden hier nie ausgeschlossen.

## 2. Jeden Kandidaten vor dem Abruf prüfen

Gib `screen` den Titel und, falls die Quelle einen zeigt, das Snippet. `skip_language` (Exit 10): nicht abrufen; mit `--log` hinterlässt es seine Zeile im Durchgangs-Log (Ergebnis `language`, nicht geöffnet). `ok` oder `unknown`: weiter durch die Gates wie gewohnt. Es liest nur den Text der Liste: Nach dem vollen Abruf prüfen die Filter des Gate 4 und der Analista wie bisher.

```bash
# once, before choosing countries and queries: the plan for THIS profile's languages
python3 /app/shared/skills/scout_language.py plan

# for each candidate, from what the LIST shows, BEFORE you fetch the full ad (exit 10 = drop it)
python3 /app/shared/skills/scout_language.py screen --title "<title>" --snippet "<the list's snippet, if any>" \
    --country nl --source greenhouse --log

# one job board in one country (exit 10 = it is in the language of its country and the profile cannot read it: skip it)
python3 /app/shared/skills/scout_language.py portal --source jobs.ch --country ch
```

## Regeln

- Überspringe nie einen Kandidaten, den `screen` nicht verworfen hat, weil du seine Sprache errätst: Das Werkzeug verwirft auf Beweis, du nicht.
- Gib den Text so weiter, wie er in der Liste steht. Die Antwort enthält nur Codes (`required_language`, `ad_language`, `title_language`); vom Inserat wird nichts gespeichert.
- Keine lesbaren Profilsprachen: `screen` antwortet überall `unknown` und verwirft nichts.
