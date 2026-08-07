import { createAdminClient } from "@/lib/supabase/admin";
import type { DownloadClick } from "@/lib/download-funnel";
import { checkRateLimit, type RateLimitResult } from "@/lib/rate-limit";

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
  ) => Promise<Pick<RateLimitResult, "allowed">>;
  increment: (event: DownloadClick) => Promise<void>;
};

const DEFAULT_DEPENDENCIES: RecorderDependencies = {
  check: checkRateLimit,
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
  const { allowed } = await dependencies.check(
    limit.namespace,
    limit.scope,
    limit.identity,
    limit.max,
    limit.windowMs,
  );

  // All anonymous callers share one constant bucket. When Upstash is
  // configured this cap is distributed across instances; the existing
  // in-memory fallback still protects each warm instance. Measurement may be
  // sampled under abuse, but the download response is never delayed or lost.
  if (!allowed) return;

  await dependencies.increment(event);
}
