import { describe, expect, it } from "vitest";

import type { AgentPose } from "../contract";
import { createRedrawGate, type FrameParts } from "./redraw-gate";

const pose = (over: Partial<AgentPose> = {}): AgentPose => ({
  uid: "scout-1",
  role: "scout",
  sheet: "scout_a",
  pos: { x: 100, y: 200 },
  mode: "sit",
  facing: "up",
  flipped: false,
  frame: 0,
  carrying: false,
  ...over,
});

const parts = (over: Partial<FrameParts> = {}): FrameParts => ({
  poses: [pose()],
  camera: { x: 0, y: 0, scale: 1 },
  view: { w: 800, h: 600 },
  statusesRevision: 1,
  tagsTellTime: true,
  nowSeconds: 10,
  bubbles: [],
  piles: { scout: 2, analisti: null, scorer: 0, scrittori: 0, critici: 1 },
  ...over,
});

describe("the redraw gate", () => {
  it("draws the first frame, then only the frames whose pictures differ", () => {
    const gate = createRedrawGate();
    expect(gate.dirty(parts())).toBe(true);
    expect(gate.dirty(parts())).toBe(false);
    expect(gate.dirty(parts())).toBe(false);
  });

  it("draws again for each thing a drawing reads", () => {
    const changes: Array<[string, Partial<FrameParts>]> = [
      ["a frame of the pose", { poses: [pose({ frame: 1 })] }],
      ["a step", { poses: [pose({ pos: { x: 101.2, y: 200 } })] }],
      ["a motion", { poses: [pose({ mode: "walk" })] }],
      ["the camera", { camera: { x: 4, y: 0, scale: 1 } }],
      ["the zoom", { camera: { x: 0, y: 0, scale: 1.1 } }],
      ["the view", { view: { w: 900, h: 600 } }],
      ["new statuses", { statusesRevision: 2 }],
      ["the tags' second", { nowSeconds: 11 }],
      ["a bubble", { bubbles: [{ uid: "scout-1", text: "hi", until: 5 }] }],
      ["a pile's count", { piles: { scout: 3, analisti: null, scorer: 0, scrittori: 0, critici: 1 } }],
    ];
    for (const [what, over] of changes) {
      const gate = createRedrawGate();
      gate.dirty(parts());
      expect(gate.dirty(parts(over)), what).toBe(true);
    }
  });

  it("does not wait for the second when there are no statuses: no tag counts time", () => {
    const gate = createRedrawGate();
    gate.dirty(parts({ tagsTellTime: false, nowSeconds: 10 }));
    expect(gate.dirty(parts({ tagsTellTime: false, nowSeconds: 11 }))).toBe(false);
  });

  it("draws the next frame after a reset", () => {
    const gate = createRedrawGate();
    gate.dirty(parts());
    gate.reset();
    expect(gate.dirty(parts())).toBe(true);
  });

  it("sees an agent that moved a hair, and one that left or arrived", () => {
    const gate = createRedrawGate();
    const two = [pose({ uid: "a" }), pose({ uid: "b", pos: { x: 300, y: 300 } })];
    expect(gate.dirty(parts({ poses: two }))).toBe(true);
    expect(gate.dirty(parts({ poses: [pose({ uid: "a" }), pose({ uid: "b", pos: { x: 300, y: 300 } })] }))).toBe(false);
    expect(gate.dirty(parts({ poses: [pose({ uid: "a" }), pose({ uid: "b", pos: { x: 300.2, y: 300 } })] }))).toBe(true);
    expect(gate.dirty(parts({ poses: [pose({ uid: "a" })] }))).toBe(true);
    expect(gate.dirty(parts({ poses: [pose({ uid: "a" })] }))).toBe(false);
  });

  it("sees the glow of a real transition", () => {
    const gate = createRedrawGate();
    gate.dirty(parts());
    expect(gate.dirty(parts({ poses: [pose({ pulse: 0.4 })] }))).toBe(true);
    expect(gate.dirty(parts({ poses: [pose({ pulse: 0.4 })] }))).toBe(false);
    expect(gate.dirty(parts({ poses: [pose()] }))).toBe(true);
  });
});
