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
 * bridge. The app only saves the file: it does not open it.
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
