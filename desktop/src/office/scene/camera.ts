import type { Rect, Vec } from "../contract";

/**
 * The office camera: world pixels -> screen pixels as `screen = world *
 * scale + offset`. Pure, so the pan/zoom rules are tested without WebGL.
 * The rules follow the Godot FreeCamera (game/scripts/office/free_camera.gd):
 * zoom around the pointer, never so far out that the floor is smaller than
 * the view, never past the floor's edges by more than a margin.
 */
export type Camera = { scale: number; x: number; y: number };

export const MAX_SCALE = 2;
/** how much of the view may show beyond the floor, in screen pixels */
export const EDGE_MARGIN = 80;

/** The scale that shows the whole floor in the view. */
export function fitScale(view: { w: number; h: number }, floor: Rect): number {
  return Math.min(view.w / floor.w, view.h / floor.h);
}

/** The whole floor, centred. */
export function fit(view: { w: number; h: number }, floor: Rect): Camera {
  const scale = fitScale(view, floor);
  return {
    scale,
    x: (view.w - floor.w * scale) / 2 - floor.x * scale,
    y: (view.h - floor.h * scale) / 2 - floor.y * scale,
  };
}

export function toWorld(camera: Camera, screen: Vec): Vec {
  return { x: (screen.x - camera.x) / camera.scale, y: (screen.y - camera.y) / camera.scale };
}

/** Keeps the floor in view: centred on an axis where it is smaller than the view, within the margin otherwise. */
export function clamp(camera: Camera, view: { w: number; h: number }, floor: Rect): Camera {
  const scale = Math.min(MAX_SCALE, Math.max(fitScale(view, floor), camera.scale));
  const axis = (offset: number, viewLen: number, start: number, len: number) => {
    const size = len * scale;
    if (size <= viewLen) return (viewLen - size) / 2 - start * scale;
    const min = viewLen - (start + len) * scale - EDGE_MARGIN;
    const max = -start * scale + EDGE_MARGIN;
    return Math.min(max, Math.max(min, offset));
  };
  return { scale, x: axis(camera.x, view.w, floor.x, floor.w), y: axis(camera.y, view.h, floor.y, floor.h) };
}

/** Zooms by `factor` keeping the world point under `at` (screen pixels) where it is. */
export function zoomAt(camera: Camera, factor: number, at: Vec, view: { w: number; h: number }, floor: Rect): Camera {
  const anchor = toWorld(camera, at);
  const scale = Math.min(MAX_SCALE, Math.max(fitScale(view, floor), camera.scale * factor));
  return clamp({ scale, x: at.x - anchor.x * scale, y: at.y - anchor.y * scale }, view, floor);
}

export function pan(camera: Camera, delta: Vec, view: { w: number; h: number }, floor: Rect): Camera {
  return clamp({ ...camera, x: camera.x + delta.x, y: camera.y + delta.y }, view, floor);
}
