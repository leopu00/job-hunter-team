import { NextRequest, NextResponse } from "next/server";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set([
  "completed",
  "timeout",
  "push_failed",
  "ack_failed",
] as const);

type TerminalStatus = "completed" | "timeout" | "push_failed" | "ack_failed";

/**
 * Chiude un rendezvous Sync now soltanto se il device sta ancora servendo la
 * stessa richiesta osservata. Il box invia la correlazione, mai timestamp:
 * action e completion sono timbrati dal server in un solo UPDATE atomico.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, tokenId, admin } = auth.data;

  const limit = await checkCloudSyncRateLimit("sync-observed", tokenId, 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { applied: false, error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      },
    );
  }

  let body: { expected_requested_at?: unknown; status?: unknown };
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }

  const expected = body.expected_requested_at;
  const status = body.status;
  const expectedMs = typeof expected === "string" ? Date.parse(expected) : NaN;
  if (
    typeof expected !== "string" ||
    !Number.isFinite(expectedMs) ||
    typeof status !== "string" ||
    !TERMINAL_STATUSES.has(status as TerminalStatus)
  ) {
    return NextResponse.json(
      { applied: false, error: "invalid_sync_observation" },
      { status: 400 },
    );
  }

  // Anche fra edge instance con lieve clock skew, l'esito deve essere
  // strettamente successivo alla richiesta server che sta chiudendo.
  const observedAt = new Date(
    Math.max(Date.now(), expectedMs + 1),
  ).toISOString();
  const update: Record<string, string> = {
    last_action: `sync:${status}`,
    last_action_at: observedAt,
  };
  if (status === "completed") update.sync_completed_at = observedAt;

  // Condizioni nello stesso UPDATE:
  // - il token e' ancora il device attivo (oppure il claim e' legacy/null);
  // - sync_requested_at e' esattamente la richiesta A osservata;
  // - nessun esito sync terminale e' gia' stato pubblicato per A.
  const { data, error } = await admin
    .from("team_state")
    .update(update)
    .eq("user_id", userId)
    .eq("sync_requested_at", expected)
    .or(`active_device_id.is.null,active_device_id.eq.${tokenId}`)
    .or(`sync_completed_at.is.null,sync_completed_at.lt.${expected}`)
    .or(
      `last_action.not.like.sync:%,last_action_at.lte.${expected},last_action_at.is.null`,
    )
    .select("sync_requested_at,sync_completed_at,last_action,last_action_at")
    .maybeSingle();

  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "team-state/sync-observed",
      publicMessage: "sync_observation_failed",
    });
  }
  if (!data) {
    return NextResponse.json(
      { applied: false, status, reason: "superseded" },
      { status: 409 },
    );
  }

  return NextResponse.json({
    applied: true,
    status,
    requested_at: data.sync_requested_at,
    sync_completed_at: data.sync_completed_at ?? null,
    last_action_at: data.last_action_at,
  });
}
