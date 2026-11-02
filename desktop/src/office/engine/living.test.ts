import { describe, expect, it } from "vitest";

import type { AgentPose, AgentStatuses, OfficeEngine, OfficeLayout } from "../contract";
import { createOfficeEngine, isTyping, PATROL_EVERY, PULSE_SECONDS, pulseAt, SETTLE_SECONDS } from "./engine";
import { seeded, smallOffice } from "./fixture.test-helpers";

const AT = 1_000_000;

function statuses(map: Record<string, "working" | "idle" | "paused" | "throttled" | "unknown">): AgentStatuses {
  return { at: AT, agents: Object.fromEntries(Object.entries(map).map(([uid, status]) => [uid, { status }])) };
}

function pose(engine: OfficeEngine, uid: string): AgentPose {
  const p = engine.poses().find((x) => x.uid === uid);
  if (!p) throw new Error(`${uid} is not in the office`);
  return p;
}

function run(engine: OfficeEngine, seconds: number, each?: () => void) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    engine.step(1 / 30);
    each?.();
  }
}

/** The small office, with a round for the capitano. */
function withRound(): OfficeLayout {
  const layout = smallOffice();
  layout.coreSeats[0]!.wander = [{ x: 640, y: 700 }];
  return layout;
}

function seated(layout = smallOffice(), uids = ["scout-1"]) {
  const engine = createOfficeEngine(layout, { random: seeded(3) });
  for (const uid of uids) {
    const role = uid.startsWith("scout") ? "scout" : "capitano";
    engine.apply({ type: "enter", agent: { uid, role, sheet: "" }, atOnce: true });
  }
  return engine;
}

describe("the agents' status becomes their motion", () => {
  it("types while the box says working, sits still on the first frame when it says anything else", () => {
    const engine = seated();
    engine.setStatuses!(statuses({ "scout-1": "working" }));
    const frames = new Set<number>();
    run(engine, 1, () => frames.add(pose(engine, "scout-1").frame));
    expect(frames.size).toBeGreaterThan(1);

    for (const status of ["idle", "paused", "throttled", "unknown"] as const) {
      engine.setStatuses!(statuses({ "scout-1": status }));
      const still = new Set<number>();
      run(engine, 1, () => still.add(pose(engine, "scout-1").frame));
      expect([...still], status).toEqual([0]);
      expect(pose(engine, "scout-1")).toMatchObject({ mode: "sit", seatedAt: "scout_desk_0" });
    }
    engine.setStatuses!(statuses({ "scout-1": "working" }));
    const again = new Set<number>();
    run(engine, 1, () => again.add(pose(engine, "scout-1").frame));
    expect(again.size).toBeGreaterThan(1);
  });

  it("works standing, or stands still, when the character has no seated sheet", () => {
    const characters = [{ id: "scout_a", main: { src: "", cols: 6, rows: 12, cell: { w: 256, h: 384 }, feet: { x: 128, y: 360 }, scale: 0.425 }, sit: null }];
    const engine = createOfficeEngine(smallOffice(), { random: seeded(), characters });
    engine.apply({ type: "enter", agent: { uid: "scout-1", role: "scout", sheet: "" }, atOnce: true });
    engine.setStatuses!(statuses({ "scout-1": "working" }));
    expect(pose(engine, "scout-1").mode).toBe("work");
    engine.setStatuses!(statuses({ "scout-1": "idle" }));
    expect(pose(engine, "scout-1").mode).toBe("still");
  });

  it("sits still when the box says nothing about the agent: the office shows the real work, it does not invent it", () => {
    expect(isTyping(null, "scout-1")).toBe(false);
    expect(isTyping(statuses({ capitano: "working" }), "scout-1")).toBe(false);
    expect(isTyping(statuses({ "SCOUT-1": "working" }), "scout-1")).toBe(false); // the producers write the keys in lower case
    expect(isTyping(statuses({ "scout-1": "idle" }), "scout-1")).toBe(false);
    expect(isTyping(statuses({ "scout-1": "working" }), "scout-1")).toBe(true);
    const engine = seated(); // no statuses at all
    const frames = new Set<number>();
    run(engine, 1, () => frames.add(pose(engine, "scout-1").frame));
    expect([...frames]).toEqual([0]);
    expect(pose(engine, "scout-1").mode).toBe("sit");
  });

  it("a status that goes away sits the agent still again", () => {
    const engine = seated();
    engine.setStatuses!(statuses({ "scout-1": "working" }));
    const typing = new Set<number>();
    run(engine, 1, () => typing.add(pose(engine, "scout-1").frame));
    expect(typing.size).toBeGreaterThan(1);
    engine.setStatuses!(null);
    const still = new Set<number>();
    run(engine, 1, () => still.add(pose(engine, "scout-1").frame));
    expect([...still]).toEqual([0]);
  });

  it("an agent that enters after the statuses were read already knows its own", () => {
    const engine = createOfficeEngine(smallOffice(), { random: seeded() });
    engine.setStatuses!(statuses({ "scout-1": "idle" }));
    engine.apply({ type: "enter", agent: { uid: "scout-1", role: "scout", sheet: "" }, atOnce: true });
    run(engine, 0.5);
    expect(pose(engine, "scout-1").frame).toBe(0);
  });

  it("a real transition still walks the trip whatever the status says: the work was seen", () => {
    const engine = seated();
    engine.setStatuses!(statuses({ "scout-1": "idle" }));
    engine.apply({ type: "pipeline", uid: "scout-1", toState: "new", position: { id: null, legacyId: 1, title: null, company: null }, ts: "t" });
    run(engine, 1);
    expect(["walk", "carry"]).toContain(pose(engine, "scout-1").mode);
  });
});

describe("a core role's round", () => {
  it("goes to a point of its round and comes back to sit, only while it works", () => {
    const engine = seated(withRound(), ["capitano"]);
    engine.setStatuses!(statuses({ capitano: "working" }));
    const seat = pose(engine, "capitano").pos;
    let walked = false;
    let paused = false;
    run(engine, PATROL_EVERY.capitano! * 1.5 + 30, () => {
      const p = pose(engine, "capitano");
      if (p.mode === "walk") walked = true;
      if (p.mode === "idle") paused = true;
    });
    expect(walked).toBe(true);
    expect(paused).toBe(true);
    // a round lasts under a minute: within two it is back on the chair
    let guard = 0;
    while (pose(engine, "capitano").mode !== "sit" && guard++ < 30 * 120) engine.step(1 / 30);
    run(engine, SETTLE_SECONDS + 0.1);
    expect(pose(engine, "capitano")).toMatchObject({ mode: "sit", pos: seat });
  });

  it("stays at its seat while the box says it is not working", () => {
    const engine = seated(withRound(), ["capitano"]);
    engine.setStatuses!(statuses({ capitano: "idle" }));
    run(engine, PATROL_EVERY.capitano! * 3, () => expect(pose(engine, "capitano").mode).toBe("sit"));
  });

  it("an agent without a round (a scout) never goes out by itself", () => {
    const engine = seated();
    engine.setStatuses!(statuses({ "scout-1": "working" }));
    run(engine, 2000, () => expect(pose(engine, "scout-1").mode).toBe("sit"));
  });

  it("a status other than working during the round sends it back to its seat instead of freezing it in the corridor", () => {
    const engine = seated(withRound(), ["capitano"]);
    engine.setStatuses!(statuses({ capitano: "working" }));
    run(engine, 200, () => undefined);
    // wait for the round to start
    let guard = 0;
    while (pose(engine, "capitano").mode === "sit" && guard++ < 30 * 400) engine.step(1 / 30);
    expect(pose(engine, "capitano").mode).not.toBe("sit");
    engine.setStatuses!(statuses({ capitano: "idle" }));
    run(engine, 60);
    expect(pose(engine, "capitano")).toMatchObject({ mode: "sit", frame: 0 });
  });

  it("the mentor walks his ritual: both stops, then back", () => {
    const layout = smallOffice();
    layout.coreSeats.push({ role: "mentor", seat: { x: 300, y: 700 }, seatFacing: "down", furnitureId: "none", wander: [{ x: 200, y: 700 }, { x: 400, y: 740 }] });
    layout.sheets.mentor = ["mentor_a"];
    const engine = createOfficeEngine(layout, { random: seeded(5) });
    engine.apply({ type: "enter", agent: { uid: "mentor", role: "mentor", sheet: "" }, atOnce: true });
    engine.setStatuses!(statuses({ mentor: "working" }));
    let stops = 0;
    let was = "";
    run(engine, 2300, () => {
      const m = pose(engine, "mentor").mode;
      if (m === "idle" && was !== "idle") stops++;
      was = m;
    });
    expect(stops).toBeGreaterThanOrEqual(2);
  });
});

describe("sitting down and standing up", () => {
  it("sits down over a short sine ease, not by appearing in the chair", () => {
    const layout = smallOffice();
    const engine = createOfficeEngine(layout, { random: seeded(), characters: undefined });
    engine.apply({ type: "enter", agent: { uid: "scout-1", role: "scout", sheet: "" }, atOnce: false });
    const desk = layout.departments[0]!.desks[0]!;
    const final = { x: desk.seat.x, y: desk.seat.y - 24 };
    const ys: number[] = [];
    let arrived = false;
    run(engine, 30, () => {
      const p = pose(engine, "scout-1");
      if (p.mode === "sit") {
        arrived = true;
        ys.push(p.pos.y);
      }
    });
    expect(arrived).toBe(true);
    // the first seated frames are between the standing spot and the chair, the last is the chair
    expect(ys[0]).toBeGreaterThan(final.y);
    expect(ys[ys.length - 1]).toBe(final.y);
    expect(ys.filter((y) => y !== final.y).length).toBeLessThanOrEqual(Math.ceil(SETTLE_SECONDS * 30) + 1);
    expect([...ys].reverse().every((y, i, all) => i === 0 || y >= all[i - 1]!)).toBe(true);
  });
});

describe("a selected agent", () => {
  it("out walking it stands still looking at the camera, and walks on when the panel closes", () => {
    const engine = createOfficeEngine(smallOffice(), { random: seeded() });
    engine.apply({ type: "enter", agent: { uid: "scout-1", role: "scout", sheet: "" }, atOnce: false });
    run(engine, 1);
    const before = pose(engine, "scout-1");
    expect(before.mode).toBe("walk");
    engine.select!("scout-1");
    const held = pose(engine, "scout-1");
    expect(held).toMatchObject({ mode: "still", facing: "down", flipped: false });
    run(engine, 3);
    expect(pose(engine, "scout-1").pos).toEqual(held.pos);
    engine.select!(null);
    run(engine, 1);
    expect(pose(engine, "scout-1").mode).toBe("walk");
    expect(pose(engine, "scout-1").pos).not.toEqual(held.pos);
  });

  it("at its desk it goes on working but does not leave on a round", () => {
    const engine = seated(withRound(), ["capitano"]);
    engine.setStatuses!(statuses({ capitano: "working" }));
    engine.select!("capitano");
    run(engine, PATROL_EVERY.capitano! * 4, () => expect(pose(engine, "capitano").mode).toBe("sit"));
  });

  it("choosing another one gives the first back", () => {
    const engine = createOfficeEngine(smallOffice(), { random: seeded() });
    engine.apply({ type: "enter", agent: { uid: "scout-1", role: "scout", sheet: "" }, atOnce: false });
    engine.apply({ type: "enter", agent: { uid: "analista-1", role: "analista", sheet: "" }, atOnce: false });
    run(engine, 1);
    engine.select!("scout-1");
    engine.select!("analista-1");
    run(engine, 1);
    expect(pose(engine, "scout-1").mode).toBe("walk");
    expect(pose(engine, "analista-1").mode).toBe("still");
  });
});

describe("a quiet office", () => {
  it("is quiet when every agent sits still, and not while one types, walks or sits down", () => {
    const engine = seated(smallOffice(), ["scout-1", "capitano"]);
    expect(engine.quiet!()).toBe(true); // no word from the box: they sit still
    engine.setStatuses!(statuses({ "scout-1": "working", capitano: "paused" }));
    expect(engine.quiet!()).toBe(false); // typing: the frames change
    engine.setStatuses!(statuses({ "scout-1": "idle", capitano: "paused" }));
    expect(engine.quiet!()).toBe(true);
    run(engine, 5);
    expect(engine.quiet!()).toBe(true);
    engine.setStatuses!(statuses({ "scout-1": "working", capitano: "paused" }));
    expect(engine.quiet!()).toBe(false);
    engine.setStatuses!(statuses({ "scout-1": "idle", capitano: "paused" }));
    engine.apply({ type: "pipeline", uid: "scout-1", toState: "new", position: { id: null, legacyId: 1, title: null, company: null }, ts: "t" });
    expect(engine.quiet!()).toBe(false);
    run(engine, 120);
    expect(engine.quiet!()).toBe(true);
  });

  it("an empty office is quiet", () => {
    expect(createOfficeEngine(smallOffice()).quiet!()).toBe(true);
  });
});

describe("the flash of real work", () => {
  it("pulses twice (0.16 s up, 0.45 s down) and is over after 1.22 s", () => {
    expect(pulseAt(0)).toBe(0);
    expect(pulseAt(0.16)).toBeCloseTo(1, 5); // the top: the start of the fall
    expect(pulseAt(0.08)).toBeCloseTo(0.5, 5);
    expect(pulseAt(0.385)).toBeCloseTo(0.5, 2); // halfway down
    expect(pulseAt(0.61 + 0.08)).toBeCloseTo(0.5, 5); // the second pulse
    expect(pulseAt(PULSE_SECONDS)).toBe(0);
    expect(pulseAt(-1)).toBe(0);
  });

  it("shows on the agent of a transition for a while, and the office is not quiet meanwhile", () => {
    const engine = seated();
    engine.setStatuses!(statuses({ "scout-1": "idle" }));
    expect(pose(engine, "scout-1").pulse).toBeUndefined();
    engine.apply({ type: "pipeline", uid: "scout-1", toState: "new", position: { id: null, legacyId: 1, title: null, company: null }, ts: "t" });
    expect(pose(engine, "scout-1").pulse).toBeDefined();
    expect(engine.quiet!()).toBe(false);
    let top = 0;
    run(engine, PULSE_SECONDS + 0.2, () => (top = Math.max(top, pose(engine, "scout-1").pulse ?? 0)));
    expect(top).toBeGreaterThan(0.8);
    expect(pose(engine, "scout-1").pulse).toBeUndefined();
  });
});
