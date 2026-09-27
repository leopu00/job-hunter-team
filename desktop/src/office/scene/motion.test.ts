import { describe, expect, it, vi } from "vitest";
import { advanceEffects, START_EFFECTS, STILL_CLOCK, watchReducedMotion } from "./motion";

describe("the office's lights and effects, and prefers-reduced-motion (D08)", () => {
  it("normally: the grain moves 9 times a second, the hologram redraws at 20 Hz, time runs", () => {
    let c = START_EFFECTS;
    let grain = 0;
    let holo = 0;
    for (let i = 0; i < 60; i++) {
      const f = advanceEffects(c, 1 / 60, false);
      c = f.next;
      if (f.moveGrain) grain++;
      if (f.redrawHologram) holo++;
      expect(f.animatePrinter).toBe(true);
    }
    expect(grain).toBeGreaterThanOrEqual(8);
    expect(holo).toBeGreaterThanOrEqual(19);
    expect(c.clock).toBeCloseTo(1);
  });

  it("with reduced motion nothing moves: a still instant, the hologram drawn once, no grain, no printing", () => {
    let c = START_EFFECTS;
    const frames = [];
    for (let i = 0; i < 60; i++) {
      const f = advanceEffects(c, 1 / 60, true);
      c = f.next;
      frames.push(f);
    }
    expect(frames.every((f) => f.t === STILL_CLOCK && !f.moveGrain && !f.animatePrinter)).toBe(true);
    expect(frames.filter((f) => f.redrawHologram)).toHaveLength(1);
  });

  it("follows the system setting while the office is open", () => {
    const listeners: Array<(e: { matches: boolean }) => void> = [];
    const query = { matches: true, addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.push(l), removeEventListener: vi.fn() };
    const onChange = vi.fn();
    const w = watchReducedMotion(onChange, { matchMedia: vi.fn(() => query) } as unknown as Window);
    expect(w.reduced()).toBe(true);
    listeners[0]!({ matches: false });
    expect(w.reduced()).toBe(false);
    expect(onChange).toHaveBeenCalledWith(false);
    w.stop();
    expect(query.removeEventListener).toHaveBeenCalled();
  });

  it("without matchMedia it is not reduced", () => {
    expect(watchReducedMotion(() => {}, {} as Window).reduced()).toBe(false);
  });
});
