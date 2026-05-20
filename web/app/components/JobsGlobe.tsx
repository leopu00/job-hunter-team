"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MaplibreMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";

// Dark-matter Carto style (free, no API key, CDN OSS).
// Provides vector tiles street-level su zoom alto.
const MAP_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

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

export default function CompanyGlobe() {
  const [data, setData] = useState<PositionCoord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<PositionCoord | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

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
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE_URL,
      center: [10, 45], // centrato su Europa
      zoom: 1.8,
      attributionControl: { compact: true },
      // pitch/bearing per dare un filo di prospettiva
      pitch: 0,
      bearing: 0,
    });

    map.on("style.load", () => {
      // Globe projection: sotto zoom 12 e' globo, sopra mercator.
      // Switch automatico gestito da MapLibre.
      try {
        map.setCompanyion({ type: "globe" });
      } catch {
        /* MapLibre versions older than 5.0 - skip */
      }
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync markers ogni volta che cambiano i dati jitterati
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    // Pulisci marker precedenti
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const p of jittered) {
      const color = STATUS_COLORS[p.status] ?? "#7a7a96";
      const el = document.createElement("div");
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", `${p.title} — ${p.company}`);
      el.title = `${p.title} — ${p.company}\nscore: ${p.score ?? "—"} · ${p.status}`;
      Object.assign(el.style, {
        width: "12px",
        height: "12px",
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 0 2px rgba(0,0,0,0.6), 0 0 10px ${color}88`,
        border: `1px solid ${color}`,
        cursor: "pointer",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
      } as Partial<CSSStyleDeclaration>);
      el.addEventListener("mouseenter", () => {
        el.style.transform = "scale(1.4)";
      });
      el.addEventListener("mouseleave", () => {
        el.style.transform = "scale(1)";
      });
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        setSelected(p);
        map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 11), duration: 800 });
      });
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([p.lon, p.lat])
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [jittered, loaded]);

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
        style={{ height: 500, background: "#000" }}
      >
        <div ref={mapContainerRef} className="absolute inset-0" />

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
