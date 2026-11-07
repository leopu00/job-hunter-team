import fs from "node:fs";
import path from "node:path";
import {
  JHT_USER_CV_DIR,
  JHT_USER_OUTPUT_DIR,
  JHT_USER_UPLOADS_DIR,
} from "./jht-paths";
import { cloudCandidateFiles } from "./cloud-candidate-files";
import { createClient } from "./supabase/server";
import {
  documentFileNameFromPath,
  findIndexedCoverLetterPdfFileName,
  type CandidateFileEntry,
} from "./position-document-file";

function localCandidateFiles(): CandidateFileEntry[] {
  const files: CandidateFileEntry[] = [];
  for (const directory of [
    JHT_USER_CV_DIR,
    JHT_USER_UPLOADS_DIR,
    JHT_USER_OUTPUT_DIR,
  ]) {
    try {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const stat = fs.statSync(path.join(directory, entry.name));
        files.push({
          name: entry.name,
          size: stat.size,
          updated_at: stat.mtime.toISOString(),
        });
      }
    } catch {
      // A directory can legitimately be absent before the first artifact.
    }
  }
  return files;
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
  const files = cloudMode
    ? await cloudCandidateFiles(await createClient())
    : localCandidateFiles();
  return findIndexedCoverLetterPdfFileName(files, legacyId);
}
