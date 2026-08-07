import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  LANDING_TOUR,
  landingShowcaseData,
} from "../../../web/app/components/landing/LandingGlobe.data";
import { T } from "../../../web/app/components/landing/LandingGlobe.i18n";

const landingGlobeSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../web/app/components/landing/LandingGlobe.tsx",
  ),
  "utf8",
);
const jobsGlobeSource = fs.readFileSync(
  path.resolve(__dirname, "../../../web/app/components/JobsGlobe.tsx"),
  "utf8",
);
const globalCssSource = fs.readFileSync(
  path.resolve(__dirname, "../../../web/app/globals.css"),
  "utf8",
);

describe("globo della home pubblica", () => {
  it("rappresenta una sola ricerca per città e conserva pin distinti", () => {
    expect(LANDING_TOUR).toHaveLength(25);

    for (const stop of LANDING_TOUR) {
      expect(stop.positions, stop.city).toHaveLength(2);
      expect(
        new Set(stop.positions.map((position) => position.title)).size,
      ).toBe(1);
      expect(
        new Set(stop.positions.map((position) => position.role_family)).size,
      ).toBe(1);
      expect(
        new Set(
          stop.positions.map((position) => `${position.lat}|${position.lon}`),
        ).size,
      ).toBe(stop.positions.length);
      for (const position of stop.positions) {
        expect(position.lat).toBeGreaterThanOrEqual(-90);
        expect(position.lat).toBeLessThanOrEqual(90);
        expect(position.lon).toBeGreaterThanOrEqual(-180);
        expect(position.lon).toBeLessThanOrEqual(180);
      }
    }

    const saoPaulo = LANDING_TOUR.find((stop) => stop.city === "São Paulo");
    expect(saoPaulo?.positions.map((position) => position.title)).toEqual([
      "Social Media Designer",
      "Social Media Designer",
    ]);
  });

  it("riduce i pin senza alterare la ricerca raccontata dalla sua card", () => {
    const full = landingShowcaseData(false);
    const lean = landingShowcaseData(true);

    expect(full.positions).toHaveLength(50);
    expect(lean.positions).toHaveLength(25);
    expect(lean.tour.map((stop) => stop.positions[0]?.title)).toEqual(
      full.tour.map((stop) => stop.positions[0]?.title),
    );
  });

  it("non espone badge o copy di dati dimostrativi", () => {
    expect(landingGlobeSource).not.toContain("jht-globe-badge");
    expect(JSON.stringify(T).toLowerCase()).not.toContain("sample data");
    expect(T).not.toHaveProperty("demo_badge");
  });

  it("sostituisce il fallback solo quando il globo vivo è pronto", () => {
    expect(landingGlobeSource).toContain(
      'const liveReady = mode === "live" && began',
    );
    expect(landingGlobeSource).toContain("{!liveReady && (");
    expect(landingGlobeSource).toContain('liveReady ? "visible" : "invisible"');
    expect(landingGlobeSource).not.toContain("transition-opacity");
  });

  it("usa un solo fallback e lo rende light dal tema pre-paint", () => {
    expect(landingGlobeSource.match(/className="jht-globe-still/g)).toHaveLength(
      1,
    );
    expect(globalCssSource).toContain(
      'html[data-theme="light"] .jht-globe-still',
    );
    expect(globalCssSource).toContain("invert(1) hue-rotate(180deg)");
    expect(jobsGlobeSource).toContain(
      'document.documentElement.getAttribute("data-theme")',
    );
    expect(jobsGlobeSource).toContain(
      'style: bootTheme === "light" ? STYLE_LIGHT : STYLE_DARK',
    );
  });

  it("rallenta zoom e viaggi e aspetta il caricamento a ogni arrivo", () => {
    expect(landingGlobeSource).toContain("const HOP_FLY_MS = 6500");
    expect(landingGlobeSource).toContain("const CONTINENT_FLY_MS = 11000");
    expect(landingGlobeSource).toContain("const FIRST_FLY_MS = 9000");
    const flyTo = landingGlobeSource.indexOf("map.flyTo({");
    const travelEnd = landingGlobeSource.indexOf(
      'map.once("moveend", onTravelEnd)',
    );
    expect(flyTo).toBeGreaterThan(-1);
    expect(travelEnd).toBeGreaterThan(flyTo);
    expect(landingGlobeSource).toContain('map.once("idle", settleAtStop)');
    const arrivalGate = landingGlobeSource.slice(
      landingGlobeSource.indexOf("const onTravelEnd"),
      flyTo,
    );
    expect(arrivalGate).not.toContain("map.loaded()");
    expect(landingGlobeSource).not.toContain("duration + 300");
  });

  it("consegna l'autopilota solo dopo il primo idle successivo ai pin", () => {
    const sourceUpdate = jobsGlobeSource.indexOf(
      'src.setData({ type: "FeatureCollection", features });',
    );
    const idleReady = jobsGlobeSource.indexOf(
      'map.once("idle", () => {',
      sourceUpdate,
    );
    const callback = jobsGlobeSource.indexOf(
      "showcaseRef.current?.onMapReady?.(map);",
      idleReady,
    );

    expect(sourceUpdate).toBeGreaterThan(-1);
    expect(idleReady).toBeGreaterThan(sourceUpdate);
    expect(callback).toBeGreaterThan(idleReady);
  });
});
