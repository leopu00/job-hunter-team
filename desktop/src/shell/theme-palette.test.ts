// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lightnessGap, relativeLuminance, toOklch, wcagContrast as contrast } from "./contrast";
import { THEME_TEXT } from "./theme.i18n";
import { THEMES, SYSTEM_THEME, themeFamily } from "./theme";

const css = readFileSync(new URL("../dashboard/dashboard.css", import.meta.url), "utf8").replace(/\r\n?/g, "\n");
const html = readFileSync(new URL("../../dashboard.html", import.meta.url), "utf8");

const REQUIRED = [
  "--color-void", "--color-deep", "--color-panel", "--color-card", "--color-row",
  "--color-border", "--color-border-glow", "--color-dim", "--color-muted", "--color-base",
  "--color-bright", "--color-white", "--color-grid", "--color-green", "--color-ready",
  "--color-yellow", "--color-blue", "--color-red", "--color-orange", "--color-purple", "--sync-warn",
] as const;
const SURFACES = ["--color-void", "--color-deep", "--color-panel", "--color-card", "--color-row"] as const;
const TEXT = ["--color-white", "--color-bright", "--color-base", "--color-muted", "--color-dim"] as const;
const ACCENTS = [
  "--color-green", "--color-ready", "--color-yellow", "--color-blue", "--color-red",
  "--color-orange", "--color-purple", "--sync-warn",
] as const;

function block(theme: string) {
  const body = css.match(new RegExp(`:root\\[data-jht-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\}`))?.[1];
  expect(body, `missing palette for ${theme}`).toBeDefined();
  return body!;
}

function tokens(theme: string) {
  return new Map([...block(theme).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

describe("every palette is complete and consistent", () => {
  it("lists eleven palettes, each once, each with a base", () => {
    expect(THEMES).toHaveLength(11);
    expect(new Set(THEMES.map((t) => t.value)).size).toBe(THEMES.length);
    expect(THEMES.every((t) => t.family === "dark" || t.family === "light")).toBe(true);
  });

  it.each(THEMES)("defines the 21 variables of $label, six-digit colours (the grid veil may be translucent)", ({ value }) => {
    const palette = tokens(value);
    for (const name of REQUIRED) {
      const colour = palette.get(name);
      expect(colour, `${value} lacks ${name}`).toBeDefined();
      if (name === "--color-grid") expect(colour).toMatch(/^rgba\(/);
      else expect(colour, `${value} ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it.each(THEMES)("$label declares the colour scheme of its base", ({ value }) => {
    expect(block(value)).toMatch(new RegExp(`color-scheme:\\s*${themeFamily(value)};`));
  });

  it.each(THEMES)("$label has its preview ball, with its panel and its accent", ({ value }) => {
    const rule = css.match(new RegExp(`\\.theme-picker__swatch\\[data-theme-preview="${value}"\\]\\s*\\{([^}]*)\\}`))?.[1];
    expect(rule, `no preview for ${value}`).toBeDefined();
    const palette = tokens(value);
    // the stylesheet may write #fff for #ffffff
    const long = (hex: string) => (/^#[0-9a-f]{3}$/i.test(hex) ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex).toLowerCase();
    const previewOf = (name: string) => long(rule!.match(new RegExp(`${name}:\\s*(#[0-9a-f]{3,6})`, "i"))![1]);
    expect(previewOf("--preview-bg")).toBe(long(palette.get("--color-panel")!));
    expect(previewOf("--preview-accent")).toBe(long(palette.get("--color-green")!));
  });

  it("the «follow the system» entry has a preview ball too", () => {
    expect(css).toMatch(new RegExp(`data-theme-preview="${SYSTEM_THEME}"\\]`));
  });
});

describe("every palette stays readable", () => {
  it.each(THEMES)("keeps every text colour at 4.5:1 on all five surfaces in $label", ({ value }) => {
    const p = tokens(value);
    for (const name of TEXT) {
      for (const surface of SURFACES) {
        expect(contrast(p.get(name)!, p.get(surface)!), `${value}: ${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(THEMES)("keeps the status colours (urgent red, blocked yellow, the rest) at 4.5:1 as labels and 3:1 as graphics on all five surfaces in $label", ({ value }) => {
    const p = tokens(value);
    for (const name of ACCENTS) {
      for (const surface of SURFACES) {
        const ratio = contrast(p.get(name)!, p.get(surface)!);
        expect(ratio, `${value}: ${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio, `${value}: ${name} as graphic on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it.each(THEMES)("keeps the text on a surface that is clearly lighter or darker than it in $label", ({ value }) => {
    const p = tokens(value);
    for (const surface of SURFACES) {
      expect(lightnessGap(p.get("--color-base")!, p.get(surface)!), `${value}: base on ${surface}`).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("holds «High contrast» to 7:1 on every text and status colour against every surface, and gives it visible borders", () => {
    const p = tokens("contrast");
    for (const name of [...TEXT, ...ACCENTS]) {
      for (const surface of SURFACES) {
        expect(contrast(p.get(name)!, p.get(surface)!), `contrast: ${name} on ${surface}`).toBeGreaterThanOrEqual(7);
      }
    }
    expect(contrast(p.get("--color-border")!, p.get("--color-panel")!)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.get("--color-border-glow")!, p.get("--color-panel")!)).toBeGreaterThanOrEqual(3);
  });
});

describe("the names", () => {
  const locales = Object.keys(THEME_TEXT) as Array<keyof typeof THEME_TEXT>;

  it("has the seven languages", () => {
    expect([...locales].sort()).toEqual(["de", "en", "es", "fr", "hu", "it", "pt"]);
  });

  it.each(locales)("names every palette, the groups and the system entry in %s, with no two the same", (locale) => {
    const text = THEME_TEXT[locale];
    const names = THEMES.map((t) => text.names[t.value]);
    for (const [i, name] of names.entries()) expect(name?.trim().length, `${locale} ${THEMES[i].value}`).toBeGreaterThan(1);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    for (const word of [text.system, text.systemShort, text.groupDark, text.groupLight]) {
      expect(word.trim().length).toBeGreaterThan(1);
    }
    // the system entry must not read as the name of a palette (a group heading may share the word of its base)
    expect(names.map((n) => n.toLowerCase())).not.toContain(text.system.toLowerCase());
  });
});

describe("the script that dresses the page before it is drawn (dashboard.html)", () => {
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)![1];

  function run(stored: string | null | "throws", light: boolean | "throws" | "absent") {
    const dataset: Record<string, string> = {};
    const win =
      light === "absent"
        ? {}
        : { matchMedia: () => (light === "throws" ? (() => { throw new Error("x"); })() : { matches: light }) };
    const storage = {
      getItem: () => {
        if (stored === "throws") throw new Error("blocked");
        return stored;
      },
    };
    new Function("localStorage", "window", "document", script)(storage, win, { documentElement: { dataset } });
    return dataset;
  }

  it.each(THEMES)("dresses a stored $label with its own base, whatever the system says", ({ value, family }) => {
    for (const light of [true, false]) {
      expect(run(value, light)).toEqual({ jhtTheme: value, theme: family });
    }
  });

  it("follows the system when nothing valid is stored (nothing, «system», an unknown word, a blocked storage)", () => {
    for (const stored of [null, "system", "ultraviolet", "constructor", "__proto__", "throws"] as const) {
      expect(run(stored, true), String(stored)).toEqual({ jhtTheme: "light", theme: "light" });
      expect(run(stored, false), String(stored)).toEqual({ jhtTheme: "dark", theme: "dark" });
    }
  });

  it("falls back to dark when the system cannot be asked", () => {
    expect(run(null, "absent")).toEqual({ jhtTheme: "dark", theme: "dark" });
    expect(run(null, "throws")).toEqual({ jhtTheme: "dark", theme: "dark" });
  });
});

describe("the contrast functions", () => {
  it("measures the WCAG ratio, the same whichever colour is the text", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrast("#ffffff", "#777777")).toBe(contrast("#777777", "#ffffff"));
    // dark greys sit on the linear branch of the sRGB curve, where the themes' deep surfaces live
    expect(contrast("#202020", "#000000")).toBeCloseTo(1.2888, 3);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
  });

  it("places a colour in OKLCH", () => {
    expect(toOklch("#ffffff").l).toBeCloseTo(1, 3);
    expect(toOklch("#000000").l).toBe(0);
    expect(toOklch("#808080").c).toBeLessThan(0.001);
    expect(toOklch("#ff0000").h).toBeGreaterThan(20);
    expect(toOklch("#ff0000").h).toBeLessThan(40);
    expect(toOklch("#0000ff").h).toBeGreaterThan(250);
    expect(lightnessGap("#000000", "#ffffff")).toBeCloseTo(1, 3);
  });

  it("refuses what is not a six-digit colour instead of measuring garbage", () => {
    for (const bad of ["#fff", "red", "#12345g", "rgba(0,0,0,0.5)", ""]) {
      expect(() => contrast(bad, "#ffffff"), bad).toThrow();
    }
  });
});
