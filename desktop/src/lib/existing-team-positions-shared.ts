import type { PositionWithScore } from "../../../web/lib/types";
import { readDesktopVpsPositions, type DesktopVpsRead } from "./existing-team-positions";

/** All the team's positions in one bounded read per page (the native side pages by 600). */
const ALL_ROWS = { limit: 20_000 } as const;
/** The globe asks for its three routes together (coords twice): one read of the VPS serves them. */
export const SHARED_READ_MS = 5_000;

let shared: { at: number; read: Promise<DesktopVpsRead<PositionWithScore[]>> } | null = null;

/**
 * The team's positions as the core serves them, one bounded read shared by
 * everything in the read-only view that needs them for SHARED_READ_MS: the
 * globe's three routes (pages/map/map-api.ts) and the office's panels
 * (office/panel/vps-panels.ts). The read itself, with the way it failed when it
 * did: a caller that must tell an empty team from a team it could not read (the
 * office's panels) needs that, and the map does not.
 *
 * A module of its own, small: the office's panels must not bring the map's
 * queries (and the cloud client behind them) into their imports.
 */
export function readVpsPositionsShared(now = Date.now()): Promise<DesktopVpsRead<PositionWithScore[]>> {
  if (shared && now - shared.at < SHARED_READ_MS) return shared.read;
  const read = readDesktopVpsPositions(ALL_ROWS);
  shared = { at: now, read };
  return read;
}

/** Forgets the shared read (a test, or a new view). */
export function resetVpsPositionsShared(): void {
  shared = null;
}
