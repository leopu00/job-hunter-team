"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import Link from "next/link";

// SSR off: three.js richiede window.
const Globe = dynamic(() => import("react-globe.gl"), { ssr: false });

type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: object };
type FeatureCollection = { type: "FeatureCollection"; features: Feature[] };

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

export default function JobsGlobe() {
  const [data, setData] = useState<PositionCoord[]>([]);
  const [countries, setCountries] = useState<Feature[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState<PositionCoord | null>(null);
  const [selected, setSelected] = useState<PositionCoord | null>(null);
  const [size, setSize] = useState({ w: 800, h: 460 });
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);

  // Sfera grafica scura: niente texture, solo solid color.
  const globeMaterial = useMemo(
    () =>
      new THREE.MeshPhongMaterial({
        color: new THREE.Color("#0a0a14"),
        emissive: new THREE.Color("#020208"),
        shininess: 0.15,
      }),
    [],
  );

  useEffect(() => {
    Promise.all([
      fetch("/api/positions/coords").then((r) => (r.ok ? r.json() : [])),
      fetch("/data/countries.geojson").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([d, geo]: [PositionCoord[], FeatureCollection | null]) => {
        setData(Array.isArray(d) ? d : []);
        setCountries(geo?.features ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.floor(e.contentRect.width);
        const h = Math.max(360, Math.floor(w * 0.55));
        setSize({ w, h });
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Auto-rotate iniziale + posizione su Europa
  useEffect(() => {
    const g = globeRef.current;
    if (!g || !loaded) return;
    // delay perche' la lib monta async
    const t = setTimeout(() => {
      try {
        const controls = g.controls() as {
          autoRotate: boolean;
          autoRotateSpeed: number;
        };
        if (controls) {
          controls.autoRotate = true;
          controls.autoRotateSpeed = 0.4;
        }
        // Centra su Europa (lat 50, lon 10)
        g.pointOfView({ lat: 45, lng: 10, altitude: 2.2 }, 0);
      } catch {}
    }, 100);
    return () => clearTimeout(t);
  }, [loaded]);

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
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-md"
        style={{ background: "#000", minHeight: 360 }}
      >
        {!loaded ? (
          <p className="text-[11px] text-[var(--color-dim)] absolute inset-0 grid place-items-center">
            Caricamento…
          </p>
        ) : data.length === 0 ? (
          <p className="text-[11px] text-[var(--color-dim)] absolute inset-0 grid place-items-center">
            Nessuna posizione geolocalizzata. Esegui{" "}
            <code>web/scripts/geocode-positions.py</code>.
          </p>
        ) : (
          <Globe
            ref={globeRef}
            width={size.w}
            height={size.h}
            backgroundColor="rgba(0,0,0,0)"
            globeMaterial={globeMaterial}
            showAtmosphere
            atmosphereColor="#00e87a"
            atmosphereAltitude={0.15}
            hexPolygonsData={countries}
            hexPolygonResolution={3}
            hexPolygonMargin={0.45}
            hexPolygonUseDots={false}
            hexPolygonColor={() => "rgba(0, 232, 122, 0.35)"}
            pointsData={data}
            pointLat="lat"
            pointLng="lon"
            pointColor={(d: object) => {
              const p = d as PositionCoord;
              return STATUS_COLORS[p.status] ?? "#7a7a96";
            }}
            pointAltitude={(d: object) => {
              const p = d as PositionCoord;
              return p.score && p.score > 70 ? 0.06 : 0.02;
            }}
            pointRadius={0.35}
            pointLabel={(d: object) => {
              const p = d as PositionCoord;
              const status =
                `<span style="color:${STATUS_COLORS[p.status] ?? "#7a7a96"};font-size:9px;letter-spacing:0.1em;text-transform:uppercase">${p.status}</span>`;
              const score = p.score != null ? ` · score ${p.score}` : "";
              return `<div style="background:#111116;border:1px solid #252530;border-radius:6px;padding:6px 10px;font-family:inherit;color:#e0e0f0;font-size:11px;max-width:260px">
                <div style="font-weight:700;margin-bottom:2px">${escapeHtml(p.title)}</div>
                <div style="color:#7a7a96;font-size:10px;margin-bottom:4px">${escapeHtml(p.company)}</div>
                ${status}${score}
              </div>`;
            }}
            onPointHover={(d) => setHovered((d as PositionCoord | null) ?? null)}
            onPointClick={(d) => {
              const p = d as PositionCoord;
              setSelected(p);
              // Stop auto-rotate quando interagisco
              const g = globeRef.current;
              if (g) {
                try {
                  (
                    g.controls() as { autoRotate: boolean }
                  ).autoRotate = false;
                } catch {}
              }
            }}
          />
        )}

        {selected && (
          <div
            className="absolute bottom-3 left-3 right-3 sm:right-auto sm:max-w-sm bg-[var(--color-panel)] border border-[var(--color-border)] rounded-md p-3 text-[11px]"
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

        {hovered && !selected && (
          <div
            className="absolute top-3 right-3 text-[10px] text-[var(--color-dim)] pointer-events-none"
            aria-hidden
          >
            click per dettaglio
          </div>
        )}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
