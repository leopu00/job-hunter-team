/** Sanitised production-readiness gate; never returns URL/token values. */
export type UpstashConfigStatus =
  | { configured: true; urlHost: string }
  | {
      configured: false;
      reason: "missing-url" | "missing-token" | "invalid-url";
    };

export function getUpstashConfigStatus(
  env: NodeJS.ProcessEnv = process.env,
): UpstashConfigStatus {
  const rawUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!rawUrl) return { configured: false, reason: "missing-url" };
  if (!token) return { configured: false, reason: "missing-token" };
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return { configured: false, reason: "invalid-url" };
    }
    return { configured: true, urlHost: parsed.hostname };
  } catch {
    return { configured: false, reason: "invalid-url" };
  }
}
