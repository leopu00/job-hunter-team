// Viewport del globo: da quali pin ricavare centro e bounding box.
// Vive fuori da JobsGlobe.tsx per poter essere verificato in isolamento sui
// dati reali (un componente "use client" non è importabile da uno script).

export type ViewportPin = { lat: number; lon: number };

// Calcola la "faccia migliore" del globo da mostrare: longitude
// media circolare di tutti i pin (vettorializzata, gestisce wrap-around
// 180/-180 correttamente). Restituisce centro + bounding box dei pin
// entro 90° da quel centro (la "metà di globo visibile").
export function bestViewport(pins: ViewportPin[]): {
  center: [number, number];
  bounds: [[number, number], [number, number]];
} | null {
  if (pins.length === 0) return null;
  const toRad = Math.PI / 180;
  let sx = 0,
    sy = 0;
  for (const p of pins) {
    sx += Math.cos(p.lon * toRad);
    sy += Math.sin(p.lon * toRad);
  }
  const centerLon = Math.atan2(sy, sx) / toRad;
  // Distanza circolare in longitudine [0..180]
  const lonDist = (a: number, b: number) => {
    let d = Math.abs(a - b) % 360;
    if (d > 180) d = 360 - d;
    return d;
  };
  const inFace = pins.filter((p) => lonDist(p.lon, centerLon) <= 100);
  const subset = inFace.length >= Math.ceil(pins.length * 0.5) ? inFace : pins;
  const lats: number[] = [];
  const lons: number[] = [];
  for (const p of subset) {
    lats.push(p.lat);
    // Normalizza lon relativa al centerLon per evitare wrap nella bbox.
    let nlon = p.lon;
    if (nlon - centerLon > 180) nlon -= 360;
    if (nlon - centerLon < -180) nlon += 360;
    lons.push(nlon);
  }
  let minLat = Math.min(...lats),
    maxLat = Math.max(...lats),
    minLon = Math.min(...lons),
    maxLon = Math.max(...lons);

  // Un solo pin con coordinate sbagliate (città classificata male a monte)
  // gonfiava il riquadro e spostava il centro di centinaia di km: filtrando
  // "Roma" bastava una posizione geocodificata in Versilia per centrare la
  // vista tra Lazio e Toscana. Se scartando le code il riquadro si stringe
  // DRASTICAMENTE, vuol dire che a gonfiarlo sono pochi punti isolati e si
  // usa il riquadro robusto. Se invece si stringe poco, i pin sono davvero
  // sparsi (es. filtro su due paesi) e vanno inquadrati tutti.
  if (subset.length >= 12) {
    const pct = (arr: number[], q: number) => {
      const a = [...arr].sort((x, y) => x - y);
      const i = (a.length - 1) * q;
      const lo = Math.floor(i);
      const hi = Math.ceil(i);
      return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
    };
    const rMinLat = pct(lats, 0.02);
    const rMaxLat = pct(lats, 0.98);
    const rMinLon = pct(lons, 0.02);
    const rMaxLon = pct(lons, 0.98);
    const spanFull = Math.max(maxLat - minLat, maxLon - minLon);
    const spanRobust = Math.max(rMaxLat - rMinLat, rMaxLon - rMinLon);
    if (spanRobust > 0 && spanFull > spanRobust * 2.5) {
      minLat = rMinLat;
      maxLat = rMaxLat;
      minLon = rMinLon;
      maxLon = rMaxLon;
    }
  }

  // Centroide lat = media; centroide lon = centerLon circolare.
  const centerLat = (minLat + maxLat) / 2;
  return {
    center: [centerLon, centerLat],
    bounds: [
      [minLon, minLat],
      [maxLon, maxLat],
    ],
  };
}

// Con la proiezione a globo, a zoom città-paese la sfera è larga migliaia di
// pixel e la curvatura sta fuori dalla finestra: un'Europa inquadrata da vicino
// sembra una mappa piatta (il globo c'è, MapLibre lo disegna, ma non si vede).
// Per un'inquadratura d'insieme su più paesi si limita lo zoom a quello in cui
// il raggio della sfera è RADIUS_SHARE del lato lungo della mappa: il bordo
// compare sul lato corto e i fasci restano distinti. Un insieme dentro un
// paese si inquadra da vicino come prima.
const WORLD_TILE = 512;
const RADIUS_SHARE = 0.62;
// Sotto questa estensione (gradi) l'insieme sta in pochi paesi vicini.
const MULTI_COUNTRY_SPAN = 12;

export function overviewMaxZoom(
  bounds: [[number, number], [number, number]],
  container: { width: number; height: number },
  normalMax: number,
): number {
  const span = Math.max(
    bounds[1][0] - bounds[0][0],
    bounds[1][1] - bounds[0][1],
  );
  const longSide = Math.max(container.width, container.height);
  if (span < MULTI_COUNTRY_SPAN || !(longSide > 0)) return normalMax;
  const radius = RADIUS_SHARE * longSide;
  const zoom = Math.log2((2 * Math.PI * radius) / WORLD_TILE);
  return Math.min(normalMax, zoom);
}
