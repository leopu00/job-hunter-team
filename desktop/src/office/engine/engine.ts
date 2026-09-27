/**
 * The office's engine: who is where, doing what, with no drawing. A port of
 * the parts of game/scripts/characters/agent_npc.gd that live data drives:
 * agents seated at their desks (the default), a real pipeline transition
 * turned into a physical trip (_prepare_pipeline_trip), entering and leaving
 * through the door. The random theatre of the Godot demo (printer runs and
 * hologram visits on a timer) is not here: in live mode the office only
 * moves on events the data layer really saw.
 */

import {
  DEPT_OF_ROLE,
  FETCH_FROM,
  type AgentMode,
  type AgentPose,
  type AgentRole,
  type Bubble,
  type CharacterSheet,
  type CreateOfficeEngine,
  type Department,
  type DeptId,
  type Facing,
  type OfficeAgent,
  type OfficeEngine,
  type OfficeEvent,
  type OfficeLayout,
  type Piles,
  type Rect,
  type SheetFacing,
  type Vec,
} from "../contract";
import { NavGrid, distance } from "./nav-grid";
import { effectiveMode, frameAt, startsGait, trackFor, walkFpsForSpeed } from "./rig";

/** AgentNPC.SPEED: the ordinary walk. */
export const SPEED = 150;
/** AgentNPC.PIPELINE_SPEED: a file carried along the pipeline, brisk but natural. */
export const PIPELINE_SPEED = 185;
/** How many pipeline events an agent keeps while busy (AgentNPC._pending_pipeline). */
export const PENDING_MAX = 8;

/** agent_npc.gd _seat_offset: where the body sits relative to desk_spot, by the desk's facing. */
export function seatOffset(facing: Facing): Vec {
  switch (facing) {
    case "up":
      return { x: 0, y: -24 };
    case "left":
      return { x: -26, y: -2 };
    case "right":
      return { x: 26, y: -2 };
    case "down":
      return { x: 0, y: 95 };
  }
}

/** A desk's facing as the rig draws it: left and right are the side row, left mirrored. */
function rigFacing(facing: Facing): { facing: SheetFacing; flipped: boolean } {
  if (facing === "left") return { facing: "side", flipped: true };
  if (facing === "right") return { facing: "side", flipped: false };
  return { facing, flipped: false };
}

/** The role and the instance number of a by_agent: scout-2 → scout, 2; capitano → capitano, 1. */
export function parseUid(uid: string): { role: string; n: number } {
  const m = /^(.*?)-(\d+)$/.exec(uid);
  return m ? { role: m[1]!, n: Number(m[2]) } : { role: uid, n: 1 };
}

type Leg = {
  target: Vec;
  mode: "walk" | "carry";
  pause: number;
  pauseMode: AgentMode;
  deskWork?: boolean;
  pileTake?: DeptId;
  pileDrop?: DeptId;
  exit?: boolean;
};

type Home = { spot: Vec; facing: Facing; dept: Department | null };

type Agent = {
  info: OfficeAgent;
  hasSit: boolean;
  home: Home;
  pos: Vec;
  state: "work" | "trip" | "pause";
  legs: Leg[];
  leg: Leg | null;
  path: Vec[];
  pi: number;
  pause: number;
  pipeline: boolean;
  pending: string[];
  mode: AgentMode;
  facing: SheetFacing;
  flipped: boolean;
  /** seated with no turn running: the seated sheet's still frame */
  still: boolean;
  speed: number;
  /** the rig's clock (SpriteSheetRig._t) */
  t: number;
  gone: boolean;
};

const EMPTY_PILES: Piles = { scout: null, analisti: null, scorer: null, scrittori: null, critici: null };

/**
 * The A*'s obstacles: the blocking furniture and the departments' desks,
 * which the layout keeps in departments[].desks only (nav_grid.gd adds them
 * from the desk nodes); an id listed in both counts once.
 */
function obstaclesOf(layout: OfficeLayout): Rect[] {
  const byId = new Map<string, Rect>();
  for (const f of layout.furniture) if (f.blocking) byId.set(f.id, f.rect);
  for (const d of layout.departments) for (const k of d.desks) if (k.furniture.blocking) byId.set(k.furniture.id, k.furniture.rect);
  return [...byId.values()];
}

export const createOfficeEngine: CreateOfficeEngine = (layout, options = {}) =>
  new Engine(layout, options.random ?? Math.random, options.characters);

class Engine implements OfficeEngine {
  private readonly nav: NavGrid;
  private readonly agents = new Map<string, Agent>();
  private readonly deptById = new Map<DeptId, Department>();
  private readonly sitBySheet: Map<string, boolean> | null;
  /** the true counts of the last "piles" event */
  private truePiles: Piles = { ...EMPTY_PILES };
  /**
   * What the trips still owe to the piles: +1 on a pile a trip has not taken
   * its sheet from yet, -1 on a pile it has not dropped on yet. The true
   * counts already hold the move; the drawn pile reaches them sheet by
   * sheet, as Godot's PaperPile.set_target waits for the physical trip.
   */
  private owed: Record<DeptId, number> = { scout: 0, analisti: 0, scorer: 0, scrittori: 0, critici: 0 };
  private said: Bubble[] = [];
  private clock = 0;

  constructor(
    private readonly layout: OfficeLayout,
    private readonly random: () => number,
    characters?: CharacterSheet[],
  ) {
    this.nav = new NavGrid({
      floor: layout.floor,
      obstacles: obstaclesOf(layout),
      walls: layout.nav.walls,
      cell: layout.nav.cell,
      margin: layout.nav.margin,
      wallMargin: layout.nav.wallMargin,
    });
    for (const d of layout.departments) this.deptById.set(d.id, d);
    this.sitBySheet = characters ? new Map(characters.map((c) => [c.id, c.sit !== null])) : null;
  }

  apply(event: OfficeEvent): void {
    switch (event.type) {
      case "enter":
        this.enter(event.agent, event.atOnce);
        return;
      case "leave":
        this.leave(event.uid);
        return;
      case "pipeline":
        this.pipeline(event.uid, event.toState);
        return;
      case "piles":
        this.truePiles = { ...event.piles };
        return;
      case "say":
        this.said = this.said.filter((b) => b.uid !== event.uid);
        this.said.push({ uid: event.uid, text: event.text, until: this.clock + event.seconds });
        return;
    }
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.clock += dt;
    for (const a of this.agents.values()) {
      a.t += dt;
      if (a.state === "pause") {
        a.pause -= dt;
        if (a.pause <= 0) this.startNextLeg(a);
      } else if (a.state === "trip") {
        this.walk(a, dt);
      }
    }
    for (const [uid, a] of this.agents) if (a.gone) this.agents.delete(uid);
    this.said = this.said.filter((b) => b.until > this.clock);
  }

  poses(): AgentPose[] {
    return [...this.agents.values()].map((a) => {
      const fps = a.mode === "walk" || a.mode === "carry" ? walkFpsForSpeed(trackFor(a.mode, a.facing).fps, a.speed) : undefined;
      const track = trackFor(a.mode, a.facing, a.still);
      return {
        uid: a.info.uid,
        role: a.info.role,
        sheet: a.info.sheet,
        pos: { ...a.pos },
        mode: a.mode,
        facing: a.facing,
        flipped: a.facing === "side" && a.flipped,
        frame: frameAt(track, a.t, fps ?? track.fps),
        carrying: a.mode === "carry",
      };
    });
  }

  bubbles(): Bubble[] {
    return this.said.map((b) => ({ ...b }));
  }

  piles(): Piles {
    const out = { ...this.truePiles };
    for (const d of Object.keys(out) as DeptId[]) {
      const c = out[d];
      if (c !== null) out[d] = Math.max(0, c + this.owed[d]);
    }
    return out;
  }

  // ─── Agents ────────────────────────────────────────────────────────────

  private enter(info: OfficeAgent, atOnce: boolean): void {
    if (this.agents.has(info.uid)) return;
    const { n } = parseUid(info.uid);
    const variants = this.layout.sheets[info.role] ?? [];
    const sheet = info.sheet || variants[(Math.max(1, n) - 1) % Math.max(1, variants.length)] || "";
    const agent: Agent = {
      info: { ...info, sheet },
      hasSit: this.sitBySheet ? this.sitBySheet.get(sheet) === true : true,
      home: this.homeOf(info.role, n),
      pos: { ...this.layout.door },
      state: "work",
      legs: [],
      leg: null,
      path: [],
      pi: 0,
      pause: 0,
      pipeline: false,
      pending: [],
      mode: "idle",
      facing: "down",
      flipped: false,
      still: false,
      speed: 0,
      t: this.random() * 10,
      gone: false,
    };
    this.agents.set(info.uid, agent);
    if (atOnce) {
      this.seat(agent);
    } else {
      agent.legs = [{ target: agent.home.spot, mode: "walk", pause: 0, pauseMode: "work" }];
      this.startNextLeg(agent);
    }
  }

  private leave(uid: string): void {
    const a = this.agents.get(uid);
    if (!a) return;
    // The trips it will not walk owe nothing any more.
    for (const toState of a.pending) this.owe(a, toState, -1);
    const unwalked = [...(a.state === "trip" && a.leg ? [a.leg] : []), ...a.legs];
    for (const leg of unwalked) {
      if (leg.pileTake) this.owed[leg.pileTake] -= 1;
      if (leg.pileDrop) this.owed[leg.pileDrop] += 1;
    }
    a.pending = [];
    a.pipeline = false;
    a.legs = [{ target: this.layout.door, mode: "walk", pause: 0, pauseMode: "idle", exit: true }];
    this.startNextLeg(a);
  }

  /** Where an agent works: its department's desk n-1 (scout-5 → desk 4), or its core seat. */
  private homeOf(role: AgentRole, n: number): Home {
    const deptId = DEPT_OF_ROLE[role];
    const dept = deptId ? this.deptById.get(deptId) ?? null : null;
    if (dept && dept.desks.length > 0) {
      const desks = [...dept.desks].sort((x, y) => x.index - y.index);
      const desk = desks.find((d) => d.index === n - 1) ?? desks[(Math.max(1, n) - 1) % desks.length]!;
      return { spot: desk.seat, facing: desk.seatFacing, dept };
    }
    const core = this.layout.coreSeats.find((s) => s.role === role);
    if (core) return { spot: core.seat, facing: core.seatFacing, dept };
    return { spot: { ...this.layout.door }, facing: "down", dept };
  }

  /** At the desk (agent_npc.gd _work_pose): seated with the seat offset, or working standing. */
  private seat(a: Agent): void {
    a.state = "work";
    a.leg = null;
    a.legs = [];
    a.path = [];
    a.pipeline = false;
    const sits = a.hasSit;
    const off = sits ? seatOffset(a.home.facing) : { x: 0, y: 0 };
    a.pos = { x: a.home.spot.x + off.x, y: a.home.spot.y + off.y };
    this.setMotion(a, rigFacing(a.home.facing), sits ? "sit" : "work");
    const next = a.pending.shift();
    if (next !== undefined) this.startTrip(a, next);
  }

  // ─── Pipeline trips ────────────────────────────────────────────────────

  private pipeline(uid: string, toState: string): void {
    const a = this.agents.get(uid);
    if (!a || a.gone || a.legs.some((l) => l.exit) || a.leg?.exit) return;
    this.owe(a, toState, +1);
    if (a.state !== "work") {
      a.pending.push(toState);
      if (a.pending.length > PENDING_MAX) this.owe(a, a.pending.shift()!, -1);
      return;
    }
    this.startTrip(a, toState);
  }

  private startTrip(a: Agent, toState: string): void {
    const legs = this.pipelineLegs(a, toState);
    if (legs.length === 0) return;
    a.legs = legs;
    a.pipeline = true;
    this.startNextLeg(a);
  }

  private between(lo: number, hi: number): number {
    return lo + (hi - lo) * this.random();
  }

  /** The piles a trip takes from and drops on (the pileTake/pileDrop of pipelineLegs), owed or forgiven. */
  private owe(a: Agent, toState: string, sign: 1 | -1): void {
    const dept = a.home.dept;
    if (!dept) return;
    const src = FETCH_FROM[dept.id];
    const hasSrc = src !== undefined && this.deptById.has(src);
    if (dept.id !== "scout" && !hasSrc) return;
    const writerDrop = dept.id === "scrittori" && (toState === "review" || toState === "ready");
    const take = dept.id === "scout" || writerDrop ? undefined : src;
    const drop = dept.id === "scrittori" && toState === "writing" ? undefined : dept.id;
    if (take) this.owed[take] += sign;
    if (drop) this.owed[drop] -= sign;
  }

  /** agent_npc.gd _prepare_pipeline_trip, leg by leg. */
  private pipelineLegs(a: Agent, toState: string): Leg[] {
    const dept = a.home.dept;
    if (!dept) return [];
    const home = a.home.spot;
    const homeOut = dept.inboxDropAccess;
    const back: Leg = { target: home, mode: "walk", pause: 0, pauseMode: "work" };
    if (dept.id === "scout") {
      return [
        { target: this.layout.pois.printer, mode: "walk", pause: this.between(1.8, 3.0), pauseMode: "idle" },
        { target: home, mode: "carry", pause: this.between(8, 14), pauseMode: "work", deskWork: true },
        { target: homeOut, mode: "carry", pause: this.between(0.8, 1.4), pauseMode: "idle", pileDrop: dept.id },
        back,
      ];
    }
    const src = FETCH_FROM[dept.id];
    const srcDept = src ? this.deptById.get(src) : undefined;
    if (!src || !srcDept) return [];
    const pick: Leg = { target: srcDept.inboxPickupAccess, mode: "walk", pause: this.between(0.8, 1.4), pauseMode: "idle", pileTake: src };
    const windows: Record<string, [number, number]> = {
      analisti: [10, 18],
      scorer: [8, 15],
      scrittori: [14, 24],
      critici: [9, 16],
    };
    const [lo, hi] = windows[dept.id] ?? [8, 14];
    const process: Leg = { target: home, mode: "carry", pause: this.between(lo, hi), pauseMode: "work", deskWork: true };
    // `writing` is the claim: the Scrittore takes the position and stays at
    // the desk. Only review/ready drops the finished CV.
    if (dept.id === "scrittori" && toState === "writing") return [pick, process];
    if (dept.id === "scrittori" && (toState === "review" || toState === "ready")) {
      return [{ target: homeOut, mode: "carry", pause: this.between(0.8, 1.4), pauseMode: "idle", pileDrop: dept.id }, back];
    }
    // The Critici are the last department: the PASS goes to the output shelf.
    if (dept.id === "critici") {
      return [pick, process, { target: this.layout.pois.outputShelf, mode: "carry", pause: this.between(0.8, 1.4), pauseMode: "idle", pileDrop: dept.id }, back];
    }
    return [pick, process, { target: homeOut, mode: "carry", pause: this.between(0.8, 1.4), pauseMode: "idle", pileDrop: dept.id }, back];
  }

  private startNextLeg(a: Agent): void {
    const leg = a.legs.shift();
    if (!leg) {
      this.seat(a);
      return;
    }
    // Standing up (_set_desk_occupied(false)): from the seat back to the
    // standing spot in front of the chair, then walk.
    if (a.mode === "sit") a.pos = { ...a.home.spot };
    a.leg = leg;
    a.path = this.nav.path(a.pos, leg.target);
    if (a.path.length === 0) a.path = [{ ...leg.target }];
    a.pi = 0;
    a.state = "trip";
    // On its way from the first frame, facing the first waypoint.
    this.face(a, a.path[0]!, leg.mode, a.pipeline ? PIPELINE_SPEED : SPEED);
  }

  /** Follows the path at the trip's speed (AgentNPC._follow_path), and faces where it goes. */
  private walk(a: Agent, dt: number): void {
    const leg = a.leg!;
    const speed = a.pipeline ? PIPELINE_SPEED : SPEED;
    let budget = speed * dt;
    while (budget > 0 && a.pi < a.path.length) {
      const target = a.path[a.pi]!;
      const d = distance(a.pos, target);
      if (d > 1e-6) this.face(a, target, leg.mode, speed);
      if (d <= budget) {
        a.pos = { ...target };
        budget -= d;
        a.pi++;
      } else {
        a.pos = { x: a.pos.x + ((target.x - a.pos.x) / d) * budget, y: a.pos.y + ((target.y - a.pos.y) / d) * budget };
        budget = 0;
      }
    }
    if (a.pi >= a.path.length) this.arrive(a);
  }

  private face(a: Agent, target: Vec, mode: AgentMode, speed: number): void {
    const dx = target.x - a.pos.x;
    const dy = target.y - a.pos.y;
    if (dx === 0 && dy === 0) {
      this.setMotion(a, { facing: a.facing, flipped: a.flipped }, mode);
      a.speed = speed;
      return;
    }
    const f = Math.abs(dx) > Math.abs(dy) ? { facing: "side" as const, flipped: dx < 0 } : { facing: dy > 0 ? ("down" as const) : ("up" as const), flipped: false };
    this.setMotion(a, f, mode);
    a.speed = speed;
  }

  /** AgentNPC._arrive_at_leg. */
  private arrive(a: Agent): void {
    const leg = a.leg!;
    a.speed = 0;
    if (leg.exit) {
      a.gone = true;
      return;
    }
    if (leg.pileTake) this.owed[leg.pileTake] -= 1;
    if (leg.pileDrop) this.owed[leg.pileDrop] += 1;
    if (leg.pause > 0) {
      a.state = "pause";
      a.pause = leg.pause;
      if (leg.deskWork && a.hasSit) {
        const off = seatOffset(a.home.facing);
        a.pos = { x: a.home.spot.x + off.x, y: a.home.spot.y + off.y };
        this.setMotion(a, rigFacing(a.home.facing), "sit");
      } else if (leg.deskWork) {
        this.setMotion(a, rigFacing(a.home.facing), "work");
      } else {
        this.setMotion(a, { facing: a.facing, flipped: a.flipped }, leg.pauseMode);
      }
      return;
    }
    this.startNextLeg(a);
  }

  private setMotion(a: Agent, f: { facing: SheetFacing; flipped: boolean }, mode: AgentMode): void {
    const next = effectiveMode(mode, a.hasSit);
    if (startsGait(a.mode, next)) a.t = 0;
    a.mode = next;
    a.facing = f.facing;
    a.flipped = f.flipped;
    a.still = false;
  }
}
