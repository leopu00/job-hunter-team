import { describe, expect, it } from "vitest";

import type { AgentPose, CharacterSheet, OfficeEngine, PositionTag } from "../contract";
import { createOfficeEngine } from "./engine";
import { seeded, smallOffice } from "./fixture.test-helpers";

const TAG: PositionTag = { id: null, legacyId: 60, title: "Engineer", company: "Acme" };

function pose(engine: OfficeEngine, uid: string): AgentPose {
  const p = engine.poses().find((x) => x.uid === uid);
  if (!p) throw new Error(`${uid} is not in the office`);
  return p;
}

/** Steps the engine in 1/30 s frames for `seconds`, calling `each` after every frame. */
function run(engine: OfficeEngine, seconds: number, each?: () => void) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    engine.step(1 / 30);
    each?.();
  }
}

describe("the office engine: agents at their desks", () => {
  it("seats everyone of the first snapshot at once, with the seat offset of the desk's facing", () => {
    const layout = smallOffice();
    const engine = createOfficeEngine(layout, { random: seeded() });
    engine.apply({ type: "enter", agent: { uid: "analista-2", role: "analista", sheet: "" }, atOnce: true });
    engine.apply({ type: "enter", agent: { uid: "capitano", role: "capitano", sheet: "" }, atOnce: true });
    const analista = pose(engine, "analista-2");
    const desk = layout.departments[1]!.desks[1]!; // analista-2 → desk index 1
    // agent_npc.gd _seat_offset: facing up sits 24 px behind desk_spot, facing down 95 px ahead.
    expect(analista.pos).toEqual({ x: desk.seat.x, y: desk.seat.y - 24 });
    expect(analista).toMatchObject({ mode: "sit", facing: "up", flipped: false, carrying: false });
    // The sheet comes from layout.sheets[role][(n - 1) % length].
    expect(analista.sheet).toBe("analista_b");
    expect(pose(engine, "capitano")).toMatchObject({ sheet: "coordinatore_a", mode: "sit", facing: "down", pos: { x: 608, y: 715 } });
  });

  it("without a seated sheet works standing on the spot, as Godot does", () => {
    const layout = smallOffice();
    const characters: CharacterSheet[] = [
      { id: "scout_a", main: { src: "", cols: 6, rows: 12, cell: { w: 256, h: 384 }, feet: { x: 128, y: 360 }, scale: 0.425 }, sit: null },
    ];
    const engine = createOfficeEngine(layout, { random: seeded(), characters });
    engine.apply({ type: "enter", agent: { uid: "scout-1", role: "scout", sheet: "" }, atOnce: true });
    expect(pose(engine, "scout-1")).toMatchObject({ mode: "work", pos: layout.departments[0]!.desks[0]!.seat });
  });

  it("animates a seated agent on the seated track, frame by frame", () => {
    const engine = createOfficeEngine(smallOffice(), { random: () => 0 });
    engine.apply({ type: "enter", agent: { uid: "scout-1", role: "scout", sheet: "" }, atOnce: true });
    const frames = new Set<number>();
    run(engine, 1, () => frames.add(pose(engine, "scout-1").frame));
    expect([...frames].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("the office engine: a pipeline transition becomes a trip", () => {
  it("an Analista fetches from the Scout pile, works seated, drops on its own pile and sits back", () => {
    const layout = smallOffice();
    const engine = createOfficeEngine(layout, { random: seeded(7) });
    engine.apply({ type: "enter", agent: { uid: "analista-1", role: "analista", sheet: "" }, atOnce: true });
    engine.apply({ type: "piles", piles: { scout: 5, analisti: 2, scorer: null, scrittori: null, critici: null } });
    const seated = pose(engine, "analista-1").pos;
    expect(pose(engine, "analista-1").mode).toBe("sit");
    engine.apply({ type: "pipeline", uid: "analista-1", toState: "checked", position: TAG, ts: "2026-09-27T17:00:00Z" });
    // the cloud's counts already hold the move; the drawn piles wait for the trip
    engine.apply({ type: "piles", piles: { scout: 4, analisti: 3, scorer: null, scrittori: null, critici: null } });
    expect(engine.piles()).toMatchObject({ scout: 5, analisti: 2 });

    const modes: string[] = [];
    let reachedPickup = false;
    let crossedWall = false;
    let crossedDesk = false;
    const pickup = layout.departments[0]!.inboxPickupAccess;
    const desks = layout.departments.flatMap((d) => d.desks.map((k) => k.furniture.rect));
    run(engine, 60, () => {
      const p = pose(engine, "analista-1");
      if (modes.at(-1) !== p.mode) modes.push(p.mode);
      if (Math.hypot(p.pos.x - pickup.x, p.pos.y - pickup.y) < 1) {
        reachedPickup = true;
        // taken from the Scout pile, not dropped yet
        expect(engine.piles()).toMatchObject({ scout: 4, analisti: 2 });
      }
      // the glass wall at x 600..608 is open only below y 600
      if (p.pos.x > 590 && p.pos.x < 618 && p.pos.y < 600) crossedWall = true;
      if ((p.mode === "walk" || p.mode === "carry") && desks.some((r) => p.pos.x > r.x && p.pos.x < r.x + r.w && p.pos.y > r.y && p.pos.y < r.y + r.h)) crossedDesk = true;
    });

    expect(reachedPickup).toBe(true);
    expect(crossedWall).toBe(false);
    // the departments' desks are obstacles though they are not in layout.furniture
    expect(crossedDesk).toBe(false);
    // (seated before the event) walk to the pile, pause, carry to the desk, work seated,
    // carry to the own pile, pause, walk back, sit
    expect(modes).toEqual(["walk", "idle", "carry", "sit", "carry", "idle", "walk", "sit"]);
    expect(pose(engine, "analista-1").pos).toEqual(seated);
    expect(engine.piles()).toMatchObject({ scout: 4, analisti: 3 });
  });

  it("walks the pipeline at 185 px/s with the walk cadence of that speed", () => {
    const engine = createOfficeEngine(smallOffice(), { random: seeded(3) });
    engine.apply({ type: "enter", agent: { uid: "analista-1", role: "analista", sheet: "" }, atOnce: true });
    engine.apply({ type: "pipeline", uid: "analista-1", toState: "checked", position: TAG, ts: "t" });
    engine.step(0.2);
    const a = pose(engine, "analista-1").pos;
    engine.step(0.1);
    const b = pose(engine, "analista-1").pos;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(18.5, 5);
  });

  it("a Scout goes to the printer first", () => {
    const layout = smallOffice();
    const engine = createOfficeEngine(layout, { random: seeded(2) });
    engine.apply({ type: "enter", agent: { uid: "scout-1", role: "scout", sheet: "" }, atOnce: true });
    engine.apply({ type: "pipeline", uid: "scout-1", toState: "new", position: TAG, ts: "t" });
    let atPrinter = false;
    run(engine, 30, () => {
      const p = pose(engine, "scout-1").pos;
      if (Math.hypot(p.x - layout.pois.printer.x, p.y - layout.pois.printer.y) < 1) atPrinter = true;
    });
    expect(atPrinter).toBe(true);
  });

  it("keeps the events that arrive during a trip and walks them one after the other", () => {
    const engine = createOfficeEngine(smallOffice(), { random: seeded(5) });
    engine.apply({ type: "enter", agent: { uid: "analista-1", role: "analista", sheet: "" }, atOnce: true });
    engine.apply({ type: "piles", piles: { scout: 5, analisti: 0, scorer: null, scrittori: null, critici: null } });
    for (let i = 0; i < 3; i++) engine.apply({ type: "pipeline", uid: "analista-1", toState: "checked", position: TAG, ts: `t${i}` });
    engine.apply({ type: "piles", piles: { scout: 2, analisti: 3, scorer: null, scrittori: null, critici: null } });
    expect(engine.piles()).toMatchObject({ scout: 5, analisti: 0 });
    run(engine, 200);
    expect(engine.piles()).toMatchObject({ scout: 2, analisti: 3 });
    expect(pose(engine, "analista-1").mode).toBe("sit");
  });

  it("ignores a transition of an agent who is not in the office, and of a role with no department", () => {
    const engine = createOfficeEngine(smallOffice(), { random: seeded() });
    engine.apply({ type: "enter", agent: { uid: "capitano", role: "capitano", sheet: "" }, atOnce: true });
    engine.apply({ type: "pipeline", uid: "scorer-9", toState: "scored", position: TAG, ts: "t" });
    engine.apply({ type: "pipeline", uid: "capitano", toState: "excluded", position: TAG, ts: "t" });
    run(engine, 1);
    expect(engine.poses().map((p) => [p.uid, p.mode])).toEqual([["capitano", "sit"]]);
  });

  it("is deterministic with an injected random", () => {
    const trace = (seed: number) => {
      const engine = createOfficeEngine(smallOffice(), { random: seeded(seed) });
      engine.apply({ type: "enter", agent: { uid: "analista-1", role: "analista", sheet: "" }, atOnce: true });
      engine.apply({ type: "pipeline", uid: "analista-1", toState: "checked", position: TAG, ts: "t" });
      const out: string[] = [];
      run(engine, 40, () => out.push(JSON.stringify(pose(engine, "analista-1"))));
      return out;
    };
    expect(trace(11)).toEqual(trace(11));
  });
});

describe("the office engine: the door", () => {
  it("a new agent after the first snapshot walks in from the door and sits", () => {
    const layout = smallOffice();
    const engine = createOfficeEngine(layout, { random: seeded() });
    engine.apply({ type: "enter", agent: { uid: "scout-2", role: "scout", sheet: "" }, atOnce: false });
    expect(pose(engine, "scout-2").pos).toEqual(layout.door);
    expect(pose(engine, "scout-2").mode).toBe("walk");
    run(engine, 30);
    expect(pose(engine, "scout-2").mode).toBe("sit");
  });

  it("a leaving agent walks to the door and is removed", () => {
    const layout = smallOffice();
    const engine = createOfficeEngine(layout, { random: seeded() });
    engine.apply({ type: "enter", agent: { uid: "scout-1", role: "scout", sheet: "" }, atOnce: true });
    engine.apply({ type: "leave", uid: "scout-1" });
    expect(pose(engine, "scout-1").mode).toBe("walk");
    run(engine, 30);
    expect(engine.poses()).toEqual([]);
  });
});

describe("the office engine: bubbles and piles", () => {
  it("shows a line for its seconds, then drops it", () => {
    const engine = createOfficeEngine(smallOffice(), { random: seeded() });
    engine.apply({ type: "say", uid: "scout-1", text: "#60 Acme", seconds: 2 });
    engine.step(1);
    expect(engine.bubbles().map((b) => b.text)).toEqual(["#60 Acme"]);
    engine.step(1.5);
    expect(engine.bubbles()).toEqual([]);
  });

  it("keeps an unknown pile unknown when a trip passes by it", () => {
    const engine = createOfficeEngine(smallOffice(), { random: seeded() });
    engine.apply({ type: "enter", agent: { uid: "analista-1", role: "analista", sheet: "" }, atOnce: true });
    engine.apply({ type: "pipeline", uid: "analista-1", toState: "checked", position: TAG, ts: "t" });
    run(engine, 60);
    expect(engine.piles()).toEqual({ scout: null, analisti: null, scorer: null, scrittori: null, critici: null });
  });

  it("shows the true counts once an agent leaves in the middle of its trips", () => {
    const engine = createOfficeEngine(smallOffice(), { random: seeded(4) });
    engine.apply({ type: "enter", agent: { uid: "analista-1", role: "analista", sheet: "" }, atOnce: true });
    engine.apply({ type: "piles", piles: { scout: 5, analisti: 0, scorer: null, scrittori: null, critici: null } });
    for (let i = 0; i < 2; i++) engine.apply({ type: "pipeline", uid: "analista-1", toState: "checked", position: TAG, ts: `t${i}` });
    engine.apply({ type: "piles", piles: { scout: 3, analisti: 2, scorer: null, scrittori: null, critici: null } });
    // walking to the Scout pile, one more trip queued
    run(engine, 0.5);
    engine.apply({ type: "leave", uid: "analista-1" });
    expect(engine.piles()).toMatchObject({ scout: 3, analisti: 2 });
    run(engine, 30);
    expect(engine.piles()).toMatchObject({ scout: 3, analisti: 2 });
  });
});
