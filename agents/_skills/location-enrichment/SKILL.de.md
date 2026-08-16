<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: location-enrichment
description: Standardisierung des Freitexts in positions.location in strukturierte loc_*/work_*/role_family-Spalten BEVOR eine Position als `checked` markiert wird. Deckt 10 Sonderfälle ab (Europe Remote, Italy+remote, Multi-Standort, US-Entity-in-EU). Erzwingt Eine-Position-nach-der-anderen, peer-abgestimmtes Vokabular, niemals NULL work_country. Verwenden, wann immer der Analyst status=checked bei einer Position setzen will.
allowed-tools: Bash(python3 *), Bash(jq *), WebSearch
---

# location-enrichment — Playbook Strukturierung Standort + role_family

Der Analyst befüllt **11 Spalten** der Tabelle `positions` BEVOR er
`status=checked` markiert. Niemals eine Position `checked` lassen ohne
Location-Enrichment.

## Die 11 zu befüllenden Spalten

```
role_family         text   semantische Kategorie der Rolle
loc_city            text   Bürostadt (NULL wenn nur Land)
loc_region          text   Region/Bundesland (optional)
loc_country         text   physisches Büro-Land (NULL wenn nur Kontinent)
loc_country_code    text   ISO-3166 alpha-2: IT, IE, HU, ...
loc_continent       text   Europe | Asia | Americas | Africa | Oceania
work_mode           text   onsite | hybrid | remote
work_country        text   Vertragsland (Entity die unterschreibt) — NIEMALS NULL
work_country_code   text   ISO-2 des work_country
is_multi_location   bool   true wenn JD mehrere Städte/Länder auflistet
location_notes      text   freie Notizen des Analysten
```

## Verhaltensregeln (KRITISCH — Sim 1-2 hat hier Probleme gefunden)

### R1 — Eine Position nach der anderen (KEIN BATCH)

Verarbeite deinen Bereich eine Position pro Runde: JD lesen → nachdenken →
db-update → status=checked → nächste. KEIN Laden von 20+ JDs in einer
einzigen LLM-Runde. Ausnahme: 3-5 banale Fälle ohne Web-Suche (z.B.
"Dublin, Ireland" + hybrid).

**Warum**: Batches von 17k+ Token (Sim 1) erzeugen generische Antworten
("multi-location + remote + EU") statt spezifischer Daten für jeden
Datensatz. Und die anderen Analysten drehen sich während deines Mega-Turns leer.

### R2 — Peer-DB-Lookup Taxonomie (alle 5-10 Datensätze)

BEVOR du einen `role_family`-Wert wählst, prüfe was die
Kollegen verwendet haben:

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT role_family, COUNT(*) AS n FROM positions
   WHERE role_family IS NOT NULL
   GROUP BY role_family ORDER BY n DESC"
```

Wenn du eine semantisch **äquivalente** Family findest, GLEICHE DICH
ihrem Namen an. Fehlerhafte Beispiele aus Sim 1:

```
✗ "Translation / Localization" vs "Localization / Language Quality"
  vs "Language / Localization"           → nur eine
✗ "Customer Support" vs "Customer Success / Technical"
  vs "Technical Support"                 → nur eine
✗ "Technical Engineering" für einen Technical Writer  → falsch
```

Wenn die Position wirklich eine neue Kategorie ist, in
`location_notes` vermerken warum.

### R3 — Fallback work_country (NIEMALS NULL bei checked)

Wenn nach 2 Web-Such-Versuchen `work_country` nicht mit
Sicherheit gefunden wird, NICHT NULL lassen. Vorgehen:

1. Land des **Posting-Boards** (z.B. linkedin.it → IT) + Notiz
   `"work_country inferred from posting board (low confidence)"`
2. Land, das in der JD als "region" / "office" erwähnt wird, auch wenn nicht Hauptsitz
3. Letzter Ausweg: der `loc_continent` als Platzhalter + Notiz
   `"work_country=Europe placeholder, entity unverified"`

### R4 — Peer-DB-Lookup Städte (VOR dem Schreiben von `loc_city`)

Genau wie R2 für `role_family`, aber für **Städte**. VOR dem Schreiben
von `loc_city` prüfe, welche Form die Kollegen bereits für dieses Land
verwendet haben, um kein Duplikat in einer anderen Sprache zu erzeugen
(Rome vs Roma, Milan vs Milano):

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT loc_country, loc_city, COUNT(*) AS n FROM positions
   WHERE loc_city IS NOT NULL
   GROUP BY loc_country, loc_city ORDER BY loc_country, n DESC"
```

- Wenn die Stadt **bereits vorhanden** ist in einer Form → GLEICHE DICH
  dieser an (sofern sie den Standard "englisches Exonym" einhält, siehe
  unten).
- Wenn du ein Duplikat in einer anderen Sprache bereits in der DB siehst
  (z.B. sowohl `Roma` als auch `Rome` vorhanden), verwende die
  **englische** Form und vermerke in `location_notes` die zu
  konsolidierende Form.

## Schreibstandard

### Länder (`loc_country` / `work_country`)

| Ja ✓ | Nein ✗ |
|---|---|
| `Italy` | `Italia`, `IT`, `Italie` |
| `United Kingdom` | `UK`, `Great Britain`, `England` |
| `Czechia` | `Czech Republic` |
| `Netherlands` | `Holland`, `The Netherlands` |
| `Székesfehérvár` | `Szekesfehervar` (Diakritische Zeichen immer beibehalten) |
| ISO-2 `IT, IE, HU, NL, DE, GB, US, ES` | ISO-3, Kleinbuchstaben |

### Städte (`loc_city`) — englisches Exonym wenn vorhanden

**Einzige Regel**: Schreibe immer die **englische** Form der Stadt, wenn
ein etabliertes Exonym existiert. Wenn die Stadt KEIN englisches Exonym
hat, verwende den lokalen Namen **unter Beibehaltung der diakritischen
Zeichen**. Dies gleicht den Analysten mit der Dedup-Karte des Scouts ab
(`_CITY_SYNONYMS` in `shared/skills/db_insert.py`) und eliminiert
Duplikate wie Rome/Roma, Milan/Milano.

| Ja ✓ (EN-Exonym) | Nein ✗ (lokale Form) |
|---|---|
| `Rome` | `Roma` |
| `Milan` | `Milano` |
| `Naples` | `Napoli` |
| `Turin` | `Torino` |
| `Florence` | `Firenze` |
| `Venice` | `Venezia` |
| `Genoa` | `Genova` |
| `Munich` | `München`, `Monaco di Baviera` |
| `Cologne` | `Köln` |
| `Vienna` | `Wien` |
| `Prague` | `Praha` |
| `Brussels` | `Bruxelles` |
| `Lisbon` | `Lisboa` |
| `Plzeň` (kein Exonym → lokal + Diakritika) | `Plzen` |

Im Zweifelsfall, ob ein etabliertes Exonym existiert, wende den
Peer-DB-Lookup (R4) an und **gleiche dich der bereits vorhandenen Form**
für diese Stadt an.

## Sonderfälle (Standardentscheidung)

### A — "Europe Remote" / "EMEA - Flexible" / "Remote"

```
loc_city          = NULL
loc_country       = NULL          # kein physisch gebundenes Land
loc_continent     = "Europe"      # nur wenn Bereich explizit ist
work_mode         = "remote"
work_country      = <Web-Suche Firmen-HQ → Fallback R3>
is_multi_location = false
location_notes    = "Remote within EU"
```

### B — "Italy" / "Spain" + full_remote (Land + remote)

```
loc_country       = "Italy"
loc_country_code  = "IT"
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Italy"       # gleiches Land, IT-Vertrag
work_country_code = "IT"
```

### C — "Dublin, Ireland" + hybrid (Stadt+Land sauber)

```
loc_city          = "Dublin"
loc_region        = "Leinster"    # optional
loc_country       = "Ireland"
loc_country_code  = "IE"
loc_continent     = "Europe"
work_mode         = "hybrid"
work_country      = "Ireland"
work_country_code = "IE"
```

### D — Multi-Standort gleiches Land ("Barcelona / Malaga")

```
loc_city          = NULL
loc_country       = "Spain"
loc_country_code  = "ES"
loc_continent     = "Europe"
work_mode         = "hybrid"
work_country      = "Spain"
is_multi_location = true
location_notes    = "Barcelona or Málaga (candidato sceglie)"
```

### E — Multi-Land ("Amsterdam, Berlin, London, Remote-Europe")

```
loc_city          = NULL
loc_country       = NULL
loc_continent     = "Europe"
work_mode         = "hybrid"      # oder remote
work_country      = <HQ-Firma via Web>
is_multi_location = true
location_notes    = "EU multi-country: NL, DE, GB + remote option"
```

### F — Vages Metropolgebiet ("Greater Bologna Metropolitan Area")

```
loc_city          = "Bologna"     # auf die Hauptstadt hochstufen
loc_country       = "Italy"
location_notes    = "Area metropolitana Bologna (raggio ~30km)"
```

### G — US-Firma mit EU-Entity die in Spanien einstellt

```
loc_country       = NULL
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Spain"       # lokale Entity die unterschreibt
location_notes    = "US company (X Inc.), assume tramite entity ES"
```

### H — JD spezifiziert Stadt, die der Scout generalisiert hatte

Scout hatte "Italy" geschrieben → JD spezifiziert im Text "Milano HQ":
**auf Stadt hochstufen**.

```
loc_city          = "Milan"
loc_country       = "Italy"
location_notes    = "JD specifica HQ Milano (scout aveva 'Italy')"
```

### I — Abgekürzte Stadt ("Dublin 2")

```
loc_city          = "Dublin"
loc_region        = "Dublin 2"    # Bezirk in Region
```

### J — Firma nur Job-Board (Railsware, Top Remote Talent, etc.)

Wenn die Firma ein verteiltes Unternehmen ohne klaren HQ ist:
Fallback R3 anwenden (Land des Posting-Boards) + vermerken.

## Absolut verboten

- ❌ `loc_country = "Europe"` oder `"EMEA"` — das ist Kontinent, nicht Land
- ❌ "EMEA" als "Europe" abbilden ohne Prüfung (umfasst Middle East + Africa)
- ❌ `work_country = NULL` bei einer `checked` Position (bricht Gehalts-UI)
- ❌ role_family erfinden wenn die Kollegen bereits ähnliche verwendet haben → siehe R2
- ❌ `loc_city` in Landessprache schreiben, wenn das englische Exonym
  existiert (`Roma`, `Milano`, `Napoli` → verwende `Rome`, `Milan`, `Naples`)
  oder ohne Peer-DB-Lookup → siehe R4 + Städtetabelle
- ❌ Den gesamten Batch des eigenen Bereichs laden → siehe R1
- ❌ **`loc_city = "Remote" / "Anywhere" / "Distributed"`** — das sind KEINE Städte.
  Wenn die Position full-remote ohne spezifische Stadt ist, `loc_city = NULL`.
  Bug beobachtet in Sim 4: A2 schrieb `loc_city='Remote'` für 8 Datensätze
  (Canonical, Miratech, Link Group, etc.). Immer korrigieren mit
  `db_update --loc-city ""` (leerer String = NULL).

## Typische Befehle

### Komplette Standortstruktur speichern

```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --loc-city "Dublin" \
  --loc-region "Leinster" \
  --loc-country "Ireland" --loc-country-code "IE" \
  --loc-continent "Europe" \
  --work-mode "hybrid" \
  --work-country "Ireland" --work-country-code "IE" \
  --is-multi-location false \
  --role-family "Technical Writing" \
  --location-notes ""
```

### Peer-Lookup Taxonomie (alle 5-10 Datensätze ausführen)

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT role_family, COUNT(*) AS n
   FROM positions WHERE role_family IS NOT NULL
   GROUP BY role_family ORDER BY n DESC"
```

### Beförderung auf checked (NUR nach vollständigem Enrichment)

```bash
python3 /app/shared/skills/db_update.py position <ID> --status checked \
  --notes "ESPERIENZA: ... \\n LINGUA: ... \\n SENIORITY: ..."
```
