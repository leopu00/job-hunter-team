"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useTheme } from "@/app/theme-provider";
import { useLocale } from "@/lib/use-locale";
import { UNCATEGORIZED_LABEL } from "@/lib/position-classifier";
import { scoreToRgb } from "@/lib/score-color";

// Stringhe UI hardcoded localizzate (chart/empty/aria/popup).
const T: Record<string, Record<string, string>> = {
  jobs_map: {
    it: "Mappa offerte",
    en: "Jobs map",
    hu: "Állástérkép",
    es: "Mapa de ofertas",
    de: "Stellenkarte",
    fr: "Carte des offres",
    pt: "Mapa de vagas",
  },
  with_coords: {
    it: "con coordinate",
    en: "with coordinates",
    hu: "koordinátákkal",
    es: "con coordenadas",
    de: "mit Koordinaten",
    fr: "avec coordonnées",
    pt: "com coordenadas",
  },
  remote: {
    it: "remote",
    en: "remote",
    hu: "távmunka",
    es: "remoto",
    de: "Remote",
    fr: "à distance",
    pt: "remoto",
  },
  overview: {
    it: "Vista generale",
    en: "Overview",
    hu: "Áttekintés",
    es: "Vista general",
    de: "Übersicht",
    fr: "Vue d'ensemble",
    pt: "Visão geral",
  },
  overview_title: {
    it: "Vista generale — mostra tutti i pin",
    en: "Overview — show all pins",
    hu: "Áttekintés — minden jelölő megjelenítése",
    es: "Vista general — mostrar todos los pines",
    de: "Übersicht — alle Pins anzeigen",
    fr: "Vue d'ensemble — afficher tous les points",
    pt: "Visão geral — mostrar todos os pins",
  },
  loading: {
    it: "Caricamento…",
    en: "Loading…",
    hu: "Betöltés…",
    es: "Cargando…",
    de: "Laden…",
    fr: "Chargement…",
    pt: "Carregando…",
  },
  close: {
    it: "Chiudi",
    en: "Close",
    hu: "Bezárás",
    es: "Cerrar",
    de: "Schließen",
    fr: "Fermer",
    pt: "Fechar",
  },
  looking_address: {
    it: "cercando indirizzo…",
    en: "looking up address…",
    hu: "cím keresése…",
    es: "buscando dirección…",
    de: "Adresse wird gesucht…",
    fr: "recherche d'adresse…",
    pt: "buscando endereço…",
  },
  open: {
    it: "Apri →",
    en: "Open →",
    hu: "Megnyitás →",
    es: "Abrir →",
    de: "Öffnen →",
    fr: "Ouvrir →",
    pt: "Abrir →",
  },
  match_score: {
    it: "Match score",
    en: "Match score",
    hu: "Match pontszám",
    es: "Match score",
    de: "Match-Score",
    fr: "Score de match",
    pt: "Match score",
  },
  found_on: {
    it: "Trovata il",
    en: "Found on",
    hu: "Megtalálva",
    es: "Encontrada el",
    de: "Gefunden am",
    fr: "Trouvée le",
    pt: "Encontrada em",
  },
  zoom_in: {
    it: "Ingrandisci",
    en: "Zoom in",
    hu: "Nagyítás",
    es: "Acercar",
    de: "Vergrößern",
    fr: "Zoom avant",
    pt: "Aproximar",
  },
  zoom_out: {
    it: "Rimpicciolisci",
    en: "Zoom out",
    hu: "Kicsinyítés",
    es: "Alejar",
    de: "Verkleinern",
    fr: "Zoom arrière",
    pt: "Afastar",
  },
};

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

// Scala colore score (solo-verde) condivisa con la score distribution.
// Vedi web/lib/score-color.ts (unica fonte di verità).

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
  // Data di creazione della posizione (≈ primo ritrovamento). Usata
  // nella vignetta come "trovata il".
  created_at: string | null;
};

// Un gruppo di posizioni che condividono la stessa coordinata
// (city-center fallback). Renderizzato come singolo symbol al centroide
// con icona canvas che contiene N raggi alti come gli score.
type GroupedFeature = {
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

// Esplode i group coord-coincident in singletons, perché a zoom
// street-level ogni position deve essere cliccabile (con N positions
// sulla stessa coord il click cade su uno solo).
//
// I pin sono FASCI VERTICALI: disposti in cerchio le colonne si
// incrociano (pin sopra/sotto condividono la x) → click ambiguo. Li
// disponiamo invece in una FILA ORIZZONTALE — tutti alla stessa
// latitudine, distanziati lungo la longitudine — così ogni colonna è
// isolata e selezionabile. Spaziatura in PIXEL (costante a schermo a
// qualunque zoom) via la proiezione reale; fallback a stima metrica.
// Ordine stabile (per id) → la fila non "balla" tra refresh/zoom.
function explodeGroups(
  groups: GroupedFeature[],
  zoom: number,
  map?: MaplibreMap | null,
): GroupedFeature[] {
  // Spaziatura orizzontale fra pin (px) — supera l'ingombro dell'icona
  // così i box di click non si sovrappongono.
  const SPACING_PX = 64;
  const out: GroupedFeature[] = [];
  for (const g of groups) {
    if (g.count <= 1) {
      out.push(g);
      continue;
    }
    let center: { x: number; y: number } | null = null;
    if (map) {
      try {
        center = map.project([g.lon, g.lat]);
      } catch {
        center = null;
      }
    }
    // Fallback metrico (proiezione assente): ground-meters per pixel in
    // Web Mercator alla latitudine del gruppo → spaziatura in longitudine.
    const mpp =
      (156543.03392 * Math.cos((g.lat * Math.PI) / 180)) / Math.pow(2, zoom);
    const lonScale = 1 / Math.cos((g.lat * Math.PI) / 180);
    // Fila ordinata per SCORE crescente: score più basso a sinistra, più alto
    // a destra. Tie-break per id → fila stabile fra refresh/zoom.
    const stable = [...g.positions].sort((a, b) => {
      const sa = a.score ?? -1;
      const sb = b.score ?? -1;
      if (sa !== sb) return sa - sb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const mid = (g.count - 1) / 2;
    stable.forEach((p, i) => {
      // Offset orizzontale centrato sulla coord del gruppo.
      const offset = (i - mid) * SPACING_PX;
      let lat: number;
      let lon: number;
      if (center && map) {
        const ll = map.unproject([center.x + offset, center.y]);
        lat = ll.lat;
        lon = ll.lng;
      } else {
        const meters = offset * mpp;
        lat = g.lat;
        lon = g.lon + (meters / 111000) * lonScale;
      }
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
// Soglia (px) sotto la quale due marker-città si SOVRAPPONGONO a schermo e
// vanno fusi in un super-cluster. Clustering in PIXEL (non in gradi): è
// pan-invariante (la distanza relativa fra due punti fissi non cambia col
// pan, solo con lo zoom) → niente "tremolio" durante lo scroll, e città
// lontane (Zurigo/Milano) non si fondono mai a zoom medio.
const CITY_MERGE_PX = 52;

function mergeGroups(arr: GroupedFeature[]): GroupedFeature {
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
  return {
    groupKey: `super|${arr.map((g) => g.groupKey).join(",")}`,
    iconId: iconIdForScores(scores),
    lat,
    lon,
    count: totalCount,
    scores,
    positions,
    topScore,
  };
}

// Fonde i gruppi-città i cui marker si sovrappongono in pixel al zoom corrente.
// Greedy O(n²) su n = numero città (poche decine) → trascurabile.
function pixelClusterCities(
  groups: GroupedFeature[],
  map: MaplibreMap | null | undefined,
): GroupedFeature[] {
  if (!map || groups.length <= 1) return groups;
  const pts = groups.map((g) => {
    let px: { x: number; y: number } | null = null;
    try {
      px = map.project([g.lon, g.lat]);
    } catch {
      px = null;
    }
    return { g, px };
  });
  const used = new Array(pts.length).fill(false);
  const out: GroupedFeature[] = [];
  const thr2 = CITY_MERGE_PX * CITY_MERGE_PX;
  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const cluster = [pts[i].g];
    const pi = pts[i].px;
    if (pi) {
      for (let j = i + 1; j < pts.length; j++) {
        if (used[j] || !pts[j].px) continue;
        const dx = pi.x - pts[j].px!.x;
        const dy = pi.y - pts[j].px!.y;
        if (dx * dx + dy * dy < thr2) {
          cluster.push(pts[j].g);
          used[j] = true;
        }
      }
    }
    out.push(cluster.length === 1 ? cluster[0] : mergeGroups(cluster));
  }
  return out;
}

function reclusterByZoom(
  groups: GroupedFeature[],
  zoom: number,
  map?: MaplibreMap | null,
): GroupedFeature[] {
  if (groups.length === 0) return [];
  // Zoom street-level: esplode la città nei singoli pin cliccabili.
  if (clusterRadiusDeg(zoom) <= 0) {
    return explodeGroups(groups, zoom, map);
  }
  // Altrimenti: un marker per città, ma città che si SOVRAPPONGONO a schermo
  // vengono fuse in un super-cluster (si separano zoomando).
  return pixelClusterCities(groups, map);
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

// Colore del match score (fasce allineate alla pagina Posizioni).
function matchScoreColor(s: number | null): string {
  if (s == null) return "var(--color-dim)";
  if (s >= 75) return "var(--color-green)";
  if (s >= 55) return "var(--color-yellow)";
  return "var(--color-red)";
}

// Data "trovata il" leggibile (gg/mm/aaaa). Solo client (la vignetta
// si renderizza on-click), niente rischio di hydration mismatch.
function formatFoundDate(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default function JobsGlobe({
  hero = false,
  fullscreen = false,
  selectedTypes = [],
  selectedScoreRanges = [],
  selectedUnscored = false,
  selectedCountries = [],
  selectedCities = [],
  bottomCenterExtra = null,
  focusPosition = null,
  familyColors = {},
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
  // Slot opzionale renderizzato nella barra controlli in basso-centro,
  // a destra di "Vista generale" + zoom (es. la pill "Filtri" di /map).
  // Sta nella stessa riga flex → l'insieme si ricentra automaticamente.
  bottomCenterExtra?: ReactNode;
  // Richiesta di focus su una posizione (dalla card Posizioni di /map):
  // la mappa zooma sul suo pin e lo seleziona. `tick` ri-triggera lo
  // stesso id. null = nessuna richiesta.
  focusPosition?: { id: string; tick: number } | null;
  // Mappa tipologia → colore (dalla donut) per il puntino nella vignetta.
  familyColors?: Record<string, string>;
} = {}) {
  const { resolvedTheme } = useTheme();
  const locale = useLocale();
  const tr = (k: string) => T[k]?.[locale] ?? T[k]?.en ?? k;
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
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const layersReadyRef = useRef(false);
  const themeRef = useRef<"dark" | "light">(resolvedTheme);
  // Ref tracking di clustered (gruppi RI-clusterizzati in pixel-space
  // sul viewport corrente). Letta dentro onStyleLoad che ha una closure
  // vecchia (registrato 1 sola volta in mount).
  const clusteredRef = useRef<GroupedFeature[]>([]);
  // Focus posizione in attesa: settato quando la città non è ancora esplosa;
  // si centra sul pin appena il cluster si ricompone (effetto su `clustered`).
  const pendingFocusRef = useRef<string | null>(null);
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
      // Raggruppa per COORDINATA, non per città: un ufficio geocodato in modo
      // esatto diventa il SUO pin alle sue coordinate reali (il team cerca
      // l'indirizzo preciso dell'ufficio apposta perché si veda lì). Le
      // posizioni senza indirizzo esatto condividono tutte la stessa
      // coordinata-città (vedi resolveCityPins) → si aggregano in un unico
      // pin-città. A zoom basso i pin vicini vengono fusi in un super-cluster
      // (pixelClusterCities); il click li espande.
      const key = `${p.lat.toFixed(4)}|${p.lon.toFixed(4)}`;
      const arr = groups.get(key);
      if (arr) arr.push(p);
      else groups.set(key, [p]);
    }
    const out: GroupedFeature[] = [];
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
        map.setProjection({ type: "globe" });
      } catch (e) {
        console.warn("[JobsGlobe] globe projection unsupported:", e);
      }
      // Force resize: container 0x0 al primo render (animazione fade-in).
      map.resize();
      // Attribution (obbligo licenza OSM/CARTO): parte COLLASSATA sulla
      // sola (i) — maplibre a volte la inizializza espansa (-show). Il
      // credito riappare al click sulla (i) o su hover (vedi CSS sotto).
      container
        .querySelector(".maplibregl-ctrl-attrib")
        ?.classList.remove("maplibregl-compact-show");
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
              "#96b4a5",
              0,
              "#b8d6c4",
              40,
              "#8fcaa8",
              70,
              "#34c97f",
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
      console.error("[JobsGlobe] map error:", (e as any)?.error?.message ?? e);
    });

    // Click handler sul layer: identifica il gruppo via groupKey e
    // recupera la lista positions dal ref.
    //  • singleton → popup diretto + zoom-in moderato sul pin.
    //  • gruppo → INQUADRA tutte le posizioni del gruppo (fitBounds sui
    //    loro bounds reali) così le si vede tutte; niente popup, perché
    //    salendo di zoom il cluster si ri-divide nei pin individuali.
    //    Se le posizioni sono coincidenti (stessa coord) → zoom profondo
    //    che le "esplode" con micro-offset rendendole cliccabili.
    map.on("click", LAYER_DOT_ID, (e) => {
      // I fasci sono icone alte: i loro box di click si sovrappongono,
      // quindi e.features[0] (il top in z-order) NON è quello puntato.
      // Interroghiamo un riquadro attorno al click e scegliamo la
      // feature il cui PIN (base) proietta più vicino al punto cliccato
      // → si seleziona quello che si mira.
      const R = 44;
      const near = map.queryRenderedFeatures(
        [
          [e.point.x - R, e.point.y - R],
          [e.point.x + R, e.point.y + R],
        ],
        { layers: [LAYER_DOT_ID] },
      );
      const feats = near.length > 0 ? near : (e.features ?? []);
      if (feats.length === 0) return;
      let f = feats[0];
      let bestD = Infinity;
      for (const cand of feats) {
        const geom = cand.geometry;
        if (geom.type !== "Point") continue;
        const [lon, lat] = geom.coordinates as [number, number];
        const pt = map.project([lon, lat]);
        const d =
          (pt.x - e.point.x) * (pt.x - e.point.x) +
          (pt.y - e.point.y) * (pt.y - e.point.y);
        if (d < bestD) {
          bestD = d;
          f = cand;
        }
      }
      const groupKey = (f.properties as { groupKey?: string })?.groupKey;
      if (!groupKey) return;
      const g = clusteredRef.current.find((x) => x.groupKey === groupKey);
      if (!g) return;

      if (g.count > 1) {
        setSelected(null);
        const vp = bestViewport(g.positions);
        const spread =
          vp != null &&
          (vp.bounds[1][0] - vp.bounds[0][0] > 1e-4 ||
            vp.bounds[1][1] - vp.bounds[0][1] > 1e-4);
        if (vp && spread) {
          // Inquadra tutto il gruppo. Padding-top generoso: i fasci dei
          // pin si sviluppano verso l'alto e non devono uscire dal frame.
          map.fitBounds(vp.bounds, {
            padding: { top: 140, bottom: 90, left: 90, right: 90 },
            duration: 800,
            maxZoom: 14,
          });
        } else {
          // Posizioni coincidenti: zoom street-level → explodeCoincident
          // le separa con micro-offset.
          map.flyTo({
            center: [g.lon, g.lat],
            zoom: Math.max(map.getZoom() + 2, 15),
            duration: 800,
          });
        }
        return;
      }

      // Singleton: popup diretto sul pin + zoom-in moderato.
      setSelected(g.positions[0]);
      map.flyTo({
        center: [g.lon, g.lat],
        zoom: Math.max(map.getZoom(), 11),
        duration: 800,
      });
    });

    map.on("mouseenter", LAYER_DOT_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYER_DOT_ID, () => {
      map.getCanvas().style.cursor = "";
    });

    // Controlli zoom/bussola: NON usiamo più NavigationControl di
    // maplibre (DOM gestito da maplibre, layout verticale fisso).
    // Renderizziamo bottoni custom (zoom +/-/nord) nella barra in
    // basso-centro, orizzontali e affiancati a "Vista generale".
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
    return reclusterByZoom(grouped, map.getZoom(), map);
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
      // Reset anche dell'inclinazione (pitch) e dell'orientamento
      // (bearing) → torna alla vista piatta di default, non solo al
      // centro/zoom. L'utente può inclinare col touchpad; questo
      // pulsante rimette tutto a posto.
      pitch: 0,
      bearing: 0,
    });
  }

  // Controlli zoom custom (rimpiazzano NavigationControl). Niente
  // reset-nord: il globo non ruota e "Vista generale" già riallinea.
  const zoomIn = () => mapRef.current?.zoomIn();
  const zoomOut = () => mapRef.current?.zoomOut();

  // Traccia la posizione schermo del pin selezionato: aggiorna ad
  // ogni movimento/zoom mappa per tenere il popup ancorato sopra.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected) {
      setPopupAnchor(null);
      return;
    }
    const update = () => {
      // Ancora il popup alla coordinata RENDERIZZATA del pin (che può
      // essere esplosa/offsettata in una fila), non a quella originale
      // condivisa dal gruppo — altrimenti la vignetta finisce al centro
      // del gruppo invece che sopra il pin selezionato.
      const grp = clusteredRef.current.find((x) =>
        x.positions.some((p) => p.id === selected.id),
      );
      const lon = grp ? grp.lon : selected.lon;
      const lat = grp ? grp.lat : selected.lat;
      const pt = map.project([lon, lat]);
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

  // Auto-zoom sui pin filtrati: ogni volta che cambia displayData
  // (filtri donut/histogram di /map o primo fetch), riadatta la
  // vista per inquadrare i pin attualmente mostrati.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReadyRef.current || displayData.length === 0) return;
    const vp = bestViewport(displayData);
    if (!vp) return;
    map.fitBounds(vp.bounds, {
      padding: { top: 80, bottom: 80, left: 80, right: 80 },
      duration: 800,
      // maxZoom city-level (era 7 = livello stato): filtrando una città
      // si scende fino allo zoom città; per insiemi più ampi (paese,
      // tutto) fitBounds sceglie comunque uno zoom inferiore.
      maxZoom: 12,
    });
  }, [displayData]);

  // Focus su una posizione richiesto da una lista (card Posizioni o drilldown
  // Location): centra il SUO pin al centro schermo e apre la card. Il pin, a
  // zoom-esplosione, è in una fila offsettata → centriamo sulla coord
  // RENDERIZZATA (singleton in clustered), non su quella di città.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusPosition) return;
    const pos = data.find((d) => d.id === focusPosition.id);
    if (!pos) return;
    setSelected(pos);
    // Se il pin è GIÀ esploso (singleton presente), centra direttamente su di esso.
    const existing = clusteredRef.current.find(
      (g) => g.count === 1 && g.positions[0]?.id === pos.id,
    );
    if (existing) {
      pendingFocusRef.current = null;
      map.easeTo({
        center: [existing.lon, existing.lat],
        zoom: Math.max(map.getZoom(), 13),
        duration: 600,
      });
      return;
    }
    // Altrimenti: vola sulla città a zoom-esplosione; il re-center sul pin
    // avviene quando il cluster si ricompone (effetto sotto, su `clustered`).
    pendingFocusRef.current = pos.id;
    map.flyTo({
      center: [pos.lon, pos.lat],
      zoom: Math.max(map.getZoom(), 13),
      duration: 800,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPosition?.tick]);

  // Quando il cluster si ricompone (es. dopo lo zoom del focus la città
  // esplode), se c'è un focus in attesa centra esattamente sul pin singolo.
  useEffect(() => {
    const id = pendingFocusRef.current;
    if (!id) return;
    const map = mapRef.current;
    if (!map) return;
    const feat = clustered.find(
      (g) => g.count === 1 && g.positions[0]?.id === id,
    );
    if (feat) {
      pendingFocusRef.current = null;
      map.easeTo({ center: [feat.lon, feat.lat], duration: 400 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clustered]);

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
          <span className="section-label">{tr("jobs_map")}</span>
          <div className="flex items-center gap-3 text-[10px] text-[var(--color-muted)]">
            {loaded && (
              <>
                <span>
                  <span className="text-[var(--color-bright)] font-semibold">
                    {data.length}
                  </span>{" "}
                  {tr("with_coords")}
                </span>
                {remoteCount > 0 && (
                  <span>
                    ·{" "}
                    <span className="text-[var(--color-bright)] font-semibold">
                      {remoteCount}
                    </span>{" "}
                    {tr("remote")}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Attribution compatta: di default mostra solo la (i); il testo
          "© CARTO, © OpenStreetMap contributors" appare su hover o
          quando l'utente apre col click (stato -show). Conforme alla
          licenza (il credito resta accessibile) ma non invadente. */}
      <style>{`
        .jht-globe-wrap .maplibregl-ctrl-attrib-inner { display: none; }
        .jht-globe-wrap .maplibregl-ctrl-attrib:hover .maplibregl-ctrl-attrib-inner,
        .jht-globe-wrap .maplibregl-ctrl-attrib.maplibregl-compact-show .maplibregl-ctrl-attrib-inner { display: block; }
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

        {/* Barra controlli in basso-centro: [Vista generale] +
            [zoom +/-/nord orizzontale] + slot opzionale (pill "Filtri"
            di /map). Tutti nella stessa riga flex centrata → l'insieme
            si ricentra da solo e "Vista generale" si sposta quando
            compaiono i filtri. */}
        {loaded && (
          <div
            className="absolute z-10"
            style={{
              bottom: 24,
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              alignItems: "flex-end",
              gap: 8,
              pointerEvents: "auto",
            }}
          >
            {/* Widget unico orizzontale: + | − | ⊕ (Vista generale).
                Niente più bottone "Vista generale" separato: l'ultimo
                tasto del widget reinquadra tutti i pin (flyToAll). */}
            <div
              className="flex items-stretch"
              style={{
                background: "var(--color-panel)",
                border: "1px solid var(--color-border)",
                borderRadius: 9999,
                overflow: "hidden",
                boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
              }}
            >
              <GlobeCtrlButton onClick={zoomIn} label={tr("zoom_in")}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </GlobeCtrlButton>
              <span
                aria-hidden
                style={{ width: 1, background: "var(--color-border)" }}
              />
              <GlobeCtrlButton onClick={zoomOut} label={tr("zoom_out")}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </GlobeCtrlButton>
              {data.length > 0 && (
                <>
                  <span
                    aria-hidden
                    style={{ width: 1, background: "var(--color-border)" }}
                  />
                  <GlobeCtrlButton
                    onClick={flyToAll}
                    label={tr("overview_title")}
                  >
                    {/* ⊕ — reinquadra tutti i pin (vista generale) */}
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden
                    >
                      <circle cx="12" cy="12" r="8" />
                      <line x1="12" y1="1.5" x2="12" y2="5.5" />
                      <line x1="12" y1="18.5" x2="12" y2="22.5" />
                      <line x1="1.5" y1="12" x2="5.5" y2="12" />
                      <line x1="18.5" y1="12" x2="22.5" y2="12" />
                    </svg>
                  </GlobeCtrlButton>
                </>
              )}
            </div>

            {bottomCenterExtra}
          </div>
        )}

        {!loaded && (
          <p className="absolute inset-0 grid place-items-center text-[11px] text-[var(--color-dim)] pointer-events-none">
            {tr("loading")}
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
            {/* Header: etichetta match score (sx) + chiudi (dx). */}
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span
                className="text-[8px] font-semibold tracking-widest uppercase"
                style={{ color: "var(--color-dim)" }}
              >
                {tr("match_score")}
              </span>
              <button
                onClick={() => setSelected(null)}
                aria-label={tr("close")}
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

            {/* Titolo/azienda (sx) + score grande (dx). */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div
                  className="font-semibold leading-tight"
                  style={{ color: "var(--color-bright)" }}
                >
                  {selected.title}
                </div>
                <div
                  className="text-[10px] mt-0.5 truncate"
                  style={{ color: "var(--color-muted)" }}
                  title={selected.company ?? ""}
                >
                  {selected.company}
                </div>
              </div>
              <div
                className="text-[24px] font-bold leading-none tabular-nums flex-shrink-0"
                style={{ color: matchScoreColor(selected.score) }}
              >
                {selected.score ?? "—"}
              </div>
            </div>

            {/* Location: solo città + paese (niente via). */}
            {(() => {
              const loc =
                [selected.loc_city, selected.loc_country]
                  .filter(Boolean)
                  .join(", ") ||
                selected.location ||
                "";
              if (!loc) return null;
              return (
                <div
                  className="text-[10px] mt-2 flex items-start gap-1"
                  style={{ color: "var(--color-base)" }}
                  title={loc}
                >
                  <span aria-hidden>📍</span>
                  <span className="leading-tight">{loc}</span>
                </div>
              );
            })()}

            {/* Divisore + riga meta: tipologia (sx) | data (dx). */}
            {(selected.role_family || formatFoundDate(selected.created_at)) && (
              <div
                className="mt-2 pt-2 flex items-center justify-between gap-2 text-[9px]"
                style={{ borderTop: "1px solid var(--color-border)" }}
              >
                <span
                  className="truncate flex items-center gap-1.5"
                  style={{ color: "var(--color-base)" }}
                  title={selected.role_family ?? ""}
                >
                  {selected.role_family && (
                    <span
                      aria-hidden
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background:
                          familyColors[selected.role_family] ??
                          "var(--color-muted)",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span className="truncate">{selected.role_family ?? ""}</span>
                </span>
                {formatFoundDate(selected.created_at) && (
                  <span
                    className="tabular-nums flex-shrink-0"
                    style={{ color: "var(--color-dim)" }}
                  >
                    {tr("found_on")} {formatFoundDate(selected.created_at)}
                  </span>
                )}
              </div>
            )}

            {/* Azione */}
            <div className="mt-2 text-right">
              <Link
                href={`/positions/${selected.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)] hover:underline no-underline"
              >
                {tr("open")}
              </Link>
            </div>

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

// Bottone singolo del widget zoom orizzontale (icona centrata, hover
// leggero). Usato per +, − e reset-nord nella barra controlli mappa.
function GlobeCtrlButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex items-center justify-center transition-colors hover:bg-[var(--color-card)]"
      style={{
        width: 34,
        height: 34,
        background: "transparent",
        border: "none",
        color: "var(--color-bright)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
