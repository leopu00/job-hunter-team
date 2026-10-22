import { NextRequest, NextResponse } from "next/server";
import { requestAction } from "@/lib/request-action";

export const dynamic = "force-dynamic";

/**
 * POST /api/team/settings: the team's working hours and the model and effort
 * of each role, from the site (web capace, phase 6).
 *
 * Through the door only: `settings.update`, L2 (recent session, 20 an hour,
 * no two-step confirmation). The closed keys and values are checked by the
 * database (migration 099) and again by the box, which applies the desire to
 * its own config (cli/src/lib/team-settings.js) and says so in
 * team_state.settings_applied_at. This route never writes a file or a table.
 *
 * Body: { "params": { "working_hours"?: {...} | null, "role_models"?: {...} } }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return requestAction(req, { action: "settings.update", level: "L2" });
}
