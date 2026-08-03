<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: office-geocoding
description: Genaue Bürogebäude-Geokodierung (Lat/Lon/Adresse) für eine Position, NACHDEM location-enrichment loc_city/loc_country befüllt hat. Web-Suche aggressiv nutzen (3+ Versuche) um die Firmen-HQ/Büro-Adresse zu finden, dann Koordinaten via Nominatim/Photon auflösen. Nur ÜBERSPRINGEN wenn erschöpfende Suche fehlschlägt oder mehrere mehrdeutige Büros existieren. Setzt office_lat, office_lon, office_address, office_geocoded, office_verified.
allowed-tools: Bash(python3 *), Bash(curl *), Bash(jq *), WebSearch, WebFetch
---

# office-geocoding — Genaue Koordinaten des Büros

Läuft **nach** `location-enrichment`. Voraussetzungen: `loc_city` und/oder
`loc_country` befüllt (aus R12-15). Wenn die Position full-remote ohne
Stadt ist, sofortiges Überspringen (kein Büro zu geokodieren).

## 5 zu befüllende Spalten

```
office_lat        numeric  Breitengrad WGS84 (z.B. 41.8933203)
office_lon        numeric  Längengrad WGS84 (z.B. 12.4829321)
office_address    text     vollständige Büroadresse
office_geocoded   bool     true wenn Geokodierung durchgeführt wurde
office_verified   bool     true wenn DU SICHER bist, dass es das richtige Büro ist;
                           false wenn Stadt-Level-Fallback / mehrdeutig
```

## Goldene Regel: Web-Verifizierung ist verpflichtend

**Speichere NIEMALS eine Straßen-Level-Adresse ohne sie vorher via Web
als echtes Büro der Firma verifiziert zu haben.** Die korrekte Reihenfolge
ist **Web-Suche ZUERST, Geokodierung DANACH** — nicht umgekehrt.

### Kanonische Reihenfolge (immer in dieser Reihenfolge)

1. **Versuch 1 — Web-Suche HQ der Firma in der Stadt**
   - Abfrage: `"<Firma> headquarters <stadt> address"`, `"<Firma>
     sede <stadt>"`, `"<Firma> office <stadt>"`, `"<Firma> contact"`
   - Akzeptable Quellen als Beweis: offizielle Firmenwebsite,
     LinkedIn "About", Crunchbase, Handelsregister (partitaiva.it,
     cerved.com für IT), Google Maps Ergebnis der Firma.
   - **Adresse extrahieren** aus der gefundenen Quelle.

2. **Versuch 2 — Extraktion aus der JD**
   - Nach Mustern suchen: "Visit us at...", "Sede operativa:", "Our office",
     Adresse in der Fußzeile der JD.

3. **Versuch 3 — Webfetch einer verdächtigen Quelle**
   - Wenn die Web-Suche Titel zeigt aber keinen Snippet mit Adresse,
     `WebFetch` der offiziellen Seite zur Extraktion.

4. **Geokodierung via Nominatim/Photon** **NUR nachdem** die Adresse
   gefunden wurde. Nominatim/Photon konvertieren Text→Koordinaten, **sind
   keine Verifizierung**. Keine Adresse aus dem Web → kein
   `office_verified=true`.

5. **Fallback Stadt-Level** wenn alle obigen Versuche fehlschlagen:
   den **Stadtnamen** geokodieren (z.B. `"Roma, Italy"`), speichern mit
   `office_verified=false` und `office_address = <stadt>, <land>`.
   **NIEMALS NULL lassen wenn die Position Stadt/Land vom Location-
   Enrichment hat** — den Fallback Stadt verwenden.

### Wann mit ALLEM NULL überspringen

Nur wenn die Position full-remote ohne loc_city/loc_country ist (kein
physisches Büro zu geokodieren). Siehe Abschnitt "Wann ÜBERSPRINGEN" unten.

## Wann mit `office_verified=true` befüllen

Du bist **wirklich sicher**, dass diese Adresse das richtige Büro ist:

- Firmenwebsite bestätigt explizit den Sitz in dieser Stadt
- Stellenanzeige enthält Straßenadresse + Hausnummer explizit
- LinkedIn "About" der Firma listet diese Stadt mit Adresse auf
- Handelsregister / Handelskammer für Italy/EU-Firmen

## Wann mit `office_verified=false` befüllen

Du hast Koordinaten aber mit Unsicherheit:

- Du hast den Hauptsitz gefunden, aber JD sagt "wir haben mehrere Büros
  in <stadt>, Kandidat arbeitet von einem von ihnen"
- Du hast Stadt-Level geokodiert (Stadtzentroid) als Fallback
- Die Adresse ist approximiert (z.B. nur Viertelname ohne Straße)

## Wann ÜBERSPRINGEN (alles NULL lassen)

```
office_lat = NULL
office_lon = NULL
office_address = NULL
office_geocoded = false
office_verified = false
```

- Full Remote: Position vollständig verteilt ohne spezifische Stadt
- Mehrdeutiger Multi-Standort: "Roma oder Milano oder Torino" + work_mode=remote
- 3+ Versuche fehlgeschlagen, nichts Konkretes gefunden
- Firma extrem generisch (Agentur/Recruiter ohne eigenes Büro für
  diese Position)

## Workflow-Befehle

### Schritt 1 — Web-Suche HQ der Firma

```bash
# Hauptsitz der Firma in dieser Stadt suchen
# 2-3 verschiedene Abfragen probieren wenn die erste nicht klärt
```

Verwende das Tool `WebSearch` mit Abfragen wie:
- `"<Firma> headquarters <stadt> address"`
- `"<Firma> office <stadt> via OR street"` (italienisch: via)
- `"<Firma> sede legale OR sede operativa <stadt>"` (italienisch)
- `"<Firma> contact us <stadt>"` (hat oft Adresse)

Für italienische JDs im Besonderen auch suchen:
- `"<Firma> Roma sede"` / `"<Firma> Milano via"` / etc.
- In Registern wie `partitaiva.it`, `easy.it`, `cerved.com`,
  `infoimprese.it` für italienische Firmen

### Schritt 2 — Geokodierung via Nominatim (1 req/sec Rate-Limit)

```bash
# Abfrage URL-kodieren
Q=$(jq -nr --arg s "<gefundene adresse> <stadt>" '$s | @uri')

curl -sS "https://nominatim.openstreetmap.org/search?q=${Q}&format=json&limit=1" \
  -H 'User-Agent: jht-analyst/1.0 (analista@jht.local)' \
  --max-time 15
```

JSON-Antwort: `[{"lat": "...", "lon": "...", "display_name": "..."}]`.
`lat`, `lon`, `display_name` (= `office_address`) extrahieren.

**Rate-Limit**: 1,2 Sek. zwischen Nominatim-Abfragen schlafen. Bei 429: zu Photon wechseln.

### Schritt 3 — Fallback Photon (komoot, kein sichtbares Rate-Limit)

```bash
Q=$(jq -nr --arg s "<Firma> <Stadt>" '$s | @uri')
curl -sS "https://photon.komoot.io/api?q=${Q}&limit=1" \
  -H 'User-Agent: jht-analyst/1.0' --max-time 15
```

GeoJSON: `features[0].geometry.coordinates = [lon, lat]` (Hinweis: umgekehrte
Reihenfolge! Photon = `[lon, lat]`, Nominatim = `{"lat","lon"}`).

### Schritt 4 — UPDATE Supabase via Wrapper

```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --office-lat 41.8933203 \
  --office-lon 12.4829321 \
  --office-address "Via Roma 1, 00100 Roma, Italy" \
  --office-geocoded true \
  --office-verified true \
  --action geocode --outcome updated
```

Zum Überspringen nach 3 Versuchen:
```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --office-geocoded false --office-verified false \
  --action geocode --outcome failed
# (lat/lon/address bleiben NULL)
```

## Typische gelöste Fälle

### Fall 1 — Italienische Firma mit klarem einzelnem Sitz

```
"Bending Spoons" + "Milano"
→ Web-Suche: "Bending Spoons via Nino Bonnet 10, 20154 Milano"
→ Nominatim: 45.4870, 9.1908
→ office_address = "Bending Spoons Spa, Via Nino Bonnet, Milano"
→ office_verified = TRUE
```

### Fall 2 — Mehrere Sitze in derselben Stadt (explizit TBD)

```
"ION Group" + "Roma" → hat 3 Büros in Rom (Eur, Centro, Tiburtina)
→ JD spezifiziert nicht welches → office_verified = FALSE
→ Koordinate des Hauptsitzes (HQ Roma) verwenden
→ office_address = "ION Trading Italy, Viale dell'Aeronautica 100, Roma"
```

### Fall 3 — JD enthält Adresse im Text

```
JD: "...vieni a trovarci in Via Tagliamento 45, Roma..."
→ Adresse direkt aus dem jd_text extrahieren
→ Das geokodieren → office_verified = TRUE
```

### Fall 4 — Überspringen wegen Mehrdeutigkeit

```
"IBM" + "Roma" + remote-eligible
→ IBM hat 4 Sitze in Rom, JD spezifiziert nicht
→ office_geocoded=true, office_verified=false, Koordinate HQ-Sitz Roma
→ location_notes enthält bereits "IBM Roma multi-sede"
```

### Fall 5 — Überspringen wegen Full Remote

```
work_mode = remote, loc_city = NULL
→ Position hat kein physisches Büro → alles NULL
→ office_geocoded = false, office_verified = false
```

## Rate-Limit-Policy

- Nominatim: 1 req/sec, 1,2s zwischen Abfragen schlafen. Nie mehr als 6 req in 10s.
- Photon: kein sichtbares Rate-Limit, trotzdem 0,5s Höflichkeitspause.
- Web-Suche: lazy, nur wenn direkte Geokodierung fehlschlägt.
- Bei 429 von Nominatim: 30s schlafen, zu Photon wechseln, Nominatim für die nächsten 5 Minuten NICHT erneut versuchen.

## Verboten

- ❌ Plausible Koordinaten ohne Web-Verifizierung erfinden
- ❌ `office_verified=true` setzen wenn Stadtzentroid verwendet wurde
- ❌ Nach EINEM einzigen leeren Nominatim-Versuch aufgeben
- ❌ Full-Remote geokodieren (kein physisches Büro)
- ❌ `office_geocoded=NULL` lassen (muss explizit `true` oder `false` sein)
- ❌ Eine Nominatim-Adresse "gefunden" speichern ohne sie vorher
  an einer Web-Quelle (Firmenwebsite / LinkedIn / Handelsregister)
  verankert zu haben → Risiko, einen ähnlichen Namen in einer anderen Stadt zu geokodieren
- ❌ `office_address=NULL` lassen für Positionen die Stadt/Land HABEN:
  verpflichtender Fallback `office_address = "<stadt>, <land>"` mit
  `office_verified=false`
