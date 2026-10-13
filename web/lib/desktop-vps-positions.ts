import type { PositionWithScore } from "./types";
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

const notDesktop = <T>(): DesktopVpsRead<T> => ({ source: "not_desktop" });

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
