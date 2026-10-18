import type { ApplicationTimelineEvent } from "@/lib/application-timeline";
import { BASE_CURRENCIES, getExchangeRates, type Rates } from "@/lib/exchange-rates";
import {
  getApplicationTimelineEvents,
  getDashboardPositions,
  getDashboardStats,
  getSeenPositionIds,
  type DashboardClient,
  type DashboardPosition,
  type DashboardStats,
} from "../../lib/dashboard-data";

/**
 * What the dashboard screen draws: the same inputs web/app/(protected)/dashboard/page.tsx gathers.
 * Read from an existing team's VPS it also says how much of each block it got
 * (`existingTeam`) and brings the core's own numbers, so the screen never
 * shows a bounded or missing block as a complete one.
 */
export type DashboardData = {
  stats: DashboardStats;
  positions: DashboardPosition[];
  rates: Rates;
  applicationEvents: ApplicationTimelineEvent[];
  /** The newest scored positions, read apart from `positions` (which may be a bounded slice). */
  latest?: DashboardPosition[];
  existingTeam?: ExistingTeamDashboardInfo;
};

export type ExistingTeamDashboardInfo = {
  /** Over the active positions, as the core counts them. */
  active: number;
  withScore: number;
  avgScore: number | null;
  buckets: Array<{ min: number; max: number; count: number }>;
  sources: Array<{ source: string; count: number }>;
  /** The charts draw `chartsIncluded` of the `chartsOf` active positions. */
  chartsIncluded: number;
  chartsOf: number;
  /** The timeline draws `eventsIncluded` of the `eventsOf` submissions. */
  eventsIncluded: number;
  eventsOf: number;
  /** Live exchange rates were read; without them only euro salaries are drawn. */
  ratesAvailable: boolean;
  /** Positions whose salary is not in euro and could not be converted. */
  salaryUnconverted: number;
};

export type DashboardSources = {
  stats: (client: DashboardClient) => Promise<DashboardStats>;
  positions: (client: DashboardClient) => Promise<DashboardPosition[]>;
  applicationEvents: (client: DashboardClient) => Promise<ApplicationTimelineEvent[]>;
  seenIds: (client: DashboardClient) => Promise<Set<string>>;
  rates: () => Promise<Rates>;
};

const SOURCES: DashboardSources = {
  stats: getDashboardStats,
  positions: getDashboardPositions,
  applicationEvents: getApplicationTimelineEvents,
  seenIds: getSeenPositionIds,
  rates: getExchangeRates,
};

/**
 * Reads the signed-in user's dashboard. The queries go through the user's own
 * session, so RLS scopes every row to them. Like the web page, a position the
 * user already opened (position_views) is marked `seen`.
 */
export async function loadDashboard(
  client: DashboardClient,
  sources: DashboardSources = SOURCES,
): Promise<DashboardData> {
  const [stats, positions, applicationEvents, seenIds, rates] = await Promise.all([
    sources.stats(client),
    sources.positions(client),
    sources.applicationEvents(client),
    sources.seenIds(client),
    sources.rates(),
  ]);
  return {
    stats,
    positions: positions.map((p) => (seenIds.has(p.id) ? { ...p, seen: true } : p)),
    rates,
    applicationEvents,
  };
}

/**
 * «Le ultime posizioni valutate», as on the web: score required, never
 * excluded, newest score first, eight rows.
 */
export function newestScored(positions: DashboardPosition[]): DashboardPosition[] {
  return positions
    .filter((p) => p.status !== "excluded" && p.score != null && p.scored_at != null)
    .sort((a, b) => Date.parse(b.scored_at ?? "") - Date.parse(a.scored_at ?? ""))
    .slice(0, 8);
}

/**
 * Currencies of the salary chart. The web adds the ones the user picked in
 * jht.config.json, a file the desktop does not read: the base set here.
 */
export function displayCurrencies(): string[] {
  return [...BASE_CURRENCIES];
}
