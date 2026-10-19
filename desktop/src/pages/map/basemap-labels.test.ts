import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import {
  CALM_NAME_COLOR_DARK,
  CALM_NAME_LAYERS,
  basemapNameExpression,
  basemapNameOf,
  isTranslatedNameLayer,
} from "@/lib/basemap-labels";

// The basemap names its countries in the language of the interface: «Deutschland»
// under a German UI, not «GERMANY». The tiles carry `name:xx` for every language
// of the app; English and the local name are the fallbacks.
const GERMANY = { name: "Deutschland", "name:de": "Deutschland", "name:it": "Germania", name_en: "Germany" };

describe("basemap names in the interface language", () => {
  it("takes the name in the language, then English, then the local one", () => {
    expect(basemapNameOf(GERMANY, "it")).toBe("Germania");
    expect(basemapNameOf(GERMANY, "de")).toBe("Deutschland");
    expect(basemapNameOf(GERMANY, "en")).toBe("Germany");
    // A language the tile has no name for falls back to English, never to nothing.
    expect(basemapNameOf(GERMANY, "hu")).toBe("Germany");
    expect(basemapNameOf({ name: "Quelque part" }, "fr")).toBe("Quelque part");
  });

  it("gives MapLibre the same order as an expression, for every language of the app", () => {
    for (const lang of locales) {
      expect(basemapNameExpression(lang)).toEqual([
        "coalesce",
        ["get", `name:${lang}`],
        ["get", "name_en"],
        ["get", "name"],
      ]);
    }
  });

  it("translates places and water, and leaves roads, points of interest and house numbers alone", () => {
    expect(isTranslatedNameLayer({ type: "symbol", "source-layer": "place" })).toBe(true);
    expect(isTranslatedNameLayer({ type: "symbol", "source-layer": "water_name" })).toBe(true);
    expect(isTranslatedNameLayer({ type: "symbol", "source-layer": "transportation_name" })).toBe(false);
    expect(isTranslatedNameLayer({ type: "symbol", "source-layer": "poi" })).toBe(false);
    expect(isTranslatedNameLayer({ type: "symbol", "source-layer": "housenumber" })).toBe(false);
    expect(isTranslatedNameLayer({ type: "fill", "source-layer": "place" })).toBe(false);
  });

  it("is applied by the globe at every style load and when the language changes", () => {
    const globe = readFileSync(resolve(process.cwd(), "../web/app/components/JobsGlobe.tsx"), "utf8");
    // style.load: a theme change reloads the style from scratch.
    expect(globe).toMatch(/applyProfileToStyle\(map, profileRef\.current\);\s*applyBasemapLanguage\(map, basemapLangRef\.current\);/);
    // a language change on a still map, and the names the labels avoid are read in that language.
    expect(globe).toMatch(/applyBasemapLanguage\(map, basemapLang\);/);
    expect(globe).toMatch(/basemapNameRects\(map, lang\)/);
  });
});

// The country names are the background, the numbers of the beams the subject.
describe("basemap names as background", () => {
  const channels = (rgba: string) => rgba.match(/[\d.]+/g)!.map(Number);

  it("are dimmer than the style's own light grey-blue (158, 182, 189), and not invisible", () => {
    const [r, g, b, a] = channels(CALM_NAME_COLOR_DARK);
    expect((r + g + b) / 3).toBeLessThan((158 + 182 + 189) / 3 - 30);
    expect(a).toBeLessThan(1);
    expect(a).toBeGreaterThan(0.6);
  });

  it("cover the countries and the continents", () => {
    expect(CALM_NAME_LAYERS).toEqual(expect.arrayContaining(["place_country_1", "place_country_2"]));
  });

  it("are applied by the globe on every style load, right after the theme tint", () => {
    const globe = readFileSync(resolve(process.cwd(), "../web/app/components/JobsGlobe.tsx"), "utf8");
    expect(globe).toMatch(/tintMap\(map, themeRef\.current\);\s*calmBasemapNames\(map, themeRef\.current\);/);
    // no capitals: the label placement reads the layout property, so it measures what is drawn
    expect(globe).toMatch(/setLayoutProperty\(id, "text-transform", "none"\)/);
  });
});
