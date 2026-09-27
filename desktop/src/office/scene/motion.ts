/**
 * prefers-reduced-motion for the office's lights and effects (D08): with it
 * the grain stands still, the box's edges stop pulsing, the hologram and
 * the printer are drawn once and hold. The agents still walk: where they go
 * is the team's data, not decoration. Pure, so the rule is tested without
 * WebGL; the scene asks it every frame.
 */

/** The instant the still effects are drawn at: the edges half lit. */
export const STILL_CLOCK = 0.6;

/** A 20 Hz hologram, a grain that moves 9 times a second (Godot's). */
const HOLO_EVERY = 0.05;
const GRAIN_EVERY = 1 / 9;

export type EffectsClock = { clock: number; grain: number; holo: number; stillDrawn: boolean };

export const START_EFFECTS: EffectsClock = { clock: 0, grain: 0, holo: HOLO_EVERY, stillDrawn: false };

export type EffectsFrame = {
  next: EffectsClock;
  /** the time the effects are drawn at this frame */
  t: number;
  moveGrain: boolean;
  redrawHologram: boolean;
  /** false = the printer holds still even when someone prints */
  animatePrinter: boolean;
};

export function advanceEffects(c: EffectsClock, dt: number, reduced: boolean): EffectsFrame {
  if (reduced) {
    return { next: { ...c, stillDrawn: true }, t: STILL_CLOCK, moveGrain: false, redrawHologram: !c.stillDrawn, animatePrinter: false };
  }
  const grain = c.grain + dt;
  const holo = c.holo + dt;
  const moveGrain = grain > GRAIN_EVERY;
  const redrawHologram = holo >= HOLO_EVERY;
  const clock = c.clock + dt;
  return {
    next: { clock, grain: moveGrain ? 0 : grain, holo: redrawHologram ? 0 : holo, stillDrawn: false },
    t: clock,
    moveGrain,
    redrawHologram,
    animatePrinter: true,
  };
}

/** Whether the system asks for less motion; follows the setting while the office is open. */
export function watchReducedMotion(onChange: (reduced: boolean) => void, win: Pick<Window, "matchMedia"> = window): { reduced: () => boolean; stop: () => void } {
  const query = typeof win.matchMedia === "function" ? win.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reduced = Boolean(query?.matches);
  const listener = (e: { matches: boolean }) => {
    reduced = e.matches;
    onChange(reduced);
  };
  query?.addEventListener?.("change", listener);
  return { reduced: () => reduced, stop: () => query?.removeEventListener?.("change", listener) };
}
