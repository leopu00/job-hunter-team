import { teamDataFromTheTeam } from "../../lib/local-team-data";
import { cloudClient } from "../../lib/cloud-client";
import { inertSupabase } from "./inert-supabase";

/**
 * Stand-in for web/lib/supabase/client.ts: the browser client is the desktop
 * client, with the user's session. Typed `any` like the web's own.
 */
export function createClient(): any {
  return teamDataFromTheTeam() ? inertSupabase : cloudClient();
}
