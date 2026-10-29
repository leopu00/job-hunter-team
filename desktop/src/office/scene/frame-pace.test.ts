import { describe, expect, it } from "vitest";
import { OFFICE_MAX_FPS, OFFICE_MAX_RESOLUTION, pauseWhenHidden, sceneResolution, type PausableTicker } from "./frame-pace";

const ticker = (started = true): PausableTicker & { starts: number; stops: number } => {
  const t = {
    started,
    starts: 0,
    stops: 0,
    start() { t.started = true; t.starts++; },
    stop() { t.started = false; t.stops++; },
  };
  return t;
};

function page(state: "visible" | "hidden") {
  const listeners = new Set<() => void>();
  return {
    visibilityState: state,
    addEventListener: (_type: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => void listeners.delete(fn),
    show(next: "visible" | "hidden") { this.visibilityState = next; listeners.forEach((fn) => fn()); },
    count: () => listeners.size,
  };
}

describe("the office's frame pace", () => {
  it("draws at most 30 frames a second and no sharper than 1.5 device pixels per pixel", () => {
    expect(OFFICE_MAX_FPS).toBe(30);
    expect(OFFICE_MAX_RESOLUTION).toBe(1.5);
    expect([undefined, 0, -2, NaN, 1, 1.25, 1.5, 2, 3].map(sceneResolution)).toEqual([1, 1, 1, 1, 1, 1.25, 1.5, 1.5, 1.5]);
  });

  it("stops the tickers while the page is hidden and starts them again when it is shown", () => {
    const doc = page("visible");
    const own = ticker();
    const shared = ticker();
    pauseWhenHidden([own, shared], doc as never);
    expect([own.started, shared.started]).toEqual([true, true]);
    doc.show("hidden");
    expect([own.started, shared.started]).toEqual([false, false]);
    doc.show("visible");
    expect([own.started, shared.started]).toEqual([true, true]);
    expect([own.starts, own.stops]).toEqual([1, 1]);
  });

  it("is already stopped when the scene is made in a hidden page", () => {
    const doc = page("hidden");
    const own = ticker();
    pauseWhenHidden([own], doc as never);
    expect(own.started).toBe(false);
    doc.show("visible");
    expect(own.started).toBe(true);
  });

  it("never starts a ticker that was not running, and does not stop one twice", () => {
    const doc = page("visible");
    const idle = ticker(false);
    const running = ticker();
    pauseWhenHidden([idle, running], doc as never);
    doc.show("hidden");
    doc.show("hidden");
    doc.show("visible");
    expect(idle.starts + idle.stops).toBe(0);
    expect([running.starts, running.stops]).toEqual([1, 1]);
  });

  it("stops watching when told, and leaves a ticker it had stopped running", () => {
    const doc = page("visible");
    const own = ticker();
    const stop = pauseWhenHidden([own], doc as never);
    doc.show("hidden");
    stop();
    expect(own.started).toBe(true);
    expect(doc.count()).toBe(0);
    doc.show("hidden");
    expect(own.started).toBe(true);
  });
});
