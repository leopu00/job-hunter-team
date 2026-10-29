import type { AgentRole, DeptId, OfficeAgent, OfficeClick } from "../office/contract";
import type { TourStopSlug } from "./tour-speech.i18n";

/**
 * The tour of the office: the Assistant leads the person from stop to stop (her own desk, the five departments of
 * the pipeline, the Mentor, the Coordinator) and the colleague of each stop introduces themself. The game's tour
 * (game/scripts/setup/tour_guide.gd) keeps its state in a file; here the state is what follows, kept in the
 * webview's storage, and the person can pause the tour and take it up again where it was.
 */
export const TOUR_STOPS: readonly TourStopSlug[] = [
  "assistente", "scout", "analista", "scorer", "scrittore", "critico", "mentor", "capitano",
];

/**
 * `offer`: never started, the Assistant invites. `running`: a stop is shown. `paused`: the person stopped it, it
 * resumes at the same stop. `later`: the person declined the invitation, the way back stays in the office.
 * `done`: the last stop was passed.
 */
export type TourStatus = "offer" | "running" | "paused" | "later" | "done";

export interface TourState {
  status: TourStatus;
  /** The stop shown (or the stop a pause or the end left): an index of TOUR_STOPS. */
  index: number;
}

export const TOUR_START: TourState = { status: "offer", index: 0 };

const LAST = TOUR_STOPS.length - 1;

/** The invitation accepted (or the tour taken again after «later»): from the first stop. */
export function startTour(state: TourState): TourState {
  return state.status === "offer" || state.status === "later" ? { status: "running", index: 0 } : state;
}

export function nextStop(state: TourState): TourState {
  if (state.status !== "running") return state;
  return state.index >= LAST ? { status: "done", index: LAST } : { status: "running", index: state.index + 1 };
}

export function pauseTour(state: TourState): TourState {
  return state.status === "running" ? { status: "paused", index: state.index } : state;
}

export function resumeTour(state: TourState): TourState {
  return state.status === "paused" ? { status: "running", index: state.index } : state;
}

/** «Not now» on the invitation. A tour already begun is paused, never dropped. */
export function postponeTour(state: TourState): TourState {
  return state.status === "offer" ? { status: "later", index: 0 } : state;
}

const DEPT_OF_STOP: Partial<Record<TourStopSlug, DeptId>> = {
  scout: "scout",
  analista: "analisti",
  scorer: "scorer",
  scrittore: "scrittori",
  critico: "critici",
};

const ROLE_OF_STOP: Partial<Record<TourStopSlug, AgentRole>> = {
  assistente: "assistente",
  mentor: "mentor",
  capitano: "capitano",
};

/**
 * What the camera goes to at a stop: a department's zone, or the core role's own seat. A role that is not in the
 * office now (the team is off, the roster is empty) has no target: the stop is still told, the camera stays.
 */
export function stopTarget(stop: TourStopSlug, roster: readonly OfficeAgent[]): OfficeClick | null {
  const dept = DEPT_OF_STOP[stop];
  if (dept) return { kind: "department", dept };
  const role = ROLE_OF_STOP[stop];
  const agent = role ? roster.find((a) => a.role === role) : undefined;
  return agent ? { kind: "agent", uid: agent.uid, role: agent.role } : null;
}

// ─── What is kept ────────────────────────────────────────────────────────

const KEY = "jht.desktop.office-tour.v1";

export interface TourStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function webviewStore(): TourStore | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

const STATUSES: readonly string[] = ["offer", "running", "paused", "later", "done"];

/**
 * The kept state. A tour that was running when the window closed comes back paused: the person finds the stop
 * where they left it and decides when to go on. Unreadable or unknown is the invitation, as for a new person.
 */
export function readTour(from: TourStore | null = webviewStore()): TourState {
  try {
    const raw = from?.getItem(KEY);
    if (!raw) return TOUR_START;
    const parsed = JSON.parse(raw) as { status?: unknown; index?: unknown };
    const { status, index } = parsed;
    if (typeof status !== "string" || !STATUSES.includes(status)) return TOUR_START;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > LAST) return TOUR_START;
    return { status: status === "running" ? "paused" : (status as TourStatus), index };
  } catch {
    return TOUR_START;
  }
}

/** Keeps the state; false when it could not be kept (the tour then offers itself again at the next start). */
export function writeTour(state: TourState, to: TourStore | null = webviewStore()): boolean {
  try {
    to?.setItem(KEY, JSON.stringify(state));
    return to !== null && to !== undefined;
  } catch {
    return false;
  }
}
