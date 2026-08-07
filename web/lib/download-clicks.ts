import { createAdminClient } from "@/lib/supabase/admin";
import type { DownloadClick } from "@/lib/download-funnel";
import {
  checkDistributedRateLimit,
  type RateLimitResult,
} from "@/lib/rate-limit";

export const DOWNLOAD_AGGREGATE_RATE_LIMIT = {
  namespace: "download-funnel",
  scope: "aggregate",
  identity: "global",
  max: 60,
  windowMs: 60_000,
} as const;

type RecorderDependencies = {
  check: (
    namespace: string,
    scope: string,
    identity: string,
    max: number,
    windowMs: number,
  ) => Promise<Pick<RateLimitResult, "allowed"> | null>;
  increment: (event: DownloadClick) => Promise<void>;
};

const DEFAULT_DEPENDENCIES: RecorderDependencies = {
  check: checkDistributedRateLimit,
  increment: async (event) => {
    const admin = createAdminClient();
    const { error } = await admin.rpc("increment_download_clicks", {
      p_ts_hour: event.ts_hour,
      p_slug: event.slug,
      p_utm_source: event.utm_source,
      p_utm_medium: event.utm_medium,
      p_utm_campaign: event.utm_campaign,
    });

    if (error) throw new Error("download aggregate increment failed");
  },
};

/** Increment an aggregate bucket. This function deliberately receives no request. */
export async function recordDownloadClick(
  event: DownloadClick,
  dependencies: RecorderDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const limit = DOWNLOAD_AGGREGATE_RATE_LIMIT;
  const result = await dependencies.check(
    limit.namespace,
    limit.scope,
    limit.identity,
    limit.max,
    limit.windowMs,
  );

  // All anonymous callers share one constant distributed bucket. Missing or
  // failed coordination is fail-closed for measurement: never fall back to a
  // per-instance budget that an autoscaling attacker can multiply.
  if (!result?.allowed) return;

  await dependencies.increment(event);
}
