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
  type AgentStatuses,
  type Bubble,
  type CharacterSheet,
  type CreateOfficeEngine,
  type Department,
  type DeptId,
  type Facing,
  type FurnitureItem,
  type OfficeAgent,
  type OfficeEngine,
  type OfficeEvent,
  type OfficeLayout,
  type Piles,
  type SheetFacing,
  type Vec,
} from "../contract";
import { allFurniture } from "../layout-items";
import { NavGrid, distance } from "./nav-grid";
import { effectiveMode, frameAt, startsGait, trackFor, walkFpsForSpeed } from "./rig";

/** AgentNPC.SPEED: the ordinary walk. */
export const SPEED = 150;
/** AgentNPC.PIPELINE_SPEED: a file carried along the pipeline, brisk but natural. */
export const PIPELINE_SPEED = 185;
/** How many pipeline events an agent keeps while busy (AgentNPC._pending_pipeline). */
export const PENDING_MAX = 8;
/** AgentNPC._begin_desk_pause: the sine ease from the standing spot to the seat. */
export const SETTLE_SECONDS = 0.28;
/** AgentNPC.react_to_work: two pulses, each 0.16 s up and 0.45 s down. */
export const PULSE_UP = 0.16;
export const PULSE_DOWN = 0.45;
export const PULSE_SECONDS = 2 * (PULSE_UP + PULSE_DOWN);

/** The glow 0..1 `t` seconds into a work flash; 0 once it is over. */
export function pulseAt(t: number): number {
  if (t < 0 || t >= PULSE_SECONDS) return 0;
  const k = t % (PULSE_UP + PULSE_DOWN);
  return k < PULSE_UP ? k / PULSE_UP : 1 - (k - PULSE_UP) / PULSE_DOWN;
}
/**
 * AgentNPC.TRIP_EVERY for the core roles that walk a round in live too
 * (LIVE_PATROL): the mean seconds between two rounds, jitter x0.6..1.4 (the
 * mentor's x0.95..1.05: his ritual stays near the half hour).
 */
export const PATROL_EVERY: Partial<Record<AgentRole, number>> = { capitano: 90, sentinella: 140, assistente: 300, mentor: 1800 };

/** Whether a status published by the box means the agent is at work (agent_npc.gd backend_status == "working"). */
export function isTyping(statuses: AgentStatuses | null, uid: string): boolean {
  const status = statuses?.agents[uid.toLowerCase()];
  // no word from the box about this agent: it sits still, the office shows the real work and does not invent it
  return status ? status.status === "working" : false;
}

/**
 * agent_npc.gd _seat_offset's table by facing: where the body sits relative
 * to desk_spot. The layout's Desk/CoreSeat.seatOffset wins when present.
 */
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

/** The sine ease from the standing spot to the seat (AgentNPC.SEATING). */
type Settle = { t: number; from: Vec; to: Vec };

/**
 * Where an agent works. `furniture`: the desk or core seat it sits at, null
 * when it has no workstation of its own (an instance beyond the chairs)
 * and works standing, as Godot's overflow copies do.
 */
type Home = { spot: Vec; facing: Facing; dept: Department | null; offset: Vec; furniture: FurnitureItem | null };

type Agent = {
  info: OfficeAgent;
  /** agent_npc.gd _seated(): a seated sheet, or a workstation with seated art */
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
  /** what the box says: working types, anything else sits still (agent_npc.gd _work_pose) */
  typing: boolean;
  /** a core role's round (character_defs.gd "wander"); empty = none */
  wander: Vec[];
  /** seconds to the next round */
  patrolIn: number;
  /** the trip it walks is a round, which a status other than working cuts short */
  patrol: boolean;
  settle: Settle | null;
  /** seconds into the flash of a real transition; null = none */
  pulse: number | null;
  /** the motion it had when the panel took it, given back when the panel closes */
  heldFrom: { facing: SheetFacing; flipped: boolean; mode: AgentMode } | null;
};

const EMPTY_PILES: Piles = { scout: null, analisti: null, scorer: null, scrittori: null, critici: null };

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
  private statuses: AgentStatuses | null = null;
  /** the agent whose panel is open: it stands still and looks at the camera */
  private selected: string | null = null;

  constructor(
    private readonly layout: OfficeLayout,
    private readonly random: () => number,
    characters?: CharacterSheet[],
  ) {
    this.nav = new NavGrid({
      floor: layout.floor,
      // allFurniture: the departments' desks too, which the layout may keep only in their Desk
      obstacles: allFurniture(layout)
        .filter((f) => f.blocking)
        .map((f) => f.rect),
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

  setStatuses(statuses: AgentStatuses | null): void {
    this.statuses = statuses;
    for (const a of this.agents.values()) {
      const typing = isTyping(statuses, a.info.uid);
      if (typing === a.typing) continue;
      a.typing = typing;
      if (a.state === "work") this.deskPose(a);
      else if (a.patrol && !typing) this.recall(a);
    }
  }

  select(uid: string | null): void {
    const before = this.selected;
    this.selected = uid;
    if (before !== null && before !== uid) {
      const a = this.agents.get(before);
      if (a) this.hold(a, false);
    }
    if (uid !== null && uid !== before) {
      const a = this.agents.get(uid);
      if (a) this.hold(a, true);
    }
  }

  /** Nothing in the office moves or changes its picture: a scene that draws less may skip the frame. */
  quiet(): boolean {
    for (const a of this.agents.values()) {
      if (a.gone || a.settle || a.pulse !== null) return false;
      // held by the panel it does not move: only its picture can still change
      if (a.state !== "work" && this.selected !== a.info.uid) return false;
      if (trackFor(a.mode, a.facing, a.still).fps > 0) return false;
    }
    return true;
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.clock += dt;
    for (const a of this.agents.values()) {
      a.t += dt;
      if (a.settle) this.settling(a, dt);
      if (a.pulse !== null) {
        a.pulse += dt;
        if (a.pulse >= PULSE_SECONDS) a.pulse = null;
      }
      if (this.selected === a.info.uid && a.state !== "work") continue; // the panel holds it
      if (a.state === "work") {
        this.patrolTick(a, dt);
      } else if (a.state === "pause") {
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
        ...(a.pulse !== null ? { pulse: pulseAt(a.pulse) } : {}),
        ...(a.mode === "sit" && a.home.furniture ? { seatedAt: a.home.furniture.id } : {}),
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
    const sheetSit = this.sitBySheet ? this.sitBySheet.get(sheet) === true : true;
    const home = this.homeOf(info.role, n);
    const agent: Agent = {
      info: { ...info, sheet },
      hasSit: home.furniture !== null && (sheetSit || home.furniture.occupiedImage !== undefined),
      home,
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
      typing: isTyping(this.statuses, info.uid),
      wander: home.dept ? [] : this.layout.coreSeats.find((c) => c.role === info.role)?.wander ?? [],
      patrolIn: 0,
      patrol: false,
      settle: null,
      pulse: null,
      heldFrom: null,
    };
    agent.patrolIn = this.nextPatrol(agent);
    this.agents.set(info.uid, agent);
    if (atOnce) {
      this.seat(agent);
    } else {
      agent.legs = [{ target: agent.home.spot, mode: "walk", pause: 0, pauseMode: "work" }];
      this.startNextLeg(agent);
    }
    if (this.selected === info.uid) this.hold(agent, true);
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

  /**
   * Where an agent works (office.gd _take_desk_for, _spawn_backend_agent):
   * its department's desk n-1 (scout-5 → desk 4), else the first free one;
   * its core seat. With no free chair it works standing next to its
   * department's inbox, or next to the core seat, shifted per copy so two
   * bodies never share a spot.
   */
  private homeOf(role: AgentRole, n: number): Home {
    const deptId = DEPT_OF_ROLE[role];
    const dept = deptId ? this.deptById.get(deptId) ?? null : null;
    const taken = new Set([...this.agents.values()].flatMap((a) => (a.home.furniture ? [a.home.furniture.id] : [])));
    const copies = [...this.agents.values()].filter((a) => a.info.role === role && a.home.furniture === null).length;
    if (dept) {
      const desks = [...dept.desks].sort((x, y) => x.index - y.index).filter((d) => !taken.has(d.furniture.id));
      const desk = desks.find((d) => d.index === n - 1) ?? desks[0];
      if (desk) {
        const offset = desk.seatOffset ?? seatOffset(desk.seatFacing);
        return { spot: desk.seat, facing: desk.seatFacing, dept, offset, furniture: desk.furniture };
      }
      const serial = copies + 1;
      const spot = { x: dept.inbox.x + 58 * serial, y: dept.inbox.y + 46 * (serial % 2) };
      return { spot: this.nav.clampToWalkable(spot), facing: "down", dept, offset: { x: 0, y: 0 }, furniture: null };
    }
    const core = this.layout.coreSeats.find((s) => s.role === role);
    if (core) {
      const furniture = allFurniture(this.layout).find((f) => f.id === core.furnitureId) ?? null;
      if (furniture && !taken.has(furniture.id)) {
        return { spot: core.seat, facing: core.seatFacing, dept, offset: core.seatOffset ?? seatOffset(core.seatFacing), furniture };
      }
      const serial = copies + 1;
      const spot = { x: core.seat.x + 84 * serial, y: core.seat.y + 52 * (serial % 2) };
      return { spot: this.nav.clampToWalkable(spot), facing: core.seatFacing, dept, offset: { x: 0, y: 0 }, furniture: null };
    }
    return { spot: { ...this.layout.door }, facing: "down", dept, offset: { x: 0, y: 0 }, furniture: null };
  }

  /**
   * At the desk (agent_npc.gd _work_pose): seated with the seat offset, or
   * working standing. `ease`: it sits down over SETTLE_SECONDS from where it
   * stands, instead of appearing in the chair.
   */
  private seat(a: Agent, ease = false): void {
    a.state = "work";
    a.leg = null;
    a.legs = [];
    a.path = [];
    a.pipeline = false;
    a.patrol = false;
    this.deskPose(a, ease);
    const next = a.pending.shift();
    if (next !== undefined) this.startTrip(a, next);
  }

  /** The pose at the desk by what the box says: typing, or sitting (standing) still. */
  private deskPose(a: Agent, ease = false): void {
    const sits = a.hasSit;
    const off = sits ? a.home.offset : { x: 0, y: 0 };
    const to = { x: a.home.spot.x + off.x, y: a.home.spot.y + off.y };
    if (sits && ease && (a.pos.x !== to.x || a.pos.y !== to.y)) a.settle = { t: 0, from: { ...a.pos }, to };
    else {
      a.settle = null;
      a.pos = to;
    }
    this.setMotion(a, rigFacing(a.home.facing), sits ? "sit" : a.typing ? "work" : "still");
    // the seated sheet's sit_idle: the first frame, no motion
    if (sits && !a.typing) a.still = true;
  }

  /** AgentNPC._begin_desk_pause's tween: position only, the sine ease. */
  private settling(a: Agent, dt: number): void {
    const s = a.settle!;
    s.t += dt;
    const p = Math.min(1, s.t / SETTLE_SECONDS);
    const e = Math.sin((p * Math.PI) / 2);
    a.pos = { x: s.from.x + (s.to.x - s.from.x) * e, y: s.from.y + (s.to.y - s.from.y) * e };
    if (p >= 1) a.settle = null;
  }

  // ─── Rounds of the core roles ───────────────────────────────────────────

  private nextPatrol(a: Agent): number {
    const every = PATROL_EVERY[a.info.role];
    if (every === undefined || a.wander.length === 0) return Infinity;
    return a.info.role === "mentor" ? every * this.between(0.95, 1.05) : every * this.between(0.6, 1.4);
  }

  /** agent_npc.gd's S.WORK timer: a round only while the box says it works (and no panel holds it). */
  private patrolTick(a: Agent, dt: number): void {
    if (a.patrolIn === Infinity || a.settle || this.selected === a.info.uid) return;
    a.patrolIn -= dt;
    if (a.patrolIn > 0) return;
    a.patrolIn = this.nextPatrol(a);
    if (a.typing) this.startPatrol(a);
  }

  /** agent_npc.gd _plan_trip for a core role: the mentor's ritual, or one stop of the round, then the seat. */
  private startPatrol(a: Agent): void {
    const home: Leg = { target: a.home.spot, mode: "walk", pause: 0, pauseMode: "work" };
    const stop = (target: Vec, lo: number, hi: number): Leg => ({ target, mode: "walk", pause: this.between(lo, hi), pauseMode: "idle" });
    if (a.info.role === "mentor" && a.wander.length >= 2) {
      a.legs = [stop(a.wander[0]!, 5, 8), stop(a.wander[1]!, 7, 12), home];
    } else {
      const spot = a.wander[Math.floor(this.random() * a.wander.length) % a.wander.length]!;
      // AgentNPC._jit: thirty agents on one pixel look like a queue
      const target = this.nav.clampToWalkable({ x: spot.x + this.between(-26, 26), y: spot.y + this.between(-14, 14) });
      a.legs = [stop(target, 3, 7), home];
    }
    a.patrol = true;
    this.startNextLeg(a);
  }

  /** The box stopped saying "working" on a round: back to the seat instead of freezing in the corridor. */
  private recall(a: Agent): void {
    a.legs = [{ target: a.home.spot, mode: "walk", pause: 0, pauseMode: "work" }];
    this.startNextLeg(a);
  }

  /** The panel takes an agent that is out walking (it stands, looking at the camera) or gives it back. */
  private hold(a: Agent, on: boolean): void {
    if (a.state === "work" || a.mode === "sit") return; // at its desk it goes on as it is
    if (on) {
      a.heldFrom = { facing: a.facing, flipped: a.flipped, mode: a.mode };
      a.speed = 0;
      this.setMotion(a, { facing: "down", flipped: false }, "still");
      return;
    }
    const from = a.heldFrom;
    a.heldFrom = null;
    if (!from) return;
    this.setMotion(a, { facing: from.facing, flipped: from.flipped }, from.mode);
    if (a.state === "trip" && a.leg) a.speed = a.pipeline ? PIPELINE_SPEED : SPEED;
  }

  // ─── Pipeline trips ────────────────────────────────────────────────────

  private pipeline(uid: string, toState: string): void {
    const a = this.agents.get(uid);
    if (!a || a.gone || a.legs.some((l) => l.exit) || a.leg?.exit) return;
    a.pulse = 0; // react_to_work: the real work shows
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
      this.seat(a, true);
      return;
    }
    a.settle = null;
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
        const off = a.home.offset;
        const to = { x: a.home.spot.x + off.x, y: a.home.spot.y + off.y };
        a.settle = { t: 0, from: { ...a.pos }, to };
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
