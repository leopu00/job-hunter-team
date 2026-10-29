import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  documentPreviewApi,
  installDocumentPreview,
  onDocumentPreviewRequest,
  PREVIEW_DOCUMENT_EVENT,
  previewErrorCode,
  type DocumentPreviewRequest,
  type PreviewDocumentDetail,
} from "./team-document";

const core = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: core.invoke, isTauri: core.isTauri }));

let remove: () => void = () => {};
let off: () => void = () => {};
beforeEach(() => {
  core.invoke.mockReset();
  core.isTauri.mockReturnValue(true);
});
afterEach(() => {
  remove();
  off();
  remove = () => {};
  off = () => {};
});

function send(detail: PreviewDocumentDetail): boolean {
  return !window.dispatchEvent(new CustomEvent(PREVIEW_DOCUMENT_EVENT, { detail, cancelable: true }));
}

describe("the preview event", () => {
  it("answers the probe with «supported» in the desktop and says nothing in the web", () => {
    const probe: PreviewDocumentDetail = { probe: true };
    send(probe);
    expect(probe.supported).toBeUndefined();
    remove = installDocumentPreview();
    const asked: PreviewDocumentDetail = { probe: true };
    send(asked);
    expect(asked.supported).toBe(true);
  });

  it("hands a request of two plain names and a kind to the window, and takes the event", () => {
    remove = installDocumentPreview();
    const seen: DocumentPreviewRequest[] = [];
    off = onDocumentPreviewRequest((r) => seen.push(r));
    expect(send({ name: "CV_1.pdf", textName: "CV_1.md", kind: "cv" })).toBe(true);
    expect(send({ name: "CL_1.pdf", kind: "letter" })).toBe(true);
    expect(seen).toEqual([
      { name: "CV_1.pdf", textName: "CV_1.md", kind: "cv" },
      { name: "CL_1.pdf", textName: null, kind: "letter" },
    ]);
  });

  it("refuses what is not a plain request: no name, a long name, another kind, nothing listening", () => {
    remove = installDocumentPreview();
    const seen: DocumentPreviewRequest[] = [];
    off = onDocumentPreviewRequest((r) => seen.push(r));
    expect(send({ name: "", kind: "cv" })).toBe(false);
    expect(send({ name: "x".repeat(121), kind: "cv" })).toBe(false);
    expect(send({ name: "a.pdf", kind: "other" as never })).toBe(false);
    expect(send({ kind: "cv" })).toBe(false);
    expect(seen).toEqual([]);
    off();
    off = () => {};
    expect(send({ name: "a.pdf", kind: "cv" })).toBe(false);
  });

  it("is not installed outside the desktop", () => {
    core.isTauri.mockReturnValue(false);
    remove = installDocumentPreview();
    const detail: PreviewDocumentDetail = { probe: true };
    send(detail);
    expect(detail.supported).toBeUndefined();
  });
});

describe("the calls to the native side", () => {
  it("asks for the text, the pages and one page by their plain arguments", async () => {
    core.invoke.mockResolvedValueOnce({ text: "# hi" });
    expect(await documentPreviewApi.text("CV_1.md")).toBe("# hi");
    expect(core.invoke).toHaveBeenLastCalledWith("team_document_text", { name: "CV_1.md" });
    core.invoke.mockResolvedValueOnce({ pages: 2, truncated: false, sha256: "a".repeat(64) });
    expect(await documentPreviewApi.pages("CV_1.pdf")).toEqual({ pages: 2, truncated: false, sha256: "a".repeat(64) });
    expect(core.invoke).toHaveBeenLastCalledWith("team_document_pages", { name: "CV_1.pdf" });
    core.invoke.mockResolvedValueOnce({ page: 1, png: "AAAA" });
    expect(await documentPreviewApi.page("CV_1.pdf", 1, "a".repeat(64))).toBe("AAAA");
    expect(core.invoke).toHaveBeenLastCalledWith("team_document_page", { name: "CV_1.pdf", page: 1, sha256: "a".repeat(64) });
    await documentPreviewApi.open("CV_1.pdf");
    expect(core.invoke).toHaveBeenLastCalledWith("team_document_open", { name: "CV_1.pdf" });
  });

  it("does not believe an answer that is not whole", async () => {
    for (const reply of [{}, { text: 5 }, null]) {
      core.invoke.mockResolvedValueOnce(reply);
      await expect(documentPreviewApi.text("a.md")).rejects.toEqual({ code: "read_failed" });
    }
    for (const reply of [{ pages: 0, truncated: false, sha256: "a" }, { pages: 7, truncated: true, sha256: "a" }, { pages: 2, sha256: "a" }, { pages: 2, truncated: false }, {}]) {
      core.invoke.mockResolvedValueOnce(reply);
      await expect(documentPreviewApi.pages("a.pdf")).rejects.toEqual({ code: "read_failed" });
    }
    core.invoke.mockResolvedValueOnce({});
    await expect(documentPreviewApi.page("a.pdf", 1, "a".repeat(64))).rejects.toEqual({ code: "read_failed" });
  });

  it("keeps only a closed code from an error", () => {
    expect(previewErrorCode({ code: "document_unreadable" })).toBe("document_unreadable");
    for (const odd of [new Error("CV_synthetic.pdf failed"), { code: "has a space" }, { code: 5 }, { code: "x".repeat(65) }, null, "text"]) {
      expect(previewErrorCode(odd)).toBe("read_failed");
    }
  });
});

describe("what the preview is built from", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const desktop = join(here, "..", "..");
  const files = [
    join(here, "safe-markdown.ts"),
    join(desktop, "src", "components", "SafeMarkdown.tsx"),
    join(desktop, "src", "pages", "positions", "DocumentPreview.tsx"),
    join(desktop, "src", "pages", "positions", "DocumentPreviewHost.tsx"),
  ];

  it("never builds HTML, never loads a frame, embed or object, never gives an element the document's words as a link", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const forbidden of ["dangerouslySetInnerHTML", "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "<iframe", "<embed", "<object", "<a ", "href=", "srcDoc", "createContextualFragment", "DOMParser", "eval(", "new Function"]) {
        expect(source.includes(forbidden), `${forbidden} in ${file}`).toBe(false);
      }
    }
  });

  it("has no PDF or markdown library among its dependencies", () => {
    const manifests = [join(desktop, "package.json"), join(desktop, "..", "web", "package.json")];
    for (const manifest of manifests) {
      const json = JSON.parse(readFileSync(manifest, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const names = Object.keys({ ...json.dependencies, ...json.devDependencies });
      const found = names.filter((name) => /pdf|markdown|marked|remark|rehype|mdast|micromark|dompurify|sanitize-html|showdown/i.test(name));
      expect(found, manifest).toEqual([]);
    }
  });
});
