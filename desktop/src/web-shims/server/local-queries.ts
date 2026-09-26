/**
 * Stand-in for web/lib/local-queries.ts, the web's SQLite reader
 * (better-sqlite3, filesystem). Its functions only run on the local-workspace
 * branch, which the desktop never takes (see workspace.ts: no workspace, so
 * `ws()` in web/lib/queries.ts is always null). They exist here so the web
 * modules that import them load and type-check; calling one is a bug.
 */
function localOnly(name: string): (...args: any[]) => any {
  return () => {
    throw new Error(`${name}: local SQLite workspace is not available in the desktop`);
  };
}

// Same shape as PositionCoord in web/lib/local-queries.ts (the map's rows).
export interface PositionCoord {
  id: string;
  title: string;
  company: string;
  status: string;
  role_family: string | null;
  score: number | null;
  lat: number;
  lon: number;
  is_remote: boolean;
  remote_type: string | null;
  location: string | null;
  loc_country: string | null;
  loc_city: string | null;
  office_address: string | null;
  created_at: string | null;
}

export const countPendingMessagesLocal = localOnly("countPendingMessagesLocal");
export const getApplicationTimelineEventsLocal = localOnly("getApplicationTimelineEventsLocal");
export const getDashboardPositionsLocal = localOnly("getDashboardPositionsLocal");
export const getDashboardStatsLocal = localOnly("getDashboardStatsLocal");
export const getMessagesHistoryLocal = localOnly("getMessagesHistoryLocal");
export const getPositionByIdLocal = localOnly("getPositionByIdLocal");
export const getPositionFacetsLocal = localOnly("getPositionFacetsLocal");
export const getPositionLocationsLocal = localOnly("getPositionLocationsLocal");
export const getPositionTypeDistributionLocal = localOnly("getPositionTypeDistributionLocal");
export const getPositionsLocal = localOnly("getPositionsLocal");
export const getPositionsWithCoordsLocal = localOnly("getPositionsWithCoordsLocal");
export const getPositionsWithoutCoordsLocal = localOnly("getPositionsWithoutCoordsLocal");
export const getRecentPositionsLocal = localOnly("getRecentPositionsLocal");
export const getScoreDistributionLocal = localOnly("getScoreDistributionLocal");
export const getScorerStatsLocal = localOnly("getScorerStatsLocal");
export const getScoutStatsLocal = localOnly("getScoutStatsLocal");
export const getSourceDistributionLocal = localOnly("getSourceDistributionLocal");
export const getTeamActivityLocal = localOnly("getTeamActivityLocal");
export const getTeamActivityLogLocal = localOnly("getTeamActivityLogLocal");
export const getApplyRequestSignalsLocal = localOnly("getApplyRequestSignalsLocal");
