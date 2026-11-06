import type { SupabaseClient } from "@supabase/supabase-js";
import type { CandidateFileEntry } from "./position-document-file";

export async function cloudCandidateFiles(
  supabase: Pick<SupabaseClient, "auth" | "from">,
): Promise<CandidateFileEntry[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("candidate_files")
    .select("name, size, updated_at")
    .eq("user_id", user.id);
  if (error) return [];
  return (data ?? []) as CandidateFileEntry[];
}
