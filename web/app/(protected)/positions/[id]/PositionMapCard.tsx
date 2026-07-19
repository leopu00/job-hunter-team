"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "@/app/theme-provider";

// Mini-mappa statica della card Località: stessa base Carto del globo /map
// (dark-matter/positron a seconda del tema), centrata sulla città con un
// pin. Non interattiva: su telefono una mappa trascinabile dentro la pagina
// ruberebbe lo scroll. Il livello di zoom è "città nel suo contesto" — anche
// con coordinate ufficio esatte non si zooma sulla via (scelta utente 19/07).
const STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const STYLE_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export default function PositionMapCard({
  lat,
  lon,
}: {
  lat: number;
  lon: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const map = new maplibregl.Map({
      container: el,
      style: resolvedTheme === "light" ? STYLE_LIGHT : STYLE_DARK,
      center: [lon, lat],
      zoom: 8.3,
      interactive: false,
      attributionControl: { compact: true },
    });
    // Attribution collassata alla sola (i) — maplibre a volte la
    // inizializza espansa (stesso workaround di JobsGlobe).
    el.querySelector(".maplibregl-ctrl-attrib")?.classList.remove(
      "maplibregl-compact-show",
    );

    const pin = document.createElement("div");
    pin.innerHTML = `
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"
              fill="var(--color-card)" />
        <circle cx="12" cy="10" r="3" fill="currentColor" stroke="none" />
      </svg>`;
    pin.style.color = "var(--color-purple)";
    pin.style.filter = "drop-shadow(0 2px 4px rgba(0,0,0,0.45))";
    new maplibregl.Marker({ element: pin, anchor: "bottom" })
      .setLngLat([lon, lat])
      .addTo(map);

    return () => map.remove();
  }, [lat, lon, resolvedTheme]);

  return (
    <div
      ref={ref}
      className="w-full h-44 rounded-lg overflow-hidden border border-[var(--color-border)]"
      aria-hidden="true"
    />
  );
}
