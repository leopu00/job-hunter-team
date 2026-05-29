"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "@/app/theme-provider";

const STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const STYLE_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const ROTATION_DEG_PER_SEC = 18;
const SRC_ID = "hero-pins";
const HALO_ID = "hero-pins-halo";
const DOT_ID = "hero-pins-dot";

// Coordinate città-hub (lon, lat). Distribuite globalmente per dare
// senso di copertura mentre il globo ruota. Mix Europa / NA / Asia /
// Sud / Africa / Oceania.
const CITIES: Array<[number, number]> = [
  // Europa
  [-0.13, 51.51],  // London
  [13.4, 52.52],   // Berlin
  [2.35, 48.86],   // Paris
  [-3.7, 40.42],   // Madrid
  [12.49, 41.9],   // Rome
  [9.19, 45.46],   // Milan
  [4.9, 52.37],    // Amsterdam
  [18.07, 59.33],  // Stockholm
  [-9.14, 38.72],  // Lisbon
  [21.01, 52.23],  // Warsaw
  [16.37, 48.21],  // Vienna
  [14.42, 50.08],  // Prague
  [-6.26, 53.35],  // Dublin
  [23.73, 37.98],  // Athens
  [12.57, 55.68],  // Copenhagen
  [24.94, 60.17],  // Helsinki
  [19.04, 47.5],   // Budapest
  [26.1, 44.43],   // Bucharest
  // Nord America
  [-74.0, 40.71],  // NYC
  [-122.42, 37.77], // SF
  [-118.24, 34.05], // LA
  [-122.33, 47.6], // Seattle
  [-79.38, 43.65], // Toronto
  [-71.06, 42.36], // Boston
  [-87.63, 41.88], // Chicago
  [-97.74, 30.27], // Austin
  [-80.19, 25.76], // Miami
  [-123.12, 49.28], // Vancouver
  [-75.16, 39.95], // Philadelphia
  [-122.68, 45.52], // Portland
  // Asia
  [139.69, 35.69], // Tokyo
  [126.98, 37.57], // Seoul
  [103.82, 1.35],  // Singapore
  [77.59, 12.97],  // Bangalore
  [72.83, 19.08],  // Mumbai
  [116.41, 39.9],  // Beijing
  [121.47, 31.23], // Shanghai
  [114.17, 22.32], // Hong Kong
  [34.78, 32.07],  // Tel Aviv
  [55.27, 25.2],   // Dubai
  [101.69, 3.14],  // Kuala Lumpur
  [106.66, 10.76], // Ho Chi Minh
  // Oceania / Sud / Africa
  [151.21, -33.87], // Sydney
  [144.96, -37.81], // Melbourne
  [-46.63, -23.55], // São Paulo
  [-58.38, -34.6],  // Buenos Aires
  [18.42, -33.92],  // Cape Town
  [28.03, -26.2],   // Johannesburg
  [3.39, 6.52],     // Lagos
  [31.24, 30.04],   // Cairo
];

function tintMap(map: MaplibreMap, mode: "dark" | "light") {
  const tweaks: Array<[string, string, string]> =
    mode === "dark"
      ? [
          ["background", "background-color", "#0d0d11"],
          ["water", "fill-color", "#23252b"],
          ["landcover_wood", "fill-color", "#14171a"],
          ["landcover_grass", "fill-color", "#181b1e"],
          ["landuse_park", "fill-color", "#181b1e"],
          ["landuse_residential", "fill-color", "#16161a"],
          ["national_park", "fill-color", "#181b1e"],
          ["building", "fill-color", "#1c1d22"],
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
      } catch {}
    }
  }
}

function buildPinFeatures(count: number): GeoJSON.FeatureCollection {
  const slice = CITIES.slice(0, count);
  return {
    type: "FeatureCollection",
    features: slice.map(([lon, lat], i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { id: i },
    })),
  };
}

export default function HeroGlobe() {
  const { resolvedTheme } = useTheme();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const themeRef = useRef<"dark" | "light">(resolvedTheme);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const layersReadyRef = useRef(false);
  const [pinCount, setPinCount] = useState(0);
  const pinCountRef = useRef(0);

  useEffect(() => {
    pinCountRef.current = pinCount;
  }, [pinCount]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const container = containerRef.current;

    const map = new maplibregl.Map({
      container,
      style: themeRef.current === "light" ? STYLE_LIGHT : STYLE_DARK,
      center: [10, 20],
      zoom: 2.2,
      attributionControl: false,
      interactive: false,
      pitch: 0,
      bearing: 0,
    });

    // Anchor invisibile alla posizione esatta del top sfera, computata via
    // map.project() del nord-polo. Aggiornato a ogni render. BetaTeamFlow
    // legge la posizione di questo anchor (data-sphere-top) per agganciare
    // la convergenza dei path.
    const updateSphereAnchor = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const anchor = wrap.querySelector(
        "[data-sphere-top]",
      ) as HTMLElement | null;
      if (!anchor) return;
      try {
        const c = map.getCenter();
        const pt = map.project([c.lng, 89.5]);
        anchor.style.top = `${pt.y}px`;
      } catch {}
    };

    const onStyleLoad = () => {
      try {
        map.setProjection({ type: "globe" });
      } catch {}
      map.resize();
      tintMap(map, themeRef.current);
      updateSphereAnchor();

      if (!map.getSource(SRC_ID)) {
        map.addSource(SRC_ID, {
          type: "geojson",
          data: buildPinFeatures(pinCountRef.current),
        });
        map.addLayer({
          id: HALO_ID,
          type: "circle",
          source: SRC_ID,
          paint: {
            "circle-radius": 14,
            "circle-color": "#00e87a",
            "circle-opacity": 0.25,
            "circle-blur": 0.7,
          },
        });
        map.addLayer({
          id: DOT_ID,
          type: "circle",
          source: SRC_ID,
          paint: {
            "circle-radius": 3.5,
            "circle-color": "#00e87a",
            "circle-opacity": 0.95,
            "circle-stroke-color": "#0d0d11",
            "circle-stroke-width": 0.5,
          },
        });
      } else {
        const src = map.getSource(SRC_ID) as maplibregl.GeoJSONSource;
        src.setData(buildPinFeatures(pinCountRef.current));
      }
      layersReadyRef.current = true;
    };
    map.on("style.load", onStyleLoad);

    mapRef.current = map;

    const ro = new ResizeObserver(() => {
      try {
        map.resize();
        updateSphereAnchor();
      } catch {}
    });
    ro.observe(container);

    map.on("move", updateSphereAnchor);
    map.on("render", updateSphereAnchor);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      layersReadyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    themeRef.current = resolvedTheme;
    const map = mapRef.current;
    if (!map) return;
    layersReadyRef.current = false;
    map.setStyle(resolvedTheme === "light" ? STYLE_LIGHT : STYLE_DARK);
  }, [resolvedTheme]);

  // Rotazione guidata dallo scroll: ogni pixel scrollato ruota il globo.
  useEffect(() => {
    const DEG_PER_PX = 0.12;
    let lastY = typeof window !== "undefined" ? window.scrollY : 0;
    const onScroll = () => {
      const map = mapRef.current;
      if (!map) return;
      const dy = window.scrollY - lastY;
      lastY = window.scrollY;
      if (dy === 0) return;
      const c = map.getCenter();
      let nextLon = c.lng + dy * DEG_PER_PX;
      if (nextLon > 180) nextLon -= 360;
      if (nextLon < -180) nextLon += 360;
      map.jumpTo({ center: [nextLon, c.lat] });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Pin progress: legge il [data-pin-section] piu' vicino (hero pinned
  // section condivisa col team flow). I pin appaiono progressivamente
  // mentre l'utente scrolla attraverso il pin.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const sec = wrap.closest("[data-pin-section]") as HTMLElement | null;
    if (!sec) return;
    const onScroll = () => {
      const rect = sec.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) return;
      const raw = -rect.top / total;
      const progress = Math.max(0, Math.min(1, raw));
      const count = Math.round(progress * CITIES.length);
      if (count !== pinCountRef.current) {
        setPinCount(count);
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Aggiorna i pin sulla mappa quando pinCount cambia.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReadyRef.current) return;
    const src = map.getSource(SRC_ID) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildPinFeatures(pinCount));
  }, [pinCount]);

  return (
    <section
      aria-hidden="true"
      data-pin-section="globe"
      className="flex justify-center"
    >
      <div
        ref={wrapRef}
        data-hero-globe="true"
        className="pointer-events-none relative"
        style={{
          background: "transparent",
          width: "min(90vh, 90vw)",
          // Canvas non quadrato: rapporto 1/0.7 → sfera MapLibre fitta
          // l'altezza, niente spazio vuoto sopra/sotto. Canvas top = sfera
          // visibile top → convergence dei path collima perfettamente.
          aspectRatio: "1 / 0.7",
        }}
      >
        <div
          ref={containerRef}
          style={{ width: "100%", height: "100%", background: "transparent" }}
        />
      </div>
    </section>
  );
}
