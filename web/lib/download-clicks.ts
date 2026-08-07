import { createAdminClient } from "@/lib/supabase/admin";
import type { DownloadClick } from "@/lib/download-funnel";

/** Increment an aggregate bucket. This function deliberately receives no request. */
export async function recordDownloadClick(event: DownloadClick): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("increment_download_clicks", {
    p_ts_hour: event.ts_hour,
    p_slug: event.slug,
    p_utm_source: event.utm_source,
    p_utm_medium: event.utm_medium,
    p_utm_campaign: event.utm_campaign,
  });

  if (error) throw new Error("download aggregate increment failed");
}
