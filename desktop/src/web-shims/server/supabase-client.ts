import { existingTeamView } from "../../lib/existing-team-readonly";
import { supabase } from "../../lib/supabase";
import { inertSupabase } from "./inert-supabase";

/**
 * Stand-in for web/lib/supabase/client.ts: the browser client is the desktop
 * client, with the user's session. Typed `any` like the web's own.
 */
export function createClient(): any {
  return existingTeamView() ? inertSupabase : supabase;
}
