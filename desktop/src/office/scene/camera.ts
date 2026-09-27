import type { Rect, Vec } from "../contract";

/**
 * The office camera: world pixels -> screen pixels as `screen = world *
 * scale + offset`. Pure, so the pan/zoom rules are tested without WebGL.
 * The rules are the Godot FreeCamera's (game/scripts/office/free_camera.gd):
 * the smallest zoom COVERS the office (no void around it, so there is always
 * something to pan along one axis), the largest is 2.8, and the view never
 * goes past the office's edges.
 */
export type Camera = { scale: number; x: number; y: number };

export const MAX_SCALE = 2.8;

/** The scale that shows the whole office in the view (letterboxed). */
export function fitScale(view: { w: number; h: number }, bounds: Rect): number {
  return Math.min(view.w / bounds.w, view.h / bounds.h);
}

/** The scale at which the office fills the view on both axes (FreeCamera._zoom_min). */
export function coverScale(view: { w: number; h: number }, bounds: Rect): number {
  return Math.max(view.w / bounds.w, view.h / bounds.h);
}

/** The whole office, centred (letterboxed). */
export function fit(view: { w: number; h: number }, bounds: Rect): Camera {
  return centred(view, bounds, fitScale(view, bounds));
}

/** The office filling the view, centred. */
export function cover(view: { w: number; h: number }, bounds: Rect): Camera {
  return centred(view, bounds, coverScale(view, bounds));
}

function centred(view: { w: number; h: number }, bounds: Rect, scale: number): Camera {
  return {
    scale,
    x: (view.w - bounds.w * scale) / 2 - bounds.x * scale,
    y: (view.h - bounds.h * scale) / 2 - bounds.y * scale,
  };
}

export function toWorld(camera: Camera, screen: Vec): Vec {
  return { x: (screen.x - camera.x) / camera.scale, y: (screen.y - camera.y) / camera.scale };
}

/**
 * Keeps the scale within [minScale, MAX_SCALE] and the office in view:
 * never past its edges, centred on an axis where it is smaller than the view.
 */
export function clamp(camera: Camera, view: { w: number; h: number }, bounds: Rect, minScale = coverScale(view, bounds)): Camera {
  const scale = Math.min(Math.max(MAX_SCALE, minScale), Math.max(minScale, camera.scale));
  const axis = (offset: number, viewLen: number, start: number, len: number) => {
    const size = len * scale;
    if (size <= viewLen) return (viewLen - size) / 2 - start * scale;
    const min = viewLen - (start + len) * scale;
    const max = -start * scale;
    return Math.min(max, Math.max(min, offset));
  };
  return { scale, x: axis(camera.x, view.w, bounds.x, bounds.w), y: axis(camera.y, view.h, bounds.y, bounds.h) };
}

/** Zooms by `factor` keeping the world point under `at` (screen pixels) where it is, as far as the edges allow. */
export function zoomAt(
  camera: Camera,
  factor: number,
  at: Vec,
  view: { w: number; h: number },
  bounds: Rect,
  minScale = coverScale(view, bounds),
): Camera {
  const anchor = toWorld(camera, at);
  const scale = Math.min(Math.max(MAX_SCALE, minScale), Math.max(minScale, camera.scale * factor));
  return clamp({ scale, x: at.x - anchor.x * scale, y: at.y - anchor.y * scale }, view, bounds, minScale);
}

/** Moves the view by `delta` screen pixels (the office follows the pointer). */
export function pan(camera: Camera, delta: Vec, view: { w: number; h: number }, bounds: Rect, minScale = coverScale(view, bounds)): Camera {
  return clamp({ ...camera, x: camera.x + delta.x, y: camera.y + delta.y }, view, bounds, minScale);
}
