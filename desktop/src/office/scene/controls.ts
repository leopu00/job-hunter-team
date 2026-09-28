import type { Rect, Vec } from "../contract";
import { clamp, cover, pan, zoomAt, type Camera } from "./camera";

/**
 * How the user moves around the office, as in the Godot game
 * (game/scripts/office/free_camera.gd):
 *   drag with the mouse or one finger     pan
 *   two-finger scroll on a trackpad       pan
 *   pinch on a trackpad                   zoom towards the pointer
 *   mouse wheel                           zoom towards the pointer, 1.12 a notch
 *   W A S D / arrows                      pan, 1100 world px/s
 *   + / -                                 zoom towards the centre
 *   double click, 0 or Home               back to the starting view
 * Keys typed in a text field, or inside an element marked OWN_KEYS_ATTR (the
 * panel, whose list the arrows scroll), are not the camera's.
 * A press that travels less than DRAG_CLICK_TOLERANCE is a click (a tap on
 * a trackpad travels a few pixels), anything longer a drag: while a drag is
 * on, `dragging()` says so and the scene ignores the taps it would fire.
 *
 * Plain DOM listeners on the canvas, no PixiJS: the same code in Chromium
 * and WKWebView (whose pinch arrives as Safari's gesture events, not as a
 * ctrl+wheel), and testable in jsdom. Positions are in the element's CSS
 * pixels, what the Pixi screen uses, whatever CSS zoom the page wears.
 */

export const ZOOM_STEP = 1.12;
export const DRAG_CLICK_TOLERANCE = 14;
export const PAN_SPEED = 1100;
/** On an element whose keys are its own: the camera ignores the keys pressed inside it. */
export const OWN_KEYS_ATTR = "data-office-own-keys";

export type WheelKind = "zoom" | "pinch" | "pan";

/**
 * What a wheel event is. Chromium turns a pinch into a ctrl+wheel; a
 * trackpad's two-finger scroll is a pixel wheel whose legacy wheelDeltaY is
 * -3 x deltaY (or that moves sideways too); a mouse wheel is the rest.
 */
export function classifyWheel(e: Pick<WheelEvent, "ctrlKey" | "deltaMode" | "deltaX" | "deltaY"> & { wheelDeltaY?: number }): WheelKind {
  if (e.ctrlKey) return "pinch";
  if (e.deltaMode !== 0) return "zoom";
  if (e.deltaX !== 0) return "pan";
  if (typeof e.wheelDeltaY === "number" && e.wheelDeltaY !== 0 && Math.abs(e.wheelDeltaY + 3 * e.deltaY) < 1) return "pan";
  return "zoom";
}

/** The pan direction of the keys held down, WASD and arrows. */
export function keyDirection(held: ReadonlySet<string>): Vec {
  const x = (held.has("d") || held.has("arrowright") ? 1 : 0) - (held.has("a") || held.has("arrowleft") ? 1 : 0);
  const y = (held.has("s") || held.has("arrowdown") ? 1 : 0) - (held.has("w") || held.has("arrowup") ? 1 : 0);
  return { x, y };
}

const PAN_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]);

/** A pointer's position in the element's CSS pixels (the Pixi screen's), whatever CSS zoom the page wears. */
export function elementPoint(el: HTMLElement, e: { clientX: number; clientY: number }): Vec {
  const box = el.getBoundingClientRect();
  const kx = box.width > 0 ? el.clientWidth / box.width : 1;
  const ky = box.height > 0 ? el.clientHeight / box.height : 1;
  return { x: (e.clientX - box.left) * kx, y: (e.clientY - box.top) * ky };
}

export type Controls = {
  camera(): Camera;
  /** true from the moment a press becomes a drag until just after it ends */
  dragging(): boolean;
  /** advances the key pan by `dt` seconds (the scene calls it every frame) */
  step(dt: number): void;
  resize(view: { w: number; h: number }): void;
  reset(): void;
  /** centres the view on a world point at the current zoom, within the edges (the keyboard's focus) */
  lookAt(world: Vec): void;
  destroy(): void;
};

export function attachControls(
  el: HTMLElement,
  options: { view: { w: number; h: number }; bounds: Rect; start: Vec; onChange: (camera: Camera) => void },
): Controls {
  const { bounds, onChange } = options;
  let view = options.view;
  const home = () => {
    const c = cover(view, bounds);
    // centred on `start` (the floor's centre, as Godot), within the bounds
    return clamp({ scale: c.scale, x: view.w / 2 - options.start.x * c.scale, y: view.h / 2 - options.start.y * c.scale }, view, bounds, c.scale);
  };
  const minScale = () => cover(view, bounds).scale;
  let camera = home();
  const set = (next: Camera) => {
    camera = next;
    onChange(camera);
  };
  set(camera);

  const local = (e: { clientX: number; clientY: number }): Vec => elementPoint(el, e);
  const zoom = (factor: number, at: Vec) => set(zoomAt(camera, factor, at, view, bounds, minScale()));
  const panBy = (delta: Vec) => set(pan(camera, delta, view, bounds, minScale()));

  // Drag.
  let press: { id: number; last: Vec; travel: number } | null = null;
  let dragging = false;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || press) return;
    press = { id: e.pointerId, last: local(e), travel: 0 };
  };
  const onMove = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    const now = local(e);
    const d = { x: now.x - press.last.x, y: now.y - press.last.y };
    press.travel += Math.hypot(d.x, d.y);
    press.last = now;
    if (!dragging && press.travel >= DRAG_CLICK_TOLERANCE) dragging = true;
    if (dragging) panBy(d);
  };
  const onUp = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    press = null;
    // the taps of this same release run first, and still see the drag
    if (dragging) setTimeout(() => (dragging = false), 0);
  };

  // Wheel: mouse zoom, trackpad pan, Chromium pinch.
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const at = local(e);
    const kind = classifyWheel(e as WheelEvent & { wheelDeltaY?: number });
    if (kind === "pan") panBy({ x: -e.deltaX, y: -e.deltaY });
    else if (kind === "pinch") zoom(Math.exp(-e.deltaY * 0.01), at);
    else zoom(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, at);
  };

  // Safari / WKWebView pinch: gesture events with a cumulative scale.
  let gestureScale = 1;
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    gestureScale = 1;
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    const g = e as Event & { scale: number; clientX: number; clientY: number };
    if (!(g.scale > 0)) return;
    zoom(g.scale / gestureScale, local(g));
    gestureScale = g.scale;
  };

  // Keys: held for the pan, pressed for zoom and home.
  const held = new Set<string>();
  const notTheCameras = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest?.(`[${OWN_KEYS_ATTR}]`));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (notTheCameras(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (PAN_KEYS.has(key)) {
      held.add(key);
      e.preventDefault();
    } else if (key === "+" || key === "=") zoom(ZOOM_STEP, { x: view.w / 2, y: view.h / 2 });
    else if (key === "-" || key === "_") zoom(1 / ZOOM_STEP, { x: view.w / 2, y: view.h / 2 });
    else if (key === "0" || key === "home") set(home());
  };
  const onKeyUp = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());
  const onBlur = () => held.clear();
  const onDblClick = () => set(home());

  el.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("gesturestart", onGestureStart);
  el.addEventListener("gesturechange", onGestureChange);
  el.addEventListener("dblclick", onDblClick);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    camera: () => camera,
    dragging: () => dragging,
    step(dt) {
      const dir = keyDirection(held);
      if (dir.x === 0 && dir.y === 0) return;
      const len = Math.hypot(dir.x, dir.y);
      // world px/s, so on screen it goes faster the closer you are (as Godot)
      const px = PAN_SPEED * dt * camera.scale;
      panBy({ x: (-dir.x / len) * px, y: (-dir.y / len) * px });
    },
    resize(next) {
      view = next;
      set(clamp(camera, view, bounds, minScale()));
    },
    reset: () => set(home()),
    lookAt: (p: Vec) =>
      set(clamp({ scale: camera.scale, x: view.w / 2 - p.x * camera.scale, y: view.h / 2 - p.y * camera.scale }, view, bounds, minScale())),
    destroy() {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("dblclick", onDblClick);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    },
  };
}
