<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: circles-and-sources
description: Strategiekarte dafür, was WO gesucht wird, vollständig abgeleitet vom Kandidatenprofil. Die 5 konzentrischen Kreise (work_mode + Umzug) definieren den geografischen Scope; die 4 Quellenstufen (LinkedIn → ATS-Aggregatoren → Nische → Web) definieren, welche Plattformen in welcher Reihenfolge durchsucht werden. Ein Scout, der die falsche Stufe im falschen Kreis durchsucht, verschwendet sein Kontingent und seine `scout-coord`-Partition. Öffne diesen Skill beim Boot (nach `scout-coord`) und erneut, wenn ein Kreis erschöpft ist oder ein `[FEEDBACK]` vom Analysten eine Quellenänderung nahelegt.
allowed-tools: Bash(python3 /app/shared/skills/safe_fetch.py *), Bash(python3 /app/shared/skills/linkedin_check.py *)
---

# circles-and-sources — Profil lesen, Karte erstellen

Zwei orthogonale Achsen:
- **Kreise** = WO (geografischer / Arbeitsmodus-Scope)
- **Stufen** = WELCHE Plattformen (in Prioritätsreihenfolge)

Beide kommen aus `$JHT_HOME/profile/candidate_profile.yml`. **Nicht vermuten**: lies `preferences.work_mode`, `location`, `preferences.relocation`, dann baue die Kreise darauf auf, was der Kandidat tatsächlich will.

## Die 5 konzentrischen Kreise

Erschöpfe jeden Kreis von innen nach außen, bevor du nach außen gehst.

| # | Kreis                        | Was es ist                                                                                                  | Wann eintreten                                                           |
|---|------------------------------|-------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------|
| 1 | 🎯 **Primäre Präferenz**     | Der Modus + die Geografie, die der Kandidat als Priorität angegeben hat.                                    | Immer hier beginnen. Zuerst erschöpfen.                                  |
| 2 | 🗺️ **Geo-Nachbarn**          | Gebiete, die unmittelbar von Kreis 1 erweiterbar sind.                                                      | Nur wenn `relocation` es erlaubt ODER Kreis 1 erschöpft ist.             |
| 3 | ✈️ **Gezielter Umzug**        | Städte / Länder, die in `preferences.relocation` aufgeführt sind (oder abgeleitet von `"ovunque"` / `"Europa"`). | Nur wenn `relocation` nicht leer ist (true / Liste / `"ovunque"`).       |
| 4 | 🛰️ **Satellit**              | Geografie außerhalb des Kernziels, geringere Wahrscheinlichkeit.                                            | Nur wenn Kreise 1-3 erschöpft sind.                                      |
| 5 | 🌗 **Grenze**                | Rollen **angrenzend** zum primären Stack des Kandidaten (Sub-Domains derselben Sprache, funktionsübergreifend, Automation, ML-angrenzend, etc.). Der Kandidat wird als anpassungsfähig behandelt; der Scorer wendet den Lücken-Abzug nachgelagert an. | Nur nachdem Kreise 1-4 für den Tag erschöpft sind. |

### Wie Kreis 1 aus dem Profil materialisiert wird

```yaml
preferences:
  work_mode: <remoto|ibrido|in sede|flessibile>
  ...
location: <city/area>
preferences:
  relocation: <true|false|"per la giusta posizione"|list>
```

| `work_mode`   | Kreis 1 = WAS gesucht wird                                                                              |
|---------------|---------------------------------------------------------------------------------------------------------|
| `remote`      | Remote-Rollen, kompatibel mit Zeitzone / Land des Kandidaten (z.B. `Remote (EU only)` für EU-basiert)    |
| `on-site`     | Rollen in `location` (Stadtbasis) nur                                                                    |
| `hybrid`      | Rollen in `location`-Stadt, als hybrid getaggt oder Pendelradius                                         |
| `flessibile`  | Vereinigung der drei obigen — in Reihenfolge erschöpfen: remote → Stadt → hybrid                        |

### Kreis 2 — Geo-Nachbarn

| Kreis-1-Typ      | Kreis-2-Erweiterung                                                                           |
|------------------|------------------------------------------------------------------------------------------------|
| Remote (national)| Remote regional / kontinental, kompatibel mit Zeitzone + Arbeitserlaubnis des Kandidaten      |
| On-site          | Region / Metropolregion des Basislandes                                                       |
| Hybrid           | Wie On-site (Pendelradius-Erweiterung)                                                        |

### Kreis 3 — Gezielter Umzug

Nur wenn `preferences.relocation` nicht leer ist:

| `relocation`-Wert    | Kreis-3-Erweiterung                                                                          |
|------------------------|---------------------------------------------------------------------------------------------|
| Liste (`["Berlin", "Lisbon"]`) | Nur diese Städte                                                                    |
| `"ovunque"`            | Globale Hubs **für die Domain des Kandidaten** (Finanzen → London, NYC, Zürich, Frankfurt, Singapur, Dublin, Luxemburg; Tech → SF, Berlin, Amsterdam, Lissabon, Tel Aviv…). **Rotiere im Round-Robin über sie — durchsuche NICHT zuerst den dichtesten Hub (z.B. London für Finanzen)**, sonst wird die Shortlist hub-dominiert (siehe Anti-Bias-Regel, Standort-Guard). |
| `"Europa"`             | EU Tech-Hubs (Berlin, London, Amsterdam, Lissabon, Dublin, Madrid, Paris, Stockholm, …)     |
| `"per la giusta posizione"` | Kreis 3 überspringen, Grenzfall-Kandidaten aus Kreis 4 mit Umzugs-Flag in den Notizen markieren |

## Die 4 Quellenstufen

Eine Stufe vollständig erschöpfen, bevor zur nächsten gewechselt wird.

| Stufe | Typ                                | Quellen                                                                                                       | Hinweise                                                                                       |
|-------|-------------------------------------|--------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| 1     | **LinkedIn**                        | `linkedin_check.py` (authentifiziertes Profil), `safe_fetch.py`                                         | Universal: deckt remote, on-site, hybrid ab. Verpflichtender erster Schritt für jeden Kreis. **NIEMALS `fetch` MCP** — blockiert durch robots.txt. |
| 2     | **ATS-Aggregatoren**                | Greenhouse-Boards, Lever-Boards, Indeed, Wellfound (ehem. AngelList)                                          | Funktioniert für jeden work_mode. Deckt viele Firmen in einem Scrape ab.                       |
| 3     | **Nischen-Boards (profilspezifisch)** | Nach `work_mode` UND Domain auswählen                                                                       | (siehe Tabelle unten)                                                                          |
| 4     | **WebSearch + Karriereseiten**       | `WebSearch`-Abfragen + Scraping von Firmen-Karriereseiten                                                    | Letzter Ausweg nur nach Erschöpfung der Stufen 1-3.                                           |

### Stufe 3 — Auswahl nach work_mode + Domain

| `work_mode` des Kandidaten | Zu erwägende Nischen-Boards                                                                                |
|-------------------------|--------------------------------------------------------------------------------------------------------------------|
| `remote`                | Remote.co, WeWorkRemotely, RemoteOK, EURemoteJobs (oder regionale Äquivalente)                                     |
| `on-site` / `hybrid`    | Lokale / nationale Boards (InfoJobs, Glassdoor regional, Stepstone, Welcome to the Jungle FR, …)                  |
| `flessibile`            | Remote + lokal kombinieren                                                                                         |
| Domain-spezifisch (beliebig) | Stack-spezifische Nische: PyJobs (Python), GoJobs (Go), Djinni (Osteuropa / Dev), 4dayweek.io (4-Tage-Woche), … |

> ⚠️ **Bringe keine remote-spezifischen Boards in eine Nicht-Remote-Suche** und umgekehrt. WeWorkRemotely bei einem Kandidaten, der On-site in Mailand will, ist verschwendetes Scraping.

## Anti-Bias-Regel (verpflichtend) — für **Firma UND Standort**

Zwei unabhängige Guards, beide am Ende des Batches:

1. **Firma**: wenn **> 30% der Positionen eines einzelnen Batches von einer Firma kommen**, Quelle/Abfrage für den nächsten Batch wechseln. Ein Scaleup, das 12 Rollen auf einem Board ablegt, flutet den Pool — Diversität ist wichtiger als Volumen.
2. **Standort** (Stadt/Gebiet): wenn **> 40% eines einzelnen Batches aus einer Stadt kommen**, MUSS der nächste Batch eine *andere* Kreis-Stadt anvisieren. Ohne dies bekommt ein Kandidat, der für einen Multi-Stadt-Kreis offen ist (z.B. Umzug `"ovunque"`/`"Europa"`), einen Pool, der vom einzelnen Hub dominiert wird, der die meisten Stellenanzeigen für seine Domain hat — Finanzen → **London**, Tech → SF/Berlin. Realer Vorfall (Beta-Tester #2): Ein Finanz-Kandidat erhielt eine fast nur-London-Shortlist, weil London jeden anderen Hub um ~10× übertrifft. Rotiere über die Städte des Kreises im Round-Robin; erschöpfe nicht zuerst den dichtesten Hub.

```python
# Pseudocode für die Prüfung am Ende des Batches
from collections import Counter
batch = [...]
n = len(batch)

# Guard 1 — Firma
top_company, c_count = Counter(p.company for p in batch).most_common(1)[0]
if c_count / n > 0.30:
    log(f"anti-bias company: {top_company} = {c_count}/{n} >30% → switch source/query")

# Guard 2 — Standort (Stadt), KUMULATIV über den gesamten Run (NICHT nur diesen Batch)
# Der Per-Batch-Guard reicht nicht: ein Hub (London für Finanzen) bleibt unter-Schwelle
# in jedem einzelnen Batch und akkumuliert dennoch 60% der DB über die Zeit (live gesehen beim
# Beta: London=57/97=59%). Miss am TOTAL der DB.
db_by_city = dict(db.execute(
    "SELECT COALESCE(loc_city, TRIM(SUBSTR(location,1,INSTR(location||',',',')-1))), COUNT(*) "
    "FROM positions GROUP BY 1"))
db_total = sum(db_by_city.values()) or 1
top_city, top_n = max(db_by_city.items(), key=lambda kv: kv[1])
if top_n / db_total > 0.35:                       # SOFT Cap: keine Stadt > ~35% des Runs
    log(f"anti-bias location KUMULATIV: {top_city}={top_n}/{db_total} (>35%) → "
        f"STOPP Abfragen auf {top_city}, nächster Sweep auf unter-versorgte Prioritätsstädte")
```

**Regel zur geografischen Ausgewogenheit (kumulativ, Soft-Cap) — fördert die Streuung, erzwingt keine Gleichheit:**

1. **Profil lesen**: die `priority cities` (Feld `location` / `preferences.relocation`) sind das Ziel. Es ist normal und richtig, dass Städte mit mehr Fit stärker gewichtet werden — NICHT eine gleichmäßige Aufteilung erzwingen.
2. **Über den gesamten Run messen** vor jedem neuen Sweep: `SELECT loc_city, COUNT(*) FROM positions GROUP BY loc_city ORDER BY 2 DESC`.
3. **Soft-Cap ~35%**: wenn EINE einzige Stadt den ~35% des Gesamt-DB übersteigt, **höre auf sie abzufragen** für die nächsten Sweeps und lenke den Aufwand um. Ein Hub (z.B. London für Finanzen über-postet jede andere Stadt ~10×): laufen lassen produziert eine hub-dominierte Shortlist, nutzlos für jemanden mit Multi-Stadt-Prioritäten.
4. **Prioritäts-Abdeckungsquote**: die Prioritätsstädte des Profils mit **0 oder unter-versorgt** haben Vorrang in den nächsten Sweeps — widme gezielte Abfragen (`<provider>:<keyword>:<city>`) bis sie eine Mindestpräsenz haben, bevor du zu den bereits vollen Hubs zurückkehrst.
5. **Städte außerhalb des Profils als Hub = doppelter Alarm**: wenn die dominierende Stadt NICHT unter den Prioritäten des Profils ist, ist es Hub-Bias + Off-Target → mit Dringlichkeit ausgleichen.

### ⚠️ Arbeitserlaubnis als Filter VOR dem Ausgleich (Brexit, Visa)

Standorte auszugleichen nützt nichts, wenn die Angebote nicht **arbeitsfähig** für den Nutzer sind. Vor der Akzeptanz eines Hubs die Kompatibilität der Arbeitserlaubnis mit dem Profil (Staatsbürgerschaft / deklarierte Visa) überprüfen:

- 🇬🇧 **UK nach Brexit**: ein **EU-Bürger ohne UK-Visum** KANN ohne **Sponsorship** (Skilled Worker visa) nicht in London/UK arbeiten. Daher gelten für ein reines EU-Profil UK-Angebote **nur wenn** die JD explizit *visa sponsorship* erwähnt; ansonsten sind sie arbeitserlaubnis-inkompatibel → ÜBERSPRINGEN (siehe "Durchlässige Filter", Geo-Regel).
- 🇨🇭 **Schweiz / Nicht-EU**: gleiche Logik — Arbeitserlaubnis überprüfen.
- Praktische Regel: wenn der dominante Hub in einem Land ist, das eine Erlaubnis erfordert, die der Nutzer nicht hat (und die JDs kein Sponsoring anbieten), ist dieses Volumen **Phantom** — zählt nicht als Abdeckung und muss aus dem Pool ausgeschlossen werden, nicht nur ausbalanciert.

### 🗣️ Sprachbewusste Quellensuche — nicht sammeln, was wegen Sprache ausgeschlossen wird

Gleiches Prinzip wie die Arbeitserlaubnis, auf der Sprachseite. Wenn die **Sprachen des Nutzers** (`languages`, mit Level) die **lokale Arbeitssprache** einer Zielstadt NICHT abdecken, werden die Rollen, die sie erfordern, nachgelagert vom Analysten (`[LANGUAGE]`) aussortiert — sie zu sammeln ist Verschwendung. Realer Fall (Beta): Kandidat mit Englisch C1 + Deutsch nur Konversation + kein IT/ES/FR → von 18 Ausschlüssen waren 11 wegen obligatorischer Lokalsprache (M&A auf Deutsch in München/Zürich, IB auf Italienisch in Mailand, etc.).

**Regel:** bevor du eine Stadt abfragst, deren lokale Sprache der Nutzer nicht auf Business-Level beherrscht, **biase die Abfragen Richtung English-first / international Rollen**:
- Qualifizierer zur Abfrage hinzufügen: `"English-speaking"`, `"international team"`, `"English required"`, Name von multinationalen/globalen Firmen (Big4, Bulge-Bracket, internationale Scale-ups), die auf Englisch arbeiten, auch in nicht-englischsprachigen Märkten.
- Für Rollen, die **die Lokalsprache erfordern** (und der Nutzer hat sie nicht auf Business-Level): behandle sie wie UK-ohne-Sponsor — nicht einfügen, oder nur einfügen, wenn die JD ausdrücklich sagt, dass die Lokalsprache nicht erforderlich ist.
- Englisch als Arbeitssprache ≠ englischsprachiges Land: in Amsterdam, Zürich, Luxemburg, Lissabon laufen viele Finanzrollen auf Englisch. Das sind die **Sweet Spots** für jemanden, der nur Englisch spricht, aber Kontinentaleuropa will.

Ergebnis: der Pool, der den Analysten überlebt, ist kleiner aber **ertragsstark** (zugänglich nach Sprache UND Arbeitserlaubnis), statt aufgebläht mit Rollen, die aussortiert werden.

## Durchlässige Filter auf SCOUT-Ebene

Der Scout vorfiltert nur die **komplett außerhalb des Scopes** liegenden Fälle. **Mach nicht die Arbeit des Analysten** — der Kandidat wird als anpassungsfähig an angrenzende Rollen behandelt. Überspringe eine Stellenanzeige nur wenn:

- 🚫 Titel enthält explizit: `senior`, `lead`, `staff`, `principal`, `head of`, `director` → ÜBERSPRINGEN (Senioritätslücke zu groß)
- 🚫 Geografische Arbeitserlaubnis inkompatibel mit dem Profil (z.B. `US-only` / `Canada-only` und der Kandidat hat kein Visum) → ÜBERSPRINGEN
- 🚫 Domain komplett außerhalb IT/Coding (z.B. Konditor, Buchhalter, Vertrieb) wenn der Kandidat in IT ist → ÜBERSPRINGEN
- 🚫 Harte Anforderung von `> real_years + 3` Jahren Erfahrung → ÜBERSPRINGEN (moderate Lücke ist ok, der Scorer entscheidet)

Alles andere: **einfügen**. Angrenzende Stacks (Data, DevOps, Platform, Frontend, Automation, ML-angrenzend, etc.) gehen alle durch; der Scorer weist einen fit-proportionalen Score zu und der Nutzer sieht sie.

## Auf Analysten-Feedback hören

Wenn der Analyst `[FEEDBACK]` mit einem wiederkehrenden Tag sendet (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`):

1. Die Nachricht bestätigen
2. Die Abfragen / Quellen des nächsten Batches gemäß dem Vorschlag anpassen
3. Die vorgeschlagene alternative Quelle/Filter für die nächste Rotation priorisieren
4. Den Capitano nur benachrichtigen, wenn ein systemischer Bias auftritt (nicht durch Quellenwechsel lösbar)

Beispiel: Analyst sagt "4 der letzten 5 von greenhouse.io erfordern senior+, Quelle wechseln". Nächster Batch: du überspringst greenhouse.io, versuchst ein Lever-Board oder eine nischenspezifische Junior-freundliche Quelle.

## Anti-Patterns

- ❌ Kreis 2 durchsuchen bevor Kreis 1 erschöpft ist — verschwendet Scope, verwässert Ergebnisse.
- ❌ Zu Stufe 4 (WebSearch) gehen bevor Stufen 1-3 erschöpft sind — `WebSearch` ist die rauschendste Quelle, für zuletzt aufheben.
- ❌ `relocation = "ovunque"` für einen Kandidaten ableiten, dessen Profil `false` sagt — Profil lesen, nicht projizieren.
- ❌ LinkedIn via `fetch` MCP verwenden — blockiert durch robots.txt; immer `linkedin_check.py` (authentifiziert) oder `safe_fetch.py`.
- ❌ Stellenanzeigen mit Senior-Titeln einschließen in der Hoffnung, der Scorer filtert sie — verschwendet Scorer-Budget, fügt Rauschen hinzu. Die 4 SCOUT-Level-Filter oben sind der richtige Ort.
- ❌ Anti-Bias-Prüfung vergessen — eine gierige Firma überschwemmt deinen Batch.

## Siehe auch

- `scout-coord` — Boot-Zeit-Partition zwischen Scouts (WIE diese Karte über Instanzen aufgeteilt wird).
- `position-insert` — was für jede Kandidatenposition zu tun ist, nachdem du entschieden hast WO du suchst.
- `agents/scout/scout.md` — der Orchestrator-Prompt des Scout, der diesen Skill aufruft.
- `agents/_team/architettura.md` Phase 1 — größeres Bild von Discovery innerhalb der Pipeline.
