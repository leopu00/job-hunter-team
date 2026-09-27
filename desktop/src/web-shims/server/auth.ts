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
