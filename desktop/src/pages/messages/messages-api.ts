import * as ack from "@/app/api/pending-messages/[id]/ack/route";
import * as reply from "@/app/api/pending-messages/[id]/reply/route";
import * as pendingMessages from "@/app/api/pending-messages/route";
import * as teamState from "@/app/api/team-state/route";
import { webRoutes, type ApiFetch } from "../../shell/api-bridge";

/**
 * The chat's routes, run as the web routes themselves. In the desktop they
 * take their cloud branch: reads and writes on pending_user_messages and
 * team_state with the user's session, under the same RLS and the same checks
 * (agent allowlist, body length, writable team_state fields).
 *   GET|POST /api/pending-messages            web/app/api/pending-messages/route.ts
 *   POST     /api/pending-messages/[id]/ack   web/app/api/pending-messages/[id]/ack/route.ts
 *   POST     /api/pending-messages/[id]/reply web/app/api/pending-messages/[id]/reply/route.ts
 *   GET|PATCH /api/team-state                 web/app/api/team-state/route.ts (the chat's bell)
 */
export function messagesApi(next: ApiFetch): ApiFetch {
  return webRoutes(
    {
      "/api/pending-messages": pendingMessages,
      "/api/pending-messages/[id]/ack": ack,
      "/api/pending-messages/[id]/reply": reply,
      "/api/team-state": teamState,
    },
    next,
  );
}
