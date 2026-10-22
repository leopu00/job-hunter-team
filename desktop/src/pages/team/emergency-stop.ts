import { DATABASE_REFUSALS } from "@/lib/request-action-codes";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/team-state/emergency-stop in the desktop: the same single door as on the web
 * (`request_action`, the action team.emergency_stop, level 2), called with the desktop's own session.
 *
 * It does not run the web route. That one is the website's entrance and checks the Origin of a browser
 * request (a forbidden header: the app's in-process request can not carry it); the app has no browser
 * between itself and its own client. Everything that decides is the database's, as there: the user from
 * the session, the limits, the record, the effect. Nothing here chooses the action from the request.
 */
export async function POST(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  let result: { data: unknown; error: unknown };
  try {
    result = await supabase.rpc("request_action", {
      p_action: "team.emergency_stop",
      p_params: {},
      p_confirm_id: null,
      p_route_level: "L2",
    });
  } catch {
    return Response.json({ ok: false, error: "action_failed" }, { status: 502 });
  }
  if (result.error) return Response.json({ ok: false, error: "action_failed" }, { status: 502 });

  const data = (result.data ?? {}) as Record<string, unknown>;
  if (data.ok === true && data.state === "queued") {
    return Response.json({ ok: true, state: "queued" });
  }
  const code = typeof data.error === "string" ? data.error : "";
  const status = Object.prototype.hasOwnProperty.call(DATABASE_REFUSALS, code) ? DATABASE_REFUSALS[code] : null;
  if (data.ok === false && status !== null) return Response.json({ ok: false, error: code }, { status });
  return Response.json({ ok: false, error: "action_failed" }, { status: 502 });
}
