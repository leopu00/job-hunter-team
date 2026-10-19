import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Saving a CSV the page built (web/app/(protected)/positions/ExportCsvButton).
 *
 * The web components cannot call the desktop, and a webview does not save a
 * `download` link to disk. The button therefore announces the file in a
 * cancelable `jht:export-csv` event; here, in the desktop, the event is taken
 * and the file is saved by the native side (src-tauri/src/export_file.rs) in
 * the Downloads folder. Where nobody listens (the web), the button downloads
 * the file itself.
 */
export const EXPORT_CSV_EVENT = "jht:export-csv";

export interface ExportCsvDetail {
  name: string;
  csv: string;
  /** Set by the listener: resolves with where the file was saved. */
  result?: Promise<string>;
}

export async function saveCsv(name: string, csv: string): Promise<string> {
  return invoke<string>("export_csv_save", { name, content: csv });
}

export function installCsvExport(target: Window = window): () => void {
  if (!isTauri()) return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ExportCsvDetail>).detail;
    if (!detail || typeof detail.name !== "string" || typeof detail.csv !== "string") return;
    event.preventDefault();
    detail.result = saveCsv(detail.name, detail.csv);
  };
  target.addEventListener(EXPORT_CSV_EVENT, listener);
  return () => target.removeEventListener(EXPORT_CSV_EVENT, listener);
}
