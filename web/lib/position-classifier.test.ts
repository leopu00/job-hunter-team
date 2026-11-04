import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FAMILY_PALETTE,
  OTHER_GROUP_LABEL,
  UNCATEGORIZED_LABEL,
  aggregateRoleFamilies,
  assignFamilyColors,
  colorForFamily,
  groupRoleFamilies,
} from "./position-classifier";

const here = path.dirname(fileURLToPath(import.meta.url));

// ── i token VERI dei temi: undici palette del desktop + chiaro e scuro del web ──────────────────────────────────
type Tokens = Record<string, string>;

function tokensOf(block: string): Tokens {
  const t: Tokens = {};
  for (const m of block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) t[m[1]] = m[2];
  return t;
}

function loadThemes(): Record<string, Tokens> {
  const desktop = readFileSync(path.join(here, "../../desktop/src/dashboard/dashboard.css"), "utf8");
  const web = readFileSync(path.join(here, "../app/globals.css"), "utf8");
  const themes: Record<string, Tokens> = {};
  for (const m of desktop.matchAll(/:root\[data-jht-theme="([a-z]+)"\]\s*\{([^}]*)\}/g)) {
    themes[`desktop ${m[1]}`] = tokensOf(m[2]);
  }
  const webDark = /^@theme inline\s*\{([^}]*)\}/m.exec(web);
  const webLight = /^html\[data-theme="light"\]\s*\{([^}]*)\}/m.exec(web);
  if (webDark) themes["web dark"] = tokensOf(webDark[1]);
  if (webLight) themes["web light"] = tokensOf(webLight[1]);
  return themes;
}

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;

/** What a browser paints for a palette entry in a theme: only the two forms the palette is allowed to use. */
function resolve(entry: string, t: Tokens): Rgb {
  const plain = /^var\(--color-([a-z-]+)\)$/.exec(entry);
  if (plain) return hex(t[plain[1]]);
  const mixed = /^color-mix\(in srgb, var\(--color-([a-z-]+)\) (\d+)%, var\(--color-([a-z-]+)\)\)$/.exec(entry);
  if (!mixed) throw new Error(`palette entry not understood by the test: ${entry}`);
  const a = hex(t[mixed[1]]);
  const b = hex(t[mixed[3]]);
  const w = Number(mixed[2]) / 100;
  return a.map((v, i) => v * w + b[i] * (1 - w)) as Rgb;
}

function lab([r, g, b]: Rgb): Rgb {
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (x: number) => (x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const deltaE = (a: Rgb, b: Rgb) => {
  const x = lab(a);
  const y = lab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

// ── gli elementi del donut «Types» ─────────────────────────────────────────────────────────────────────────────
const NAMES = [
  "Analytics Engineering",
  "Data Engineering",
  "Agentic AI / LLM Engineering",
  "MLOps / ML Engineering",
  "Platform Engineering",
  "Forward Deployed Engineering",
  "AI Product Engineering",
  "Applied AI Engineering",
  "QA / Test Automation",
  "Business Process Automation",
  "Frontend Engineering",
  "Solutions Engineering",
  "Security Engineering",
  "Data Science",
  "Technical Writing",
];

const rowsFor = (families: string[], each = 5) =>
  families.flatMap((family, i) =>
    Array.from({ length: each + families.length - i }, () => ({ role_family: family, score: 70, critic: null })),
  );

const donutFor = (families: string[]) => groupRoleFamilies(aggregateRoleFamilies(rowsFor(families)));

describe("the colours of the position types", () => {
  it("are the chosen theme's tokens, never a fixed hex or hsl value", () => {
    for (const entry of FAMILY_PALETTE) {
      expect(entry).toMatch(/^(var\(--color-[a-z-]+\)|color-mix\(in srgb, var\(--color-[a-z-]+\) \d+%, var\(--color-[a-z-]+\)\))$/);
    }
    for (const name of NAMES) expect(FAMILY_PALETTE).toContain(colorForFamily(name));
    for (const slice of donutFor(NAMES)) expect(slice.color).toMatch(/^(var|color-mix)\(/);
  });

  it("have at least eight different entries before any repeats", () => {
    expect(new Set(FAMILY_PALETTE).size).toBe(FAMILY_PALETTE.length);
    expect(FAMILY_PALETTE.length).toBeGreaterThanOrEqual(8);
  });

  it("keep Analytics Engineering and Data Engineering apart (both were the same pink)", () => {
    const slices = donutFor(["Analytics Engineering", "Data Engineering", "Frontend Engineering"]);
    const color = (family: string) => slices.find((s) => s.family === family)?.color;
    expect(color("Analytics Engineering")).toBeDefined();
    expect(color("Analytics Engineering")).not.toBe(color("Data Engineering"));
  });

  it("give every visible slice its own colour, whatever the set of types", () => {
    // Every size of set, from a few types to more than the donut can show, in a few different mixes.
    for (let size = 1; size <= NAMES.length; size++) {
      for (let shift = 0; shift < NAMES.length; shift++) {
        const families = Array.from({ length: size }, (_, i) => NAMES[(i + shift) % NAMES.length]);
        const slices = donutFor(Array.from(new Set(families)));
        const colors = slices.map((s) => s.color);
        expect(new Set(colors).size, `${slices.map((s) => s.family).join(" | ")}`).toBe(colors.length);
      }
    }
  });

  it("keep «Other» (the long tail) and «Da categorizzare» apart from each other and from every type", () => {
    // «Da categorizzare» big enough to be a slice of its own, the long tail of small types behind it.
    const rows = [
      ...rowsFor(NAMES),
      ...Array.from({ length: 400 }, () => ({ role_family: UNCATEGORIZED_LABEL, score: null, critic: null })),
    ];
    const slices = groupRoleFamilies(aggregateRoleFamilies(rows));
    expect(slices.some((s) => s.family === OTHER_GROUP_LABEL)).toBe(true);
    expect(slices.some((s) => s.family === UNCATEGORIZED_LABEL)).toBe(true);
    const colors = slices.map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("give the whole list of types its own colours too (the map's donut shows them all)", () => {
    const first = aggregateRoleFamilies(rowsFor(NAMES.slice(0, FAMILY_PALETTE.length))).map((d) => d.color);
    expect(new Set(first).size).toBe(first.length);
    // Past the palette it repeats, in order: no colour is used a third time before all are used twice.
    const all = assignFamilyColors(NAMES);
    const uses = FAMILY_PALETTE.map((c) => Array.from(all.values()).filter((v) => v === c).length);
    expect(Math.max(...uses) - Math.min(...uses)).toBeLessThanOrEqual(1);
  });

  it("do not depend on the order the types arrive in", () => {
    const a = assignFamilyColors(NAMES.slice(0, 9));
    const b = assignFamilyColors([...NAMES.slice(0, 9)].reverse());
    for (const [name, color] of a) expect(b.get(name)).toBe(color);
  });

  it("are different to the eye, not only different in text, in every theme", () => {
    const themes = loadThemes();
    expect(Object.keys(themes).length).toBeGreaterThanOrEqual(13); // 11 desktop palettes + web light and dark
    for (const [theme, tokens] of Object.entries(themes)) {
      for (const need of ["blue", "green", "red", "orange", "purple", "yellow"]) {
        expect(tokens[need], `${theme} has no --color-${need}`).toBeTruthy();
      }
      for (let i = 0; i < FAMILY_PALETTE.length; i++) {
        for (let j = i + 1; j < FAMILY_PALETTE.length; j++) {
          const d = deltaE(resolve(FAMILY_PALETTE[i], tokens), resolve(FAMILY_PALETTE[j], tokens));
          expect(d, `${theme}: ${FAMILY_PALETTE[i]} and ${FAMILY_PALETTE[j]} look alike (ΔE ${d.toFixed(1)})`).toBeGreaterThanOrEqual(12);
        }
      }
    }
  });

  it("change with the theme: the same type is another colour in the light and in the dark one", () => {
    const themes = loadThemes();
    const dark = themes["desktop dark"];
    const light = themes["desktop light"];
    for (const entry of FAMILY_PALETTE) {
      expect(resolve(entry, dark).join()).not.toBe(resolve(entry, light).join());
    }
  });
});
