import type { PositionWithScore } from "../../../web/lib/types";
import { readDesktopVpsMap, readDesktopVpsPiles, readDesktopVpsPositions, type DesktopVpsMapRow, type DesktopVpsPiles, type DesktopVpsRead } from "./existing-team-positions";
import { localTeamDataKey } from "./local-team-data";
import { existingTeamConnectionKey } from "./existing-team-readonly";

/** All the team's positions in one bounded read per page (the native side pages by 600). */
const ALL_ROWS = { limit: 20_000 } as const;
/** The globe asks for its three routes together (coords twice): one read of the VPS serves them. */
export const SHARED_READ_MS = 5_000;

let shared: { at: number; key: string; read: Promise<DesktopVpsRead<PositionWithScore[]>> } | null = null;
let sharedPiles: { at: number; key: string; read: Promise<DesktopVpsRead<DesktopVpsPiles>> } | null = null;

/** What a kept read belongs to: the existing team's connection, or the profile whose team is on this computer; null: nothing is kept. */
function sharedKey(): string | null {
  const view = existingTeamConnectionKey();
  if (view !== null) return view;
  const local = localTeamDataKey();
  return local === null ? null : `this-computer:${local}`;
}

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
  const key = sharedKey();
  if (key === null) {
    shared = null;
    return readDesktopVpsPositions(ALL_ROWS);
  }
  if (shared && shared.key === key && now - shared.at < SHARED_READ_MS) return shared.read;
  const read = readDesktopVpsPositions(ALL_ROWS).then((result): DesktopVpsRead<PositionWithScore[]> =>
    sharedKey() === key ? result : { source: "unavailable", code: "existing_team_target_changed" });
  shared = { at: now, key, read };
  return read;
}

let sharedMap: { at: number; key: string; read: Promise<DesktopVpsRead<DesktopVpsMapRow[]>> } | null = null;

/**
 * What the globe draws, read the way readVpsPositionsShared reads the list (one read for its three
 * routes, kept for SHARED_READ_MS, only for the connection it was read on) but with the core's `map`
 * read: the fields the globe uses and nothing else, in as few replies as the byte budget allows.
 */
export function readVpsMapShared(now = Date.now()): Promise<DesktopVpsRead<DesktopVpsMapRow[]>> {
  const key = existingTeamConnectionKey();
  if (key === null) {
    sharedMap = null;
    return readDesktopVpsMap();
  }
  if (sharedMap && sharedMap.key === key && now - sharedMap.at < SHARED_READ_MS) return sharedMap.read;
  const read = readDesktopVpsMap().then((result): DesktopVpsRead<DesktopVpsMapRow[]> =>
    existingTeamConnectionKey() === key ? result : { source: "unavailable", code: "existing_team_target_changed" });
  sharedMap = { at: now, key, read };
  return read;
}

/** Forgets the shared reads (a test, or a new view). */
export function resetVpsPositionsShared(): void {
  shared = null;
  sharedMap = null;
  sharedPiles = null;
}

/**
 * The office's five pile counts: ONE read of the core (not the whole list), kept for SHARED_READ_MS for the
 * connection or the local profile it was read on, with the same rules as the list above. A read that is still on its
 * way is shared by whoever asks meanwhile, so two callers never make two reads.
 */
export function readVpsPilesShared(now = Date.now()): Promise<DesktopVpsRead<DesktopVpsPiles>> {
  const key = sharedKey();
  if (key === null) {
    sharedPiles = null;
    return readDesktopVpsPiles();
  }
  if (sharedPiles && sharedPiles.key === key && now - sharedPiles.at < SHARED_READ_MS) return sharedPiles.read;
  const read = readDesktopVpsPiles().then((result): DesktopVpsRead<DesktopVpsPiles> =>
    sharedKey() === key ? result : { source: "unavailable", code: "existing_team_target_changed" });
  sharedPiles = { at: now, key, read };
  return read;
}
