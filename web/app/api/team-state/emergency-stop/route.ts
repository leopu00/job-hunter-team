import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { requestAction } from "@/lib/request-action";

export const dynamic = "force-dynamic";

/**
 * POST /api/team-state/emergency-stop
 *
 * The one stop of the team that needs no confirmation, and never a start: a level 2 action of the single
 * door. The database writes should_run = false (and the stamp of the stop) for the signed-in user, nothing
 * else; the box converges with the hard-coded `jht team stop`. The limits, the record in web_action_log and
 * the user are the database's (`request_action`), and a stop is not held back by the recent-session rule.
 *
 *   POST {}        (or {"params": {}})
 *
 * It answers {ok:true, state:"queued", ...}. The state of the team (should_run, the stop requested and
 * completed) is read from GET /api/team-state, as the rest of the page does.
 */
export async function POST(req: NextRequest) {
  return requestAction(req, {
    action: "team.emergency_stop",
    level: "L2",
    whenDoorMissing: stopWithoutTheDoor,
  });
}

/**
 * TEMPORARY fallback while the database has no door (the web goes out before migration 098): the stop the
 * route did before, and nothing more. Only should_run = false, the stop's stamp and the presence, on the
 * user's own row, with the user's session (the row policies of 019 allow it until 098). It runs only when
 * request_action does not exist; remove it once 098 is applied and verified on the cloud.
 */
async function stopWithoutTheDoor({
  supabase,
  userId,
}: {
  supabase: any;
  userId: string;
}): Promise<NextResponse> {
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
  const { error } = await supabase.from("team_state").upsert(
    {
      user_id: userId,
      should_run: false,
      emergency_stop_requested_at: now,
      last_user_activity_at: now,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    return NextResponse.json(
      { ok: false, error: "action_failed" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, state: "queued" });
}
