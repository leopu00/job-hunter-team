import * as facets from "@/app/api/positions/facets/route";
import * as seen from "@/app/api/positions/seen/route";
import * as applyRequest from "@/app/api/positions/[legacyId]/apply-request/route";
import * as geocodeRequest from "@/app/api/positions/[legacyId]/geocode-request/route";
import * as markApplied from "@/app/api/positions/[legacyId]/mark-applied/route";
import * as outcome from "@/app/api/positions/[legacyId]/outcome/route";
import * as recheckRequest from "@/app/api/positions/[legacyId]/recheck-request/route";
import * as ticket from "@/app/api/positions/[legacyId]/ticket/route";
import * as userNote from "@/app/api/positions/[legacyId]/user-note/route";
import * as writeRequest from "@/app/api/positions/[legacyId]/write-request/route";
import { webRoutes, type ApiFetch } from "../../shell/api-bridge";

/**
 * The web routes the positions pages call, run as they are (web/app/api/...).
 * On the cloud deploy each one is a Supabase read or write with the user's
 * session, RLS scoped (tables or the web's own RPCs): with the server
 * stand-ins (src/web-shims/server) that is the branch that runs here too.
 * None of them reaches a service_role client, the filesystem or the box.
 *
 *   facets           the sidebar's dataset (PositionsFilterSidebar)
 *   seen             the "new" marker goes away (MarkSeenAfterView)
 *   write-request    ask for a CV, and for a cover letter (Write/CoverLetter buttons)
 *   apply-request    ask the team to apply (ApplyRequestButton)
 *   recheck-request  ask for a new analysis (RecheckButton)
 *   geocode-request  ask for the office's coordinates (GeocodeRequestButton)
 *   ticket           a request to the team, and a new score (TicketPanel, RescoreRequestButton)
 *   mark-applied     "I applied" and its undo (FeedbackButtons)
 *   outcome          the answer received and its undo (FeedbackButtons)
 *   user-note        the private note (UserNote)
 *
 * Not here, on purpose: /api/profile/files/* (the CV download goes through a
 * service_role signed URL) and /api/local/sync/* (the box's own sync; on the
 * cloud its banner hides, and it hides here too). They answer not_in_desktop.
 */
export const POSITION_ROUTES = {
  "/api/positions/facets": facets,
  "/api/positions/seen": seen,
  "/api/positions/[legacyId]/write-request": writeRequest,
  "/api/positions/[legacyId]/apply-request": applyRequest,
  "/api/positions/[legacyId]/recheck-request": recheckRequest,
  "/api/positions/[legacyId]/geocode-request": geocodeRequest,
  "/api/positions/[legacyId]/ticket": ticket,
  "/api/positions/[legacyId]/mark-applied": markApplied,
  "/api/positions/[legacyId]/outcome": outcome,
  "/api/positions/[legacyId]/user-note": userNote,
};

export function positionsApi(next: ApiFetch): ApiFetch {
  return webRoutes(POSITION_ROUTES, next);
}
