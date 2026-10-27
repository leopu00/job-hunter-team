import { inertSupabase } from "../web-shims/server/inert-supabase";
import { cloudSessionReadable } from "./auth-storage-lock";
import { supabase } from "./supabase";

/**
 * The client the data pages read the cloud with. While the session's storage is locked (a local
 * profile never unlocks it) the real client answers nothing, ever, and a page waiting on it
 * showed its loading skeleton for good: there is no cloud session to read with, so the pages get
 * the stand-in that answers «no rows, no error», which they already draw as an empty page.
 */
export function cloudClient(): any {
  return cloudSessionReadable() ? supabase : inertSupabase;
}
