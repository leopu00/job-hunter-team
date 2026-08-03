import { NextRequest, NextResponse } from "next/server";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { checkRateLimit } from "@/lib/rate-limit";
import { sanitizedError } from "@/lib/error-response";
import { resolveUser } from "@/lib/team-state/auth";
import { validateEmergencyStopBody } from "@/lib/team-state/emergency-stop";

export const dynamic = "force-dynamic";

/**
 * POST /api/team-state/emergency-stop
 *
 * Unica eccezione al web cloud read-only: un utente con sessione può soltanto
 * portare il desired-state da qualunque valore a `should_run=false`. Nessun
 * payload viene inoltrato al container e non esistono action/target/argomenti.
 * Il daemon già associato all'account converge il valore con il solo comando
 * hard-coded `jht team stop`.
 */
export async function POST(req: NextRequest) {
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;

  // Il Bearer token appartiene al device: la corsia è deliberatamente una
  // capacità della sessione web dell'utente, non un nuovo endpoint device.
  if (resolved.user.source !== "session") {
    return NextResponse.json(
      { ok: false, error: "browser_session_required" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }
  const parsed = validateEmergencyStopBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: "invalid_confirmation", message: parsed.error },
      { status: 400 },
    );
  }

  const { userId, supabase } = resolved.user;
  const limit = await checkRateLimit(
    "team-state",
    "emergency-stop",
    userId,
    3,
    60_000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      },
    );
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("team_state")
    .upsert(
      {
        user_id: userId,
        should_run: false,
        emergency_stop_requested_at: now,
        last_user_activity_at: now,
      },
      { onConflict: "user_id" },
    )
    .select(
      "should_run,is_running,last_heartbeat_at,last_action,last_action_at,last_error,emergency_stop_requested_at,emergency_stop_completed_at",
    )
    .single();

  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "team-state/emergency-stop",
      publicMessage: "stop_request_failed",
    });
  }

  return NextResponse.json({ ok: true, state: data });
}
