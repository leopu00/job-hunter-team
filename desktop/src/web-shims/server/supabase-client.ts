import { supabase } from "../../lib/supabase";

/**
 * Stand-in for web/lib/supabase/client.ts: the browser client is the desktop
 * client, with the user's session. Typed `any` like the web's own.
 */
export function createClient(): any {
  return supabase;
}
