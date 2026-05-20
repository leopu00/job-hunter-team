# Mappamondo interattivo dashboard — design doc

**Date**: 2026-05-20
**Stato**: design lockato, implementazione non ancora iniziata
**Branch target**: dev2

## 🎯 Goal

Mostrare sulla dashboard un mappamondo 3D interattivo (stile Google Earth) con un pin per ogni ufficio di lavoro associato a una posizione trovata dagli agenti. L'utente puo' ruotare, zoomare, cliccare i pin per aprire la posizione.

## 🔑 Decisione architetturale chiave: precision = ufficio, non citta'

**Lock-in 2026-05-20**: i pin geolocalizzano l'**ufficio specifico** (es. "Via Marsala 39, Roma" — sede locale dell'azienda menzionata nell'annuncio), non solo la citta'. Questo abilita una vista bi-livello:

- **Zoom out (continente / nazione)**: bolla "Roma 35 pin", "Berlin 8 pin", ecc. Cluster city-level renderizzato lato client.
- **Zoom in (citta')**: pin separati per ogni ufficio. Due offerte da aziende diverse a Roma non finiscono nello stesso punto.

**Rationale**: a parita' di sforzo di geocoding, avere coordinate office-level rende la feature utile anche per "vedo che molte offerte sono concentrate in zona Termini" o "qui c'e' tutto un cluster fintech in via Veneto", non solo "35 a Roma". E' un boost narrativo che giustifica il lavoro di geocoding.

## 🤖 Divisione compiti agenti

**Scout** (al momento dello scrape):
- Estrae dal job posting (e/o sito aziendale linkato) l'indirizzo precedo dell'ufficio dove la posizione opererebbe.
- Compila i nuovi campi `office_address`, `office_lat`, `office_lon` su `positions`.
- Per offerte remote: lascia coordinate `NULL`, marca `is_remote = true`.
- Per offerte con sede sconosciuta: lascia tutto `NULL`, marca `office_geocoded = false` per signal che serve fallback.

**Analista** (durante l'esistente verifica posizione):
- Step aggiuntivo: valida che le coordinate inserite dallo Scout siano sensate vs il contesto.
  - "Annuncio dice Milano, lo Scout ha messo lat/lon di un ufficio a Berlino" → flag `office_verified = false`, note esplicative.
  - Se lo Scout ha lasciato NULL e l'analista trova la sede esplicita nell'annuncio → riempie i campi.
- Output: `office_verified` boolean.

**Geocoder worker** (fallback / backfill):
- Worker dedicato che gira N volte al giorno: legge positions con `office_address IS NOT NULL AND office_lat IS NULL`, chiama Nominatim/OSM, popola le coordinate.
- Anche backfill iniziale delle 251 positions storiche.
- Rate-limit Nominatim: 1 req/s.

## 🗄 Schema DB (proposta)

### Tabella `positions` — nuove colonne

```sql
ALTER TABLE positions
  ADD COLUMN office_address TEXT,         -- "Via Marsala 39, 00185 Roma RM, Italia"
  ADD COLUMN office_lat NUMERIC,
  ADD COLUMN office_lon NUMERIC,
  ADD COLUMN office_geocoded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN office_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN is_remote BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX positions_office_coords_idx
  ON positions (office_lat, office_lon)
  WHERE office_lat IS NOT NULL;
```

### Tabella `location_geocode` — cache dedup

```sql
CREATE TABLE location_geocode (
  canonical    TEXT PRIMARY KEY,   -- es. "via marsala 39 roma 00185"
  raw_text     TEXT,               -- ultima variante vista
  lat          NUMERIC,
  lon          NUMERIC,
  city         TEXT,
  country      TEXT,
  geocoded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source       TEXT NOT NULL       -- 'scout' | 'analista' | 'nominatim' | 'manual'
);
```

**Perche' separata da positions**: lo stesso indirizzo "Via Marsala 39, Roma" puo' comparire in 5 offerte diverse → geocode 1 volta sola → 5 hit cache. Senza cache, 5 chiamate Nominatim per la stessa stringa.

## 🌍 Tech UI

- **Libreria**: `react-globe.gl` (Three.js wrapper, ~200KB gz, supporta `pointsData` con click handler, animazione auto-rotate, label HTML al hover)
- **Tile texture**: Earth notturna (`//unpkg.com/three-globe/example/img/earth-night.jpg`) per coerenza dark theme
- **Cluster algorithm**: lato client, grid-based. Sotto zoom ≤ city, raggruppa pin entro 50px screen-space in una bolla con count. Click bolla → zoom in.
- **Color coding pin**: per `status` (verde=ready/applied, blu=new, viola=scored, ecc.)
- **Sizing pin**: per `score` (raggio piu' grande = score alto)
- **Click pin**: drawer laterale con summary (titolo / azienda / score / status / link) + CTA "apri dettaglio" → /positions/[id]
- **Filtri sopra il globo**: status, score range, remote-only toggle
- **Widget size**: full-width row in dashboard, altezza ~500px. Pulsante "expand" per modal fullscreen.

## ✈ Handling "Company *"

Le offerte remote non vanno sul globo (no coordinate fisiche). Soluzione:
- Badge dedicato sopra il widget: "🌐 X offerte remote" (count, click → /positions?remote=true)
- Eventuale arco curvo "from-anywhere-to-... " se interessa visualizzare timezone span, ma e' v2.

## 🗺 MVP step concreti

1. **Migration** `017_position_office_coords.sql`: ALTER positions + CREATE location_geocode.
2. **Backfill script** `scripts/geocode-positions.ts`: legge positions con location non-NULL, normalizza, hit Nominatim, scrive cache + positions. Una tantum su 100 stringhe distinte → ~2 min.
3. **AGENTS.md / CLAUDE.md update**:
   - Scout: spec per estrazione `office_address` + geocoding (se possibile con strumenti che ha).
   - Analista: spec per verifica `office_verified`.
4. **Geocoder worker**: cron job o agente dedicato (nome candidato: `cartografo`). Legge positions con `office_address NOT NULL AND office_geocoded = false`, riempie.
5. **API** `/api/positions/coords`: ritorna `[{id, title, lat, lon, status, score}]` per il client globe.
6. **Componente** `web/app/components/CompanyGlobe.tsx`: react-globe.gl + clustering + drawer.
7. **Dashboard integrazione**: nuova row prima di Recent Positions.

## ⚖ Tradeoff espliciti

| Pro | Contro |
|---|---|
| Boost narrativo / wow factor in demo | Geocoding office-level vs city e' piu' difficile: spesso l'annuncio non da' l'indirizzo preciso |
| Vista bi-livello (cluster city + pin office) utile davvero | Lavoro extra per Scout (estrarre address) e Analista (verificare) |
| Riusabile per altre viste (mappa heatmap, mappa salari) | +5 colonne su positions, +1 tabella |
| Dato di prima classe nel DB | Annunci con sede vaga ("Roma o remote") richiedono fallback a city-center |

## 📌 Cosa NON facciamo (out of scope MVP)

- Heatmap per concentrazione salari (v2)
- Archi "remote, timezone-bound" (v2)
- Integrazione con timezone widget esistente (v2)
- Multi-tenant: per ora i pin sono dell'utente loggato, no aggregazione cross-user
- Mobile globe: lo lasciamo desktop-only inizialmente (perf 3D su mobile)

## 🔗 Riferimenti

- `react-globe.gl`: https://github.com/vasturiano/react-globe.gl
- Nominatim policy: https://operations.osmfoundation.org/policies/nominatim/
- Pattern attuale agenti: `docs/internal/2026-05-19-dashboard-routing-cases.md`, `tui/agents/` definitions
