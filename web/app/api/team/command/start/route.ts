import { NextRequest } from "next/server";
import { requestAction } from "@/lib/request-action";

export const dynamic = "force-dynamic";

/**
 * POST /api/team/command/start — to start the team, or one agent, from the website.
 *
 * A level 2 action: the site asks, the box runs it with its own secrets. Everything that decides is the
 * database's, behind `request_action` (recent session, limits, the closed list of targets, the record):
 *
 *   {"params": {"target": "all" | "<agent>" | "bridge"}}   the first call; "all" (the default) answers
 *                                                             awaiting_confirm with what will happen
 *   {"confirmId": "<id of that answer>"}                    the second call, from the same session
 *
 * The answer carries `commandId` once the command is queued: GET /api/team/command/<commandId> follows it
 * from pending to running to done (or error).
 */
export async function POST(req: NextRequest) {
  return requestAction(req, { action: "team.start", level: "L2" });
}
