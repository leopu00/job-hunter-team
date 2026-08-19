"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "@/app/theme-provider";
import { useLocale } from "@/lib/use-locale";
import type { Locale } from "@/i18n/config";

// Mini-mappa della card Località: stessa base Carto del globo /map
// (dark-matter/positron a seconda del tema), centrata sulla città con un
// pin. Zoomabile per capire DOVE si trova la città (scelta utente 19/07),
// ma con gesti COOPERATIVI: un dito scrolla la pagina, due dita (o
// Ctrl+rotella su desktop) muovono la mappa — così non ruba lo scroll.
// Il centro/zoom iniziale resta "città nel suo contesto": anche con
// coordinate ufficio esatte non si parte zoomati sulla via.
const STYLE_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const STYLE_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// Testi dell'overlay cooperative-gestures di maplibre.
const GESTURE_HINTS: Record<
  Locale,
  { win: string; mac: string; mobile: string }
> = {
  it: {
    win: "Usa Ctrl + rotella per zoomare la mappa",
    mac: "Usa ⌘ + rotella per zoomare la mappa",
    mobile: "Usa due dita per muovere la mappa",
  },
  en: {
    win: "Use Ctrl + scroll to zoom the map",
    mac: "Use ⌘ + scroll to zoom the map",
    mobile: "Use two fingers to move the map",
  },
  es: {
    win: "Usa Ctrl + rueda para hacer zoom en el mapa",
    mac: "Usa ⌘ + rueda para hacer zoom en el mapa",
    mobile: "Usa dos dedos para mover el mapa",
  },
  fr: {
    win: "Utilisez Ctrl + molette pour zoomer la carte",
    mac: "Utilisez ⌘ + molette pour zoomer la carte",
    mobile: "Utilisez deux doigts pour déplacer la carte",
  },
  de: {
    win: "Strg + Mausrad zum Zoomen der Karte",
    mac: "⌘ + Mausrad zum Zoomen der Karte",
    mobile: "Karte mit zwei Fingern bewegen",
  },
  hu: {
    win: "Ctrl + görgő a térkép nagyításához",
    mac: "⌘ + görgő a térkép nagyításához",
    mobile: "Két ujjal mozgathatod a térképet",
  },
  pt: {
    win: "Usa Ctrl + roda para ampliar o mapa",
    mac: "Usa ⌘ + roda para ampliar o mapa",
    mobile: "Usa dois dedos para mover o mapa",
  },
};

export default function PositionMapCard({
  lat,
  lon,
}: {
  lat: number;
  lon: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const locale = useLocale();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hints = GESTURE_HINTS[locale] ?? GESTURE_HINTS.en;
    const map = new maplibregl.Map({
      container: el,
      style: resolvedTheme === "light" ? STYLE_LIGHT : STYLE_DARK,
      center: [lon, lat],
      zoom: 8.3,
      minZoom: 0.8,
      maxZoom: 12,
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
      locale: {
        "CooperativeGesturesHandler.WindowsHelpText": hints.win,
        "CooperativeGesturesHandler.MacHelpText": hints.mac,
        "CooperativeGesturesHandler.MobileHelpText": hints.mobile,
      },
    });
    map.touchZoomRotate.disableRotation();
    // +/− espliciti: su telefono lo zoom out a tap è più chiaro del pinch.
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    // Attribution collassata alla sola (i) — maplibre la inizializza
    // espansa (stesso workaround di JobsGlobe); il DOM del controllo
    // esiste solo a mappa caricata.
    map.once("load", () => {
      el.querySelector(".maplibregl-ctrl-attrib")?.classList.remove(
        "maplibregl-compact-show",
      );
    });

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
  }, [lat, lon, resolvedTheme, locale]);

  return (
    <div
      ref={ref}
      className="w-full h-48 md:h-56 rounded-lg overflow-hidden border border-[var(--color-border)]"
    />
  );
}
