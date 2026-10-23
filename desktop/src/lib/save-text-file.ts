import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * «Save as» of a small text the page made (save_text_file, text_file_export.rs): the system's own window opens,
 * the person picks the place, and only the native side writes. The page never names a path.
 */
export type SaveTextResult = { outcome: "saved" } | { outcome: "cancelled" } | { outcome: "failed"; code: string };

/** Only the desktop app has the command; in a browser the page offers «Copy» alone. */
export const canSaveTextFile = () => isTauri();

export async function saveTextFile(suggestedName: string, contents: string): Promise<SaveTextResult> {
  try {
    const reply = await invoke<{ outcome?: unknown }>("save_text_file", { suggestedName, contents });
    if (reply?.outcome === "saved") return { outcome: "saved" };
    if (reply?.outcome === "cancelled") return { outcome: "cancelled" };
    return { outcome: "failed", code: "unknown" };
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    return { outcome: "failed", code: typeof code === "string" ? code : "unknown" };
  }
}
