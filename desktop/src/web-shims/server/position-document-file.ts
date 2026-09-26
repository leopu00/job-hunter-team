import { createClient } from "./supabase-server";
import {
  documentFileNameFromPath,
  findIndexedCoverLetterPdfFileName,
  type CandidateFileEntry,
} from "@/lib/position-document-file";

/**
 * Stand-in for web/lib/position-document-file.server.ts. Its cloud branch is
 * copied here as it is (candidate_files read with the user's session); the
 * local branch lists folders on disk, which the desktop does not have, so
 * the local answer is empty.
 */
async function cloudCandidateFiles(): Promise<CandidateFileEntry[]> {
  const supabase = await createClient();
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

export async function resolveCoverLetterPdfFileName({
  explicitPath,
  legacyId,
  cloudMode,
}: {
  explicitPath: string | null | undefined;
  legacyId: number | null | undefined;
  cloudMode: boolean;
}): Promise<string | null> {
  const explicitName = documentFileNameFromPath(explicitPath);
  if (explicitName) return explicitName;
  if (legacyId == null) return null;
  const files = cloudMode ? await cloudCandidateFiles() : [];
  return findIndexedCoverLetterPdfFileName(files, legacyId);
}
