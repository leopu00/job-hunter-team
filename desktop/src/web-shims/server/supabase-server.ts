import { existingTeamView } from "../../lib/existing-team-readonly";
import { supabase } from "../../lib/supabase";
import { inertSupabase } from "./inert-supabase";

/**
 * Stand-in for web/lib/supabase/server.ts. On the web the server client
 * carries the user's session in cookies; here it is the desktop client, which
 * carries the same session (anon key + JWT). RLS scopes every row to the
 * user, as on the web. Never a service_role client.
 *
 * Typed `any` like the web's own (its not-configured branch returns a mock
 * `as any`): the web's queries are written against that type, and some build
 * their select strings by concatenation, which the typed client rejects.
 */
export async function createClient(): Promise<any> {
  // Reading an existing team's VPS: no cloud row is read next to it.
  return existingTeamView() ? inertSupabase : supabase;
}
