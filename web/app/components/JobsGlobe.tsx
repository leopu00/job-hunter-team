"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useTheme } from "@/app/theme-provider";
import { UNCATEGORIZED_LABEL } from "@/lib/position-classifier";

const SOURCE_ID = "jht-jobs";
const LAYER_HALO_ID = "jht-jobs-halo";
const LAYER_DOT_ID = "jht-jobs-dot";

// Soglia di clustering in GRADI (lat/lon) per zoom level. Geografica
// invece di pixel → pan non riassorbisce i punti in bucket diversi.
// Zoom SNAPPED a intero → radiusDeg in step discreti → cluster
// cambiano solo a soglie nette (no jitter su zoom fractional).
//
// Valori: z=4 ~5° (~550km); z=8 ~0.3° (~33km); z=12 ~0.02° (~2km).
// A zoom >= 14 niente cluster (raggio sotto coords city-center).
function clusterRadiusDeg(zoom: number): number {
  const z = Math.round(zoom);
  if (z >= 12) return 0; // zoom street-level: no cluster, esplode singletons
  return 5.0 / Math.pow(2, Math.max(0, z - 4));
}

// Layout circolare 2D: N raggi disposti su anelli concentrici visti
// dall'alto-davanti (yScale schiaccia il cerchio in ellisse, dando
// effetto "terreno"). Il top-score va al centro, gli altri in ordine
// decrescente sugli anelli via via più esterni → il fascio appare
// come un faro al centro di un'aiuola di luci minori.
//
// Ritorna offset per indice DESCRESCENTE di score (i=0 → top score
// al centro). yOff > 0 = davanti, yOff < 0 = dietro: il chiamante
// userà painter's-algorithm (sort by yOff asc) per render order.
function arrangeCircle(
  N: number,
  ringStep: number,
  yScale: number,
): { xOff: number; yOff: number }[] {
  const out: { xOff: number; yOff: number }[] = [];
  if (N <= 0) return out;
  out.push({ xOff: 0, yOff: 0 }); // center
  let ring = 1;
  while (out.length < N) {
    const r = ring * ringStep;
    // Slot per anello ≈ circonferenza / spaziatura
    const slots = Math.max(6, Math.floor((2 * Math.PI * r) / ringStep));
    // Alterna l'offset angolare iniziale fra anelli pari/dispari per
    // non allineare i raggi radialmente (effetto "righe").
    const angleStart = ring % 2 === 0 ? 0 : Math.PI / slots;
    for (let s = 0; s < slots && out.length < N; s++) {
      const angle = angleStart + (s * 2 * Math.PI) / slots;
      out.push({
        xOff: r * Math.cos(angle),
        yOff: r * Math.sin(angle) * yScale,
      });
    }
    ring++;
  }
  return out;
}

// Mappa score (0-100) → altezza normalizzata (0-1). Piecewise:
// la fascia bassa (0-40) è schiacciata, la fascia alta (40-100) è
// espansa → differenza tra 65 e 80 visivamente più marcata che con
// mappatura lineare.
function scoreNormHeight(score: number | null): number {
  if (score == null) return 0.45;
  const s = Math.max(0, Math.min(100, score));
  if (s <= 40) return s / 200; // 0..0.20
  return 0.2 + ((s - 40) / 60) * 0.8; // 0.20..1.00
}

// Mappa score (0-100) → colore RGB. Stops allineati al design system
// JHT (red/orange/yellow/mint/green). Lerp lineare in RGB nei tratti.
function scoreToRgb(score: number | null): [number, number, number] {
  if (score == null) return [140, 200, 170]; // verde-grigio neutro
  const s = Math.max(0, Math.min(100, score));
  const stops: Array<[number, [number, number, number]]> = [
    [0, [255, 69, 96]], // --color-red
    [40, [255, 140, 66]], // --color-orange
    [55, [245, 197, 24]], // --color-yellow
    [70, [127, 255, 178]], // mint
    [100, [0, 232, 122]], // --color-green
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [s0, c0] = stops[i];
    const [s1, c1] = stops[i + 1];
    if (s >= s0 && s <= s1) {
      const t = (s - s0) / (s1 - s0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

// Genera l'icona "fascio di raggi" per un gruppo di N offerte
// nella stessa location. Disegna esattamente N raggi affiancati,
// ciascuno con altezza proporzionale al proprio score (score 0 →
// stub, score 100 → pilastro). Pin senza score → altezza media.
// L'immagine è ancorata bottom-center sulla coordinata del gruppo.
// Disposizione "montagna": score più alto al centro, decrescente
// verso i bordi → forma estetica e leggibilità dello score top.
// Cap raggi disegnati per icona cluster. Oltre, ne disegniamo i top
// N_CAP e il count vero resta nella text-label sotto al fascio.
// Disegnarne 150 col blur era costoso e poco leggibile.
const MAX_BEAMS_PER_ICON = 24;

// Hash content-based per l'icon-image. Dipende SOLO dai top-cap
// scores sorted desc → icone ri-usate fra cluster con stessa "testa
// di distribuzione" anche se la coda differisce.
function iconIdForScores(scores: (number | null)[]): string {
  const drawn = [...scores]
    .sort((a, b) => (b ?? 0) - (a ?? 0))
    .slice(0, MAX_BEAMS_PER_ICON)
    .map((s) => (s == null ? "x" : String(s)))
    .join("|");
  return `jht-bm-${Math.min(scores.length, MAX_BEAMS_PER_ICON)}-${hashStr(drawn).toString(36)}`;
}

function createGroupBeamsImageData(
  scores: (number | null)[],
): { data: ImageData; w: number; h: number } | null {
  const total = Math.max(1, scores.length);
  // Sort desc e cap ai top N_CAP — visualizziamo la testa della
  // distribuzione, non l'intero spettro.
  const sortedDesc = [...scores].sort((a, b) => (b ?? 0) - (a ?? 0));
  const drawScores = sortedDesc.slice(0, MAX_BEAMS_PER_ICON);
  const N = drawScores.length;
  // Step radiale costante per cap fisso → layout stabile.
  const ringStep = N <= 4 ? 14 : N <= 12 ? 11 : 9;
  const yScale = 0.42;
  const beamW = Math.max(3, Math.min(8, ringStep - 3));
  const minH = 90;
  const maxH = 400;
  const haloPad = 36;

  const layout = arrangeCircle(N, ringStep, yScale);
  // Bounding box del layout (per dimensionare canvas)
  let minX = 0,
    maxX = 0,
    minY = 0,
    maxY = 0;
  for (const p of layout) {
    if (p.xOff < minX) minX = p.xOff;
    if (p.xOff > maxX) maxX = p.xOff;
    if (p.yOff < minY) minY = p.yOff;
    if (p.yOff > maxY) maxY = p.yOff;
  }
  const halfW = Math.max(48, Math.max(-minX, maxX) + beamW);
  const halfDepthFront = Math.max(20, maxY + 10); // verso davanti
  const halfDepthBack = Math.max(20, -minY + 10); // verso dietro
  const W = Math.ceil(2 * halfW + 20);
  // Spazio sopra baseY (per il raggio centrale + i raggi posteriori).
  const spaceAbove = maxH + halfDepthBack;
  // Spazio sotto baseY (basi raggi anteriori + halo).
  const spaceBelow = halfDepthFront + haloPad;
  // Canvas simmetrico in altezza: H/2 = baseY → con icon-anchor
  // "center" il punto geo coincide col centro del cerchio dell'aiuola
  // (niente più "fluttuamento" dei raggi sopra la coordinata).
  const halfH = Math.max(spaceAbove, spaceBelow);
  const H = 2 * halfH;

  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  const cx = W / 2;
  // baseY al centro del canvas. Con icon-anchor "center" la coord
  // geografica cade qui = al centro dell'aiuola di raggi.
  const baseY = halfH;

  // Top-score → tinta halo/core. È il primo elemento di sortedDesc.
  const topScore = sortedDesc[0];
  const [hr, hg, hb] = scoreToRgb(topScore);
  const haloBase = `rgba(${hr},${hg},${hb},`;

  // Halo: ellisse tenue al centro (più piccolo + meno opaco rispetto
  // alle prime versioni). Suggerisce il "terreno" senza dominare.
  const haloR = Math.max(28, halfW * 0.55);
  const haloGrad = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, haloR);
  haloGrad.addColorStop(0, `${haloBase}0.30)`);
  haloGrad.addColorStop(0.5, `${haloBase}0.1)`);
  haloGrad.addColorStop(1, `${haloBase}0)`);
  ctx.fillStyle = haloGrad;
  ctx.beginPath();
  ctx.ellipse(cx, baseY, haloR, haloR * yScale, 0, 0, 2 * Math.PI);
  ctx.fill();

  // Niente blur filter: era il più costoso del rendering canvas e
  // non aggiunge molto valore visivo con raggi sottili. Painter sort
  // per non bucare i raggi davanti.
  const renderOrder = layout
    .map((p, idx) => ({ ...p, idx }))
    .sort((a, b) => a.yOff - b.yOff);

  for (const { xOff, yOff, idx } of renderOrder) {
    const score = drawScores[idx];
    const norm = scoreNormHeight(score);
    const height = minH + norm * (maxH - minH);
    const x = cx + xOff;
    const y0 = baseY + yOff;
    const topY = y0 - height;
    const topW = 0.8;
    const [r, g, b] = scoreToRgb(score);
    const base = `rgba(${r},${g},${b},`;

    const grad = ctx.createLinearGradient(x, y0, x, topY);
    grad.addColorStop(0, `${base}1)`);
    grad.addColorStop(0.12, `${base}0.92)`);
    grad.addColorStop(0.5, `${base}0.4)`);
    grad.addColorStop(1, `${base}0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - beamW / 2, y0);
    ctx.lineTo(x + beamW / 2, y0);
    ctx.lineTo(x + topW / 2, topY);
    ctx.lineTo(x - topW / 2, topY);
    ctx.closePath();
    ctx.fill();
  }

  // Core luminoso al centro (più piccolo e meno saturo): un puntino
  // di luce sulla coordinata, non più un "faro" grande.
  const coreLight = `rgba(${Math.min(255, hr + 50)},${Math.min(255, hg + 50)},${Math.min(255, hb + 50)},0.55)`;
  const coreR = 11;
  const coreGrad = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, coreR);
  coreGrad.addColorStop(0, coreLight);
  coreGrad.addColorStop(0.5, `${haloBase}0.28)`);
  coreGrad.addColorStop(1, `${haloBase}0)`);
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, baseY, coreR, 0, 2 * Math.PI);
  ctx.fill();

  return { data: ctx.getImageData(0, 0, W, H), w: W, h: H };
}

// Carto basemap styles (free, no API key, CDN OSS).
// Vector tiles street-level su zoom alto.
const STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const STYLE_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const STATUS_COLORS: Record<string, string> = {
  new: "#7a7a96",
  checked: "#4d9fff",
  scored: "#a855f7",
  writing: "#f5c518",
  review: "#ff8c42",
  ready: "#7fffb2",
  applied: "#00e87a",
  response: "#58a6ff",
};

type PositionCoord = {
  id: string;
  title: string;
  company: string;
  status: string;
  // Post-dev2 refactor: classificazione viene da positions.role_family
  // (popolata dal team analyst), non più da classifyTitle del title.
  role_family: string | null;
  score: number | null;
  lat: number;
  lon: number;
  is_remote: boolean;
  location: string | null;
  // Country/city normalizzati (location-enrichment skill, regole R12-R15).
  // Usati come filtro mappa quando l'utente clicca un nodo del tree
  // Location nella sidebar.
  loc_country: string | null;
  loc_city: string | null;
  // Indirizzo street-level geocodato (es. "Via Roma 42, Milano"). Null
  // se l'analista non ha trovato un indirizzo preciso (ufficio mai
  // pubblicato, JD vaga, remote). Vedi migration 017.
  office_address: string | null;
};

// Un gruppo di posizioni che condividono la stessa coordinata
// (city-center fallback). Renderizzato come singolo symbol al centroide
// con icona canvas che contiene N raggi alti come gli score.
type CompanydFeature = {
  groupKey: string;
  iconId: string;
  lat: number;
  lon: number;
  count: number;
  scores: (number | null)[];
  positions: PositionCoord[];
  topScore: number | null; // max degli scores → tinta halo/core
};

// Calcola la "faccia migliore" del globo da mostrare: longitude
// media circolare di tutti i pin (vettorializzata, gestisce wrap-around
// 180/-180 correttamente). Restituisce centro + bounding box dei pin
// entro 90° da quel centro (la "metà di globo visibile").
function bestViewport(pins: PositionCoord[]): {
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
  let minLat = +Infinity,
    maxLat = -Infinity,
    minLon = +Infinity,
    maxLon = -Infinity;
  for (const p of subset) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    // Normalizza lon relativa al centerLon per evitare wrap nella bbox.
    let nlon = p.lon;
    if (nlon - centerLon > 180) nlon -= 360;
    if (nlon - centerLon < -180) nlon += 360;
    if (nlon < minLon) minLon = nlon;
    if (nlon > maxLon) maxLon = nlon;
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

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Esplode i group coord-coincident in singletons con micro-offset
// radiale, perché a zoom street-level ogni position deve essere
// cliccabile (con N positions sulla stessa coord il click cade su
// uno solo). Offset deterministico via hash dell'id → stabile su
// refresh. Raggio in metri scalato col zoom: ~40m a z=14, ~10m a z=16.
function explodeGroups(
  groups: CompanydFeature[],
  zoom: number,
): CompanydFeature[] {
  const meters = 50 / Math.pow(2, Math.max(0, zoom - 14));
  const out: CompanydFeature[] = [];
  for (const g of groups) {
    if (g.count <= 1) {
      out.push(g);
      continue;
    }
    const radiusDeg = meters / 111000; // ≈ deg latitudine per metro
    const lonScale = 1 / Math.cos((g.lat * Math.PI) / 180); // anti-distorsione
    g.positions.forEach((p, i) => {
      // Angle deterministico: posizione equispaziata sul cerchio +
      // jitter piccolo da hashStr(p.id) per evitare allineamenti.
      const angle =
        (i / g.count) * 2 * Math.PI + (hashStr(p.id) & 0xff) * (Math.PI / 256);
      const lat = g.lat + radiusDeg * Math.sin(angle);
      const lon = g.lon + radiusDeg * Math.cos(angle) * lonScale;
      const singleScores: (number | null)[] = [p.score];
      out.push({
        groupKey: `single|${p.id}`,
        iconId: iconIdForScores(singleScores),
        lat,
        lon,
        count: 1,
        scores: singleScores,
        positions: [p],
        topScore: p.score,
      });
    });
  }
  return out;
}

// Re-clusterizza i gruppi (city-coincident) tramite bucket geografici
// in gradi (lat/lon), dimensione derivata dallo zoom. Bucket geografici
// sono PAN-INVARIANTI: spostarsi sulla mappa non cambia in che bucket
// cade un punto → i cluster non "tremano" durante lo scroll.
// Re-trigger solo su cambio zoom, non su move.
//
// A zoom street-level (>=14) "esplode" i group coord-coincident in
// singletons con micro-offset radiale: così ogni position diventa
// cliccabile separatamente (altrimenti N positions sulla stessa
// coord = 1 solo target di click).
function reclusterByZoom(
  groups: CompanydFeature[],
  zoom: number,
): CompanydFeature[] {
  if (groups.length === 0) return [];
  const radiusDeg = clusterRadiusDeg(zoom);
  if (radiusDeg <= 0) {
    // Street zoom: esplode i groups in singleton click-target.
    return explodeGroups(groups, zoom);
  }
  const buckets = new Map<string, CompanydFeature[]>();
  for (const g of groups) {
    const bx = Math.floor(g.lon / radiusDeg);
    const by = Math.floor(g.lat / radiusDeg);
    const key = `${bx}|${by}`;
    const arr = buckets.get(key);
    if (arr) arr.push(g);
    else buckets.set(key, [g]);
  }

  const out: CompanydFeature[] = [];
  for (const [bkey, arr] of buckets) {
    if (arr.length === 1) {
      out.push(arr[0]);
      continue;
    }
    const totalCount = arr.reduce((s, g) => s + g.count, 0);
    const lat = arr.reduce((s, g) => s + g.lat * g.count, 0) / totalCount;
    const lon = arr.reduce((s, g) => s + g.lon * g.count, 0) / totalCount;
    const scores = arr.flatMap((g) => g.scores);
    const positions = arr.flatMap((g) => g.positions);
    const topScore = scores.reduce<number | null>((acc, s) => {
      if (s == null) return acc;
      if (acc == null) return s;
      return Math.max(acc, s);
    }, null);
    const iconId = iconIdForScores(scores);
    out.push({
      groupKey: `cluster|${bkey}`,
      iconId,
      lat,
      lon,
      count: totalCount,
      scores,
      positions,
      topScore,
    });
  }
  return out;
}

// Paint override per allineare il basemap al theme JHT.
// Dark = inverso cromatico della light: stessa palette grayscale
// neutra (warm offwhite → warm darkgray), nessun verde/blu acceso.
// Relazioni di luminanza preservate (water più chiaro del land,
// building leggermente più scuro del land, ecc.) per leggibilità.
function tintMap(map: MaplibreMap, mode: "dark" | "light") {
  const tweaks: Array<[string, string, string]> =
    mode === "dark"
      ? [
          ["background", "background-color", "#0d0d11"],
          ["water", "fill-color", "#23252b"],
          ["landcover_wood", "fill-color", "#14171a"],
          ["landcover_grass", "fill-color", "#181b1e"],
          ["landuse_overlay_national_park", "fill-color", "#181b1e"],
          ["landuse_park", "fill-color", "#181b1e"],
          ["landuse_residential", "fill-color", "#16161a"],
          ["national_park", "fill-color", "#181b1e"],
          ["building", "fill-color", "#1c1d22"],
          ["building-3d", "fill-color", "#1c1d22"],
        ]
      : [
          ["background", "background-color", "#f3f3ee"],
          ["water", "fill-color", "#dadce6"],
          ["landcover_wood", "fill-color", "#e6efe6"],
          ["landcover_grass", "fill-color", "#eaf2ea"],
          ["landuse_park", "fill-color", "#eaf2ea"],
          ["landuse_residential", "fill-color", "#ecebe6"],
          ["national_park", "fill-color", "#eaf2ea"],
          ["building", "fill-color", "#e4e1d8"],
        ];
  const style = map.getStyle();
  const layerIds = new Set((style?.layers ?? []).map((l) => l.id));
  for (const [layerId, prop, value] of tweaks) {
    if (layerIds.has(layerId)) {
      try {
        map.setPaintProperty(layerId, prop, value);
      } catch {
        /* layer non supporta la prop, skip */
      }
    }
  }
}

export default function CompanyGlobe({
  hero = false,
  fullscreen = false,
  selectedTypes = [],
  selectedScoreRanges = [],
  selectedUnscored = false,
  selectedCountries = [],
  selectedCities = [],
}: {
  hero?: boolean;
  fullscreen?: boolean;
  selectedTypes?: string[];
  selectedScoreRanges?: Array<{ lo: number; hi: number }>;
  selectedUnscored?: boolean;
  // Filtro country (es. ["Italy", "Hungary"]).
  selectedCountries?: string[];
  // Filtro city formato "<Country>|<City>" per evitare collisioni
  // omonime (es. "Italy|Milan" vs "Spain|Milan(?)" — improbabile ma safe).
  selectedCities?: string[];
} = {}) {
  const { resolvedTheme } = useTheme();
  const [data, setData] = useState<PositionCoord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<PositionCoord | null>(null);
  // Posizione schermo del pin selezionato (in pixel viewport del map
  // container). Serve a posizionare il popup-vignetta sopra al pin
  // con la coda che punta verso il basso. Si aggiorna ad ogni
  // move/zoom della mappa.
  const [popupAnchor, setPopupAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  // Indirizzo reverse-geocodato lazy quando il popup mostra una pos
  // con office_address null. Cache client-side keyed sulla pos id per
  // evitare refetch su re-render.
  const [reverseAddrs, setReverseAddrs] = useState<Record<string, string>>({});
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const layersReadyRef = useRef(false);
  const themeRef = useRef<"dark" | "light">(resolvedTheme);
  // Ref tracking di clustered (gruppi RI-clusterizzati in pixel-space
  // sul viewport corrente). Letta dentro onStyleLoad che ha una closure
  // vecchia (registrato 1 sola volta in mount).
  const clusteredRef = useRef<CompanydFeature[]>([]);
  // Registry icone gruppo registrate sulla mappa: iconId -> true. Permette
  // di rimuoverle quando il set di gruppi visibili cambia (filtri/zoom).
  const registeredIconsRef = useRef<Set<string>>(new Set());
  // Trigger di re-render quando lo zoom/pan cambia → recompute clustered.
  const [reclusterTick, setReclusterTick] = useState(0);

  // Micro-jitter deterministico per pin con stesse coordinate
  // (city-center fallback): perturba di ~50m random-but-stable, cosi'
  // a zoom city-level si vedono come pin distinti su strade vicine,
  // non come cerchio finto. A zoom country i pin micro-jitterati
  // restano dentro il clusterRadius (~30m) e vengono raggruppati
  // dal cluster nativo MapLibre. Quando lo Scout/Analista forniranno
  // office-level vero, il jitter sara' no-op naturale.
  // Applica filtri donut (tipi) + histogram (range score + flag
  // unscored) di /map. Tra tipi e score: AND. Dentro score:
  // (range OR unscored). Vuoto = no filtro.
  const displayData = useMemo(() => {
    let out = data;
    if (selectedTypes.length > 0) {
      out = out.filter((p) =>
        selectedTypes.includes(p.role_family ?? UNCATEGORIZED_LABEL),
      );
    }
    const scoreFilterActive =
      selectedScoreRanges.length > 0 || selectedUnscored;
    if (scoreFilterActive) {
      out = out.filter((p) => {
        if (typeof p.score !== "number") return selectedUnscored;
        return selectedScoreRanges.some(
          (r) => p.score! >= r.lo && p.score! <= r.hi,
        );
      });
    }
    // Filtro location gerarchico: country e/o city.
    // Country e cities sono OR fra loro (selezioni multiple).
    // Tra country e city: se una city è selezionata, basta che la pos
    // matchi la city (la country è implicita).
    if (selectedCities.length > 0 || selectedCountries.length > 0) {
      out = out.filter((p) => {
        const country = (p.loc_country ?? "").trim() || "(unknown)";
        const city = (p.loc_city ?? "").trim() || null;
        if (selectedCities.length > 0) {
          const key = `${country}|${city ?? "(country-only)"}`;
          if (selectedCities.includes(key)) return true;
        }
        if (
          selectedCountries.length > 0 &&
          selectedCountries.includes(country)
        ) {
          return true;
        }
        return false;
      });
    }
    return out;
  }, [
    data,
    selectedTypes,
    selectedScoreRanges,
    selectedUnscored,
    selectedCountries,
    selectedCities,
  ]);

  // Raggruppa i pin per coordinata identica (city-center fallback).
  // Ogni gruppo diventa UN feature al centroide, con icona custom che
  // contiene esattamente N raggi (uno per ogni offerta del gruppo),
  // ciascuno con altezza ∝ score. Ordine score deterministico (sort
  // asc) → l'icona è stabile fra refresh con lo stesso content.
  const grouped = useMemo(() => {
    const groups = new Map<string, PositionCoord[]>();
    for (const p of displayData) {
      const key = `${p.lat.toFixed(4)}|${p.lon.toFixed(4)}`;
      const arr = groups.get(key);
      if (arr) arr.push(p);
      else groups.set(key, [p]);
    }
    const out: CompanydFeature[] = [];
    for (const [key, arr] of groups) {
      const sorted = [...arr].sort((a, b) => {
        const sa = a.score ?? -1;
        const sb = b.score ?? -1;
        return sa - sb;
      });
      const scores = sorted.map((p) => p.score);
      const iconId = iconIdForScores(scores);
      const lat = arr.reduce((a, p) => a + p.lat, 0) / arr.length;
      const lon = arr.reduce((a, p) => a + p.lon, 0) / arr.length;
      const topScore = scores.reduce<number | null>((acc, s) => {
        if (s == null) return acc;
        if (acc == null) return s;
        return Math.max(acc, s);
      }, null);
      out.push({
        groupKey: key,
        iconId,
        lat,
        lon,
        count: arr.length,
        scores,
        positions: sorted,
        topScore,
      });
    }
    return out;
  }, [displayData]);

  // Fetch data
  useEffect(() => {
    fetch("/api/positions/coords")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: PositionCoord[]) => {
        setData(Array.isArray(d) ? d : []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  // Inizializza la mappa una volta sola
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const container = mapContainerRef.current;

    const map = new maplibregl.Map({
      container,
      style: themeRef.current === "light" ? STYLE_LIGHT : STYLE_DARK,
      center: [10, 45], // centrato su Europa
      zoom: 1.8,
      attributionControl: { compact: true },
      pitch: 0,
      bearing: 0,
    });

    const onStyleLoad = () => {
      try {
        map.setCompanyion({ type: "globe" });
      } catch (e) {
        console.warn("[CompanyGlobe] globe projection unsupported:", e);
      }
      // Force resize: container 0x0 al primo render (animazione fade-in).
      map.resize();
      // Tinta theme-aware sui layer base.
      tintMap(map, themeRef.current);
      // Aggiungo source + layer per i pin. WebGL native = follow-mappa
      // garantito (i DOM markers su globe projection ballavano).
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
          // Cluster nativo OFF: facciamo clustering client-side basato
          // sui pixel del viewport (vedi recluster()). Così i raggi
          // visibili nel cluster sono ESATTAMENTE quelli reali dei
          // membri, non un'icona summary generica.
        });
        // Halo radiale alla base del fascio. Radius scala col count
        // del cluster client-side, color con il top-score del cluster
        // (max degli scores dei membri, -1 sentinel = no score).
        map.addLayer({
          id: LAYER_HALO_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              [
                "interpolate",
                ["linear"],
                ["get", "count"],
                1,
                2,
                20,
                5,
                100,
                9,
              ],
              8,
              [
                "interpolate",
                ["linear"],
                ["get", "count"],
                1,
                6,
                20,
                14,
                100,
                24,
              ],
              14,
              [
                "interpolate",
                ["linear"],
                ["get", "count"],
                1,
                14,
                20,
                30,
                100,
                50,
              ],
            ],
            "circle-color": [
              "interpolate",
              ["linear"],
              ["coalesce", ["get", "topScore"], -1],
              -1,
              "#8cc8a0",
              0,
              "#ff4560",
              40,
              "#ff8c42",
              55,
              "#f5c518",
              70,
              "#7fffb2",
              100,
              "#00e87a",
            ],
            "circle-opacity": 0.12,
            "circle-blur": 0.9,
          },
        });
        // Symbol layer unico: ogni feature è un cluster client-side
        // con icona dinamica generata sui dati reali dei suoi membri.
        // Niente filter cluster nativo.
        map.addLayer({
          id: LAYER_DOT_ID,
          type: "symbol",
          source: SOURCE_ID,
          layout: {
            "icon-image": ["get", "iconId"],
            "icon-anchor": "center",
            "icon-rotation-alignment": "viewport",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              0.45,
              6,
              0.65,
              12,
              0.95,
              16,
              1.15,
            ],
            // Numero del cluster mostrato sotto al fascio (solo se >1).
            "text-field": [
              "case",
              [">", ["get", "count"], 1],
              ["to-string", ["get", "count"]],
              "",
            ],
            "text-font": ["Open Sans Bold"],
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              11,
              6,
              12,
              12,
              14,
            ],
            // 0.3em sotto il pin: subito attaccato al cluster.
            // Halo forte (sotto) gestisce overlap coi nomi città.
            "text-offset": [0, 0.3],
            "text-anchor": "top",
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            // Disegna SEMPRE sopra altri layer di testo della basemap.
            "symbol-sort-key": 999,
          },
          paint: {
            "text-color": "#ffffff",
            // Halo nero più spesso e opaco per coprire i nomi città
            // della basemap dietro al numero (es. "11" su "Milan").
            "text-halo-color": "rgba(0,0,0,0.95)",
            "text-halo-width": 2.5,
            "text-halo-blur": 0.5,
          },
        });
      }
      layersReadyRef.current = true;
      syncData(map);
    };
    map.on("style.load", onStyleLoad);

    map.on("error", (e) => {
      console.error("[CompanyGlobe] map error:", (e as any)?.error?.message ?? e);
    });

    // Click handler sul layer: identifica il gruppo via groupKey e
    // recupera la lista positions dal ref. Singleton → popup diretto;
    // gruppo → zoom in + popup sul migliore (top score).
    map.on("click", LAYER_DOT_ID, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const groupKey = (f.properties as { groupKey?: string })?.groupKey;
      if (!groupKey) return;
      const g = clusteredRef.current.find((x) => x.groupKey === groupKey);
      if (!g) return;
      // Apri popup sulla posizione con score più alto del gruppo
      // (l'ultima dopo sort asc, o la prima senza score).
      const top =
        g.positions
          .filter((p) => p.score != null)
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? g.positions[0];
      setSelected(top);
      map.flyTo({
        center: [g.lon, g.lat],
        zoom: Math.max(map.getZoom(), g.count > 1 ? 10 : 11),
        duration: 800,
      });
    });

    map.on("mouseenter", LAYER_DOT_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYER_DOT_ID, () => {
      map.getCanvas().style.cursor = "";
    });

    // NavigationControl in top-left (poi spostato CSS-side al
    // top-center per liberare la colonna sinistra alla card Location).
    map.addControl(new maplibregl.NavigationControl(), "top-left");
    mapRef.current = map;

    const ro = new ResizeObserver(() => {
      try {
        map.resize();
      } catch {}
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      layersReadyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Re-clustering ad ogni cambio di grouped (filtri) o di zoom.
  // PAN non riclusterizza (bucket geografici sono pan-invarianti)
  // → niente jitter durante lo scroll.
  const clustered = useMemo(() => {
    const map = mapRef.current;
    if (!map || !layersReadyRef.current) return grouped;
    return reclusterByZoom(grouped, map.getZoom());
  }, [grouped, reclusterTick]);

  // Listener `zoomend` (fired UNA volta a fine animazione di zoom)
  // + check sullo zoom intero arrotondato: ricluster solo quando lo
  // zoom snappato cambia. Pan non triggera. Mid-animation non triggera.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let lastSnap = Math.round(map.getZoom());
    const trigger = () => {
      const snap = Math.round(map.getZoom());
      if (snap !== lastSnap) {
        lastSnap = snap;
        setReclusterTick((t) => t + 1);
      }
    };
    map.on("zoomend", trigger);
    return () => {
      map.off("zoomend", trigger);
    };
  }, [loaded]);

  // Tieni il ref allineato a ogni render: syncData (closure vecchia)
  // legge sempre i cluster attuali.
  useEffect(() => {
    clusteredRef.current = clustered;
  }, [clustered]);

  // Sync GeoJSON source ogni volta che cambiano i cluster.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    syncData(map);
  }, [clustered, loaded]);

  // Reagisci al cambio theme JHT (dark/light/system): switch del basemap.
  useEffect(() => {
    themeRef.current = resolvedTheme;
    const map = mapRef.current;
    if (!map) return;
    // style.load handler riapplichera' projection + tint + layer pin
    // perche' map.on('style.load', ...) e' persistent fra setStyle.
    layersReadyRef.current = false;
    map.setStyle(resolvedTheme === "light" ? STYLE_LIGHT : STYLE_DARK);
  }, [resolvedTheme]);

  function syncData(map: MaplibreMap) {
    if (!layersReadyRef.current) return;
    const src = map.getSource(SOURCE_ID) as
      | (maplibregl.GeoJSONSource & {
          setData: (data: GeoJSON.FeatureCollection) => void;
        })
      | undefined;
    if (!src) return;
    const groups = clusteredRef.current;

    // 1) Registra le icone canvas mancanti (una per ogni iconId
    // unico). Iconid è derivato dai contenuti (count + scores) →
    // gruppi con lo stesso pattern condividono l'immagine.
    const neededIcons = new Set<string>();
    for (const g of groups) {
      neededIcons.add(g.iconId);
      if (!map.hasImage(g.iconId)) {
        const img = createGroupBeamsImageData(g.scores);
        if (img) {
          // pixelRatio 2 → l'icon-size 1.0 renderizza l'immagine a
          // metà delle dim canvas: netto su display retina.
          map.addImage(g.iconId, img.data, { pixelRatio: 2 });
          registeredIconsRef.current.add(g.iconId);
        }
      }
    }
    // 2) Rimuovi icone non più necessarie (es. filtri hanno cambiato i
    // contenuti dei gruppi). Lascia maplibre liberare la GPU texture.
    for (const id of Array.from(registeredIconsRef.current)) {
      if (!neededIcons.has(id) && map.hasImage(id)) {
        try {
          map.removeImage(id);
        } catch {
          /* race ok */
        }
        registeredIconsRef.current.delete(id);
      }
    }

    // 3) Una feature per gruppo, al centroide. properties include
    // count + iconId. La lista positions completa è in clusteredRef per
    // il click handler.
    const features: GeoJSON.Feature[] = groups.map((g) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [g.lon, g.lat] },
      properties: {
        groupKey: g.groupKey,
        iconId: g.iconId,
        count: g.count,
        topScore: g.topScore,
      },
    }));
    src.setData({ type: "FeatureCollection", features });
  }

  const remoteCount = data.filter((d) => d.is_remote).length;

  function flyToAll() {
    const map = mapRef.current;
    if (!map || displayData.length === 0) return;
    const vp = bestViewport(displayData);
    if (!vp) return;
    map.fitBounds(vp.bounds, {
      padding: { top: 60, bottom: 60, left: 60, right: 60 },
      duration: 800,
      maxZoom: 7,
    });
  }

  // Traccia la posizione schermo del pin selezionato: aggiorna ad
  // ogni movimento/zoom mappa per tenere il popup ancorato sopra.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected) {
      setPopupAnchor(null);
      return;
    }
    const update = () => {
      const pt = map.project([selected.lon, selected.lat]);
      setPopupAnchor({ x: pt.x, y: pt.y });
    };
    update();
    map.on("move", update);
    map.on("zoom", update);
    return () => {
      map.off("move", update);
      map.off("zoom", update);
    };
  }, [selected]);

  // Lazy reverse-geocoding: se la posizione selezionata non ha un
  // office_address dal DB, prova a recuperarlo via API server-side
  // (Nominatim). Cache locale keyed sulla pos id evita refetch su
  // re-render. Niente fetch per pos id già risolte (anche null).
  useEffect(() => {
    if (!selected) return;
    if (selected.office_address) return;
    if (selected.id in reverseAddrs) return;
    let cancel = false;
    fetch(
      `/api/positions/reverse-geocode?lat=${selected.lat}&lon=${selected.lon}`,
    )
      .then((r) => (r.ok ? r.json() : { address: null }))
      .then((d: { address: string | null }) => {
        if (cancel) return;
        setReverseAddrs((cur) => ({
          ...cur,
          [selected.id]: d.address ?? "",
        }));
      })
      .catch(() => {
        if (!cancel) {
          setReverseAddrs((cur) => ({ ...cur, [selected.id]: "" }));
        }
      });
    return () => {
      cancel = true;
    };
  }, [selected, reverseAddrs]);

  // Auto-zoom sui pin filtrati: ogni volta che cambia displayData
  // (filtri donut/histogram di /map o primo fetch), riadatta la
  // vista per inquadrare i pin attualmente mostrati.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReadyRef.current || displayData.length === 0) return;
    const vp = bestViewport(displayData);
    if (!vp) return;
    map.fitBounds(vp.bounds, {
      padding: { top: 60, bottom: 60, left: 60, right: 60 },
      duration: 800,
      maxZoom: 7,
    });
  }, [displayData]);

  const wrapClass =
    hero || fullscreen
      ? fullscreen
        ? "h-full"
        : ""
      : "bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]";

  return (
    <div className={wrapClass}>
      {!hero && !fullscreen && (
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <span className="section-label">Mappa offerte</span>
          <div className="flex items-center gap-3 text-[10px] text-[var(--color-muted)]">
            {loaded && (
              <>
                <span>
                  <span className="text-[var(--color-bright)] font-semibold">
                    {data.length}
                  </span>{" "}
                  con coordinate
                </span>
                {remoteCount > 0 && (
                  <span>
                    ·{" "}
                    <span className="text-[var(--color-bright)] font-semibold">
                      {remoteCount}
                    </span>{" "}
                    remote
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Sposta i controlli zoom +/- dal top-left al top-CENTER
          (liberiamo la colonna sinistra alla card Location). Il
          bottone "Vista generale" si affianca a sinistra dei controlli
          zoom — l'insieme è centrato orizzontalmente. */}
      <style>{`
        .jht-globe-wrap .maplibregl-ctrl-top-left {
          left: 50%;
          transform: translateX(-50%);
        }
        .jht-globe-wrap .maplibregl-ctrl-top-left .maplibregl-ctrl-group {
          margin-top: 0;
        }
      `}</style>
      <div
        ref={mapWrapRef}
        className={`jht-globe-wrap relative w-full overflow-hidden ${hero || fullscreen ? "" : "rounded-md"}`}
        // zoom: 1 neutralizza il body { zoom: var(--zoom) } di JHT
        // che mandava MapLibre a leggere dimensioni canvas sbagliate.
        // In hero il bg è transparent così il globo si fonde col
        // body (--color-deep) senza frame; in card mode mantiene
        // --color-deep esplicito. In fullscreen height=100% riempie
        // il container fisso (es. /map).
        style={{
          height: fullscreen ? "100%" : hero ? 620 : 500,
          background: hero || fullscreen ? "transparent" : "var(--color-deep)",
          zoom: 1,
        }}
      >
        <div
          ref={mapContainerRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
        />

        {/* Bottone "Vista generale": fitBounds sulla faccia migliore.
            Posizionato top-center, affiancato ai controlli zoom +/-. */}
        {loaded && data.length > 0 && (
          <button
            onClick={flyToAll}
            aria-label="Vista generale"
            title="Vista generale — mostra tutti i pin"
            className="absolute top-2 z-10 text-[10px] font-semibold tracking-widest uppercase"
            style={{
              // Bordo destro del bottone a (50% - 30px) → resta ~8px
              // di gap a sinistra del ctrl-group +/- centrato sul 50%.
              left: "calc(50% - 30px)",
              transform: "translateX(-100%)",
              padding: "6px 10px",
              borderRadius: 6,
              background: "var(--color-panel)",
              border: "1px solid var(--color-border)",
              color: "var(--color-bright)",
              cursor: "pointer",
              fontFamily: "inherit",
              boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            }}
          >
            ⊕ Vista generale
          </button>
        )}

        {!loaded && (
          <p className="absolute inset-0 grid place-items-center text-[11px] text-[var(--color-dim)] pointer-events-none">
            Caricamento…
          </p>
        )}

        {selected && popupAnchor && (
          <div
            // Vignetta popup ancorata sopra al pin selezionato. La
            // freccia in basso punta esattamente al pin. translate
            // -50% X centra orizzontalmente sul pin; -100% Y la
            // sposta interamente sopra; il -14px Y aggiunge gap +
            // spazio per la coda.
            className="absolute bg-[var(--color-panel)] border border-[var(--color-border)] rounded-md p-3 text-[11px] z-10"
            style={{
              left: popupAnchor.x,
              top: popupAnchor.y - 14,
              transform: "translate(-50%, -100%)",
              width: 280,
              maxWidth: "calc(100vw - 32px)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            }}
          >
            <div className="flex items-start justify-between gap-3 mb-1">
              <span
                className="text-[9px] font-semibold tracking-widest uppercase"
                style={{
                  color: STATUS_COLORS[selected.status] ?? "var(--color-dim)",
                }}
              >
                {selected.status}
                {selected.score != null ? ` · ${selected.score}` : ""}
              </span>
              <button
                onClick={() => setSelected(null)}
                aria-label="Chiudi"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--color-muted)",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
            <div className="font-semibold text-[var(--color-bright)] mb-0.5">
              {selected.title}
            </div>
            <div className="text-[var(--color-muted)] mb-1">
              {selected.company}
            </div>
            {(() => {
              const lazyAddr = reverseAddrs[selected.id];
              const street = selected.office_address || lazyAddr || null;
              const fallback = selected.location;
              const showStreet = street && street.length > 0;
              const showFallback =
                fallback && fallback.length > 0 && fallback !== street;
              const looking =
                !selected.office_address && lazyAddr === undefined;
              return (
                <>
                  {(showStreet || fallback) && (
                    <div
                      className="text-[10px] mb-1 flex items-start gap-1"
                      style={{ color: "var(--color-base)" }}
                      title={street ?? fallback ?? ""}
                    >
                      <span aria-hidden>📍</span>
                      <span className="leading-tight">
                        {showStreet ? street : fallback}
                        {looking && (
                          <span
                            className="ml-1 italic"
                            style={{ color: "var(--color-dim)" }}
                          >
                            cercando indirizzo…
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                  {showStreet && showFallback && (
                    <div
                      className="text-[9px] mb-1 truncate"
                      style={{ color: "var(--color-dim)" }}
                    >
                      {fallback}
                    </div>
                  )}
                </>
              );
            })()}
            <div
              className="text-[9px] mb-2 tabular-nums"
              style={{ color: "var(--color-dim)" }}
            >
              {selected.lat.toFixed(4)}, {selected.lon.toFixed(4)}
            </div>
            <Link
              href={`/positions/${selected.id}`}
              className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)] hover:underline no-underline"
            >
              Apri →
            </Link>

            {/* Coda della vignetta: triangolo SVG centrato sotto al
                box, punta verso il basso (verso il pin). Riga top
                del triangolo NON disegnata per non far apparire
                doppia linea col bordo del popup. */}
            <svg
              width="16"
              height="9"
              viewBox="0 0 16 9"
              style={{
                position: "absolute",
                left: "50%",
                bottom: -9,
                transform: "translateX(-50%)",
                pointerEvents: "none",
                overflow: "visible",
              }}
              aria-hidden
            >
              <path
                d="M 0 0 L 8 9 L 16 0 Z"
                fill="var(--color-panel)"
                stroke="none"
              />
              <path
                d="M 0 0 L 8 9 L 16 0"
                fill="none"
                stroke="var(--color-border)"
                strokeWidth="1"
              />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
