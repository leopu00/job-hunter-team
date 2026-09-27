import type { AgentPose, Rect, Vec } from "../contract";

/**
 * The office's small machines, ported from the Godot game. Pure maths here;
 * pixi-scene.ts draws. They react to the engine's real poses, not to
 * events of their own: the printer works while an agent stands at it
 * (printer_fx.gd, pinged by the Scout's stop there), the door slides open
 * while someone passes through it (exit_door.gd).
 */

// ─── tesseract_edges.gd ──────────────────────────────────────────────────

export const TESSERACT = { blue: 0x4d9eff, cyan: 0x73d9ff, rayLen: 360, riseLen: 480, aRoot: 0.3, steps: 9 } as const;

export type RaySegment = { from: Vec; to: Vec; alpha: number; color: number };

/**
 * The box's edges: from each corner of the floor two rays along its sides
 * and one rising edge, each fading towards its tip (alpha aRoot x (1 - t)^1.7).
 * One segment per step, with the alpha of its start.
 */
export function tesseractRays(floor: Rect): RaySegment[] {
  const { blue, cyan, rayLen, riseLen, aRoot, steps } = TESSERACT;
  const r = floor.x + floor.w;
  const b = floor.y + floor.h;
  const corners: Array<{ pos: Vec; dirs: Vec[] }> = [
    { pos: { x: floor.x, y: floor.y }, dirs: [{ x: 1, y: 0 }, { x: 0, y: 1 }] },
    { pos: { x: r, y: floor.y }, dirs: [{ x: -1, y: 0 }, { x: 0, y: 1 }] },
    { pos: { x: r, y: b }, dirs: [{ x: -1, y: 0 }, { x: 0, y: -1 }] },
    { pos: { x: floor.x, y: b }, dirs: [{ x: 1, y: 0 }, { x: 0, y: -1 }] },
  ];
  const out: RaySegment[] = [];
  const ray = (from: Vec, dir: Vec, length: number, color: number, pulse: number) => {
    for (let i = 0; i < steps - 1; i++) {
      const t0 = i / (steps - 1);
      const t1 = (i + 1) / (steps - 1);
      out.push({
        from: { x: from.x + dir.x * length * t0, y: from.y + dir.y * length * t0 },
        to: { x: from.x + dir.x * length * t1, y: from.y + dir.y * length * t1 },
        alpha: aRoot * Math.pow(1 - t0, 1.7) * pulse,
        color,
      });
    }
  };
  for (const c of corners) {
    for (const d of c.dirs) ray(c.pos, d, rayLen, blue, 1);
    ray(c.pos, { x: 0, y: -1 }, riseLen, cyan, 0.9);
  }
  return out;
}

/** The edges' slow pulse (self_modulate.a). */
export function tesseractPulse(t: number): number {
  return 0.8 + 0.2 * Math.sin(t * 1.4);
}

// ─── hologram.gd ─────────────────────────────────────────────────────────

/** The globe's three meridians: their horizontal squash at time t, and the beat. */
export function hologramFrame(t: number): { squash: number[]; pulse: number } {
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
  const squash = [0, 1, 2].map((k) => {
    const phase = (t * 0.5 + k / 3) % 1;
    return Math.abs(Math.cos(phase * Math.PI)) * 0.95 + 0.05;
  });
  return { squash, pulse };
}

/** Where the painted globe's centre is and its radius, for a hologram drawn on `rect` (textured case). */
export function hologramGlobe(rect: Rect): { centre: Vec; radius: number } {
  const w = rect.w;
  return { centre: { x: rect.x + w / 2, y: rect.y + rect.h - ((w * 1.06) / 520) * 640 * 0.62 }, radius: w * 0.3 };
}

// ─── printer_fx.gd and exit_door.gd ─────────────────────────────────────

/** An agent standing (not walking) within `radius` of `spot`. */
export function someoneStandsAt(poses: AgentPose[], spot: Vec, radius: number): boolean {
  return poses.some((p) => p.mode !== "walk" && p.mode !== "carry" && Math.hypot(p.pos.x - spot.x, p.pos.y - spot.y) <= radius);
}

/** Anyone within `radius` of `spot`, walking or not. */
export function someoneNear(poses: AgentPose[], spot: Vec, radius: number): boolean {
  return poses.some((p) => Math.hypot(p.pos.x - spot.x, p.pos.y - spot.y) <= radius);
}

/** PrinterFx._draw at time t: the LED on or dimmed, and how far the new sheet is out (0..1). */
export function printerFrame(t: number): { ledOn: boolean; sheet: number } {
  const k = (t % 1.2) / 1.2;
  return { ledOn: t % 0.5 < 0.3, sheet: Math.min(1, k * 1.5) };
}

/** ExitDoor: open moves towards 1 while held, back to 0 after, 3.5 per second. */
export function doorStep(open: number, wantOpen: boolean, dt: number): number {
  const target = wantOpen ? 1 : 0;
  const step = dt * 3.5;
  return open < target ? Math.min(target, open + step) : Math.max(target, open - step);
}

/** The door's leaves, relative to its centre, for an opening 0..1 (W 150, posts 10). */
export function doorLeaves(open: number): Rect[] {
  const W = 150;
  const POST = 10;
  const half = W / 2;
  const leaf = half - POST / 2;
  const slide = open * leaf;
  return [-1, 1].map((sx) => {
    const x0 = (sx * POST) / 2 + sx * slide;
    const w = Math.max(2, leaf - slide);
    return { x: Math.min(x0, x0 + sx * (leaf - slide)), y: -58, w, h: 52 };
  });
}
