import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/workspace";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

/**
 * Revoca il token che sta autenticando la richiesta. Il bearer può revocare
 * esclusivamente sé stesso: tokenId arriva dalla verifica dell'hash e non dal
 * body della richiesta.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: "cloud sync non disponibile" },
      { status: 400 },
    );
  }

  const verified = await verifyBearerToken(req);
  if (!verified.ok) return verified.res;

  const rl = await checkCloudSyncRateLimit(
    "token-self-revoke",
    verified.data.tokenId,
    5,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit superato. Riprova tra poco." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const { error } = await verified.data.admin
    .from("cloud_sync_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", verified.data.tokenId)
    .eq("user_id", verified.data.userId);

  if (error) {
    return sanitizedError(error, { status: 500, scope: "cloud-sync/revoke" });
  }
  return NextResponse.json({ ok: true, revoked: true });
}
