// Risoluzione delle coordinate a livello CITTÀ per la mappa.
//
// Il dato mandatorio è paese + città (le coordinate esatte dell'ufficio NON lo
// sono più). Qui ricaviamo il "centro città" dai record che HANNO già coordinate
// ufficio (centroide per città) e ci appoggiamo le posizioni senza coordinate
// della stessa città. Così ogni posizione con una città nota diventa un pin sulla
// mappa (raggruppato per città; a zoom alto il cluster esplode in pin singoli).
//
// Le posizioni nella stessa città-senza-ufficio ricevono un piccolo jitter a
// spirale attorno al centro, così non si sovrappongono e restano cliccabili una
// per una.

export type GeoRow = {
  loc_country: string | null;
  loc_city: string | null;
  office_lat: number | null;
  office_lon: number | null;
};

function cityKey(country: string | null, city: string | null): string {
  return `${(country ?? "").trim().toLowerCase()}|${(city ?? "").trim().toLowerCase()}`;
}

/**
 * Ritorna, allineato all'ordine di `rows`, le coordinate risolte per ogni
 * posizione (ufficio esatto se presente, altrimenti centro-città + jitter) o
 * null se la città non è risolvibile (nessun sibling geocodificato).
 */
export function resolveCityPins(
  rows: GeoRow[],
): Array<{ lat: number; lon: number } | null> {
  // 1. Centroidi città dai record con coordinate ufficio.
  const acc = new Map<string, { sl: number; so: number; n: number }>();
  for (const r of rows) {
    if (
      r.office_lat != null &&
      r.office_lon != null &&
      (r.loc_city ?? "").trim()
    ) {
      const k = cityKey(r.loc_country, r.loc_city);
      const a = acc.get(k) ?? { sl: 0, so: 0, n: 0 };
      a.sl += r.office_lat;
      a.so += r.office_lon;
      a.n += 1;
      acc.set(k, a);
    }
  }
  const centroid = new Map<string, { lat: number; lon: number }>();
  for (const [k, a] of acc)
    centroid.set(k, { lat: a.sl / a.n, lon: a.so / a.n });

  // 2. Risoluzione per posizione (jitter progressivo per città).
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (r.office_lat != null && r.office_lon != null) {
      return { lat: r.office_lat, lon: r.office_lon };
    }
    const city = (r.loc_city ?? "").trim();
    if (!city) return null;
    const k = cityKey(r.loc_country, r.loc_city);
    const c = centroid.get(k);
    if (!c) return null;
    const i = seen.get(k) ?? 0;
    seen.set(k, i + 1);
    if (i === 0) return { lat: c.lat, lon: c.lon };
    // spirale ad angolo aureo, raggio ~ sqrt(i) * 0.0035° (≈ 400 m)
    const ang = i * 2.399963;
    const rad = 0.0035 * Math.sqrt(i);
    return {
      lat: c.lat + rad * Math.sin(ang),
      lon: c.lon + rad * Math.cos(ang),
    };
  });
}
