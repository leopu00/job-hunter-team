/**
 * The office of the desktop control panel (D05, route B: React + PixiJS),
 * ported from the Godot office in game/. This file is the CONTRACT between
 * the three parts, built in parallel; it holds types and a few constants,
 * no logic. A change here is agreed first, then made.
 *
 *   ASSETS  (layout JSON, character atlases, animation data)
 *           produced by a repeatable script from game/assets and game/scripts
 *           /office/{furniture,department}_defs.gd, served under /office/.
 *   ENGINE  (navigation, agents' state machine, sprite rig timing, data ->
 *           events) pure TypeScript, no PixiJS, no DOM: testable in vitest.
 *   SCENE   (PixiJS in the webview: layers, camera, drawing the engine's
 *           poses, bubbles, piles, hit testing) plus the /office page.
 *
 * Coordinates are WORLD pixels, the Godot ones unchanged (origin top-left,
 * y down): the office is FurnitureDefs.WORLD = (0, -420, 3400, 2560) and its
 * floor FurnitureDefs.FLOOR = (240, 140, 2920, 1860). Times are seconds.
 */

// ─── Geometry ────────────────────────────────────────────────────────────

export type Vec = { x: number; y: number };
/** Godot's Rect2: position (x, y) of the top-left corner, then size. */
export type Rect = { x: number; y: number; w: number; h: number };
/** The four directions of the furniture and of a seated agent. */
export type Facing = "down" | "up" | "left" | "right";
/** The three rows of a sprite sheet; "left" is "side" drawn flipped. */
export type SheetFacing = "down" | "up" | "side";

// ─── Roles and departments ───────────────────────────────────────────────

/** The team's roles, as the agents page names them (pages/agents/load-agents.ts). */
export type AgentRole =
  | "capitano"
  | "scout"
  | "analista"
  | "scorer"
  | "scrittore"
  | "critico"
  | "sentinella"
  | "assistente"
  | "mentor";

/** The five departments of the pipeline (DepartmentDefs.DEPT_ORDER), in order. */
export type DeptId = "scout" | "analisti" | "scorer" | "scrittori" | "critici";

export const DEPT_ORDER: readonly DeptId[] = ["scout", "analisti", "scorer", "scrittori", "critici"];

/** Which department a pipeline role works in. The other roles have a core seat. */
export const DEPT_OF_ROLE: Partial<Record<AgentRole, DeptId>> = {
  scout: "scout",
  analista: "analisti",
  scorer: "scorer",
  scrittore: "scrittori",
  critico: "critici",
};

/** DepartmentDefs.FETCH_FROM: where a department picks its work up. Scout fetches nothing. */
export const FETCH_FROM: Partial<Record<DeptId, DeptId>> = {
  analisti: "scout",
  scorer: "analisti",
  scrittori: "scorer",
  critici: "scrittori",
};

// ─── Assets (john) ───────────────────────────────────────────────────────

/**
 * A picture the scene draws. `src` is a URL under /office/ (relative to the
 * app root, as the page asks for it); `frame` names a region when src is an
 * atlas. The scene never reads game/ directly.
 */
export type ImageRef = { src: string; frame?: string };

/** An atlas: one image and its named regions, in the image's own pixels. */
export type Atlas = {
  src: string;
  frames: Record<string, Rect>;
};

/**
 * One character's sprite sheet (game/assets/characters/sheets/<id>.png and
 * <id>_sit.png). The Godot sheet is 6 cols x 12 rows of 256x384 cells, feet
 * at (128, 360), drawn at RIG_SCALE; a recompressed sheet may be scaled
 * down: `cell` and `feet` are in the shipped image's pixels, and `scale`
 * is what brings one cell to world pixels (0.425 for the original size).
 */
export type SheetRef = {
  src: string;
  cols: number;
  rows: number;
  cell: { w: number; h: number };
  feet: Vec;
  scale: number;
};

export type CharacterSheet = {
  /** the Godot slug and variant: "scout_a", "analista_c", "coordinatore_a" */
  id: string;
  main: SheetRef;
  /** the 4x3 seated sheet, when the character has one */
  sit: SheetRef | null;
};

/** One row of a sheet: which row, how many frames from col 0, at what fps (0 = still). */
export type Track = { row: number; frames: number; fps: number };

/** SpriteSheetRig: the rig's scale and walk cadence (sprite_sheet_rig.gd). */
export const RIG_SCALE = 0.425;
export const WALK_REFERENCE_SPEED = 75;
export const WALK_MAX_FPS = 24;

/** SpriteSheetRig.TRACKS, key = `${mode}_${facing}` on the main sheet. */
export const TRACKS: Record<string, Track> = {
  idle_down: { row: 0, frames: 2, fps: 2 },
  idle_up: { row: 1, frames: 2, fps: 2 },
  idle_side: { row: 2, frames: 2, fps: 2 },
  still_down: { row: 0, frames: 1, fps: 0 },
  still_up: { row: 1, frames: 1, fps: 0 },
  still_side: { row: 2, frames: 1, fps: 0 },
  walk_down: { row: 3, frames: 6, fps: 10 },
  walk_up: { row: 4, frames: 6, fps: 10 },
  walk_side: { row: 5, frames: 6, fps: 10 },
  work_down: { row: 6, frames: 4, fps: 8 },
  work_up: { row: 7, frames: 4, fps: 8 },
  work_side: { row: 8, frames: 4, fps: 8 },
  carry_down: { row: 9, frames: 6, fps: 10 },
  carry_up: { row: 10, frames: 6, fps: 10 },
  carry_side: { row: 11, frames: 6, fps: 10 },
};

/** SpriteSheetRig.SIT_TRACKS, on the seated sheet. */
export const SIT_TRACKS: Record<string, Track> = {
  sit_down: { row: 0, frames: 4, fps: 8 },
  sit_up: { row: 1, frames: 4, fps: 8 },
  sit_side: { row: 2, frames: 4, fps: 8 },
  sit_idle_down: { row: 0, frames: 1, fps: 0 },
  sit_idle_up: { row: 1, frames: 1, fps: 0 },
  sit_idle_side: { row: 2, frames: 1, fps: 0 },
};

/** A piece of furniture (FurnitureDefs.ITEMS and the departments' desks). */
export type FurnitureItem = {
  id: string;
  kind: string;
  rect: Rect;
  facing?: Facing;
  /** false for what hangs on a wall (corkboard): no obstacle on the floor */
  blocking: boolean;
  /** null while the kind has no art: the scene draws a plain block on `rect` */
  image: ImageRef | null;
  /** the "occupied" art (agent seated at it), when there is one: same canvas, so same `draw` and `flip` */
  occupiedImage?: ImageRef;
  /**
   * Where the image is drawn, in world pixels. Godot places each kind of
   * furniture with a rule of its own (furniture_node.gd: width rect.w*1.06
   * with the base at rect.end.y+10, handoff tables 220 wide on the inbox,
   * rugs stretched on their rect…): the asset script computes it, so the
   * scene only draws. Missing = the image stretched on `rect`.
   */
  draw?: Rect;
  /** drawn mirrored horizontally (left/down_left from the _side/_diag_down art, wb_scorer) */
  flip?: boolean;
  /**
   * "floor": flat on the floor under everyone (rugs); "sorted" (default):
   * y-sorted with the agents by the bottom of `draw` (or of `rect`).
   */
  layer?: "floor" | "sorted";
  /**
   * The desk's front drawn again over an agent seated at it without a
   * seated picture (department_defs.gd front_occlusion, furniture_node.gd
   * _add_front_occluder): the part of the image below this fraction of its
   * height. Only the "down" desks, whose seat is behind the desk.
   */
  frontOcclusion?: number;
  /** the core role that sits here (registry_key "core:<role>"), if any */
  seatOf?: AgentRole;
};

/**
 * A desk of a department (DepartmentDefs.DEPARTMENTS[*].desks). Its
 * furniture need not be repeated in OfficeLayout.furniture: the scene draws
 * both lists, once per id.
 */
export type Desk = {
  /** 0..5, the order of DepartmentDefs (so `scout-5` gets desk 4, as in Godot) */
  index: number;
  furniture: FurnitureItem;
  /**
   * DepartmentDefs.desk_spot: the point STANDING in front of the chair, where
   * the path ends. Seated, the engine adds agent_npc.gd's seat offset.
   */
  seat: Vec;
  /** the way the seated agent looks */
  seatFacing: Facing;
  /**
   * agent_npc.gd _seat_offset() resolved for this desk: the desk's own
   * seat_offset (department_defs.gd; the diagonals differ from their facing)
   * or the table by facing. Missing = the engine uses the table by facing.
   */
  seatOffset?: Vec;
};

export type Department = {
  id: DeptId;
  /** the role that works here */
  role: AgentRole;
  name: string;
  /** "#rrggbb" */
  color: string;
  zone: Rect;
  /** DepartmentDefs "tagline", in English as the game falls back to */
  tagline?: string;
  /**
   * Where the name is written (department_dressing.gd: zone.x + 18,
   * zone.end.y - 34): the name at 26 px, the tagline 24 px below at 15 px.
   * The zone's tint and L brackets the scene draws from `zone` and `color`.
   */
  labelPos?: Vec;
  /**
   * The handoff table's tag (handoff_station.gd), "RESEARCH  →  ANALYSIS",
   * centred on labelPos at 10 px; pileSpot is where the paper pile stands.
   */
  handoff?: { label: string; labelPos: Vec; pileSpot: Vec };
  /** the handoff table where the department's output piles up */
  inbox: Vec;
  /** where the department's own agents stand to drop on it */
  inboxDropAccess: Vec;
  /** where the next department's agents stand to pick up from it */
  inboxPickupAccess: Vec;
  desks: Desk[];
};

/** A core role's fixed place (capitano, sentinella, mentor, assistente…). */
/** `seat` is the standing point, as for a Desk. */
export type CoreSeat = {
  role: AgentRole;
  seat: Vec;
  seatFacing: Facing;
  furnitureId: string;
  /** as Desk.seatOffset: the role def's seat_offset (the mentor's (0, -24)) or the table by facing */
  seatOffset?: Vec;
};

/** Everything static about the office: /office/layout.json. */
export type OfficeLayout = {
  version: 1;
  world: Rect;
  floor: Rect;
  /** the painted floor (floor_main), drawn over `floor` */
  floorImage: ImageRef;
  /**
   * What stands behind the floor, drawn before it: the north wall and the
   * glass band above it (game/scripts/office/office_floor.gd, wall_main
   * tiled horizontally). `repeatX`: the image is tiled across `draw` at the
   * scale that makes it `draw.h` tall, instead of stretched.
   */
  backdrop?: Array<{ image: ImageRef; draw: Rect; repeatX?: boolean }>;
  furniture: FurnitureItem[];
  departments: Department[];
  coreSeats: CoreSeat[];
  /** where agents enter and leave */
  door: Vec;
  /**
   * Shared points of the work flows: the printer the Scout goes to first
   * (DepartmentDefs.POIS.printer.spot) and the output shelf where the
   * Critici put a PASS (OutputShelf.RECT centre + (0, 46)).
   */
  pois: { printer: Vec; outputShelf: Vec };
  /**
   * NavGrid inputs (nav_grid.gd): the engine builds the grid from these.
   * The obstacles are every blocking piece of allFurniture(layout)
   * (layout-items.ts), the departments' desks included, grown by `margin`.
   */
  nav: {
    cell: number; // 32
    margin: number; // 28, around blocking furniture
    wallMargin: number; // 14
    walls: Rect[];
  };
  /**
   * The paper on the handoff tables (paper_pile.gd): stacks of `perStack`
   * sheets, each stack `rise` px higher per sheet, at most `maxStacks` in
   * `columns` columns laid along basisX/basisY, drawn `width` px wide.
   */
  paperPile?: {
    image: ImageRef;
    width: number;
    rise: number;
    perStack: number;
    maxStacks: number;
    columns: number;
    basisX: Vec;
    basisY: Vec;
  };
  /** which sheet each role wears, and the variants for its instances */
  sheets: Record<AgentRole, string[]>;
};

/** /office/manifest.json: the one file the page fetches first. */
export type OfficeManifest = {
  version: 1;
  layout: string; // URL of the OfficeLayout JSON
  characters: CharacterSheet[];
  atlases: Atlas[];
};

// ─── Agents at runtime (engine) ──────────────────────────────────────────

/** SpriteSheetRig modes. "sit" reads the seated sheet. */
export type AgentMode = "idle" | "still" | "walk" | "work" | "carry" | "sit";

/** One agent in the office: `uid` is the instance (scout-2) or the role for a single one. */
export type OfficeAgent = {
  uid: string;
  role: AgentRole;
  /**
   * The CharacterSheet id it wears. The data layer has no layout and leaves
   * it "": the engine picks layout.sheets[role][(n - 1) % length] from the
   * instance number (scout-2 -> the second variant). Always set in poses().
   */
  sheet: string;
};

/** What the scene draws for an agent, every frame. */
export type AgentPose = {
  uid: string;
  role: AgentRole;
  sheet: string;
  /** the feet, in world pixels */
  pos: Vec;
  mode: AgentMode;
  facing: SheetFacing;
  /** true when "side" is drawn facing left */
  flipped: boolean;
  /** frame index within the track */
  frame: number;
  /** carrying a sheet of paper (draws the carry track, or a sheet in hand) */
  carrying: boolean;
  /**
   * The furniture id the agent is seated at, working at its own desk or
   * core seat; absent when standing or walking. Where that furniture has
   * an occupiedImage, the scene draws it (desk and agent in one picture,
   * as Godot's seated_art) and hides the agent's own sprite.
   */
  seatedAt?: string;
};

/**
 * An agent's status as the box publishes it (team_state.agents_status,
 * migration 089), with the Godot game's rule; "idle" is the game's WAITING.
 */
export type AgentStatus = {
  status: "working" | "idle" | "paused" | "throttled";
  /** throttled only: when the pause ends, on this computer's clock */
  throttleUntil?: number;
};

/** The statuses to tag, by uid (capitano, scout-1…); `at` is when the box observed them. */
export type AgentStatuses = { at: number; agents: Record<string, AgentStatus> };

/** A speech bubble over an agent. */
export type Bubble = { uid: string; text: string; until: number };

/** The count on each department's handoff pile (office.gd PILE_PHASE), null = unknown. */
export type Piles = Record<DeptId, number | null>;

// ─── Data from the cloud → events (engine) ──────────────────────────────

/** A position as the office tells it: what an agent carries or talks about. */
export type PositionTag = {
  /** uuid, for the link to /positions/:id; null when not on the cloud */
  id: string | null;
  legacyId: number;
  title: string | null;
  company: string | null;
};

/**
 * What the office reads from the cloud, with the user's session (RLS). Only
 * what exists (D03): position_transitions, the positions' counts, team_state.
 * The tmux roster, CPU and the agents' chat do not reach the cloud and are
 * not part of phase 1.
 */
export type OfficeSnapshot = {
  /** team_state.is_running with a fresh heartbeat; null = never written */
  teamOnline: boolean | null;
  heartbeatAt: string | null;
  /** the agents in the office: derived from the data, never invented */
  roster: OfficeAgent[];
  piles: Piles;
  /** position_transitions, newest first, with the position resolved */
  transitions: Array<{
    ts: string;
    byAgent: string;
    from: string | null;
    to: string | null;
    position: PositionTag;
  }>;
};

/**
 * What the engine is told happened. The data layer turns two snapshots into
 * these (the first snapshot seats everyone and only sets the piles); the
 * scene never makes them up.
 */
export type OfficeEvent =
  /** an agent appears: seated at once on the first snapshot, through the door after */
  | { type: "enter"; agent: OfficeAgent; atOnce: boolean }
  /** an agent walks out of the door and is removed */
  | { type: "leave"; uid: string }
  /**
   * a position changed state by this agent: its department's trip
   * (agent_npc.gd _prepare_pipeline_trip): pick up from the FETCH_FROM
   * pile, carry to the desk, work, drop on its own pile, back to the seat.
   * Scout instead goes to the printer first.
   */
  | { type: "pipeline"; uid: string; toState: string; position: PositionTag; ts: string }
  /**
   * the piles' TRUE counts on the cloud, already including the pipeline
   * events that arrived with them: the engine's piles() reaches them sheet
   * by sheet as the trips drop and pick up, never counting twice
   */
  | { type: "piles"; piles: Piles }
  /** a line over an agent's head */
  | { type: "say"; uid: string; text: string; seconds: number };

// ─── The engine's API (charles) ──────────────────────────────────────────

/** The engine: all the office's state and motion, no drawing. */
export interface OfficeEngine {
  apply(event: OfficeEvent): void;
  /** advances the world by `dt` seconds (the scene calls it once per frame) */
  step(dt: number): void;
  poses(): AgentPose[];
  bubbles(): Bubble[];
  /** the counts as drawn now: moving towards the last "piles" event with the trips */
  piles(): Piles;
}

/** Builds an engine over a layout. `random` is injectable so tests are deterministic. */
/**
 * `characters`: the manifest's sheets, so the engine knows who has a seated
 * sheet (without one, "sit" becomes "work" standing on the spot, as in
 * Godot). Missing = every character is assumed to have one.
 */
export type CreateOfficeEngine = (
  layout: OfficeLayout,
  options?: { random?: () => number; characters?: CharacterSheet[] },
) => OfficeEngine;

/**
 * The data layer: reads a snapshot with the user's Supabase client, and turns
 * the previous snapshot and the new one into events (prev = null on the
 * first read). Both pure but for the client.
 */
export type LoadOfficeSnapshot = (client: import("@supabase/supabase-js").SupabaseClient) => Promise<OfficeSnapshot>;
export type DiffOfficeSnapshots = (prev: OfficeSnapshot | null, next: OfficeSnapshot) => OfficeEvent[];

// ─── The scene's API (sadie) ─────────────────────────────────────────────

/** What a click in the office means; the page turns it into a route. */
export type OfficeClick =
  | { kind: "agent"; uid: string; role: AgentRole } // -> /agents?agent=<role>
  | { kind: "pile"; dept: DeptId }; // -> /positions

export type OfficeSceneOptions = {
  manifest: OfficeManifest;
  layout: OfficeLayout;
  engine: OfficeEngine;
  onClick: (click: OfficeClick) => void;
};

export interface OfficeScene {
  resize(width: number, height: number): void;
  /** the tags over the agents; null = no tags (no status, or an old one) */
  setAgentStatuses?(statuses: AgentStatuses | null): void;
  destroy(): void;
}
