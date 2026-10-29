import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CvDownloadButton } from "@/app/(protected)/positions/[id]/CvDownloadButton";
import { installDocumentPreview, onDocumentPreviewRequest, type DocumentPreviewRequest } from "../../lib/team-document";

const core = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: core.invoke, isTauri: core.isTauri }));

const labels = { idle: "Scarica CV", preparing: "Preparo…", error: "Errore", preview: "Anteprima" };
const NAME = "CV_synthetic_1.pdf";

let remove: () => void = () => {};
let off: () => void = () => {};
beforeEach(() => {
  core.isTauri.mockReturnValue(true);
});
afterEach(() => {
  remove();
  off();
  remove = () => {};
  off = () => {};
  cleanup();
});

describe("the preview button of the position page", () => {
  it("appears only where the desktop answers the probe", () => {
    render(<CvDownloadButton fileName={NAME} cloudMode color="var(--color-green)" labels={labels} previewKind="cv" textName="CV_synthetic_1.md" />);
    expect(screen.queryByRole("button", { name: "Anteprima" })).toBeNull();
    cleanup();
    remove = installDocumentPreview();
    render(<CvDownloadButton fileName={NAME} cloudMode color="var(--color-green)" labels={labels} previewKind="cv" textName="CV_synthetic_1.md" />);
    expect(screen.getByRole("button", { name: "Anteprima" })).toBeInTheDocument();
  });

  it("is not there without a kind or a label", () => {
    remove = installDocumentPreview();
    render(<CvDownloadButton fileName={NAME} cloudMode color="var(--color-green)" labels={{ ...labels, preview: undefined }} previewKind="cv" />);
    expect(screen.queryByRole("button", { name: "Anteprima" })).toBeNull();
    cleanup();
    render(<CvDownloadButton fileName={NAME} cloudMode color="var(--color-green)" labels={labels} />);
    expect(screen.queryByRole("button", { name: "Anteprima" })).toBeNull();
  });

  it("asks for the document by its two plain names and its kind, only on a click", async () => {
    remove = installDocumentPreview();
    const seen: DocumentPreviewRequest[] = [];
    off = onDocumentPreviewRequest((request) => seen.push(request));
    render(<CvDownloadButton fileName="CL_synthetic_1.pdf" cloudMode color="var(--color-blue)" labels={labels} previewKind="letter" textName={null} />);
    expect(seen).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Anteprima" }));
    expect(seen).toEqual([{ name: "CL_synthetic_1.pdf", textName: null, kind: "letter" }]);
    expect(core.invoke).not.toHaveBeenCalled();
  });
});
