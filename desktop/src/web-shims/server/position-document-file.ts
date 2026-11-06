import { cloudCandidateFiles } from "@/lib/cloud-candidate-files";
import { createClient } from "./supabase-server";
import {
  documentFileNameFromPath,
  findIndexedCoverLetterPdfFileName,
} from "@/lib/position-document-file";

/**
 * Stand-in for web/lib/position-document-file.server.ts. Its cloud branch
 * uses the shared candidate_files read with the user's session; the
 * local branch lists folders on disk, which the desktop does not have, so
 * the local answer is empty.
 */
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
  const files = cloudMode
    ? await cloudCandidateFiles(await createClient())
    : [];
  return findIndexedCoverLetterPdfFileName(files, legacyId);
}
