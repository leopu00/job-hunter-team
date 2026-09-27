import { NextResponse } from "next/server";
import { createClient } from "./supabase-server";

/**
 * Stand-in for web/lib/auth.ts. The web tells a request from the user's own
 * machine (local SQLite workspace) from one to the cloud deploy (Supabase).
 * The desktop reads Supabase with the user's session: it is always the cloud
 * branch, as on the web deploy.
 */
export async function isLocalRequest(..._request: unknown[]): Promise<boolean> {
  return false;
}

/**
 * The session branch of the web's requireAuth: a signed-in user passes, anyone
 * else gets the same 401. (The web's other two ways in, no Supabase at all
 * and the box's local token, do not exist in the desktop.)
 */
export async function requireAuth(): Promise<NextResponse | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }
  return null;
}

/**
 * web/lib/auth.ts requireLocalWrite on the cloud deploy: control, config and
 * data writes that belong to the user's own machine are refused with 403
 * read_only, and nothing reaches a shell. The web's message ("si fa dall'app
 * desktop") is false here: in the desktop these commands are coming. The
 * only desktop route that reaches this today is /api/team/send
 * (require-local-write.test.ts fails if another starts to), hence a team
 * wording (operator's decision, 27/09).
 */
export const DESKTOP_READ_ONLY_MESSAGE = "I comandi al team dalla desktop sono in arrivo.";

export async function requireLocalWrite(): Promise<NextResponse | null> {
  return NextResponse.json({ error: "read_only", message: DESKTOP_READ_ONLY_MESSAGE }, { status: 403 });
}
