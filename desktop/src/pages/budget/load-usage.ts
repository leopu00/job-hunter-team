import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The tmux team's usage window, as the cloud has it: sentinel_ticks, the
 * sentinel bridge's samples (5-hour window, week, resets, projection,
 * throttle), sent by the cloud daemon (cli/src/lib/usage-samples-push.js) and
 * read here with the user's own session (RLS scopes every row).
 *
 * The TUI team runs on a subscription: what it consumes is a share of the
 * provider's windows, not dollars, so that is what the page shows.
 */
export type UsageSample = {
  ts: string;
  provider: string;
  /** the 5-hour window, percent */
  usage: number;
  /** the week, percent */
  weeklyUsage: number | null;
  /** where the 5-hour window is headed at its reset, percent */
  projection: number | null;
  /** percent per hour, smoothed */
  velocity: number | null;
  status: string;
  throttle: number | null;
  /** epoch seconds of the 5-hour reset */
  resetAtUnix: number | null;
  weeklyResetAtUnix: number | null;
};

export type UsageRead =
  | { state: "ready"; samples: UsageSample[] }
  | { state: "failed" };

/** The samples the page lists: about two hours of the bridge's ticks. */
export const USAGE_SAMPLES = 24;

export const USAGE_SELECT =
  "ts, provider, usage, weekly_usage, projection, velocity_smooth, status, throttle, reset_at_unix, weekly_reset_at_unix";

type Client = Pick<SupabaseClient, "from">;

/** Newest first. */
export async function loadUsage(client: Client): Promise<UsageSample[]> {
  const { data, error } = await client
    .from("sentinel_ticks")
    .select(USAGE_SELECT)
    .order("ts", { ascending: false })
    .limit(USAGE_SAMPLES);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(toSample).filter((s): s is UsageSample => s !== null);
}

function toSample(row: Record<string, unknown>): UsageSample | null {
  const usage = num(row["usage"]);
  const ts = typeof row["ts"] === "string" ? row["ts"] : null;
  if (usage === null || ts === null) return null;
  return {
    ts,
    provider: typeof row["provider"] === "string" ? row["provider"] : "—",
    usage,
    weeklyUsage: num(row["weekly_usage"]),
    projection: num(row["projection"]),
    velocity: num(row["velocity_smooth"]),
    status: typeof row["status"] === "string" ? row["status"] : "—",
    throttle: num(row["throttle"]),
    resetAtUnix: num(row["reset_at_unix"]),
    weeklyResetAtUnix: num(row["weekly_reset_at_unix"]),
  };
}

/** PostgREST hands NUMERIC columns back as strings or numbers, depending on the value. */
function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}
