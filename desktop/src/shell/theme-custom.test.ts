// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lightnessGap, toOklch, wcagContrast } from "./contrast";
import {
  GAP_CARD_PANEL,
  SEED_KEYS,
  STATUS_TOKENS,
  TOKEN_NAMES,
  checkSeeds,
  checkTokens,
  deriveTokens,
  fixAll,
  isHexColour,
  seedFamily,
  suggestFix,
  type DeriveContext,
  type Failure,
  type Seeds,
  type StatusColors,
  type TokenName,
  type Tokens,
} from "./theme-custom";
import { THEMES } from "./theme";

const css = readFileSync(new URL("../dashboard/dashboard.css", import.meta.url), "utf8").replace(/\r\n?/g, "\n");

function tokensOf(theme: string): Tokens {
  const body = css.match(new RegExp(`:root\\[data-jht-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\}`))![1];
  const found = new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  return Object.fromEntries(TOKEN_NAMES.map((name) => [name, found.get(name)!])) as Tokens;
}
const seedsOf = (t: Tokens): Seeds => ({
  background: t["--color-void"],
  panel: t["--color-panel"],
  text: t["--color-base"],
  border: t["--color-border"],
  accent: t["--color-green"],
});
const statusOf = (t: Tokens) => Object.fromEntries(STATUS_TOKENS.map((k) => [k, t[k]])) as StatusColors;
const contextOf = (theme: string, t: Tokens): DeriveContext => ({ status: statusOf(t), strict: theme === "contrast" });

const READY = THEMES.map(({ value }) => {
  const tokens = tokensOf(value);
  return { value, tokens, seeds: seedsOf(tokens), context: contextOf(value, tokens) };
});
const dark = READY.find((r) => r.value === "dark")!;
const strict = READY.find((r) => r.value === "contrast")!;
const light = READY.find((r) => r.value === "light")!;
const L = (hex: string) => toOklch(hex).l;

describe("the guard accepts what the ready palettes are", () => {
  it.each(READY)("passes the real $value palette, with nothing to report", ({ tokens, context }) => {
    expect(checkTokens(tokens, { strict: context.strict })).toEqual([]);
  });
});

describe("the derivation from five seeds", () => {
  it.each(READY)("rebuilds the layers, the ladder and the accent of $value close to the real ones", ({ tokens, seeds, context }) => {
    const derived = deriveTokens(seeds, context);
    for (const seed of ["--color-void", "--color-panel", "--color-base", "--color-border", "--color-green"] as const) {
      expect(derived[seed], seed).toBe(tokens[seed].toLowerCase());
    }
    for (const name of ["--color-deep", "--color-card", "--color-row"] as const) {
      expect(Math.abs(L(derived[name]) - L(tokens[name])), `${name} lightness`).toBeLessThan(0.02);
    }
    expect(Math.abs(L(derived["--color-border-glow"]) - L(tokens["--color-border-glow"]))).toBeLessThan(0.06);
    expect(Math.abs(L(derived["--color-white"]) - L(tokens["--color-white"]))).toBeLessThan(0.07);
    expect(Math.abs(L(derived["--color-bright"]) - L(tokens["--color-bright"]))).toBeLessThan(0.07);
    expect(Math.abs(L(derived["--color-ready"]) - L(tokens["--color-ready"]))).toBeLessThan(0.07);
    // muted and dim stay between the text and the surfaces
    for (const name of ["--color-muted", "--color-dim"] as const) {
      const gapToText = Math.abs(L(derived["--color-base"]) - L(derived[name]));
      expect(gapToText, name).toBeGreaterThan(0.02);
    }
  });

  it.each(READY)("makes a palette of $value's seeds that the guard accepts", ({ seeds, context }) => {
    expect(checkSeeds(seeds, context).failures).toEqual([]);
  });

  it("makes the same 21 tokens, all #rrggbb but the grid veil, whatever the seeds", () => {
    const { tokens } = checkSeeds(dark.seeds, dark.context);
    expect(Object.keys(tokens).sort()).toEqual([...TOKEN_NAMES].sort());
    for (const name of TOKEN_NAMES) {
      if (name === "--color-grid") expect(tokens[name]).toMatch(/^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0\.04\)$/);
      else expect(tokens[name], name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("takes the base from the lightness of the panel and puts the layers on the right side of it", () => {
    expect(seedFamily(dark.seeds)).toBe("dark");
    expect(seedFamily(light.seeds)).toBe("light");
    const d = deriveTokens(dark.seeds, dark.context);
    expect(L(d["--color-card"])).toBeGreaterThan(L(d["--color-panel"]));
    expect(L(d["--color-row"])).toBeGreaterThan(L(d["--color-card"]));
    expect(L(d["--color-deep"])).toBeLessThan(L(d["--color-panel"]));
    const l = deriveTokens(light.seeds, light.context);
    expect(L(l["--color-card"])).toBeLessThan(L(l["--color-panel"]));
    expect(L(l["--color-row"])).toBeLessThan(L(l["--color-card"]));
  });

  it("reads status colours made for the other base: a dark theme's colours on a light panel are darkened until they read", () => {
    const { tokens, failures } = checkSeeds(light.seeds, { status: statusOf(dark.tokens), strict: false });
    expect(failures).toEqual([]);
    for (const name of STATUS_TOKENS) {
      expect(wcagContrast(tokens[name], tokens["--color-card"]), name).toBeGreaterThanOrEqual(4.5);
      expect(Math.abs(toOklch(tokens[name]).h - toOklch(dark.tokens[name]).h), `${name} hue`).toBeLessThan(8);
    }
  });

  it("accepts only #rrggbb as a colour, in either case, and nothing else", () => {
    for (const good of ["#000000", "#ffffff", "#7A3fD0"]) expect(isHexColour(good), good).toBe(true);
    for (const bad of ["#fff", "#1234", "#12345", "#1234567", "#12345g", " #123456", "123456", "red", "", null, 12, undefined]) {
      expect(isHexColour(bad), String(bad)).toBe(false);
    }
  });

  it("refuses a seed that is not a six-digit colour instead of deriving from garbage", () => {
    for (const bad of ["#fff", "#1234", "#12345", "#1234567", "red", "url(x)", "#12345g", "var(--x)", ""]) {
      for (const key of SEED_KEYS) {
        expect(() => deriveTokens({ ...dark.seeds, [key]: bad }, dark.context), `${key}=${bad}`).toThrow();
      }
    }
  });
});

describe("the guard says which pair fails and by how much", () => {
  const broken = (name: TokenName, colour: string, base = dark) => ({ ...base.tokens, [name]: colour }) as Tokens;
  const failures = (tokens: Tokens, strict = false) => checkTokens(tokens, { strict });
  const has = (list: Failure[], rule: string, a: TokenName, b?: TokenName) =>
    list.find((f) => f.rule === rule && f.a === a && (b === undefined || f.b === b));

  it("flags dim text under 4.5 on a card, with the measured and the needed value", () => {
    const found = has(failures(broken("--color-dim", "#4a4a5c")), "text", "--color-dim", "--color-card");
    expect(found).toBeDefined();
    expect(found!.value).toBeLessThan(4.5);
    expect(found!.need).toBe(4.5);
    expect(found!.kind).toBe("wcag");
  });

  it("flags a status colour, an accent used as text and a button label", () => {
    expect(has(failures(broken("--color-red", "#552222")), "status", "--color-red")).toBeDefined();
    expect(has(failures(broken("--color-yellow", "#f0e8a0", light), false), "status", "--color-yellow")).toBeDefined();
    expect(has(failures(broken("--color-ready", "#1c4a30")), "accent", "--color-ready")).toBeDefined();
    expect(has(failures(broken("--color-green", "#123b2a")), "button", "--color-void", "--color-green")).toBeDefined();
    expect(has(failures(broken("--color-green", "#123b2a")), "graphic", "--color-green")).toBeDefined();
  });

  it("flags layers that look the same and a border that cannot be seen", () => {
    expect(has(failures(broken("--color-card", dark.tokens["--color-panel"])), "layer", "--color-card", "--color-panel")).toBeDefined();
    expect(has(failures(broken("--color-row", dark.tokens["--color-card"])), "layer", "--color-row", "--color-card")).toBeDefined();
    expect(has(failures(broken("--color-void", dark.tokens["--color-panel"])), "layer", "--color-void", "--color-panel")).toBeDefined();
    const border = has(failures(broken("--color-border", dark.tokens["--color-panel"])), "border", "--color-border", "--color-panel");
    expect(border?.kind).toBe("lightness");
  });

  it("flags a card only a little lighter than the panel, and accepts one that clears the gap", () => {
    const panel = toOklch(dark.tokens["--color-panel"]);
    const at = (gap: number) => fromOklchLocal(panel.l + gap, panel.c, panel.h);
    const layer = (gap: number) => has(failures(broken("--color-card", at(gap))), "layer", "--color-card", "--color-panel");
    expect(layer(0.017)).toBeDefined();
    expect(layer(0.033)).toBeUndefined();
  });

  it("holds the high-contrast palette to 7:1 for text and status, and 3:1 for its border", () => {
    const contrast = READY.find((r) => r.value === "contrast")!;
    expect(failures(contrast.tokens, true)).toEqual([]);
    expect(has(failures(broken("--color-muted", "#9a9ab1", contrast), true), "text", "--color-muted")).toBeDefined();
    expect(has(failures(broken("--color-border", "#3a3a4a", contrast), true), "border", "--color-border", "--color-panel")).toBeDefined();
    // the same colour is fine under the normal bar
    expect(has(failures(broken("--color-muted", "#9a9ab1", contrast), false), "text", "--color-muted")).toBeUndefined();
  });

  it("says that no text is readable when a surface is a middle grey", () => {
    // the worst grey still gives 4.58 with white or black: only the 7:1 bar can leave a surface with no readable text
    const grey = { ...dark.seeds, background: "#777777", panel: "#777777" };
    const { failures: found } = checkSeeds(grey, strict.context);
    expect(found.some((f) => f.rule === "no-readable-text" && f.a === "--color-panel")).toBe(true);
    expect(found.filter((f) => f.rule === "no-readable-text").every((f) => f.value < 7)).toBe(true);
  });
});

describe("the suggestion moves the colour at fault by the smallest step that cures the failure", () => {
  const first = (seeds: Seeds, context: DeriveContext, rule: string, a: TokenName) => {
    const failure = checkSeeds(seeds, context).failures.find((f) => f.rule === rule && f.a === a);
    expect(failure, `${rule} ${a}`).toBeDefined();
    return failure!;
  };

  it("lightens a text colour that is too dim on a dark base, changing nothing else, and not by more than needed", () => {
    const seeds = { ...dark.seeds, text: "#5a5a6e" };
    const failure = first(seeds, dark.context, "text", "--color-base");
    const fixed = suggestFix(seeds, dark.context, failure)!;
    expect(fixed).not.toBeNull();
    expect({ ...fixed, text: "" }).toEqual({ ...seeds, text: "" });
    expect(L(fixed.text)).toBeGreaterThan(L(seeds.text));
    expect(checkSeeds(fixed, dark.context).failures.some((f) => f.rule === failure.rule && f.a === failure.a && f.b === failure.b)).toBe(false);
    // one step less still fails: it is the nearest
    const lessBy = toOklch(fixed.text);
    const almost = { ...fixed, text: moveL(fixed.text, lessBy.l - 0.004) };
    expect(checkSeeds(almost, dark.context).failures.some((f) => f.rule === "text" && f.a === "--color-base" && f.b === failure.b)).toBe(true);
  });

  it("darkens a text colour that is too pale on a light base", () => {
    const seeds = { ...light.seeds, text: "#9aa0b4" };
    const failure = first(seeds, light.context, "text", "--color-base");
    const fixed = suggestFix(seeds, light.context, failure)!;
    expect(L(fixed.text)).toBeLessThan(L(seeds.text));
    expect(checkSeeds(fixed, light.context).failures.some((f) => f.rule === failure.rule && f.a === failure.a && f.b === failure.b)).toBe(false);
  });

  it("moves the colour the person touched last when it is one of the pair, the other one otherwise", () => {
    const seeds = { ...dark.seeds, text: "#5a5a6e" };
    const failure = first(seeds, dark.context, "text", "--color-base");
    const surface = failure.b === "--color-void" ? "background" : "panel";
    const viaSurface = suggestFix(seeds, dark.context, failure, surface)!;
    expect(viaSurface).not.toBeNull();
    expect(viaSurface.text).toBe(seeds.text);
    expect(viaSurface[surface]).not.toBe(seeds[surface]);
    const viaText = suggestFix(seeds, dark.context, failure, "text")!;
    expect(viaText.panel).toBe(seeds.panel);
    expect(viaText.background).toBe(seeds.background);
    expect(viaText.text).not.toBe(seeds.text);
  });

  it("moves the surface out of the middle grey, to the nearest readable lightness", () => {
    const grey = { ...dark.seeds, background: "#777777", panel: "#777777" };
    const failure = first(grey, strict.context, "no-readable-text", "--color-panel");
    const fixed = suggestFix(grey, strict.context, failure)!;
    expect(fixed).not.toBeNull();
    expect(checkSeeds(fixed, strict.context).failures.some((f) => f.rule === "no-readable-text" && f.a === "--color-panel")).toBe(false);
  });

  it("raises a panel from the floor so that the layers around it have room", () => {
    const seeds = { ...dark.seeds, background: "#000000", panel: "#000000" };
    const { failures } = checkSeeds(seeds, dark.context);
    expect(failures.some((f) => f.rule === "layer")).toBe(true);
    const out = fixAll(seeds, dark.context, "panel");
    expect(out.failures).toEqual([]);
    expect(lightnessGap(deriveTokens(out.seeds, dark.context)["--color-card"], out.seeds.panel)).toBeGreaterThanOrEqual(GAP_CARD_PANEL);
  });

  it("fixes a palette with several faults at once, or says what is left", () => {
    const messy: Seeds = { background: "#101018", panel: "#14141c", text: "#3a3a48", border: "#15151d", accent: "#2a2a60" };
    const out = fixAll(messy, dark.context);
    expect(out.failures).toEqual([]);
    expect(checkSeeds(out.seeds, dark.context).failures).toEqual([]);
    // colours it never touches keep their hue
    expect(Math.abs(toOklch(out.seeds.accent).h - toOklch(messy.accent).h)).toBeLessThan(12);
  });

  it("looks beyond the colour touched last when that one cannot cure the fault alone", () => {
    const grey = { ...dark.seeds, background: "#777777", panel: "#777777", text: "#808080" };
    const failure = checkSeeds(grey, dark.context).failures.find((f) => f.rule === "layer")!;
    expect(failure).toBeDefined();
    // text is the colour touched last, but a layer gap is cured only by moving a surface
    const fixed = suggestFix(grey, dark.context, failure, "text")!;
    expect(fixed).not.toBeNull();
    expect(fixed.text).toBe(grey.text);
    expect(fixed.panel !== grey.panel || fixed.background !== grey.background).toBe(true);
  });

  it("returns the seeds untouched when the palette already passes", () => {
    expect(fixAll(dark.seeds, dark.context)).toEqual({ seeds: dark.seeds, failures: [] });
  });

  it("never leaves an arbitrary palette worse than it found it, on both bases, and says what is left", () => {
    const pick = ["#000000", "#ffffff", "#808080", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#202040", "#e8e8f0", "#7a3fd0"];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 8; i += 1) {
      const seeds = Object.fromEntries(SEED_KEYS.map((k) => [k, pick[Math.floor(rnd() * pick.length)]])) as Seeds;
      const context = i % 2 === 0 ? dark.context : light.context; // both bases, four palettes each
      const out = fixAll(seeds, context);
      const before = checkSeeds(seeds, context).failures.length;
      expect(out.failures.length, JSON.stringify(seeds)).toBeLessThanOrEqual(before);
      expect(out.failures).toEqual(checkSeeds(out.seeds, context).failures);
    }
    // Each case searches every candidate of every fault it cannot cure, and the whole file runs beside others
    // under load: the default 5 s is not enough, so the bound is explicit.
  }, 60_000);
});

function moveL(hex: string, l: number) {
  const { c, h } = toOklch(hex);
  return fromOklchLocal(l, c, h);
}
import { fromOklch } from "./contrast";
const fromOklchLocal = (l: number, c: number, h: number) => fromOklch({ l, c, h });
