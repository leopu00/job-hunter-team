// Risoluzione delle coordinate per la mappa.
//
// Ogni posizione con coordinate ufficio ESATTE (office_lat/lon) è resa alle
// sue coordinate reali → sul globo diventa un pin al suo indirizzo (è per
// questo che chiediamo al team di geocodare l'indirizzo preciso). Le posizioni
// SENZA ufficio esatto vanno nella "griglia nord" della loro città (sotto).
//
// Il centro città usa la MEDIANA (per componente lat/lon) delle coordinate
// ufficio dei record della stessa città, non la media: una singola posizione
// mal-etichettata (es. loc_city='Rome' ma ufficio geocodato a Dubai) non
// trascina più il centro della città (era il bug "pin di Roma spostati a
// Frascati"). Se la città non ha alcun ufficio geocodato (VPS fresca) si
// ripiega sul gazetteer città→coordinate (lib/city-gazetteer.ts).
//
// GRIGLIA NORD (scelta utente 23/07): le posizioni città-only NON stanno più
// tutte sulla stessa coordinata centro-città (il client le "esplodeva" in una
// fila in pixel-space che si riallargava a ogni zoom, tagliando la città).
// Ogni posizione riceve QUI una coordinata geografica propria, FISSA e
// deterministica: una griglia ordinata che parte ~10 km a nord del centro
// città e cresce verso nord (mai verso la città), così non interferisce coi
// pin che hanno un indirizzo reale. Zoom e pan non la muovono: sono normali
// coordinate lat/lon nel GeoJSON.

import {
  gazetteerCity,
  gazetteerCountryAnchor,
  canonicalCountry,
  canonicalCityKey,
} from "./city-gazetteer";

export type GeoRow = {
  loc_country: string | null;
  loc_city: string | null;
  office_lat: number | null;
  office_lon: number | null;
  // Opzionali, usati SOLO per l'ordine dentro le griglie: score decrescente
  // (i migliori nella riga più vicina all'ancora), tie-break per id →
  // layout deterministico fra refresh a parità di dati.
  id?: string | null;
  score?: number | null;
  // Opzionale, usato per smascherare gli "uffici" finti: la stessa identica
  // coordinata condivisa da aziende DIVERSE non è un building reale ma il
  // geocode generico della città (vedi GENERIC_COORD_MIN_COMPANIES).
  company?: string | null;
  // Opzionale: 'full_remote' attiva il piazzamento remote (griglia-paese a
  // SUD dell'ancora paese, o isola "anywhere") per le righe senza città.
  remote_type?: string | null;
};

// Distanza del bordo sud della griglia dal centro città (~10 km: fuori dal
// centro anche per una metropoli) e passo fra pin adiacenti (~300 m: ben
// separati a zoom street, compatti come "campo" a zoom città).
const NORTH_OFFSET_M = 10_000;
const GRID_SPACING_M = 300;
const M_PER_DEG_LAT = 111_320;

// Una coordinata-ufficio identica (~11 m, 4 decimali) condivisa da almeno
// QUESTO numero di aziende diverse è un geocode città-level salvato come
// ufficio, non un indirizzo reale (caso reale su prod: 42 posizioni di 33
// aziende tutte sul punto-centro di Roma → la vecchia "fila" sulla mappa).
// 2 aziende sullo stesso punto restano plausibili (coworking, cluster
// alberghiero); da 3 in su le trattiamo come città-only → griglia nord.
const GENERIC_COORD_MIN_COMPANIES = 3;

// Chiave città CANONICA (alias/accenti risolti dal gazetteer): "Rome" e
// "Roma" condividono centroide e griglia nord invece di sdoppiarsi.
function cityKey(country: string | null, city: string | null): string {
  return canonicalCityKey(country, city);
}

// Ancora dell'isola "remote anywhere": punto convenzionale IN MARE
// (Mediterraneo occidentale, tra Baleari e Sardegna). Fisso per tutti i
// profili: qualunque derivazione dai dati (min-lon, paese dominante)
// finiva su terra o in mezzo al Pacifico appena il dataset aveva un
// outlier — il mare aperto non è mai confondibile con una sede.
const ANYWHERE_ANCHOR = { lat: 40.0, lon: 5.0 };

/**
 * Ritorna, allineato all'ordine di `rows`, le coordinate risolte per ogni
 * posizione (ufficio esatto se presente, altrimenti slot fisso nella griglia
 * a nord della città) o null se la città non è risolvibile (né sibling
 * geocodificato né gazetteer).
 */
export function resolveCityPins(
  rows: GeoRow[],
): Array<{ lat: number; lon: number } | null> {
  // 1. Centro-città ROBUSTO dai record con coordinate ufficio: MEDIANA
  //    (per componente lat/lon), non media. La mediana ignora gli outlier,
  //    quindi una posizione mal-etichettata (loc_city='Rome' ma ufficio
  //    geocodato a Dubai) non sposta più il centro della città.
  const byCity = new Map<string, { lat: number[]; lon: number[] }>();
  for (const r of rows) {
    if (
      r.office_lat != null &&
      r.office_lon != null &&
      (r.loc_city ?? "").trim()
    ) {
      const k = cityKey(r.loc_country, r.loc_city);
      const a = byCity.get(k) ?? { lat: [], lon: [] };
      a.lat.push(r.office_lat);
      a.lon.push(r.office_lon);
      byCity.set(k, a);
    }
  }
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const centroid = new Map<string, { lat: number; lon: number }>();
  for (const [k, a] of byCity)
    centroid.set(k, { lat: median(a.lat), lon: median(a.lon) });

  // 2. Smaschera gli "uffici" finti: coordinate identiche condivise da
  //    aziende diverse = geocode generico della città → le posizioni vanno
  //    trattate come città-only. Senza `company` nei rows (call-site
  //    no-coords) nessuna coordinata risulta generica: lì conta solo se il
  //    pin è risolvibile, non dove sta, e l'esito non cambia.
  const coordCompanies = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.office_lat == null || r.office_lon == null) continue;
    const ck = `${r.office_lat.toFixed(4)}|${r.office_lon.toFixed(4)}`;
    const set = coordCompanies.get(ck) ?? new Set<string>();
    set.add((r.company ?? "").trim().toLowerCase());
    coordCompanies.set(ck, set);
  }
  const genericCoords = new Set<string>();
  for (const [ck, companies] of coordCompanies)
    if (companies.size >= GENERIC_COORD_MIN_COMPANIES) genericCoords.add(ck);

  // 3. Prima passata: uffici esatti alle coordinate reali. Le altre righe
  //    vengono smistate (con l'indice originale) nei bucket delle griglie:
  //    per città (onsite/ibride o remote CON sede di riferimento), per
  //    paese-remote (full remote col solo vincolo di paese), o isola
  //    "anywhere" (full remote senza alcun geo).
  const out: Array<{ lat: number; lon: number } | null> = new Array(
    rows.length,
  ).fill(null);
  type Member = { row: GeoRow; idx: number };
  const cityOnly = new Map<string, Member[]>();
  const remoteByCountry = new Map<string, Member[]>();
  const remoteAnywhere: Member[] = [];
  rows.forEach((r, idx) => {
    const hasOffice = r.office_lat != null && r.office_lon != null;
    const hasCity = (r.loc_city ?? "").trim() !== "";
    const fullRemote = r.remote_type === "full_remote";
    if (hasOffice) {
      const ck = `${r.office_lat!.toFixed(4)}|${r.office_lon!.toFixed(4)}`;
      // Ufficio vero (coordinata non generica) → pin lì, anche per le
      // remote (è la sede di riferimento geocodata). Coordinata generica
      // ma non ricollocabile altrove (niente città né regime remote) →
      // meglio il punto generico che sparire dalla mappa.
      if (!genericCoords.has(ck) || (!hasCity && !fullRemote)) {
        out[idx] = { lat: r.office_lat!, lon: r.office_lon! };
        return;
      }
    }
    if (hasCity) {
      // Anche le full remote con una sede di riferimento vanno alla città.
      const k = cityKey(r.loc_country, r.loc_city);
      const arr = cityOnly.get(k) ?? [];
      arr.push({ row: r, idx });
      cityOnly.set(k, arr);
      return;
    }
    if (fullRemote) {
      const country = canonicalCountry(r.loc_country);
      if (country) {
        const arr = remoteByCountry.get(country) ?? [];
        arr.push({ row: r, idx });
        remoteByCountry.set(country, arr);
      } else {
        remoteAnywhere.push({ row: r, idx });
      }
      return;
    }
    // Onsite/ibrida senza città: resta null → bucket no-coords.
  });

  // Layout griglia condiviso: quadrata (≈√N colonne), bordo a OFFSET
  // dall'ancora, righe che crescono ALLONTANANDOSI (dir +1 = verso nord,
  // -1 = verso sud). Ordine di lettura: score decrescente, ovest→est riga
  // per riga (i migliori nella riga più vicina all'ancora). Coordinate
  // pure funzioni di (ancora, insieme posizioni) → fisse a ogni zoom/pan
  // e stabili fra refresh a parità di dati.
  const layGrid = (
    members: Member[],
    anchor: { lat: number; lon: number },
    dir: 1 | -1,
  ) => {
    const sorted = [...members].sort((a, b) => {
      const sa = a.row.score ?? -1;
      const sb = b.row.score ?? -1;
      if (sa !== sb) return sb - sa;
      const ia = a.row.id ?? "";
      const ib = b.row.id ?? "";
      if (ia !== ib) return ia < ib ? -1 : 1;
      return a.idx - b.idx;
    });
    const cols = Math.ceil(Math.sqrt(sorted.length));
    const dLat = GRID_SPACING_M / M_PER_DEG_LAT;
    // Clamp del coseno: a latitudini estreme il passo in longitudine
    // divergerebbe (difensivo, nessuna città reale del dataset è lì).
    const cosLat = Math.max(0.2, Math.cos((anchor.lat * Math.PI) / 180));
    const dLon = GRID_SPACING_M / (M_PER_DEG_LAT * cosLat);
    const baseLat = anchor.lat + (dir * NORTH_OFFSET_M) / M_PER_DEG_LAT;
    sorted.forEach((m, i) => {
      const rowI = Math.floor(i / cols);
      const colI = i % cols;
      out[m.idx] = {
        lat: baseLat + dir * rowI * dLat,
        lon: anchor.lon + (colI - (cols - 1) / 2) * dLon,
      };
    });
  };

  // 4. Griglia NORD per ogni città (posizioni con città ma senza ufficio).
  for (const [k, members] of cityOnly) {
    const sample = members[0].row;
    const c =
      centroid.get(k) ?? gazetteerCity(sample.loc_country, sample.loc_city);
    if (!c) continue; // città irrisolvibile → restano null (no-coords)
    layGrid(members, c, 1);
  }

  // 5. Griglia SUD per le full remote col solo vincolo di paese, ancorata
  //    al "baricentro" del paese: mediana dei centroidi delle sue città
  //    (se l'account ne ha), altrimenti la capitale dal gazetteer. Paese
  //    non riconosciuto (es. pseudo-paesi come "Europe") → isola anywhere.
  for (const [country, members] of remoteByCountry) {
    const cityAnchors = [...centroid.entries()]
      .filter(([k]) => k.startsWith(`${country}|`))
      .map(([, c]) => c);
    const anchor =
      cityAnchors.length > 0
        ? {
            lat: median(cityAnchors.map((c) => c.lat)),
            lon: median(cityAnchors.map((c) => c.lon)),
          }
        : gazetteerCountryAnchor(country);
    if (!anchor) {
      remoteAnywhere.push(...members);
      continue;
    }
    layGrid(members, anchor, -1);
  }

  // 6. Isola "anywhere" per le full remote senza alcun geo: griglia sul
  //    punto-mare convenzionale, uguale per tutti i profili.
  if (remoteAnywhere.length > 0) {
    layGrid(remoteAnywhere, ANYWHERE_ANCHOR, -1);
  }

  return out;
}
