import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Rect } from "../contract";
import { MAX_SCALE, coverScale, toWorld, type Camera } from "./camera";
import { attachControls, classifyWheel, DRAG_CLICK_TOLERANCE, keyDirection, PAN_SPEED, ZOOM_STEP, type Controls } from "./controls";

// The office as the layout frames it (floor + wall), and a canvas 1200x700.
const BOUNDS: Rect = { x: 240, y: 20, w: 2920, h: 1980 };
const VIEW = { w: 1200, h: 700 };
const START = { x: 1700, y: 1070 };

let el: HTMLElement;
let controls: Controls;
let seen: Camera[];

/** jsdom has no PointerEvent: a MouseEvent carrying a pointerId. */
function pointer(type: string, x: number, y: number, target: EventTarget = el) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
  Object.defineProperty(e, "pointerId", { value: 1 });
  target.dispatchEvent(e);
}

function wheel(init: WheelEventInit & { wheelDeltaY?: number; x?: number; y?: number }) {
  const e = new WheelEvent("wheel", { clientX: init.x ?? 600, clientY: init.y ?? 350, cancelable: true, ...init });
  if (init.wheelDeltaY !== undefined) Object.defineProperty(e, "wheelDeltaY", { value: init.wheelDeltaY });
  el.dispatchEvent(e);
  return e;
}

function key(type: "keydown" | "keyup", k: string) {
  window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  el = document.createElement("canvas");
  document.body.appendChild(el);
  Object.defineProperty(el, "clientWidth", { value: VIEW.w });
  Object.defineProperty(el, "clientHeight", { value: VIEW.h });
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: VIEW.w, height: VIEW.h, right: VIEW.w, bottom: VIEW.h, x: 0, y: 0, toJSON: () => ({}) });
  seen = [];
  controls = attachControls(el, { view: VIEW, bounds: BOUNDS, start: START, onChange: (c) => seen.push(c) });
});
afterEach(() => {
  controls.destroy();
  el.remove();
});

describe("the office controls", () => {
  it("start covering the view, centred on the floor, with room to pan", () => {
    const cam = controls.camera();
    expect(cam.scale).toBeCloseTo(coverScale(VIEW, BOUNDS));
    expect(seen).toHaveLength(1);
    const centre = toWorld(cam, { x: 600, y: 350 });
    expect(centre.x).toBeCloseTo(START.x, 0);
  });

  it("a drag pans the office with the pointer", () => {
    const before = controls.camera();
    // home is at the bottom edge here (the floor's centre is low in the
    // bounds, which include the wall): dragging down reveals the wall
    pointer("pointerdown", 600, 350);
    pointer("pointermove", 600, 370, window);
    pointer("pointermove", 600, 400, window);
    expect(controls.dragging()).toBe(true);
    expect(controls.camera().y).toBeCloseTo(before.y + 50);
    pointer("pointerup", 600, 400, window);
  });

  it("a press that barely moves is a click, not a drag", () => {
    const before = controls.camera();
    pointer("pointerdown", 600, 350);
    pointer("pointermove", 605, 352, window);
    pointer("pointerup", 605, 352, window);
    expect(controls.dragging()).toBe(false);
    expect(controls.camera()).toEqual(before);
    expect(DRAG_CLICK_TOLERANCE).toBe(14);
  });

  it("a drag stays a drag for the taps of its own release, then ends", async () => {
    pointer("pointerdown", 600, 350);
    pointer("pointermove", 600, 300, window);
    pointer("pointerup", 600, 300, window);
    expect(controls.dragging()).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(controls.dragging()).toBe(false);
  });

  it("the mouse wheel zooms one step towards the pointer, and is kept from the page", () => {
    const before = controls.camera();
    const anchor = toWorld(before, { x: 300, y: 200 });
    const e = wheel({ deltaY: -100, wheelDeltaY: 120, x: 300, y: 200 });
    expect(e.defaultPrevented).toBe(true);
    expect(controls.camera().scale).toBeCloseTo(before.scale * ZOOM_STEP);
    const after = toWorld(controls.camera(), { x: 300, y: 200 });
    expect(after.x).toBeCloseTo(anchor.x);
    expect(after.y).toBeCloseTo(anchor.y);
  });

  it("a trackpad's two-finger scroll pans, a pinch (ctrl+wheel) zooms", () => {
    const before = controls.camera();
    wheel({ deltaY: -40, wheelDeltaY: 120 });
    expect(controls.camera().scale).toBe(before.scale);
    expect(controls.camera().y).toBeCloseTo(before.y + 40);
    wheel({ deltaY: -30, ctrlKey: true });
    expect(controls.camera().scale).toBeGreaterThan(before.scale);
  });

  it("the WKWebView pinch (gesture events) zooms by the change in scale", () => {
    const before = controls.camera().scale;
    const gesture = (type: string, scale: number) => {
      const e = new Event(type, { cancelable: true });
      Object.assign(e, { scale, clientX: 600, clientY: 350 });
      el.dispatchEvent(e);
      return e;
    };
    expect(gesture("gesturestart", 1).defaultPrevented).toBe(true);
    gesture("gesturechange", 1.5);
    gesture("gesturechange", 2);
    expect(controls.camera().scale).toBeCloseTo(before * 2);
  });

  it("never zooms past 2.8 nor out past covering the view", () => {
    for (let i = 0; i < 60; i++) wheel({ deltaY: -100, wheelDeltaY: 120 });
    expect(controls.camera().scale).toBe(MAX_SCALE);
    for (let i = 0; i < 60; i++) wheel({ deltaY: 100, wheelDeltaY: -120 });
    expect(controls.camera().scale).toBeCloseTo(coverScale(VIEW, BOUNDS));
  });

  it("WASD and the arrows pan while held, + and - zoom, 0 goes home", () => {
    const home = controls.camera();
    key("keydown", "w");
    controls.step(0.1);
    key("keyup", "w");
    controls.step(0.1);
    expect(controls.camera().y).toBeCloseTo(home.y + PAN_SPEED * 0.1 * home.scale);
    key("keydown", "+");
    expect(controls.camera().scale).toBeCloseTo(home.scale * ZOOM_STEP);
    key("keydown", "0");
    expect(controls.camera()).toEqual(home);
  });

  it("a double click goes home", () => {
    const home = controls.camera();
    wheel({ deltaY: -100, wheelDeltaY: 120 });
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(controls.camera()).toEqual(home);
  });

  it("keys typed in a text field do not move the office", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const before = controls.camera();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "w", bubbles: true }));
    controls.step(0.5);
    expect(controls.camera()).toEqual(before);
    input.remove();
  });

  it("after destroy nothing moves it", () => {
    const before = controls.camera();
    controls.destroy();
    wheel({ deltaY: -100, wheelDeltaY: 120 });
    expect(controls.camera()).toEqual(before);
  });
});

describe("classifyWheel", () => {
  it("tells a mouse wheel, a trackpad scroll and a pinch apart", () => {
    expect(classifyWheel({ ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: 100, wheelDeltaY: -120 })).toBe("zoom");
    expect(classifyWheel({ ctrlKey: false, deltaMode: 1, deltaX: 0, deltaY: 3 })).toBe("zoom");
    expect(classifyWheel({ ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: 12, wheelDeltaY: -36 })).toBe("pan");
    expect(classifyWheel({ ctrlKey: false, deltaMode: 0, deltaX: 4, deltaY: 0 })).toBe("pan");
    expect(classifyWheel({ ctrlKey: true, deltaMode: 0, deltaX: 0, deltaY: 5 })).toBe("pinch");
  });

  it("keys: WASD and arrows, opposite keys cancel", () => {
    expect(keyDirection(new Set(["w", "arrowright"]))).toEqual({ x: 1, y: -1 });
    expect(keyDirection(new Set(["a", "d"]))).toEqual({ x: 0, y: 0 });
  });
});
