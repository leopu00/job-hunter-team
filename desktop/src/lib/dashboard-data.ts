// Dashboard data for the desktop app, read from the same Supabase as the web
// with the user's own session (anon key + JWT): RLS is the only per-user
// filter, exactly as on the web. Never a service_role client here.
//
// Where it comes from: the CLOUD branch of the functions of the same name in
// web/lib/queries.ts. That file imports next/headers (cookies, request host)
// for its demo and local-SQLite branches, which have no meaning in a desktop
// window, so the cloud branch is copied here with the same selects, filters,
// order and mapping. dashboard-data.test.ts reads web/lib/queries.ts and
// fails when a select or a filter drifts between the two.
//
// What is shared instead of copied: the pure modules of web/lib that import
// nothing (types, salary rule, role-family aggregation, timeline event type).
//
// Every function takes the client as its first argument and, like the web,
// answers "empty" on a query error instead of throwing.

import {
  aggregateRoleFamilies,
  type RoleFamilyCount,
} from "../../../web/lib/position-classifier";
import { salaryPreference } from "../../../web/lib/salary-source";
import type { ApplicationTimelineEvent } from "../../../web/lib/application-timeline";
import type {
  DashboardStats,
  PositionWithScore,
} from "../../../web/lib/types";

export type {
  ApplicationTimelineEvent,
  DashboardStats,
  PositionWithScore,
  RoleFamilyCount,
};

// Structural on purpose: a SupabaseClient from @supabase/supabase-js fits as
// it is, and the tests can pass a fake without the real package.
export type DashboardClient = {
  from(table: string): any;
};

// Same shape as DashboardPosition in web/lib/queries.ts (the test compares
// the field lists).
export type DashboardPosition = {
  id: string;
  legacy_id: number | null;
  title: string | null;
  company: string | null;
  location: string | null;
  remote_type: string | null;
  status: string;
  score: number | null;
  role_family: string | null;
  loc_country: string | null;
  loc_city: string | null;
  source: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  found_at: string | null;
  // When the Scorer scored it (scores.scored_at), null if not scored yet.
  scored_at: string | null;
  last_action_at: string;
  // Who did the last action: role (scout/analista/scorer/scrittore/critico/
  // user) and instance name (e.g. 'scout-1', falling back to the role).
  last_action_by: string;
  last_action_actor: string;
  // Critic vote (0-10) + verdict (PASS|NEEDS_WORK|REJECT), null if not
  // reviewed yet.
  critic_score: number | null;
  critic_verdict: string | null;
  // true = already opened by the user (position_views). Undefined on the
  // cloud path, where getSeenPositionIds answers separately.
  seen?: boolean;
};

export type RecentPosition = PositionWithScore & { last_action_at?: string };

export type ScoreBucket = { label: string; count: number; color: string };

export type ScoreDistribution = {
  buckets: ScoreBucket[];
  total: number;
  withScore: number;
  avgScore: number | null;
  scores: number[];
};

export type SourceCount = { source: string; count: number };

// PostgREST caps a response at 1000 rows even when the caller sets no limit:
// the answer looks complete and is only the first block. The builder arrives
// here after filters and order; `.range()` only moves the window.
const POSTGREST_PAGE_SIZE = 1000;

type PostgrestRangeQuery<T> = {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: T[] | null; error: unknown }>;
};

async function fetchPostgrestRows<T>(
  query: PostgrestRangeQuery<T>,
): Promise<{ data: T[]; error: unknown | null }> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await query.range(
      offset,
      offset + POSTGREST_PAGE_SIZE - 1,
    );
    if (error || !data) {
      return {
        data: rows,
        error: error ?? new Error("PostgREST response did not contain data"),
      };
    }
    rows.push(...data);
    if (data.length < POSTGREST_PAGE_SIZE) break;
    offset += data.length;
  }
  return { data: rows, error: null };
}

const EMPTY_STATS: DashboardStats = {
  total: 0,
  new: 0,
  checked: 0,
  scored: 0,
  writing: 0,
  review: 0,
  ready: 0,
  applied: 0,
  excluded: 0,
  response: 0,
  scored_open: 0,
  to_write: 0,
};

export async function getDashboardStats(
  client: DashboardClient,
): Promise<DashboardStats> {
  const query = client
    .from("positions")
    .select("status, write_requested")
    .is("deleted_at", null)
    .order("id", { ascending: true });
  const { data, error } = await fetchPostgrestRows<any>(query);
  if (error || !data) return { ...EMPTY_STATS };

  const counts: Record<string, number> = {};
  for (const row of data) counts[row.status] = (counts[row.status] ?? 0) + 1;

  // "To write" counts the positions the user selected (write_requested) whose
  // CV is not ready yet; "scored_open" counts the scored ones NOT selected.
  const TO_WRITE_STATUSES = new Set(["scored", "writing", "review"]);
  let to_write = 0;
  let scored_requested = 0;
  for (const row of data) {
    if (row.write_requested && TO_WRITE_STATUSES.has(row.status)) to_write++;
    if (row.write_requested && row.status === "scored") scored_requested++;
  }

  return {
    total: data.length,
    new: counts["new"] ?? 0,
    checked: counts["checked"] ?? 0,
    scored: counts["scored"] ?? 0,
    writing: counts["writing"] ?? 0,
    review: counts["review"] ?? 0,
    ready: counts["ready"] ?? 0,
    applied: counts["applied"] ?? 0,
    excluded: counts["excluded"] ?? 0,
    response: counts["response"] ?? 0,
    scored_open: (counts["scored"] ?? 0) - scored_requested,
    to_write,
  };
}

export async function getRecentPositions(
  client: DashboardClient,
  limit = 15,
): Promise<RecentPosition[]> {
  const { data, error } = await client
    .from("positions")
    .select(
      "id, legacy_id, title, company, location, remote_type, salary_declared_min, salary_declared_max, url, source, found_at, last_checked, status, notes, scores ( total_score, scored_at )",
    )
    .not("status", "eq", "excluded")
    .is("deleted_at", null)
    .order("found_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as any[]).map((p) => {
    // last_action_at = the LAST action among scout / analyst / scorer.
    const score = Array.isArray(p.scores) ? p.scores[0] : p.scores;
    const candidates = [p.found_at, p.last_checked, score?.scored_at].filter(
      Boolean,
    ) as string[];
    const last_action_at =
      candidates.length > 0
        ? candidates.reduce((acc, cur) => (cur > acc ? cur : acc))
        : p.found_at;
    return { ...p, score: score?.total_score ?? undefined, last_action_at };
  });
}

type LastActionCandidate = {
  ts: string | null | undefined;
  by: string;
  actor: string | null | undefined;
};

// Same as pickLastAction in web/lib/queries.ts.
function pickLastAction(cands: LastActionCandidate[]): {
  at: string;
  by: string;
  actor: string;
} {
  let best: { at: string; by: string; actor: string } | null = null;
  for (const c of cands) {
    if (!c.ts) continue;
    if (!best || c.ts > best.at) {
      best = { at: c.ts, by: c.by, actor: c.actor || c.by };
    }
  }
  return best ?? { at: "", by: "scout", actor: "scout" };
}

export async function getDashboardPositions(
  client: DashboardClient,
): Promise<DashboardPosition[]> {
  const query = client
    .from("positions")
    .select(
      "id, legacy_id, title, company, location, remote_type, status, role_family, loc_country, loc_city, source, salary_estimated_min, salary_estimated_max, salary_estimated_currency, salary_declared_min, salary_declared_max, salary_declared_currency, found_at, found_by, last_checked, scores ( total_score, scored_at, scored_by ), applications ( critic_score, critic_verdict, written_at, written_by, critic_reviewed_at, reviewed_by, applied_at, response_at )",
    )
    .not("status", "eq", "excluded")
    .is("deleted_at", null)
    .order("found_at", { ascending: false })
    .order("id", { ascending: true });
  const { data, error } = await fetchPostgrestRows<any>(query);
  if (error || !data) return [];
  return data.map((p) => {
    const s = Array.isArray(p.scores) ? p.scores[0] : p.scores;
    const a = Array.isArray(p.applications)
      ? p.applications[0]
      : p.applications;
    const score = typeof s?.total_score === "number" ? s.total_score : null;
    const {
      at: last_action_at,
      by: last_action_by,
      actor: last_action_actor,
    } = pickLastAction([
      { ts: p.found_at, by: "scout", actor: p.found_by },
      { ts: p.last_checked, by: "analista", actor: "analista" },
      { ts: s?.scored_at, by: "scorer", actor: s?.scored_by },
      { ts: a?.written_at, by: "scrittore", actor: a?.written_by },
      // critic_reviewed_at is set by the WRITER's --critic-score call (the
      // critic never writes to the DB), so its author is the writer.
      { ts: a?.critic_reviewed_at, by: "scrittore", actor: a?.written_by },
      { ts: a?.applied_at, by: "user", actor: "user" },
      { ts: a?.response_at, by: "user", actor: "user" },
    ]);
    // Salary: the declared one wins, the estimate is the fallback; min, max
    // and currency always come from the same source.
    const {
      min: salary_min,
      max: salary_max,
      currency: salary_currency,
    } = salaryPreference(p);
    return {
      id: String(p.id),
      legacy_id: (p.legacy_id as number | null) ?? null,
      title: p.title ?? null,
      company: p.company ?? null,
      location: p.location ?? null,
      remote_type: p.remote_type ?? null,
      status: p.status,
      score: typeof score === "number" ? score : null,
      role_family: p.role_family ?? null,
      loc_country: p.loc_country ?? null,
      loc_city: p.loc_city ?? null,
      source: p.source ?? null,
      salary_min: typeof salary_min === "number" ? salary_min : null,
      salary_max: typeof salary_max === "number" ? salary_max : null,
      salary_currency,
      found_at: p.found_at ?? null,
      scored_at: (s?.scored_at as string | null) ?? null,
      last_action_at: last_action_at || (p.found_at ?? ""),
      last_action_by,
      last_action_actor,
      critic_score: typeof a?.critic_score === "number" ? a.critic_score : null,
      critic_verdict: a?.critic_verdict ?? null,
    };
  });
}

// Set of the position ids the current user already opened: RLS scopes the
// select to the session, so no .in() over thousands of ids.
export async function getSeenPositionIds(
  client: DashboardClient,
): Promise<Set<string>> {
  const { data, error } = await client
    .from("position_views")
    .select("position_id")
    .limit(10000);
  if (error || !data) return new Set();
  return new Set((data as any[]).map((r) => String(r.position_id)));
}

// An application stays a submission even if the position later changes
// status: a query of its own, separate from the dashboard facets.
export async function getApplicationTimelineEvents(
  client: DashboardClient,
): Promise<ApplicationTimelineEvent[]> {
  const query = client
    .from("applications")
    .select("id, applied_at, response, response_at")
    .not("applied_at", "is", null)
    .is("deleted_at", null)
    .order("applied_at", { ascending: true })
    .order("id", { ascending: true });
  const { data, error } = await fetchPostgrestRows<{
    id: string;
    applied_at: string | null;
    response: string | null;
    response_at: string | null;
  }>(query);
  if (error || !data) return [];
  return data.flatMap((row) =>
    row.applied_at
      ? [
          {
            appliedAt: row.applied_at,
            response: row.response,
            responseAt: row.response_at,
          },
        ]
      : [],
  );
}

function emptyScoreDistribution(): ScoreDistribution {
  return { buckets: [], total: 0, withScore: 0, avgScore: null, scores: [] };
}

export async function getScoreDistribution(
  client: DashboardClient,
): Promise<ScoreDistribution> {
  const query = client
    .from("positions")
    .select("scores(total_score)")
    .not("status", "eq", "excluded")
    .is("deleted_at", null)
    .order("id", { ascending: true });
  const { data, error } = await fetchPostgrestRows<any>(query);
  if (error || !data) return emptyScoreDistribution();

  const scores = data.map(
    (r) => (r.scores?.total_score as number | null) ?? null,
  );
  const withScore = scores.filter((s): s is number => s != null && s > 0);
  const buckets = [
    { label: "76–100", min: 76, max: 100, color: "var(--color-green)" },
    { label: "61–75", min: 61, max: 75, color: "var(--color-yellow)" },
    { label: "41–60", min: 41, max: 60, color: "var(--color-orange)" },
    { label: "≤ 40", min: 0, max: 40, color: "var(--color-red)" },
  ].map((b) => ({
    label: b.label,
    count: withScore.filter((s) => s >= b.min && s <= b.max).length,
    color: b.color,
  }));
  const sum = withScore.reduce((a, s) => a + s, 0);
  return {
    buckets,
    total: scores.length,
    withScore: withScore.length,
    avgScore: withScore.length > 0 ? Math.round(sum / withScore.length) : null,
    scores: withScore,
  };
}

export async function getSourceDistribution(
  client: DashboardClient,
): Promise<SourceCount[]> {
  const query = client
    .from("positions")
    .select("source")
    .not("status", "eq", "excluded")
    .is("deleted_at", null)
    .order("id", { ascending: true });
  const { data, error } = await fetchPostgrestRows<any>(query);
  if (error || !data) return [];
  const counts: Record<string, number> = {};
  for (const row of data) {
    const s = row.source ?? "sconosciuta";
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

export async function getPositionTypeDistribution(
  client: DashboardClient,
): Promise<RoleFamilyCount[]> {
  const query = client
    .from("positions")
    .select("role_family, scores(total_score), applications(critic_score)")
    .not("status", "eq", "excluded")
    .is("deleted_at", null)
    .order("id", { ascending: true });
  const { data, error } = await fetchPostgrestRows<any>(query);
  if (error || !data) return [];
  const rows = data.map((r) => {
    const scoresRel = Array.isArray(r.scores) ? r.scores[0] : r.scores;
    const appRel = Array.isArray(r.applications)
      ? r.applications[0]
      : r.applications;
    return {
      role_family: r.role_family as string | null,
      score: (scoresRel?.total_score as number | null) ?? null,
      critic: (appRel?.critic_score as number | null) ?? null,
    };
  });
  return aggregateRoleFamilies(rows);
}
