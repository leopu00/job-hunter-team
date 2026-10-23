/**
 * The personal theme's engine: pure functions, no DOM and no storage.
 *
 * The person chooses five colours (the seeds). The other sixteen tokens of a palette are derived from them
 * by fixed rules measured on the eleven ready palettes, so a personal theme is built like the others: layered
 * surfaces, a text ladder, an accent, status colours. `checkTokens` then measures the result and says which
 * pair fails and by how much; `suggestFix` moves the colour at fault, along its lightness, by the smallest
 * step that makes the failure go away. Nothing here writes CSS: it returns #rrggbb strings and numbers.
 */
import { fromOklch, lightnessGap, toOklch, wcagContrast, type Oklch } from "./contrast";

export const SEED_KEYS = ["background", "panel", "text", "border", "accent"] as const;
export type SeedKey = (typeof SEED_KEYS)[number];
export type Seeds = Record<SeedKey, string>;

/** The colours that carry a meaning: the engine keeps their hue and chroma and only moves their lightness. */
export const STATUS_TOKENS = [
  "--color-yellow",
  "--color-blue",
  "--color-red",
  "--color-orange",
  "--color-purple",
  "--sync-warn",
] as const;
export type StatusToken = (typeof STATUS_TOKENS)[number];
export type StatusColors = Record<StatusToken, string>;

export const SURFACE_TOKENS = [
  "--color-void",
  "--color-deep",
  "--color-panel",
  "--color-card",
  "--color-row",
] as const;
export const TEXT_TOKENS = [
  "--color-white",
  "--color-bright",
  "--color-base",
  "--color-muted",
  "--color-dim",
] as const;
export const TOKEN_NAMES = [
  ...SURFACE_TOKENS,
  "--color-border",
  "--color-border-glow",
  ...TEXT_TOKENS,
  "--color-grid",
  "--color-green",
  "--color-ready",
  ...STATUS_TOKENS,
] as const;
export type TokenName = (typeof TOKEN_NAMES)[number];
export type Tokens = Record<TokenName, string>;

/**
 * What the derivation needs besides the seeds: the status colours of the palette the person started from,
 * and whether that palette is held to the strict (7:1) standard.
 */
export type DeriveContext = { status: StatusColors; strict: boolean };

/** The thresholds. WCAG AA for text and graphics; 7:1 for text when the start is the high-contrast palette. */
export const TEXT_MIN = 4.5;
export const TEXT_MIN_STRICT = 7;
export const GRAPHIC_MIN = 3;
/** Lightness gaps between neighbouring layers (OKLCH): three quarters of the smallest gap of the ready palettes. */
export const GAP_CARD_PANEL = 0.025;
export const GAP_ROW_CARD = 0.016;
export const GAP_VOID_PANEL = 0.017;
export const GAP_BORDER_PANEL = 0.1;

const HEX = /^#[0-9a-f]{6}$/i;
const STEP = 0.004;

export type Family = "dark" | "light";

/** A panel lighter than this is a light base. */
const LIGHT_PANEL_FROM = 0.6;

export function seedFamily(seeds: Seeds): Family {
  return toOklch(seeds.panel).l >= LIGHT_PANEL_FROM ? "light" : "dark";
}

export function isHexColour(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const moved = (hex: string, lightness: number) => {
  const { c, h } = toOklch(hex);
  return fromOklch({ l: lightness, c, h });
};
const minOnSurfaces = (colour: string, surfaces: string[]) =>
  Math.min(...surfaces.map((surface) => wcagContrast(colour, surface)));

/**
 * The colour at `origin`'s hue and chroma, nearest to `origin`'s lightness in the direction `sign`
 * (+1 lighter, -1 darker), that reads at `min` on every surface; `origin` itself when it already does,
 * the last one tried when none does.
 */
function readableFrom(origin: string, sign: 1 | -1, surfaces: string[], min: number): string {
  const start = toOklch(origin).l;
  let candidate = origin;
  for (let l = start; l >= 0 && l <= 1; l += sign * STEP) {
    candidate = moved(origin, l);
    if (minOnSurfaces(candidate, surfaces) >= min) return candidate;
  }
  return candidate;
}

/** How far the ladder runs from the text colour to the extreme, and how far toward the surface, per base. */
const LADDER = {
  dark: { bright: 0.55, white: 0.87, muted: 0.2, dim: 0.32 },
  light: { bright: 0.28, white: 0.48, muted: 0.16, dim: 0.27 },
} as const;
/** Lightness of the layers around the panel; the deep one is darker than the panel in both bases. */
const LAYERS = {
  dark: { deep: 0.027, card: 0.04, row: 0.068, glow: 0.085, ready: 0.08 },
  light: { deep: 0.058, card: 0.048, row: 0.077, glow: 0.085, ready: 0 },
} as const;

function rgbaOf(hex: string, alpha: number) {
  const [r, g, b] = [1, 3, 5].map((o) => Number.parseInt(hex.slice(o, o + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The 21 tokens of a palette from five seeds. Every seed must be #rrggbb: anything else throws. */
export function deriveTokens(seeds: Seeds, context: DeriveContext): Tokens {
  for (const key of SEED_KEYS) {
    if (!isHexColour(seeds[key])) throw new Error(`seed ${key} is not a #rrggbb colour`);
  }
  const family = seedFamily(seeds);
  const sign = family === "dark" ? 1 : -1;
  const layer = LAYERS[family];
  const ladder = LADDER[family];
  const panel = toOklch(seeds.panel);
  const surface = (l: number) => fromOklch({ ...panel, l: clamp01(l) });

  const void_ = seeds.background.toLowerCase();
  const panelHex = seeds.panel.toLowerCase();
  const deep = surface(panel.l - layer.deep);
  const card = surface(panel.l + sign * layer.card);
  const row = surface(panel.l + sign * layer.row);
  const surfaces = [void_, deep, panelHex, card, row];

  const text = toOklch(seeds.text);
  const extreme = sign === 1 ? 1 : 0;
  const along = (fraction: number, chromaKept: number) =>
    fromOklch({ l: text.l + fraction * (extreme - text.l), c: text.c * chromaKept, h: text.h });
  const strictMin = context.strict ? TEXT_MIN_STRICT : TEXT_MIN;
  // muted and dim are anchored: the colour nearest to the text that clears the bar on EVERY surface,
  // so they cannot be the pair that fails by construction.
  const anchorMin = strictMin + (context.strict ? 0.2 : 0.5);
  const towardSurface = (fraction: number) =>
    readableFrom(moved(seeds.text, text.l - sign * fraction * Math.abs(text.l - panel.l)), sign, surfaces, anchorMin);

  const border = toOklch(seeds.border);
  const accent = toOklch(seeds.accent);
  const status = Object.fromEntries(
    STATUS_TOKENS.map((token) => [token, readableFrom(context.status[token], sign, surfaces, strictMin)]),
  ) as StatusColors;

  return {
    "--color-void": void_,
    "--color-deep": deep,
    "--color-panel": panelHex,
    "--color-card": card,
    "--color-row": row,
    "--color-border": seeds.border.toLowerCase(),
    "--color-border-glow": fromOklch({ ...border, l: clamp01(border.l + sign * layer.glow) }),
    "--color-white": along(ladder.white, 0.3),
    "--color-bright": along(ladder.bright, 0.6),
    "--color-base": seeds.text.toLowerCase(),
    "--color-muted": towardSurface(ladder.muted),
    "--color-dim": towardSurface(ladder.dim),
    "--color-grid": rgbaOf(seeds.text, 0.04),
    "--color-green": seeds.accent.toLowerCase(),
    "--color-ready": fromOklch({ ...accent, l: clamp01(accent.l + sign * layer.ready) }),
    ...status,
  };
}

export type FailureRule =
  | "text"
  | "accent"
  | "button"
  | "graphic"
  | "status"
  | "layer"
  | "border"
  | "no-readable-text";
export type Failure = {
  rule: FailureRule;
  /** The two tokens of the pair (the same one twice when a single surface is the problem). */
  a: TokenName;
  b: TokenName;
  kind: "wcag" | "lightness";
  value: number;
  need: number;
};

/** Every pair of a palette that must hold, measured. Empty when the palette is readable. */
export function checkTokens(tokens: Tokens, options: { strict: boolean }): Failure[] {
  const failures: Failure[] = [];
  const need = options.strict ? TEXT_MIN_STRICT : TEXT_MIN;
  const wcag = (rule: FailureRule, a: TokenName, b: TokenName, min: number) => {
    const value = wcagContrast(tokens[a], tokens[b]);
    if (value < min) failures.push({ rule, a, b, kind: "wcag", value, need: min });
  };
  const gap = (rule: FailureRule, a: TokenName, b: TokenName, min: number) => {
    const value = lightnessGap(tokens[a], tokens[b]);
    if (value < min) failures.push({ rule, a, b, kind: "lightness", value, need: min });
  };

  for (const surface of SURFACE_TOKENS) {
    const best = Math.max(wcagContrast("#ffffff", tokens[surface]), wcagContrast("#000000", tokens[surface]));
    if (best < need) failures.push({ rule: "no-readable-text", a: surface, b: surface, kind: "wcag", value: best, need });
  }
  for (const text of TEXT_TOKENS) for (const surface of SURFACE_TOKENS) wcag("text", text, surface, need);
  for (const accent of ["--color-green", "--color-ready"] as const) {
    for (const surface of SURFACE_TOKENS) wcag("accent", accent, surface, need);
  }
  wcag("button", "--color-void", "--color-green", need);
  for (const surface of SURFACE_TOKENS) wcag("graphic", "--color-green", surface, GRAPHIC_MIN);
  for (const status of STATUS_TOKENS) for (const surface of SURFACE_TOKENS) wcag("status", status, surface, need);
  gap("layer", "--color-card", "--color-panel", GAP_CARD_PANEL);
  gap("layer", "--color-row", "--color-card", GAP_ROW_CARD);
  gap("layer", "--color-void", "--color-panel", GAP_VOID_PANEL);
  gap("border", "--color-border", "--color-panel", GAP_BORDER_PANEL);
  if (options.strict) wcag("border", "--color-border", "--color-panel", GRAPHIC_MIN);
  return failures;
}

/** Derive and check in one go: what the editor runs after every change. */
export function checkSeeds(seeds: Seeds, context: DeriveContext) {
  const tokens = deriveTokens(seeds, context);
  return { tokens, failures: checkTokens(tokens, { strict: context.strict }) };
}

/** The seed a token comes from, when the person can change it. */
const SEED_OF: Partial<Record<TokenName, SeedKey>> = {
  "--color-void": "background",
  "--color-deep": "panel",
  "--color-panel": "panel",
  "--color-card": "panel",
  "--color-row": "panel",
  "--color-border": "border",
  "--color-border-glow": "border",
  "--color-white": "text",
  "--color-bright": "text",
  "--color-base": "text",
  "--color-muted": "text",
  "--color-dim": "text",
  "--color-green": "accent",
  "--color-ready": "accent",
};

const sameFailure = (x: Failure, y: Failure) => x.rule === y.rule && x.a === y.a && x.b === y.b;

/**
 * Which seeds could cure a failure. A pair of two derived tokens is cured at its source, and a status colour
 * (derived from the start palette) by the surfaces it sits on. When the person's last change is one of the
 * candidates it is the only one; otherwise the foreground seeds (text, border, accent) come before the surfaces.
 */
function culprits(failure: Failure, touched?: SeedKey): SeedKey[] {
  const fromTokens = [failure.a, failure.b]
    .map((token) => SEED_OF[token])
    .filter((seed): seed is SeedKey => seed !== undefined);
  const found = fromTokens.length > 0 ? fromTokens : (["panel", "background"] as SeedKey[]);
  const unique = [...new Set(found)];
  if (failure.rule === "no-readable-text") return ["panel", "background"].filter((s) => unique.includes(s as SeedKey)) as SeedKey[];
  if (touched && unique.includes(touched)) return [touched];
  const surface = (seed: SeedKey) => seed === "background" || seed === "panel";
  return [...unique.filter((s) => !surface(s)), ...unique.filter(surface)];
}

/**
 * The seeds with the colour at fault moved, along its lightness, by the smallest step that clears this
 * failure (same pair, same rule), in the direction that costs less. Null when no lightness cures it.
 */
export function suggestFix(
  seeds: Seeds,
  context: DeriveContext,
  failure: Failure,
  touched?: SeedKey,
): Seeds | null {
  let best: { seeds: Seeds; distance: number } | null = null;
  for (const seed of culprits(failure, touched)) {
    const origin = toOklch(seeds[seed]);
    // lighter and darker are tried at each distance, nearest first: the first distance that cures wins
    search: for (let k = 1; k <= 1 / STEP; k += 1) {
      if (best && k * STEP >= best.distance) break;
      for (const sign of [1, -1]) {
        const l = origin.l + sign * k * STEP;
        if (l < 0 || l > 1) continue;
        const candidate = { ...seeds, [seed]: fromOklch({ ...origin, l } as Oklch) };
        if (candidate[seed] === seeds[seed]) continue;
        const { failures } = checkSeeds(candidate, context);
        if (!failures.some((f) => sameFailure(f, failure))) {
          best = { seeds: candidate, distance: k * STEP };
          break search;
        }
      }
    }
  }
  return best?.seeds ?? null;
}

/**
 * «Fix everything»: applies one suggestion at a time until the palette passes or nothing more can be
 * cured. Returns the seeds reached and what still fails (empty when it all passes).
 */
export function fixAll(seeds: Seeds, context: DeriveContext, touched?: SeedKey) {
  let current = seeds;
  const uncurable = new Set<string>();
  for (let round = 0; round < 12; round += 1) {
    const { failures } = checkSeeds(current, context);
    if (failures.length === 0) return { seeds: current, failures };
    // lazily: the first failure that has a cure is enough for this round
    let next: Seeds | null = null;
    for (const failure of failures) {
      const key = `${failure.rule}|${failure.a}|${failure.b}`;
      if (uncurable.has(key)) continue;
      next = suggestFix(current, context, failure, touched);
      if (next) break;
      // no lightness cures it: the search over every candidate is not repeated on each round
      uncurable.add(key);
    }
    if (!next) return { seeds: current, failures };
    current = next;
  }
  return { seeds: current, failures: checkSeeds(current, context).failures };
}
