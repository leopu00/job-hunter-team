import type { PositionWithScore } from "../../../web/lib/types";
import { readDesktopVpsPositions, type DesktopVpsRead } from "./existing-team-positions";
import { existingTeamConnectionKey } from "./existing-team-readonly";

/** All the team's positions in one bounded read per page (the native side pages by 600). */
const ALL_ROWS = { limit: 20_000 } as const;
/** The globe asks for its three routes together (coords twice): one read of the VPS serves them. */
export const SHARED_READ_MS = 5_000;

let shared: { at: number; key: string; read: Promise<DesktopVpsRead<PositionWithScore[]>> } | null = null;

/**
 * The team's positions as the core serves them, one bounded read shared by
 * everything in the read-only view that needs them for SHARED_READ_MS: the
 * globe's three routes (pages/map/map-api.ts) and the office's panels
 * (office/panel/vps-panels.ts). The read itself, with the way it failed when it
 * did: a caller that must tell an empty team from a team it could not read (the
 * office's panels) needs that, and the map does not.
 *
 * Kept only for the connection it was read on (existingTeamConnectionKey: this
 * opening of the view, its account, VPS and team): another team or another
 * opening reads again, and with the view closed nothing is kept. A read that
 * comes back after the view changed is not given to the new one: it is told the
 * target changed.
 *
 * A module of its own, small: the office's panels must not bring the map's
 * queries (and the cloud client behind them) into their imports.
 */
export function readVpsPositionsShared(now = Date.now()): Promise<DesktopVpsRead<PositionWithScore[]>> {
  const key = existingTeamConnectionKey();
  if (key === null) {
    shared = null;
    return readDesktopVpsPositions(ALL_ROWS);
  }
  if (shared && shared.key === key && now - shared.at < SHARED_READ_MS) return shared.read;
  const read = readDesktopVpsPositions(ALL_ROWS).then((result): DesktopVpsRead<PositionWithScore[]> =>
    existingTeamConnectionKey() === key ? result : { source: "unavailable", code: "existing_team_target_changed" });
  shared = { at: now, key, read };
  return read;
}

/** Forgets the shared read (a test, or a new view). */
export function resetVpsPositionsShared(): void {
  shared = null;
}
