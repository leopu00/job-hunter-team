// Risoluzione delle coordinate per la mappa.
//
// Ogni posizione con coordinate ufficio ESATTE (office_lat/lon) è resa alle
// sue coordinate reali → sul globo diventa un pin al suo indirizzo (è per
// questo che chiediamo al team di geocodare l'indirizzo preciso). Le posizioni
// SENZA ufficio esatto ripiegano sul "centro città".
//
// Il centro città usa la MEDIANA (per componente lat/lon) delle coordinate
// ufficio dei record della stessa città, non la media: una singola posizione
// mal-etichettata (es. loc_city='Rome' ma ufficio geocodato a Dubai) non
// trascina più il centro della città (era il bug "pin di Roma spostati a
// Frascati"). Se la città non ha alcun ufficio geocodato (VPS fresca) si
// ripiega sul gazetteer città→coordinate (lib/city-gazetteer.ts).
//
// Tutte le posizioni città-only della stessa città ricevono la STESSA
// coordinata (niente jitter): sul globo si aggregano in un unico pin-città che
// il click esplode.

import { gazetteerCity } from "./city-gazetteer";

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

  // 2. Risoluzione per posizione.
  return rows.map((r) => {
    // Ufficio esatto → coordinate reali (pin al suo indirizzo sul globo).
    if (r.office_lat != null && r.office_lon != null) {
      return { lat: r.office_lat, lon: r.office_lon };
    }
    // Città-only: centro-città robusto (mediana dei record con ufficio) o,
    // se la città non ha alcun ufficio geocodato (VPS fresca), gazetteer
    // città→coordinate. NIENTE jitter: tutte le posizioni città-only della
    // stessa città ricevono la STESSA coordinata → sul globo si aggregano in
    // un unico pin-città che il click esplode.
    const city = (r.loc_city ?? "").trim();
    if (!city) return null;
    const k = cityKey(r.loc_country, r.loc_city);
    const c = centroid.get(k) ?? gazetteerCity(r.loc_country, r.loc_city);
    if (!c) return null;
    return { lat: c.lat, lon: c.lon };
  });
}
