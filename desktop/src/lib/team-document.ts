import { invoke, isTauri } from "@tauri-apps/api/core";
import { describeError } from "./error-catalog";
import { appLocale } from "./app-locale";

/**
 * Saving a CV or a cover letter the team wrote (web/app/(protected)/positions/[id]/CvDownloadButton).
 *
 * The PDFs live on the box that runs the team and the website reaches them through a bridge the app does not
 * have. The button therefore announces the file in a cancelable `jht:save-document` event; here, in the
 * desktop, the event is taken and the native side (src-tauri/src/team_document.rs) reads the PDF from the team
 * and saves it where the person picks in the system's «Save as» window. The page names the file by its plain
 * name and nothing else; the name is never logged. Where nobody listens (the web), the button goes on with the
 * bridge. The app never opens or interprets a PDF: saving writes the file where the person picks, and the preview
 * (below) shows the team's own rendering of it, as pictures, and the markdown as text.
 */
export const SAVE_DOCUMENT_EVENT = "jht:save-document";

export type DocumentOutcome = "saved" | "cancelled";

export interface SaveDocumentDetail {
  name: string;
  /** Set by the listener: resolves with what happened, rejects with an error carrying a closed `code` and its `message`. */
  result?: Promise<DocumentOutcome>;
}

/** The error the page gets: a closed code and the catalog's sentence for it, never the file's name. */
function documentError(error: unknown): { code: string; message: string } {
  const raw = (error as { code?: unknown } | null)?.code;
  const code = typeof raw === "string" && raw ? raw : "document_save_failed";
  const copy = describeError(code, { fallback: "document_save_failed", locale: appLocale() });
  return { code, message: `${copy.text} ${copy.action}` };
}

export async function saveTeamDocument(name: string): Promise<DocumentOutcome> {
  let reply: { outcome?: unknown } | undefined;
  try {
    reply = await invoke<{ outcome?: unknown }>("team_document_save", { name });
  } catch (error) {
    throw documentError(error);
  }
  if (reply?.outcome === "saved" || reply?.outcome === "cancelled") return reply.outcome;
  throw documentError(null);
}

export function installDocumentSave(target: Window = window): () => void {
  if (!isTauri()) return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SaveDocumentDetail>).detail;
    if (!detail || typeof detail.name !== "string") return;
    event.preventDefault();
    detail.result = saveTeamDocument(detail.name);
  };
  target.addEventListener(SAVE_DOCUMENT_EVENT, listener);
  return () => target.removeEventListener(SAVE_DOCUMENT_EVENT, listener);
}

// ── The preview inside the app ─────────────────────────────────────────────────────────────────────────────

/**
 * The position page's «Preview» button asks the desktop to show a CV or a letter. It first PROBES with the same
 * event (`probe: true`): the desktop answers `supported = true`, the web answers nothing, and only then does the
 * button appear. The request itself carries two plain file names and the kind, nothing else.
 */
export const PREVIEW_DOCUMENT_EVENT = "jht:preview-document";

export type PreviewKind = "cv" | "letter";

export interface PreviewDocumentDetail {
  probe?: boolean;
  supported?: boolean;
  name?: string;
  textName?: string | null;
  kind?: PreviewKind;
}

export interface DocumentPreviewRequest {
  name: string;
  textName: string | null;
  kind: PreviewKind;
}

export interface DocumentPages {
  pages: number;
  truncated: boolean;
  sha256: string;
}

/** What the preview window asks of the app. The real one talks to the native side; a test gives its own. */
export interface DocumentPreviewApi {
  text(name: string): Promise<string>;
  pages(name: string): Promise<DocumentPages>;
  /** One page as the base64 of a PNG, of the file `pages` described. */
  page(name: string, page: number, sha256: string): Promise<string>;
  save(name: string): Promise<DocumentOutcome>;
  open(name: string): Promise<void>;
}

/** The closed code of a failed preview call; never the file's name, never a message from outside. */
export function previewErrorCode(error: unknown): string {
  const raw = (error as { code?: unknown } | null)?.code;
  return typeof raw === "string" && /^[a-z0-9_]{1,64}$/.test(raw) ? raw : "read_failed";
}

export const documentPreviewApi: DocumentPreviewApi = {
  async text(name) {
    const reply = await invoke<{ text?: unknown }>("team_document_text", { name });
    if (typeof reply?.text !== "string") throw { code: "read_failed" };
    return reply.text;
  },
  async pages(name) {
    const reply = await invoke<Partial<DocumentPages>>("team_document_pages", { name });
    if (
      !Number.isInteger(reply?.pages) || (reply.pages as number) < 1 || (reply.pages as number) > 6 ||
      typeof reply.truncated !== "boolean" || typeof reply.sha256 !== "string"
    ) throw { code: "read_failed" };
    return { pages: reply.pages as number, truncated: reply.truncated, sha256: reply.sha256 };
  },
  async page(name, page, sha256) {
    const reply = await invoke<{ png?: unknown }>("team_document_page", { name, page, sha256 });
    if (typeof reply?.png !== "string") throw { code: "read_failed" };
    return reply.png;
  },
  save: saveTeamDocument,
  async open(name) {
    await invoke("team_document_open", { name });
  },
};

type PreviewListener = (request: DocumentPreviewRequest) => void;
let previewListener: PreviewListener | null = null;

/** The window that shows previews says it is there; one at a time. Returns how to take it back. */
export function onDocumentPreviewRequest(listener: PreviewListener): () => void {
  previewListener = listener;
  return () => {
    if (previewListener === listener) previewListener = null;
  };
}

function plainName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120;
}

export function installDocumentPreview(target: Window = window): () => void {
  if (!isTauri()) return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PreviewDocumentDetail>).detail;
    if (!detail) return;
    if (detail.probe === true) {
      detail.supported = true;
      return;
    }
    if (!plainName(detail.name) || (detail.kind !== "cv" && detail.kind !== "letter")) return;
    if (!previewListener) return;
    event.preventDefault();
    previewListener({ name: detail.name, textName: plainName(detail.textName) ? detail.textName : null, kind: detail.kind });
  };
  target.addEventListener(PREVIEW_DOCUMENT_EVENT, listener);
  return () => target.removeEventListener(PREVIEW_DOCUMENT_EVENT, listener);
}
