"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useTheme } from "@/app/theme-provider";
import { useLocale } from "@/lib/use-locale";
import { UNCATEGORIZED_LABEL } from "@/lib/position-classifier";
import { scoreToRgb, scoreSpectrumCss } from "@/lib/score-color";
import { canonicalCountry, canonicalCityKey } from "@/lib/city-gazetteer";

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
  positions_here: {
    it: "posizioni a questo indirizzo",
    en: "positions at this address",
    hu: "pozíció ezen a címen",
    es: "posiciones en esta dirección",
    de: "Stellen an dieser Adresse",
    fr: "postes à cette adresse",
    pt: "vagas neste endereço",
  },
};

const SOURCE_ID = "jht-jobs";
const LAYER_HALO_ID = "jht-jobs-halo";
const LAYER_DOT_ID = "jht-jobs-dot";

// Tre regimi di aggregazione, selezionati dallo zoom SNAPPATO a intero.
// Dentro ciascun regime le coordinate non cambiano MAI (ancore fisse =
// mediana dei membri): le uniche transizioni sono gli attraversamenti
// di soglia (scelta utente 23/07 — "raggruppamento a zoom fuori,
// location esatte una volta scompattato").
//   snap < CITY_ZOOM            → un fascio per PAESE
//   CITY_ZOOM ≤ snap < DETAIL   → un fascio per CITTÀ
//   snap ≥ DETAIL_ZOOM          → pin alle coordinate esatte
const CITY_ZOOM = 5;
const DETAIL_ZOOM = 11;
type ViewLevel = 0 | 1 | 2; // 0=paese, 1=città, 2=esatto
function viewLevelForZoom(zoom: number): ViewLevel {
  const snap = Math.round(zoom);
  if (snap >= DETAIL_ZOOM) return 2;
  if (snap >= CITY_ZOOM) return 1;
  return 0;
}

// NIENTE clustering dipendente dallo zoom (scelta utente 23/07): ogni
// pin viene disegnato SEMPRE alla sua coordinata risolta (ufficio esatto
// o slot fisso della griglia nord), a qualsiasi zoom. I vecchi cluster
// dinamici (bucket geografici per-zoom + fusione dei marker sovrapposti
// in pixel) disegnavano il marker al CENTROIDE dei membri, che cambiava
// a ogni scatto di zoom → i pin sembravano "muoversi". Ora l'unica
// aggregazione è per coordinata IDENTICA (stesso building): un fascio a
// N raggi inchiodato lì, il click apre la lista delle posizioni.

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
// scores sorted desc (+ flag remote) → icone ri-usate fra cluster con
// stessa "testa di distribuzione" anche se la coda differisce.
function iconIdForScores(scores: (number | null)[], remote: boolean): string {
  const drawn = [...scores]
    .sort((a, b) => (b ?? 0) - (a ?? 0))
    .slice(0, MAX_BEAMS_PER_ICON)
    .map((s) => (s == null ? "x" : String(s)))
    .join("|");
  return `jht-bm-${remote ? "r-" : ""}${Math.min(scores.length, MAX_BEAMS_PER_ICON)}-${hashStr(drawn).toString(36)}`;
}

// Tinta del distintivo "da remoto" (anello alla base del fascio).
// Azzurro: fuori dalla scala verde degli score, non ruba significato.
const REMOTE_RING_RGB = "90,180,255";

function createGroupBeamsImageData(
  scores: (number | null)[],
  remote: boolean,
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
  // topSal: come per i beam, il gruppo il cui MIGLIOR score è basso ha
  // halo/core smorzati — solo i cluster buoni "brillano" a terra.
  const topScore = sortedDesc[0];
  const [hr, hg, hb] = scoreToRgb(topScore);
  const haloBase = `rgba(${hr},${hg},${hb},`;
  const topSal = 0.4 + 0.6 * scoreNormHeight(topScore);

  // Halo: ellisse tenue al centro (più piccolo + meno opaco rispetto
  // alle prime versioni). Suggerisce il "terreno" senza dominare.
  const haloR = Math.max(28, halfW * 0.55);
  const haloGrad = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, haloR);
  haloGrad.addColorStop(0, `${haloBase}${0.3 * topSal})`);
  haloGrad.addColorStop(0.5, `${haloBase}${0.1 * topSal})`);
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
    // Salienza ∝ score (feedback utente 21/07, SOLO globo — i grafici
    // tengono lo spettro pieno): con lo spettro al posto della scala
    // solo-verde, i beam rossi/ARANCIONI (score medio-bassi) attiravano
    // l'occhio più dei verdi. Alpha e saturazione crescono con lo score
    // su curve ripide (esponente > 1): la fascia arancione 45-65 si
    // spegne davvero, i verdi alti restano pieni e vivi.
    const [r0, g0, b0] = scoreToRgb(score);
    const sal = 0.22 + 0.78 * Math.pow(norm, 1.7);
    const keep = 0.4 + 0.6 * Math.pow(norm, 1.3);
    const gray = (r0 + g0 + b0) / 3;
    const r = Math.round(gray + (r0 - gray) * keep);
    const g = Math.round(gray + (g0 - gray) * keep);
    const b = Math.round(gray + (b0 - gray) * keep);
    const base = `rgba(${r},${g},${b},`;

    const grad = ctx.createLinearGradient(x, y0, x, topY);
    grad.addColorStop(0, `${base}${sal})`);
    grad.addColorStop(0.12, `${base}${0.92 * sal})`);
    grad.addColorStop(0.5, `${base}${0.4 * sal})`);
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
  const coreLight = `rgba(${Math.min(255, hr + 50)},${Math.min(255, hg + 50)},${Math.min(255, hb + 50)},${0.55 * topSal})`;
  const coreR = 11;
  const coreGrad = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, coreR);
  coreGrad.addColorStop(0, coreLight);
  coreGrad.addColorStop(0.5, `${haloBase}${0.28 * topSal})`);
  coreGrad.addColorStop(1, `${haloBase}0)`);
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, baseY, coreR, 0, 2 * Math.PI);
  ctx.fill();

  // Distintivo remote: ellisse azzurra alla base del fascio (schiacciata
  // come il "terreno" dell'aiuola). Doppio tratto: alone morbido + linea
  // netta → leggibile sia su singoli pin che su fasci aggregati.
  if (remote) {
    const rx = Math.max(16, Math.max(-minX, maxX) + beamW + 6);
    const ry = rx * yScale;
    ctx.beginPath();
    ctx.ellipse(cx, baseY, rx + 2, ry + 2, 0, 0, 2 * Math.PI);
    ctx.strokeStyle = `rgba(${REMOTE_RING_RGB},0.35)`;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, baseY, rx, ry, 0, 0, 2 * Math.PI);
    ctx.strokeStyle = `rgba(${REMOTE_RING_RGB},0.9)`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

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
  // 'full_remote' | 'hybrid' | 'onsite' | null — la sorgente di verità per
  // il regime remote (is_remote è derivato da questa lato query).
  remote_type: string | null;
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
  // true se TUTTI i membri sono full remote: icona con base cerchiata
  // azzurra + etichetta "Da remoto" sui fasci aggregati.
  remote: boolean;
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

// Aggrega i gruppi-coordinata in fasci per chiave (città o paese), con
// ancora alla MEDIANA per componente delle coordinate dei membri:
// deterministica, indipendente da zoom/pan, robusta agli outlier (una
// posizione mal geocodata non trascina il fascio). keyOf → null lascia
// il gruppo com'è (pin individuale in ogni regime).
function aggregateGroups(
  groups: GroupedFeature[],
  prefix: string,
  keyOf: (p: PositionCoord) => string | null,
): GroupedFeature[] {
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const byKey = new Map<string, PositionCoord[]>();
  const out: GroupedFeature[] = [];
  for (const g of groups) {
    const k = keyOf(g.positions[0]);
    if (k == null) {
      out.push(g);
      continue;
    }
    const arr = byKey.get(k) ?? [];
    arr.push(...g.positions);
    byKey.set(k, arr);
  }
  for (const [k, arr] of byKey) {
    const sorted = [...arr].sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
    const scores = sorted.map((p) => p.score);
    const topScore = scores.reduce<number | null>((acc, s) => {
      if (s == null) return acc;
      if (acc == null) return s;
      return Math.max(acc, s);
    }, null);
    const remote = sorted.every((p) => p.remote_type === "full_remote");
    out.push({
      groupKey: `${prefix}|${k}`,
      iconId: iconIdForScores(scores, remote),
      lat: median(arr.map((p) => p.lat)),
      lon: median(arr.map((p) => p.lon)),
      count: arr.length,
      scores,
      positions: sorted,
      topScore,
      remote,
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

// Colore del match score (fasce allineate alla pagina Posizioni).
function matchScoreColor(s: number | null): string {
  return scoreSpectrumCss(s ?? null);
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
  // Gruppo coincidente selezionato (più posizioni sullo stesso building):
  // il popup mostra la LISTA dei membri invece della singola posizione.
  // Mutuamente esclusivo con `selected`.
  const [selectedGroup, setSelectedGroup] = useState<GroupedFeature | null>(
    null,
  );
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
  // Ref tracking dei gruppi correnti (per coordinata identica). Letta
  // dentro onStyleLoad che ha una closure vecchia (registrato 1 sola
  // volta in mount).
  const clusteredRef = useRef<GroupedFeature[]>([]);
  // Registry icone gruppo registrate sulla mappa: iconId -> true. Permette
  // di rimuoverle quando il set di gruppi visibili cambia (filtri).
  const registeredIconsRef = useRef<Set<string>>(new Set());

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
      // posizioni senza indirizzo esatto arrivano da resolveCityPins già con
      // uno slot FISSO nella griglia a nord della città (~300 m fra loro) →
      // qui sono gruppi da 1. Coincidenti restano solo gli uffici reali
      // condivisi (stesso building): un fascio a N raggi inchiodato lì,
      // il click apre il popup-lista. A zoom città-in-giù questi gruppi
      // vengono aggregati per CITTÀ su un'ancora fissa (vedi cityGrouped).
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
      const remote = sorted.every((p) => p.remote_type === "full_remote");
      const iconId = iconIdForScores(scores, remote);
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
        remote,
      });
    }
    return out;
  }, [displayData]);

  // Aggregazioni per CITTÀ (regime 1) e per PAESE (regime 0): un solo
  // fascio per chiave, ancorato alla MEDIANA (per componente) delle
  // coordinate dei membri. La mediana è deterministica e NON dipende da
  // zoom/pan → il marker sta sempre nello stesso identico punto; le
  // uniche transizioni sono gli attraversamenti di soglia. Posizioni
  // senza chiave (città/paese mancante) restano pin individuali.
  // Chiavi CANONICHE (gazetteer): "Rome"/"Roma" e "Italy"/"Italia" nello
  // stesso fascio. Le full remote senza sede formano fasci propri: per
  // paese-vincolo ("remote|<paese>", ancorati alla loro griglia sud) o
  // l'isola unica "remote|anywhere". Le remote CON sede stanno nel fascio
  // della loro città come le altre (la sede conta).
  const cityGrouped = useMemo(
    () =>
      aggregateGroups(grouped, "city", (p) => {
        const city = (p.loc_city ?? "").trim();
        if (city) return canonicalCityKey(p.loc_country, p.loc_city);
        if (p.remote_type !== "full_remote") return null;
        const country = canonicalCountry(p.loc_country);
        return country ? `remote|${country}` : "remote|anywhere";
      }),
    [grouped],
  );
  const countryGrouped = useMemo(
    () =>
      aggregateGroups(grouped, "country", (p) => {
        const country = canonicalCountry(p.loc_country);
        const city = (p.loc_city ?? "").trim();
        if (p.remote_type === "full_remote" && !city) {
          return country ? `remote|${country}` : "remote|anywhere";
        }
        return country || null;
      }),
    [grouped],
  );

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
      const collapseAttrib = () =>
        container
          .querySelector(".maplibregl-ctrl-attrib")
          ?.classList.remove("maplibregl-compact-show");
      collapseAttrib();
      // I resize successivi (es. il box mobile che prende la sua altezza
      // dopo il mount) la riespandono: ricollassa quando la mappa si
      // assesta. once() = il click utente sulla (i) dopo resta rispettato.
      map.once("idle", collapseAttrib);
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
            // Etichetta sotto al fascio: count sui gruppi (>1), con
            // " · Da remoto" sui fasci di sole remote. Precomputata in
            // syncData (property "label").
            "text-field": ["get", "label"],
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
    //  • fascio paese/città (groupKey "country|"/"city|") → fitBounds
    //    sui membri: lo zoom attraversa la soglia e il fascio si
    //    scompatta nel livello successivo.
    //  • gruppo coincidente (più posizioni sulla STESSA coordinata, es.
    //    stesso hotel) → popup-lista dei membri, ancorato al pin.
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

      if (
        g.count > 1 &&
        (g.groupKey.startsWith("city|") || g.groupKey.startsWith("country|"))
      ) {
        // Fascio paese/città: inquadra tutte le posizioni; lo zoom
        // risultante attraversa la soglia e il fascio si scompatta nel
        // livello successivo. Padding-top generoso per i fasci alti.
        setSelected(null);
        setSelectedGroup(null);
        const vp = bestViewport(g.positions);
        if (vp) {
          map.fitBounds(vp.bounds, {
            padding: { top: 140, bottom: 90, left: 90, right: 90 },
            duration: 800,
            maxZoom: 14,
          });
        }
        return;
      }

      if (g.count > 1) {
        // Popup-lista sul gruppo coincidente + zoom-in moderato per
        // leggerlo nel contesto della via.
        setSelected(null);
        setSelectedGroup(g);
        map.flyTo({
          center: [g.lon, g.lat],
          zoom: Math.max(map.getZoom(), 11),
          duration: 800,
        });
        return;
      }

      // Singleton: popup diretto sul pin + zoom-in moderato.
      setSelectedGroup(null);
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

  // Tre regimi (paese/città/esatto), tutti con coordinate FISSE: il
  // livello cambia solo quando lo zoom snappato attraversa una soglia
  // → transizioni nette, nessuna ricomposizione continua (era la causa
  // dei pin "che si muovono").
  const [viewLevel, setViewLevel] = useState<ViewLevel>(0);
  const clustered =
    viewLevel === 2 ? grouped : viewLevel === 1 ? cityGrouped : countryGrouped;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const check = () => {
      const level = viewLevelForZoom(map.getZoom());
      setViewLevel((prev) => {
        if (level < prev) {
          // Ri-aggregazione (zoom out): chiudi i popup, il pin ancorato
          // non è più renderizzato (assorbito in un fascio). Verso il
          // dettaglio i popup restano: il pin selezionato esiste alle
          // sue coordinate esatte — è il caso del focus dalla sidebar,
          // che apre il popup e poi zooma.
          setSelected(null);
          setSelectedGroup(null);
        }
        return level;
      });
    };
    check();
    map.on("zoomend", check);
    return () => {
      map.off("zoomend", check);
    };
  }, [loaded]);

  // Tieni il ref allineato a ogni render: syncData (closure vecchia)
  // legge sempre i gruppi attuali.
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
        const img = createGroupBeamsImageData(g.scores, g.remote);
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
    // count + iconId + label precomputata (count, con " · Da remoto" sui
    // fasci aggregati di sole remote). La lista positions completa è in
    // clusteredRef per il click handler.
    const features: GeoJSON.Feature[] = groups.map((g) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [g.lon, g.lat] },
      properties: {
        groupKey: g.groupKey,
        iconId: g.iconId,
        count: g.count,
        topScore: g.topScore,
        label:
          g.count > 1
            ? g.remote
              ? `${g.count} · ${tr("remote")}`
              : String(g.count)
            : "",
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

  // Traccia la posizione schermo del pin selezionato (posizione singola
  // o gruppo coincidente): aggiorna ad ogni movimento/zoom mappa per
  // tenere il popup ancorato sopra. Le coordinate sono quelle VERE del
  // pin: non c'è più alcun offset di rendering.
  useEffect(() => {
    const map = mapRef.current;
    const anchor = selected ?? selectedGroup;
    if (!map || !anchor) {
      setPopupAnchor(null);
      return;
    }
    const update = () => {
      const pt = map.project([anchor.lon, anchor.lat]);
      setPopupAnchor({ x: pt.x, y: pt.y });
    };
    update();
    map.on("move", update);
    map.on("zoom", update);
    return () => {
      map.off("move", update);
      map.off("zoom", update);
    };
  }, [selected, selectedGroup]);

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

  // Focus su una posizione richiesto da una lista (card Posizioni o
  // drilldown Location): centra il SUO pin al centro schermo e apre la
  // card. La coordinata della posizione È quella renderizzata (nessun
  // offset dinamico), quindi si centra direttamente.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusPosition) return;
    const pos = data.find((d) => d.id === focusPosition.id);
    if (!pos) return;
    setSelectedGroup(null);
    setSelected(pos);
    map.flyTo({
      center: [pos.lon, pos.lat],
      zoom: Math.max(map.getZoom(), 13),
      duration: 800,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPosition?.tick]);

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

            {/* Location: solo città + paese (niente via). Le full remote
                dichiarano il regime, con l'eventuale vincolo geografico. */}
            {(() => {
              const geo =
                [selected.loc_city, selected.loc_country]
                  .filter(Boolean)
                  .join(", ") ||
                selected.location ||
                "";
              const loc =
                selected.remote_type === "full_remote"
                  ? geo
                    ? `${tr("remote")} — ${geo}`
                    : tr("remote")
                  : geo;
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

        {selectedGroup && !selected && popupAnchor && (
          <div
            // Vignetta-lista per un gruppo coincidente (più posizioni
            // sullo stesso building). Stessa ancora/coda del popup
            // singolo: punta al pin, che sta alla coordinata vera.
            className="absolute bg-[var(--color-panel)] border border-[var(--color-border)] rounded-md p-3 text-[11px] z-10"
            style={{
              left: popupAnchor.x,
              top: popupAnchor.y - 14,
              transform: "translate(-50%, -100%)",
              width: 300,
              maxWidth: "calc(100vw - 32px)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            }}
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span
                className="text-[8px] font-semibold tracking-widest uppercase"
                style={{ color: "var(--color-dim)" }}
              >
                {selectedGroup.count} {tr("positions_here")}
              </span>
              <button
                onClick={() => setSelectedGroup(null)}
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
            {(() => {
              const addr =
                selectedGroup.positions[0]?.office_address ??
                [
                  selectedGroup.positions[0]?.loc_city,
                  selectedGroup.positions[0]?.loc_country,
                ]
                  .filter(Boolean)
                  .join(", ");
              if (!addr) return null;
              return (
                <div
                  className="text-[10px] mb-2 leading-tight truncate"
                  style={{ color: "var(--color-muted)" }}
                  title={addr}
                >
                  {addr}
                </div>
              );
            })()}
            <div
              className="flex flex-col"
              style={{ maxHeight: 220, overflowY: "auto" }}
            >
              {[...selectedGroup.positions]
                .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
                .map((p) => (
                  <Link
                    key={p.id}
                    href={`/positions/${p.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 py-1.5 no-underline rounded-sm hover:bg-[var(--color-card)]"
                    style={{
                      borderTop: "1px solid var(--color-border)",
                    }}
                  >
                    <span className="min-w-0">
                      <span
                        className="block font-semibold leading-tight truncate"
                        style={{ color: "var(--color-bright)" }}
                      >
                        {p.title}
                      </span>
                      <span
                        className="block text-[10px] truncate"
                        style={{ color: "var(--color-muted)" }}
                      >
                        {p.company}
                      </span>
                    </span>
                    <span
                      className="text-[16px] font-bold leading-none tabular-nums flex-shrink-0"
                      style={{ color: matchScoreColor(p.score) }}
                    >
                      {p.score ?? "—"}
                    </span>
                  </Link>
                ))}
            </div>
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
