/**
 * Stand-in for web/lib/supabase/admin.ts, the web's service_role client.
 * A service_role key never enters the desktop: asking for that client is
 * refused before any query can run. The web's routes reach it only on their
 * Bearer-token branch, which the desktop never takes (no token is ever sent).
 */
// `any`, not `never`: the web types its token branch against this client's
// return type, and that branch has to type-check even though it never runs.
export function createAdminClient(): any {
  throw new Error("service_role is not available in the desktop");
}
