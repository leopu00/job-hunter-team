<!-- @translation: de, ai-translated 2026-07-18 -->
---
name: logo-extraction
description: Extrahiere das Firmenlogo für ein Unternehmen der companies-Tabelle und speichere es als kleines base64-data-URI (max ~35KB, min 32px). Der primäre Weg ist voll automatisiert via logo_fetch.py gegen die offizielle Website (apple-touch-icon → icon → og:image → favicon); wenn die Site Bots blockiert oder kein brauchbares Icon hat, finde per Websuche die direkte URL eines Logo-Bildes und übergib sie mit --from-url. Prüfe VOR dem Fetch, dass die Website WIRKLICH zum Unternehmen gehört. Setzt companies.logo, logo_source, logo_fetched.
allowed-tools: Bash(python3 *), Bash(jq *), WebSearch, WebFetch
---

# logo-extraction — Firmenlogo für die Positionsseite

Das Web zeigt das Firmenlogo auf der Positions-Detailseite. Das Logo
lebt auf der `companies`-Zeile (EINE pro Unternehmen: 1000 Wizz-Air-
Positionen = 1 Logo) als kleines base64-data-URI und reist mit dem
bestehenden companies-Sync. Kein Upload, kein externer Storage.

## 3 zu befüllende Spalten (schreibt `logo_fetch.py`, NIE von Hand)

```
logo          text  base64-data-URI (png/jpeg/webp/ico), <= ~35KB raw
logo_source   text  URL, aus der das Logo extrahiert wurde (Audit)
logo_fetched  bool  true = Extraktion VERSUCHT (auch gescheitert) —
                    office_geocoded-Muster: das Unternehmen verlässt
                    die Queue next-for-logo-missing, kein Retry bei
                    jedem Durchlauf
```

## GOLDENE Regel: richtiges Unternehmen, richtige Website

**Ein falsches Logo ist schlimmer als kein Logo.** Prüfe vor dem Fetch,
dass `companies.website` WIRKLICH zum Unternehmen der Position gehört
(kein Namensvetter, nicht der Aggregator der Anzeige, nicht die falsche
Muttergesellschaft). Im Zweifel: Websuche `"<Company> official site"`
und mit Sektor/Land der Zeile abgleichen.

- Anzeige von Agentur/Recruiter (Manpower, Randstad, ...) ABER im
  Auftrag eines benannten Hotels/Unternehmens → das Logo gehört dem
  Unternehmen der mit der Position verknüpften `companies`-Zeile.
- Kette vs. Haus (z. B. „CARDO ROMA, Autograph Collection"): nimm das
  Logo der Marke, die als `companies.name` steht.

## Workflow

### Schritt 0 — Die Queue

```bash
python3 /app/shared/skills/db_query.py next-for-logo-missing
```

Listet Unternehmen mit lebenden Positionen und nie versuchtem Logo,
sortiert nach Positionszahl (die sichtbarsten zuerst). `NO WEBSITE
(cercalo prima)` = erst Schritt 1.

### Schritt 1 — Website fehlt? Finden und speichern

```bash
# nach Websuche "<Company> official website":
python3 /app/shared/skills/db_update.py company "<Company>" \
  --website https://www.wizzair.com
```

### Schritt 2 — Automatischer Fetch (der Normalweg)

```bash
python3 /app/shared/skills/logo_fetch.py "<Company>"
```

Das Skript: lädt die Homepage, probiert `apple-touch-icon` → große
`icon` → `og:image` → `/favicon.*`, validiert Format (png/jpeg/webp/
ico, NIE svg), Gewicht (200B–35KB) und Mindestseite (>=32px), speichert
das data-URI und markiert `logo_fetched=1`. JSON-Ausgabe auf stdout.
`--dry-run` zum Testen ohne Schreiben, `--force` zum Ersetzen eines
vorhandenen Logos.

### Schritt 3 — Anti-Bot-Site oder kein brauchbares Icon → `--from-url`

Wenn Schritt 2 `NO_CANDIDATE` liefert (Sites wie marriott.com
blockieren Bots):

1. Websuche `"<Company> logo png"` / `"<Company> press kit logo"` /
   Wikipedia-Seite des Unternehmens (Wikimedia-Dateien haben direkte
   URLs).
2. Finde die **direkte Bild-URL** (muss auf .png/.jpg/.webp/.ico enden
   oder das rohe Bild liefern, keine HTML-Seite).
3. ```bash
   python3 /app/shared/skills/logo_fetch.py "<Company>" \
     --from-url "https://upload.wikimedia.org/.../Wizz_Air_logo.png"
   ```
   Dieselbe Validierung (Gewicht/Format/Maße) gilt: ist das Bild zu
   schwer, suche eine leichtere Variante (Wikimedia-Thumbnail: im Pfad
   `/1200px-` durch `/240px-` ersetzen).

### Schritt 4 — Nach 3 Versuchen nichts Brauchbares → markieren, weiter

```bash
python3 /app/shared/skills/logo_fetch.py "<Company>" --mark-attempted
```

`logo_fetched=1` mit logo NULL: die Webseite zeigt den Initialen-
Fallback, das Unternehmen verlässt die Queue. NICHT über 3 Versuche
hinaus insistieren.

## Spar-Policy (enrichment-policy)

Der autonome Fetch respektiert `$JHT_HOME/profile/enrichment-policy.json`
(prüfe mit `python3 /app/shared/skills/enrichment_policy.py show`).
Mögliche Antworten von `logo_fetch.py`:

- `POLICY_DISABLED` — Sparmodus aktiv (`economy=true`) oder
  `logo.enabled=false`: NICHT extrahieren, kein Fehler. Weitermachen.
- `POLICY_SCORE_GATE` — die Firma hat noch keine lebende Position mit
  Score ≥ `logo.min_score`: NICHT insistieren. Markiert `logo_fetched`
  nicht: überschreitet der Scorer die Schwelle, kehrt die Firma von
  selbst in die Queue zurück.

`--force` umgeht die Policy: NUR auf explizite Anfrage des Nutzers
verwenden, nie eigenmächtig.

## Erwartete Qualität

- **Bevorzuge** quadratische Icons 96–256px (apple-touch-icon ist
  ideal).
- 32–48px (Favicon) ist als Notlösung akzeptabel: das Web-Quadrat ist
  klein. Unter 32px lehnt das Skript selbst ab.
- Die 35KB-Grenze ist **hart** (schützt DB und Sync): nicht umgehen,
  leichtere Variante suchen.

## Verboten

- ❌ Logo eines NAMENSGLEICHEN Unternehmens oder der falschen Gruppe
  (Web-Verifikation!)
- ❌ Logo des Aggregators/Job-Boards (LinkedIn, Indeed) statt des
  Unternehmens
- ❌ `logo`/`logo_source`/`logo_fetched` von Hand mit db_update
  schreiben: IMMER über `logo_fetch.py` (nur das validiert)
- ❌ SVG, Bilder >35KB, Icons <32px (das Skript lehnt ab: nicht
  austricksen)
- ❌ Homepage-Screenshots oder Zuschnitte: nur echte Logo-Dateien
- ❌ Mehr als 3 Versuche pro Unternehmen: `--mark-attempted` markieren
  und weiter
