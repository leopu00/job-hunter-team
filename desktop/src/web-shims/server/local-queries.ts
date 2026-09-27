/**
 * Stand-in for web/lib/local-queries.ts, the web's SQLite reader
 * (better-sqlite3, filesystem). Its functions only run on the local-workspace
 * branch, which the desktop never takes (see workspace.ts: no workspace, so
 * `ws()` in web/lib/queries.ts is always null). They exist here so the web
 * modules that import them load and type-check; calling one is a bug.
 */
// `never`, not `any`: in web/lib/queries.ts the local call sits next to the
// cloud query (`w ? local.x(w) : cloud`), and an `any` there would erase the
// cloud branch's type too (tsc then flags the web's callbacks as implicit any).
function localOnly(name: string): (...args: any[]) => never {
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
export const sendUserChatLocal = localOnly("sendUserChatLocal");
export const getScoutActivityLocal = localOnly("getScoutActivityLocal");
export const getScorerActivityLocal = localOnly("getScorerActivityLocal");
export const getAnalistaActivityLocal = localOnly("getAnalistaActivityLocal");
export const getScrittoreActivityLocal = localOnly("getScrittoreActivityLocal");
export const getCriticoActivityLocal = localOnly("getCriticoActivityLocal");

/**
 * Not a SQLite reader: web/app/api/analista/activity/route.ts also uses it on
 * the cloud branch, to bucket exclusion notes. Copied as it is from
 * web/lib/local-queries.ts (the web stays unchanged); local-queries.test.ts
 * compares the two on every bucket.
 */
export function categorizeExclusion(notes: string | null): string {
  const n = (notes || "").toLowerCase();
  const m = n.match(/esclus[ao]:\s*\[(\w+)\]/i);
  if (m) return m[1].toUpperCase();
  if (
    /link scaduto|link morto|404|redirect|lavoro occupato|pagina rimossa|url morto/.test(
      n,
    )
  )
    return "LINK_MORTO";
  if (/score < 40|score <40|score basso/.test(n)) return "SCORE_BASSO";
  if (/duplicat|già presente|stessa posizione/.test(n)) return "DUPLICATA";
  if (
    /us-only|uk-only|americas|restrizione geografica|work authorization uk|post-brexit/.test(
      n,
    )
  )
    return "GEO";
  if (/lingua croata|tedesco obbligat|polacco|ungherese|français|dutch/.test(n))
    return "LINGUA";
  if (/senior con 5\+|5\+ anni obbligatori|seniority troppo/.test(n))
    return "SENIORITY";
  if (/senza python|no python|solo java|solo node|stack incomp/.test(n))
    return "STACK";
  if (/zero sviluppo|mismatch|ruolo non-dev|iam analyst|no coding/.test(n))
    return "RUOLO";
  if (/scam|fantasma|red flag/.test(n)) return "SCAM";
  if (/voto critico|critic/.test(n)) return "CRITICO";
  return "NON_CATEGORIZZATA";
}
export const ackPendingMessageLocal = localOnly("ackPendingMessageLocal");
