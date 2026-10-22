import { NextRequest } from "next/server";
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
  return requestAction(req, { action: "team.emergency_stop", level: "L2" });
}
