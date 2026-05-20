"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useTheme } from "@/app/theme-provider";

const SOURCE_ID = "jht-jobs";
const LAYER_HALO_ID = "jht-jobs-halo";
const LAYER_DOT_ID = "jht-jobs-dot";

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
  score: number | null;
  lat: number;
  lon: number;
  is_remote: boolean;
};

function featureToPosition(f: GeoJSON.Feature): PositionCoord | null {
  if (f.geometry?.type !== "Point") return null;
  const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates as [
    number,
    number,
  ];
  const p = f.properties as Record<string, unknown> | null;
  if (!p) return null;
  return {
    id: String(p.id ?? ""),
    title: String(p.title ?? ""),
    company: String(p.company ?? ""),
    status: String(p.status ?? ""),
    score: typeof p.score === "number" ? p.score : null,
    lat,
    lon,
    is_remote: Boolean(p.is_remote),
  };
}

// Paint override per allineare il basemap al theme JHT.
// Dark: nero-verde profondo. Light: bianco-grigio caldo.
function tintMap(map: MaplibreMap, mode: "dark" | "light") {
  const tweaks: Array<[string, string, string]> =
    mode === "dark"
      ? [
          ["background", "background-color", "#04140c"],
          ["water", "fill-color", "#031410"],
          ["landcover_wood", "fill-color", "#0a1f15"],
          ["landcover_grass", "fill-color", "#0c2418"],
          ["landuse_overlay_national_park", "fill-color", "#0c2418"],
          ["landuse_park", "fill-color", "#0c2418"],
          ["landuse_residential", "fill-color", "#081710"],
          ["national_park", "fill-color", "#0c2418"],
          ["building", "fill-color", "#0a1f15"],
          ["building-3d", "fill-color", "#0a1f15"],
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

export default function JobsGlobe() {
  const { resolvedTheme } = useTheme();
  const [data, setData] = useState<PositionCoord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<PositionCoord | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const layersReadyRef = useRef(false);
  const themeRef = useRef<"dark" | "light">(resolvedTheme);
  // Ref tracking di jittered, per essere letta dentro onStyleLoad che
  // ha una closure "vecchia" (registrato 1 sola volta in mount).
  const jitteredRef = useRef<PositionCoord[]>([]);

  // Jitter deterministico sui pin con stesse coordinate (city-center
  // fallback): li sparpaglia su un anello, cosi' restano cliccabili
  // separatamente. Quando lo Scout fornira' office-level vero, e' no-op.
  const jittered = useMemo(() => {
    const groups = new Map<string, PositionCoord[]>();
    for (const p of data) {
      const key = `${p.lat.toFixed(4)}|${p.lon.toFixed(4)}`;
      const arr = groups.get(key);
      if (arr) arr.push(p);
      else groups.set(key, [p]);
    }
    const out: PositionCoord[] = [];
    for (const arr of groups.values()) {
      if (arr.length === 1) {
        out.push(arr[0]);
        continue;
      }
      const n = arr.length;
      const radius = Math.min(0.02 + n * 0.0008, 0.06); // gradi
      arr.forEach((p, i) => {
        const angle = (i / n) * Math.PI * 2;
        out.push({
          ...p,
          lat: p.lat + radius * Math.cos(angle),
          lon: p.lon + radius * Math.sin(angle),
        });
      });
    }
    return out;
  }, [data]);

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
      // Tinta theme-aware sui layer base.
      tintMap(map, themeRef.current);
      // Aggiungo source + layer per i pin. WebGL native = follow-mappa
      // garantito (i DOM markers su globe projection ballavano).
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        // Layer 1: halo glow attorno al pin
        map.addLayer({
          id: LAYER_HALO_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0, 4,
              12, 14,
            ],
            "circle-color": ["get", "color"],
            "circle-opacity": 0.22,
            "circle-blur": 0.6,
          },
        });
        // Layer 2: dot centrale
        map.addLayer({
          id: LAYER_DOT_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0, 3,
              12, 7,
            ],
            "circle-color": ["get", "color"],
            "circle-stroke-color": "#000000",
            "circle-stroke-width": 1.2,
            "circle-opacity": 0.95,
          },
        });
      }
      layersReadyRef.current = true;
      syncData(map);
    };
    map.on("style.load", onStyleLoad);

    map.on("error", (e) => {
      console.error("[JobsGlobe] map error:", e);
    });

    // Click handler sul layer
    map.on("click", LAYER_DOT_ID, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = featureToPosition(f as unknown as GeoJSON.Feature);
      if (!p) return;
      setSelected(p);
      map.flyTo({
        center: [p.lon, p.lat],
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

    map.addControl(new maplibregl.NavigationControl(), "top-right");
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

  // Tieni il ref allineato a ogni render: cosi' syncData chiamato
  // da onStyleLoad (closure vecchia) legge i dati attuali.
  useEffect(() => {
    jitteredRef.current = jittered;
  }, [jittered]);

  // Sync GeoJSON source ogni volta che cambiano i dati
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    syncData(map);
  }, [jittered, loaded]);

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
    // Legge sempre dal ref aggiornato, non dalla closure originale.
    const features: GeoJSON.Feature[] = jitteredRef.current.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: {
        id: p.id,
        title: p.title,
        company: p.company,
        status: p.status,
        score: p.score,
        is_remote: p.is_remote,
        color: STATUS_COLORS[p.status] ?? "#7a7a96",
      },
    }));
    src.setData({ type: "FeatureCollection", features });
  }

  const remoteCount = data.filter((d) => d.is_remote).length;

  return (
    <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 transition-colors duration-200 hover:border-[var(--color-border-glow)]">
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

      <div
        ref={mapWrapRef}
        className="relative w-full overflow-hidden rounded-md"
        // zoom: 1 neutralizza il body { zoom: var(--zoom) } di JHT
        // che mandava MapLibre a leggere dimensioni canvas sbagliate.
        // background theme-aware: l'area fuori dal globo (la sfera
        // proiettata occupa solo il centro del canvas) deve seguire
        // il tema della pagina, non essere hardcoded nero.
        style={{
          height: 500,
          background: "var(--color-deep)",
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

        {!loaded && (
          <p className="absolute inset-0 grid place-items-center text-[11px] text-[var(--color-dim)] pointer-events-none">
            Caricamento…
          </p>
        )}

        {selected && (
          <div
            className="absolute bottom-3 left-3 right-3 sm:right-auto sm:max-w-sm bg-[var(--color-panel)] border border-[var(--color-border)] rounded-md p-3 text-[11px] z-10"
            style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.6)" }}
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
            <div className="text-[var(--color-muted)] mb-2">
              {selected.company}
            </div>
            <Link
              href={`/positions/${selected.id}`}
              className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)] hover:underline no-underline"
            >
              Apri →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
