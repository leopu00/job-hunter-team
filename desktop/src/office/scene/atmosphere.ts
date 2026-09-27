import type { Rect, Vec } from "../contract";

/**
 * The office's light, ported from the Godot game:
 *   day_night.gd   the tint of the whole scene by the user's LOCAL hour
 *                  (day 9-17, night 21-5, dawn and dusk in between), the
 *                  band outside the box, the lamps that light up in the
 *                  dark and the daylight through the glass by day;
 *   light_pool.gd  each light: an additive radial gradient, squashed;
 *   screen_grade.gd the painting's vignette and grain over the frame.
 * The numbers are the game's. Pure data and maths here; pixi-scene.ts draws.
 */

export type Rgb = { r: number; g: number; b: number };

const hex = (h: string): Rgb => ({
  r: parseInt(h.slice(1, 3), 16) / 255,
  g: parseInt(h.slice(3, 5), 16) / 255,
  b: parseInt(h.slice(5, 7), 16) / 255,
});

export const DAY_CM: Rgb = { r: 0.98, g: 0.98, b: 1.0 };
export const NIGHT_CM: Rgb = { r: 0.6, g: 0.63, b: 0.84 };
export const NIGHT_LAMP_BOOST = 2;
export const DAY_OUT = hex("#3d4453");
export const NIGHT_OUT = hex("#060608");
const WARM = hex("#ffb45c");
const COOL = hex("#4d9fff");
const MINT = hex("#7fffb2");
const DAYLIGHT = hex("#cfe4ff");

/** A light pool: centre, radius, colour, base alpha, vertical squash. */
export type Pool = { pos: Vec; radius: number; color: Rgb; alpha: number; squash: number };

/** DayNight.LAMPS: lit in the dark. */
export const LAMPS: Pool[] = (
  [
    [2640, 1170, 280, WARM, 0.2], // the Mentor's lounge rug
    [2860, 1010, 210, WARM, 0.13], // the common area's bookshelf
    [1265, 225, 230, COOL, 0.13], // the shared printer
    [1495, 515, 250, WARM, 0.17], // the Coordinator's desk
    [1905, 560, 270, MINT, 0.14], // the Treasurer's multi-screen desk
    [1295, 1790, 250, WARM, 0.15], // the Assistant's desk (entrance)
    [775, 560, 300, WARM, 0.15], // Scout, north-west
    [2115, 430, 280, MINT, 0.12], // the Analysts' lab (cold light)
    [1455, 1172, 290, WARM, 0.15], // Scorer, centre
    [670, 1680, 290, WARM, 0.15], // Writers
    [2080, 1680, 290, WARM, 0.15], // Critics
    [1300, 780, 330, MINT, 0.13], // the hologram
  ] as const
).map(([x, y, radius, color, alpha]) => ({ pos: { x, y }, radius, color, alpha, squash: 0.55 }));

/** The box's perimeter neon (stays on in the dark) and the daylight through the glass. */
export function boxLights(floor: Rect): { neon: Pool[]; daylight: Pool[] } {
  const cx = floor.x + floor.w / 2;
  const cy = floor.y + floor.h / 2;
  return {
    neon: [
      { pos: { x: cx, y: floor.y }, radius: 1150, color: COOL, alpha: 0.05, squash: 0.1 },
      { pos: { x: cx, y: floor.y + floor.h }, radius: 1150, color: COOL, alpha: 0.05, squash: 0.1 },
    ],
    daylight: [
      { pos: { x: cx, y: floor.y + 60 }, radius: 1250, color: DAYLIGHT, alpha: 0.1, squash: 0.35 },
      { pos: { x: floor.x + 40, y: cy }, radius: 700, color: DAYLIGHT, alpha: 0.07, squash: 0.9 },
      { pos: { x: floor.x + floor.w - 40, y: cy }, radius: 700, color: DAYLIGHT, alpha: 0.07, squash: 0.9 },
    ],
  };
}

/** DayNight.darkness(): 0 = full day, 1 = deep night, from the local hour (with minutes). */
export function darkness(hour: number): number {
  if (hour >= 21 || hour < 5) return 1;
  if (hour >= 9 && hour < 17) return 0;
  if (hour < 9) return 1 - (hour - 5) / 4; // dawn
  return (hour - 17) / 4; // dusk
}

export function localHour(now: Date = new Date()): number {
  return now.getHours() + now.getMinutes() / 60;
}

export function lerp(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

export function toHex(c: Rgb): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (ch(c.r) << 16) | (ch(c.g) << 8) | ch(c.b);
}

/** Everything the light depends on, for one darkness value. */
export function lighting(d: number) {
  return {
    /** the CanvasModulate: multiplies the whole world */
    tint: toHex(lerp(DAY_CM, NIGHT_CM, d)),
    /** outside the box */
    outside: toHex(lerp(DAY_OUT, NIGHT_OUT, d)),
    /** a lamp's alpha is its base x this (and it is hidden under 0.03) */
    lampFactor: d > 0.03 ? d * NIGHT_LAMP_BOOST : 0,
    /** a daylight pool's alpha is its base x this (hidden over 0.97) */
    dayFactor: d < 0.97 ? 1 - d : 0,
  };
}

/** The four bands between the world's edge and the floor (DayNight._draw). */
export function outsideBands(world: Rect, floor: Rect): Rect[] {
  return [
    { x: world.x, y: world.y, w: world.w, h: floor.y - world.y },
    { x: world.x, y: floor.y + floor.h, w: world.w, h: world.y + world.h - (floor.y + floor.h) },
    { x: world.x, y: floor.y, w: floor.x - world.x, h: floor.h },
    { x: floor.x + floor.w, y: floor.y, w: world.x + world.w - (floor.x + floor.w), h: floor.h },
  ];
}

/** ScreenGrade's vignette alpha at a point of the frame (uv in 0..1): smoothstep(0.38, 0.92, d) x 0.95. */
export function vignetteAlpha(u: number, v: number): number {
  const d = Math.hypot(u - 0.5, v - 0.46);
  const t = Math.min(1, Math.max(0, (d - 0.38) / (0.92 - 0.38)));
  return t * t * (3 - 2 * t) * 0.95;
}

export const GRAIN_AMOUNT = 0.045;
