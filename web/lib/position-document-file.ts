export type CandidateFileEntry = {
  name: string;
  size: number | null;
  updated_at: string | null;
};

function positionToken(legacyId: number): RegExp {
  return new RegExp(`(?:^|\\D)${legacyId}(?:\\D|$)`);
}

function isCoverLetterPdf(name: string): boolean {
  return (
    /\.pdf$/i.test(name) &&
    (/cover[\s._-]*letter/i.test(name) || /^cl[\s._-]/i.test(name))
  );
}

/**
 * Resolve an unlinked cover-letter PDF from the authoritative file inventory.
 *
 * Historical Writer runs could leave the PDF on disk without recording
 * applications.cl_pdf_path. The bridge can already serve that file by
 * basename; the position page must not hide it merely because that link is
 * absent. The numeric token uses boundaries so position 643 never claims a
 * document belonging to 1643.
 */
export function findIndexedCoverLetterPdfFileName(
  files: CandidateFileEntry[],
  legacyId: number,
): string | null {
  if (!Number.isSafeInteger(legacyId) || legacyId < 1) return null;
  const token = positionToken(legacyId);
  const candidates = files
    .filter(
      (file) =>
        Number(file.size) > 0 &&
        token.test(file.name) &&
        isCoverLetterPdf(file.name),
    )
    .sort((a, b) => {
      const time =
        Date.parse(b.updated_at ?? "") - Date.parse(a.updated_at ?? "");
      if (Number.isFinite(time) && time !== 0) return time;
      return b.name.localeCompare(a.name);
    });
  return candidates[0]?.name ?? null;
}

export function documentFileNameFromPath(
  filePath: string | null | undefined,
): string | null {
  return filePath?.replaceAll("\\", "/").split("/").pop() || null;
}
