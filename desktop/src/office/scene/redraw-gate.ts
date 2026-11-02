import type { AgentPose, Bubble, Piles } from "../contract";

/**
 * What decides whether the agents, bubbles, tags and piles are drawn again
 * this frame. The office ticks at up to 30 frames a second, but most of what
 * it shows changes far more rarely: agents sitting still, a seated one typing
 * at 8 frames a second, piles that hold their count. Redrawing everything
 * every frame (sprites, shadows, tags laid out against each other) was most
 * of the scene's own work at rest. The gate draws again only when something
 * a drawing reads has changed: a pose (position, motion, frame, glow), the
 * camera or the view, the statuses, a bubble, a pile's count, or the second
 * the tags' countdowns tell. It compares field by field against what it saw
 * last, without building a string per frame.
 */

export type FrameParts = {
  poses: readonly AgentPose[];
  camera: { x: number; y: number; scale: number };
  view: { w: number; h: number };
  /** counts up with every statuses update the scene gets */
  statusesRevision: number;
  /** true while there are statuses: the tags' "until" times tell the second */
  tagsTellTime: boolean;
  nowSeconds: number;
  bubbles: readonly Bubble[];
  piles: Piles;
};

type Seen = {
  uid: string;
  sheet: string;
  x: number;
  y: number;
  mode: string;
  facing: string;
  flipped: boolean;
  frame: number;
  carrying: boolean;
  seatedAt: string | undefined;
  pulse: number | undefined;
};

export type RedrawGate = {
  /** true when this frame must be drawn: something differs from the last frame seen */
  dirty(parts: FrameParts): boolean;
  /** forget the last drawing (the scene was rebuilt: draw the next frame) */
  reset(): void;
};

const PILES = ["scout", "analisti", "scorer", "scrittori", "critici"] as const;

export function createRedrawGate(): RedrawGate {
  let first = true;
  let seen: Seen[] = [];
  let cam = { x: NaN, y: NaN, scale: NaN };
  let view = { w: NaN, h: NaN };
  let revision = NaN;
  let second = NaN;
  let bubbleKey = "";
  const piles: Array<number | null> = [NaN, NaN, NaN, NaN, NaN];

  return {
    dirty(p) {
      let changed = first;
      first = false;
      // the poses: compared and remembered in the same pass
      if (seen.length !== p.poses.length) {
        changed = true;
        seen = p.poses.map(copyPose);
      } else {
        for (let i = 0; i < seen.length; i++) {
          const a = seen[i]!;
          const b = p.poses[i]!;
          if (
            a.uid !== b.uid ||
            a.x !== b.pos.x ||
            a.y !== b.pos.y ||
            a.frame !== b.frame ||
            a.mode !== b.mode ||
            a.facing !== b.facing ||
            a.flipped !== b.flipped ||
            a.carrying !== b.carrying ||
            a.sheet !== b.sheet ||
            a.seatedAt !== b.seatedAt ||
            a.pulse !== b.pulse
          ) {
            changed = true;
            seen[i] = copyPose(b);
          }
        }
      }
      if (cam.x !== p.camera.x || cam.y !== p.camera.y || cam.scale !== p.camera.scale) {
        changed = true;
        cam = { x: p.camera.x, y: p.camera.y, scale: p.camera.scale };
      }
      if (view.w !== p.view.w || view.h !== p.view.h) {
        changed = true;
        view = { w: p.view.w, h: p.view.h };
      }
      if (revision !== p.statusesRevision) {
        changed = true;
        revision = p.statusesRevision;
      }
      const sec = p.tagsTellTime ? p.nowSeconds : -1;
      if (second !== sec) {
        changed = true;
        second = sec;
      }
      let bubbles = "";
      for (const b of p.bubbles) bubbles += `${b.uid}:${b.text}|`;
      if (bubbles !== bubbleKey) {
        changed = true;
        bubbleKey = bubbles;
      }
      PILES.forEach((d, i) => {
        if (piles[i] !== p.piles[d]) {
          changed = true;
          piles[i] = p.piles[d];
        }
      });
      return changed;
    },
    reset() {
      first = true;
    },
  };
}

function copyPose(p: AgentPose): Seen {
  return {
    uid: p.uid,
    sheet: p.sheet,
    x: p.pos.x,
    y: p.pos.y,
    mode: p.mode,
    facing: p.facing,
    flipped: p.flipped,
    frame: p.frame,
    carrying: p.carrying,
    seatedAt: p.seatedAt,
    pulse: p.pulse,
  };
}
