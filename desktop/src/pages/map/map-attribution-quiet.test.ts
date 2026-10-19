import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globe = readFileSync(resolve(process.cwd(), "../web/app/components/JobsGlobe.tsx"), "utf8");

// The credit is a licence duty, not the subject of the map: MapLibre's default
// (i) is a solid white disc, the brightest object on a dark globe.
describe("the attribution button is quiet", () => {
  it("takes the theme's panel, border and a half-intensity icon, and keeps the credit reachable", () => {
    expect(globe).toMatch(/\.maplibregl-ctrl-attrib\.maplibregl-compact \{\s*background: var\(--color-panel\);/);
    expect(globe).toMatch(/\.maplibregl-ctrl-attrib-button \{\s*background-color: transparent;\s*filter: \$\{[^}]*\} opacity\(0\.55\);/);
    // the credit text still opens on hover / click
    expect(globe).toContain(".maplibregl-ctrl-attrib:hover .maplibregl-ctrl-attrib-inner");
  });

  it("does not paint a dark theme's icon with a light theme's filter", () => {
    expect(globe).toMatch(/paintedTheme\(resolvedTheme\) === "light" \? "none" : "invert\(1\)"/);
  });
});
