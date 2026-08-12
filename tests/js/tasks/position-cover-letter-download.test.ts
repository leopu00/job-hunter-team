/** O-72 — una cover letter PDF presente non deve restare senza download. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  documentFileNameFromPath,
  findIndexedCoverLetterPdfFileName,
} from "../../../web/lib/position-document-file";

describe("download cover letter della posizione", () => {
  it("usa il PDF presente nell'indice quando cl_pdf_path non e' collegato", () => {
    const fileName = findIndexedCoverLetterPdfFileName(
      [
        {
          name: "CoverLetter_Candidate_643_Example.pdf",
          size: 24_000,
          updated_at: "2026-08-12T14:00:00Z",
        },
      ],
      643,
    );

    expect(fileName).toBe("CoverLetter_Candidate_643_Example.pdf");
  });

  it("mantiene il basename di cl_pdf_path come fonte primaria, come per il CV", () => {
    expect(
      documentFileNameFromPath("/jht_user/allegati/CoverLetter_Linked_643.pdf"),
    ).toBe("CoverLetter_Linked_643.pdf");
  });

  it("non confonde l'id e non offre sorgenti non-PDF o vuote", () => {
    expect(
      findIndexedCoverLetterPdfFileName(
        [
          {
            name: "CoverLetter_Candidate_1643_Example.pdf",
            size: 24_000,
            updated_at: null,
          },
          {
            name: "CoverLetter_Candidate_643_Example.md",
            size: 12_000,
            updated_at: null,
          },
          {
            name: "CoverLetter_Candidate_643_Empty.pdf",
            size: 0,
            updated_at: null,
          },
        ],
        643,
      ),
    ).toBeNull();
  });

  it("passa il fallback allo stesso componente di download del CV", () => {
    const page = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../web/app/(protected)/positions/[id]/page.tsx",
      ),
      "utf8",
    );
    expect(page).toContain("resolveCoverLetterPdfFileName({");
    expect(page).toContain("fileName={clFileName}");
    expect(page).toContain('idle: t("download_cl")');
  });
});
