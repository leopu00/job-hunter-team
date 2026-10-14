import type { Rates } from "@/lib/exchange-rates";
import type { ApplicationTimelineEvent } from "@/lib/application-timeline";
import type { DashboardData } from "../pages/dashboard/load-dashboard";
import { readDesktopVpsStats, type DesktopVpsStats } from "./existing-team-positions";

/**
 * The dashboard of an existing team that is only read. Its numbers come from
 * the core on the team's VPS (counts by status, the score distribution, the
 * sources, the newest scored positions, the submissions): nothing is read
 * from the cloud and nothing is counted here from downloaded rows. What the
 * team's database has not got, or what would need the cloud, is not drawn as
 * zero: `existingTeam` says how much of each block there is.
 */
export class ExistingTeamDashboardError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type ExistingTeamDashboardSources = {
  stats: () => ReturnType<typeof readDesktopVpsStats>;
  rates: () => Promise<Rates | null>;
};

const RATES_URL = "https://api.frankfurter.dev/v1/latest?base=EUR";

/** The live rates, or null: the web's built-in table is an order of magnitude, not a rate. */
export async function readLiveRates(fetchImpl: typeof fetch = fetch, timeoutMs = 6000): Promise<Rates | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(RATES_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: unknown };
    if (!data.rates || typeof data.rates !== "object") return null;
    return { EUR: 1, ...(data.rates as Rates) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const SOURCES: ExistingTeamDashboardSources = { stats: readDesktopVpsStats, rates: readLiveRates };

export async function loadExistingTeamDashboard(
  sources: ExistingTeamDashboardSources = SOURCES,
): Promise<DashboardData> {
  const [reply, liveRates] = await Promise.all([sources.stats(), sources.rates()]);
  if (reply.source === "unavailable") throw new ExistingTeamDashboardError(reply.code);
  if (reply.source !== "vps") throw new ExistingTeamDashboardError("runtime_data_unavailable");
  const core: DesktopVpsStats = reply.data;

  // A salary in another currency needs a rate: without one it is left out, never read as euros.
  let salaryUnconverted = 0;
  const positions = liveRates
    ? core.points.rows
    : core.points.rows.map((p) => {
        if ((p.salary_min == null && p.salary_max == null) || p.salary_currency === "EUR") return p;
        salaryUnconverted++;
        return { ...p, salary_min: null, salary_max: null };
      });
  const applicationEvents: ApplicationTimelineEvent[] = core.events.rows.map((e) => ({
    appliedAt: e.appliedAt,
    response: e.response,
    responseAt: e.responseAt,
  }));

  return {
    stats: core.stats,
    positions,
    latest: core.recent,
    rates: liveRates ?? { EUR: 1 },
    applicationEvents,
    existingTeam: {
      active: core.distribution.active,
      withScore: core.distribution.withScore,
      avgScore: core.distribution.avgScore,
      buckets: core.distribution.buckets,
      sources: core.sources,
      chartsIncluded: core.points.included,
      chartsOf: core.points.of,
      eventsIncluded: core.events.included,
      eventsOf: core.events.of,
      ratesAvailable: liveRates !== null,
      salaryUnconverted,
    },
  };
}
