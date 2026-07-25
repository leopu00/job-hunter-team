/**
 * Rate limiter degli endpoint /api/cloud-sync/*.
 *
 * Il motore (finestra fissa in memoria, con Upstash quando configurato)
 * vive in `lib/rate-limit.ts` ed e' condiviso con gli altri canali:
 * qui resta solo il namespace, cosi' i bucket dei cloud-sync non si
 * mescolano con quelli pubblici.
 */
import { checkRateLimit, type RateLimitResult } from "../rate-limit";

export type { RateLimitResult };

export async function checkCloudSyncRateLimit(
  scope: string,
  identity: string,
  max: number,
  windowMs: number = 60_000,
): Promise<RateLimitResult> {
  return checkRateLimit("cloud-sync", scope, identity, max, windowMs);
}
