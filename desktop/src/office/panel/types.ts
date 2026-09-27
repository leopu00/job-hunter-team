import type { SupabaseClient } from "@supabase/supabase-js";

/** What the panels need of the Supabase client: queries and the session (for user_id). */
export type PanelClient = Pick<SupabaseClient, "from" | "auth">;
