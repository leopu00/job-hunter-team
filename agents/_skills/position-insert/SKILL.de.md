<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: position-insert
description: "Die 5-Gate-Sequenz, die der Scout fuer JEDE Kandidatenposition durchlaeuft, bevor er in `positions` INSERTet: Dedup → Link-Verifizierung → JD-Abruf → permissive Filter → INSERT. Das Ueberspringen eines Gates fuellt die DB mit Duplikaten, toten Links oder nicht relevanten Zeilen, die der Analyst dann verwerfen muss — verschwendetes Sonnet-Budget downstream. Gehoert der Scout-Rolle; kombinieren mit `circles-and-sources` (bestimmt WO gesucht wird) und `scout-coord` (bestimmt WER wo sucht)."
allowed-tools: Bash(curl *), Bash(python3 *), Bash(grep *)
---

# position-insert — 5 Gates pro Position

Eine Position ist nur dann einen INSERT wert, wenn alle fuenf Gates bestanden werden. Die Reihenfolge ist wichtig: Die guenstigeren Pruefungen kommen zuerst, damit die teuren (vollstaendiger JD-Abruf + Filterung) nur bei vielversprechenden Kandidaten ausgefuehrt werden.

## Gate 1 — Dedup (guenstig, zwingend zuerst)

```bash
python3 /app/shared/skills/db_query.py check-url <linkedin_id_or_url>
```

- Ausgabe `TROVATA` → **SKIP** (bereits in der DB, moeglicherweise anderer Status — niemals erneut einfuegen).
- Ausgabe `NON TROVATA` → weiter zu Gate 2.

Der Dedup-Schluessel ist die kanonische URL (oder LinkedIn-Job-ID fuer LinkedIn). Wenn dieselbe Stellenanzeige aus zwei verschiedenen Quellen stammt (z. B. Firmen-Karriereseite UND ein LinkedIn-Cross-Listing), dedupliziert `check-url`.

## Gate 2 — Link-Verifizierung (HTTP + URL)

Zweistufiger `curl`, um tote Stellenanzeigen UND stille Weiterleitungen auf eine generische `/careers`-Seite zu erkennen (= Stelle entfernt, aber Seite liefert 200).

### Schritt 2a — Statuscode + finale URL

```bash
curl -s -o /dev/null -w "HTTP:%{http_code} URL_FINALE:%{url_effective}" \
  -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' '<URL>'
```

| Ergebnis                                      | Aktion                                         |
|-----------------------------------------------|------------------------------------------------|
| `HTTP:404` / `HTTP:410`                       | SKIP (toter Link)                              |
| `HTTP:301/302` zu einer generischen `/careers` oder `/jobs` | SKIP (Position entfernt, generische Weiterleitung) |
| `HTTP:200/301/302` finale URL = Stellenseite  | weiter zu Schritt 2b                           |

### Schritt 2b — Inhaltssignale

```bash
curl -s -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' '<URL>' \
  | grep -i 'no longer accepting\|closed-job\|position has been filled\|expired\|job not found'
```

- Treffer → SKIP (geschlossene Stelle)
- Kein Treffer → weiter zu Gate 3

### Workable-Hinweis

Fuer ATS, das auf Workable gehostet wird: Es gibt **zwei** URLs pro Stellenanzeige. Verwende die richtige:
- `apply.workable.com/...` → Bewerbungsformular: gibt `302` zurueck, wenn die Stelle geschlossen ist (sieht aus wie ein toter Link, falsch-positiv).
- `jobs.workable.com/...` → kanonische JD-Seite: HTTP 200 + gueltiges JSON-LD, wenn die Position aktiv ist.

Verifiziere immer die **kanonische** Seite (`jobs.workable.com`), nicht das Bewerbungsformular. Gleiches Prinzip fuer Greenhouse, Lever, Ashby.

## Gate 3 — Vollstaendige JD abrufen

Der DB-Vertrag verlangt, dass `--jd-text` und `--requirements` VOLLSTAENDIG sind — unvollstaendige Scrapes beeintraechtigen den Analyst downstream.

```bash
# Stufe 1 — curl mit Browser-UA (die meisten Faelle)
curl -s -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' '<URL>' > $JHT_AGENT_DIR/tmp/jd-raw.html

# Stufe 2 — JS-lastige Seiten (Wellfound, manche Custom-Karriereseiten): playwright MCP verwenden
# Stufe 3 — Fallback: WebFetch / WebSearch
```

Extrahiere den **vollstaendigen Textkoerper** (nicht nur den Titel) und den **Anforderungsbereich** (Skills, Berufserfahrung in Jahren, Sprachen). Wenn die Seite einen klaren Abschnitt "Requirements" / "Must have" / "What you'll bring" hat, uebernimm ihn woertlich in `--requirements`.

Blockierte Seiten (NICHT `fetch` MCP verwenden, blockiert durch robots.txt):
- `linkedin.com` → `linkedin_check.py` (authentifiziert) oder `curl` mit Browser-UA verwenden
- `wellfound.com` → `playwright` oder `curl` verwenden

## Gate 4 — Permissive Scout-Level-Filter

Wende NUR die vier voellig-ausserhalb-des-Umfangs-Filter an (vollstaendige Tabelle im Skill `circles-and-sources`). Ueberspringe, wenn:

- Titel enthaelt explizit: `senior`, `lead`, `staff`, `principal`, `head of`, `director`
- Geografische Arbeitserlaubnis inkompatibel (`US-only` / `Canada-only` und Kandidat hat kein Visum)
- Domaene komplett ausserhalb von IT/Coding (und Kandidat ist in IT)
- Harte Anforderung von `> real_years + 3` Jahren Berufserfahrung

Alles andere: durchlassen zu Gate 5. **Mach nicht die Arbeit des Analysten** — verwandte Stacks, Fast-Treffer, kleine Luecken sind alles `checked`-Material; der Scorer wendet den Gap-Penalty an.

## Gate 5 — INSERT

```bash
python3 /app/shared/skills/db_insert.py position \
  --title "<TITOLO>" \
  --company "<AZIENDA>" \
  --url "<URL canonica, NON apply form>" \
  --location "<location reale dalla JD>" \
  --remote-type <full_remote|hybrid|on_site> \
  --source <slug fonte: linkedin|greenhouse|lever|indeed|wellfound|remoteok|...> \
  --found-by $MY_ID \
  --jd-text "<TESTO COMPLETO DELLA JD>" \
  --requirements "<stack + requirements estratti dalla JD>"
```

**Alle Flags sind obligatorisch** — leeres `--jd-text` oder fehlendes `--url` bedeutet, dass der Analyst seine Arbeit nicht machen kann. Das Skript `db_insert.py` erzwingt nicht-leere Werte; wenn es deinen Aufruf ablehnt, korrigiere die Eingabe — umgehe es niemals mit rohem SQL.

## DB-Schreibgrenze (T05 + Rolle)

Der Scout schreibt NUR:
- `positions` (INSERT, niemals UPDATE ausser im Dup-Recovery-Fall unten)

Beruehrt NIEMALS:
- `companies` (Analyst-Bereich)
- `scores` (Scorer)
- `applications` (Scrittore)
- `position_highlights` (Analyst)
- Positionen mit `status != 'new'` (bereits downstream weitergeleitet, Haende weg)

### Dup-Recovery (das einzige erlaubte UPDATE)

Wenn du versehentlich ein Duplikat eingefuegt hast (Gate 1 hat sich geirrt, z. B. eine normalisierte URL ist durchgerutscht), kannst du das Duplikat als excluded markieren — aber niemals DELETE:

```bash
python3 /app/shared/skills/db_update.py position <DUP_ID> --status excluded \
  --notes "DUPLICATA di #<ORIGINAL_ID>"
```

`DELETE` / `DROP` SQL ist verboten (T02 + DB-Sicherheit). Ruecknahmen ueber `excluded`-Notizen sind auditierbar; Loeschungen nicht.

## Nach dem INSERT — Analysten benachrichtigen

Sende nach jedem Batch von 3-5 Inserts einen Ping an die Analyst-Sessions mit dem ID-Bereich. Sie holen `status=new` sowieso aus der DB, aber der Ping verkuerzt die Latenz:

```bash
jht-tmux-send ANALISTA-1 "[@$MY_ID -> @analista-1] [INFO] Batch 5 posizioni inserite (IDs: X-Y)"
```

Wenn du 2 Analysten hast, wechsle das Ping-Ziel ab, um die Last zu verteilen (Analysten haben auch eine `last_checked`-Claim-Koordination, sodass es nie falsch ist, aber die tmux-Benachrichtigung verbessert die Reaktionsfaehigkeit).

## Anti-Patterns

- ❌ Gate 1 ueberspringen, "weil es neu aussah" — `check-url` ist guenstig, fuehre es immer aus.
- ❌ Mit leerem `--jd-text` einfuegen, "ich fuell's spaeter aus" — es gibt kein spaeter, der Analyst verarbeitet es als naechstes.
- ❌ Verifizierung mit `curl` ohne `-L` — eine 302-Weiterleitung auf eine generische `/careers`-Seite sieht ohne Follow-Redirect lebendig aus; du wuerdest eine tote JD einfuegen.
- ❌ Das Bewerbungsformular auf Workable verifizieren statt die kanonische JD-Seite — falsch-positive tote Links.
- ❌ `fetch` MCP auf `linkedin.com` / `wellfound.com` verwenden — blockiert, liefert ein 403-Banner statt der JD.
- ❌ Den Wrapper umgehen mit `python3 -c "import sqlite3; INSERT ..."` — bricht Dedup-Invarianten und `found-by`-Tracking, und die DB weist es jetzt ebenfalls ab: `positions.url` ist UNIQUE. `UNIQUE constraint failed: positions.url` heisst, die Anzeige ist schon in der DB — zurueck zu Gate 1, nicht mit veraenderter URL neu versuchen.
- ❌ `--status` auf etwas anderes als den Standard `new` setzen (der Scout setzt den Status nie manuell; der Wrapper erledigt das).

## Siehe auch

- `circles-and-sources` — was WO suchen (dieser Skill beschreibt, was zu tun ist, NACHDEM du eine Kandidatenposition gefunden hast).
- `scout-coord` — Boot-Time-Partition (dieser Skill ist pro Position, downstream der Partition).
- `db-insert` — die Wrapper-Interna + `position`-Schema.
- `agents/_manual/anti-collision.md` — breiterer Scout-Koordinationsvertrag.
- `agents/scout/scout.md` — der Orchestrator-Prompt, der diesen Skill in der Hauptschleife aufruft.
