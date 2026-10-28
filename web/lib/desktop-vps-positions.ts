import type { PositionWithScore } from "./types";
import type { TeamActivityCounts } from "./team-activity";
import type {
  PositionDetail,
  PositionFacet,
  PositionFilterOpts,
} from "./queries";

/**
 * Desktop-only read seam for an already validated existing-team runtime.
 *
 * The web build keeps this implementation: it is deliberately inert so a
 * public request continues along its existing workspace/Supabase path. The
 * desktop aliases this module to a Tauri bridge. That bridge owns the active
 * account, persisted host and validated target; callers can only ask for one
 * of these fixed projections.
 */
export type DesktopVpsRead<T> =
  | { source: "not_desktop" }
  | { source: "vps"; data: T }
  | { source: "unavailable"; code: string };

/** One page of the team's positions, and how many match in all (the core counts them). */
export interface DesktopVpsPositionsWindow {
  items: PositionWithScore[];
  total: number;
  /** How many of the matching rows are in the «suspicious» section (JHT-T06), whichever view was asked. */
  scamSection?: number;
}

const notDesktop = <T>(): DesktopVpsRead<T> => ({ source: "not_desktop" });

export async function readDesktopVpsPositionsWindow(
  _opts: PositionFilterOpts,
): Promise<DesktopVpsRead<DesktopVpsPositionsWindow>> {
  return notDesktop();
}

export async function readDesktopVpsPositions(
  _opts?: PositionFilterOpts,
): Promise<DesktopVpsRead<PositionWithScore[]>> {
  return notDesktop();
}

export async function readDesktopVpsPosition(
  _id: string,
): Promise<DesktopVpsRead<PositionDetail | null>> {
  return notDesktop();
}

export async function readDesktopVpsPositionFacets(): Promise<
  DesktopVpsRead<PositionFacet[]>
> {
  return notDesktop();
}

/**
 * What each role of the team did per day and instance in a range, counted where the team's database is
 * (the desktop of a profile with no cloud account). The web has no such reader: its team page reads the cloud.
 */
export async function readDesktopVpsTeamActivity(
  _from: string,
  _to: string,
): Promise<DesktopVpsRead<TeamActivityCounts>> {
  return notDesktop();
}
