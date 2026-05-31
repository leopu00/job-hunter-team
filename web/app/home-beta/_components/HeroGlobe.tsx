"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "@/app/theme-provider";
import { LUXURY_POSITIONS } from "../_data/luxuryPositions";

const STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const STYLE_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const ROTATION_DEG_PER_SEC = 18;
const SRC_ID = "hero-pins";
const HALO_ID = "hero-pins-halo";
const DOT_ID = "hero-pins-dot";

// Coordinate dei pin = prime N location delle offerte (single source of
// truth in `_data/luxuryPositions.ts`). I primi 5 slot vengono pilotati
// dalla pipeline del team flow tramite la prop `pinColors`.
const CITIES: Array<[number, number]> = LUXURY_POSITIONS.map(
  (p) => [p.lon, p.lat] as [number, number],
);

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

// Costruisce le feature dei pin attivi: solo gli slot con colore != null.
// Il colore di ogni pin è una property per layer "data-driven".
function buildPinFeatures(
  pinColors: ReadonlyArray<string | null>,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < pinColors.length; i++) {
    const color = pinColors[i];
    if (!color) continue;
    const [lon, lat] = CITIES[i];
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { id: i, color },
    });
  }
  return { type: "FeatureCollection", features };
}

type HeroGlobeProps = {
  // Array di colori, uno per ogni pin. Pin i = null → nessun pin;
  // pin i = "#xxx" → pin colorato a quel valore.
  pinColors?: ReadonlyArray<string | null>;
  // Longitudine del centro del globo. Pilotata dalla pipeline per
  // ruotare il globo verso il pin che sta per essere toccato. La
  // latitudine resta a quella iniziale (20°), così la proiezione
  // globe non si distorce a lat estreme.
  centerLon?: number;
};

export default function HeroGlobe({ pinColors, centerLon }: HeroGlobeProps) {
  const { resolvedTheme } = useTheme();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const themeRef = useRef<"dark" | "light">(resolvedTheme);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const layersReadyRef = useRef(false);
  const activePinColors = pinColors ?? [];
  const pinColorsRef = useRef<ReadonlyArray<string | null>>(activePinColors);

  useEffect(() => {
    pinColorsRef.current = activePinColors;
  }, [activePinColors]);

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

    // Anchor invisibile alla posizione esatta del top sfera, computata
    // via map.project() del polo nord. Aggiornato a ogni render.
    // BetaTeamFlow legge il rect di questo anchor (data-sphere-top) per
    // far convergere i path SVG esattamente sul perimetro top visibile
    // della sfera, robusto a resize / re-render.
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
        map.setCompanyion({ type: "globe" });
      } catch {}
      map.resize();
      tintMap(map, themeRef.current);
      updateSphereAnchor();

      if (!map.getSource(SRC_ID)) {
        map.addSource(SRC_ID, {
          type: "geojson",
          data: buildPinFeatures(pinColorsRef.current),
        });
        map.addLayer({
          id: HALO_ID,
          type: "circle",
          source: SRC_ID,
          paint: {
            "circle-radius": 14,
            // colore "data-driven" dalla property `color` della feature.
            "circle-color": ["get", "color"],
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
            "circle-color": ["get", "color"],
            "circle-opacity": 0.95,
            "circle-stroke-color": "#0d0d11",
            "circle-stroke-width": 0.5,
          },
        });
      } else {
        const src = map.getSource(SRC_ID) as maplibregl.GeoJSONSource;
        src.setData(buildPinFeatures(pinColorsRef.current));
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

  // Longitudine del centro pilotata dalla pipeline. jumpTo istantaneo,
  // lo "scrubbing" è dato dal fatto che centerLon è funzione lineare
  // di T sopra la pipeline.
  useEffect(() => {
    if (centerLon == null) return;
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    if (Math.abs(c.lng - centerLon) < 0.01) return;
    map.jumpTo({ center: [centerLon, c.lat] });
  }, [centerLon]);

  // Aggiorna i pin sulla mappa quando pinColors cambia.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReadyRef.current) return;
    const src = map.getSource(SRC_ID) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildPinFeatures(activePinColors));
  }, [activePinColors]);

  return (
    <section aria-hidden="true" className="flex justify-center">
      <div
        ref={wrapRef}
        data-hero-globe="true"
        className="pointer-events-none relative"
        style={{
          background: "transparent",
          width: "min(90vh, 90vw)",
          // Canvas quadrato: la sfera MapLibre (zoom 2.2, projection globe)
          // ci sta intera dentro un 1:1, niente clipping del polo nord/sud.
          aspectRatio: "1 / 1",
        }}
      >
        <div
          ref={containerRef}
          style={{ width: "100%", height: "100%", background: "transparent" }}
        />
        {/* Anchor invisibile sul perimetro top visibile della sfera.
            updateSphereAnchor() proietta [lng, 89.5] (~ polo nord
            visibile) e setta `top` in px relativi al wrap. BetaTeamFlow
            legge il rect di questo elemento per fare convergere i path
            esattamente sul perimetro della sfera. */}
        <div
          data-sphere-top
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            width: 1,
            height: 1,
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }}
        />
      </div>
    </section>
  );
}
