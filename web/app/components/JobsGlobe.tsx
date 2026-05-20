"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MaplibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useTheme } from "@/app/theme-provider";

const SOURCE_ID = "jht-jobs";
const LAYER_HALO_ID = "jht-jobs-halo";
const LAYER_DOT_ID = "jht-jobs-dot";
const LAYER_CLUSTER_ID = "jht-jobs-cluster";
const LAYER_CLUSTER_COUNT_ID = "jht-jobs-cluster-count";

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

// Calcola la "faccia migliore" del globo da mostrare: longitude
// media circolare di tutti i pin (vettorializzata, gestisce wrap-around
// 180/-180 correttamente). Restituisce centro + bounding box dei pin
// entro 90° da quel centro (la "metà di globo visibile").
function bestViewport(pins: PositionCoord[]):
  | { center: [number, number]; bounds: [[number, number], [number, number]] }
  | null {
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

export default function CompanyGlobe() {
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

  // Niente jitter visibile: i pin coincident a livello city-center
  // vengono raggruppati come "cluster" nativo di MapLibre (vedi
  // cluster: true sulla source). Cosi' a zoom largo vedi UNA bolla
  // con count "36", zoomando dentro esplode in pin singoli.
  const jittered = data;

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
          // Cluster i pin coincident (city-center fallback) o vicini.
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 35,
        });
        // Layer cluster bubble: cerchio verde con count dentro
        map.addLayer({
          id: LAYER_CLUSTER_ID,
          type: "circle",
          source: SOURCE_ID,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#00e87a",
            "circle-opacity": 0.85,
            "circle-radius": [
              "step",
              ["get", "point_count"],
              14, 5, 18, 15, 24, 30, 30,
            ],
            "circle-stroke-color": "#000",
            "circle-stroke-width": 1.5,
          },
        });
        map.addLayer({
          id: LAYER_CLUSTER_COUNT_ID,
          type: "symbol",
          source: SOURCE_ID,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Open Sans Bold"],
            "text-size": 12,
          },
          paint: {
            "text-color": "#000",
          },
        });
        // Layer pin singolo (filtra solo non-cluster)
        map.addLayer({
          id: LAYER_HALO_ID,
          type: "circle",
          source: SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
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
        map.addLayer({
          id: LAYER_DOT_ID,
          type: "circle",
          source: SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
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
      console.error("[CompanyGlobe] map error:", e);
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

    // Click su cluster -> zoom + recenter sul centroide
    map.on("click", LAYER_CLUSTER_ID, async (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const clusterId = (f.properties as { cluster_id?: number })?.cluster_id;
      const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
      if (clusterId == null || !src) return;
      try {
        const zoom = await src.getClusterExpansionZoom(clusterId);
        const center = (f.geometry as GeoJSON.Point).coordinates as [
          number,
          number,
        ];
        map.flyTo({ center, zoom: zoom + 0.5, duration: 700 });
      } catch (err) {
        console.warn("[CompanyGlobe] cluster expand error:", err);
      }
    });
    map.on("mouseenter", LAYER_CLUSTER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYER_CLUSTER_ID, () => {
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

  function flyToAll() {
    const map = mapRef.current;
    if (!map || data.length === 0) return;
    const vp = bestViewport(data);
    if (!vp) return;
    map.fitBounds(vp.bounds, {
      padding: { top: 60, bottom: 60, left: 60, right: 60 },
      duration: 800,
      maxZoom: 7,
    });
  }

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

        {/* Bottone "Vista generale": fitBounds sulla faccia migliore */}
        {loaded && data.length > 0 && (
          <button
            onClick={flyToAll}
            aria-label="Vista generale"
            title="Vista generale — mostra tutti i pin"
            className="absolute top-2 left-2 z-10 text-[10px] font-semibold tracking-widest uppercase"
            style={{
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
