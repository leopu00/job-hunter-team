import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * «Export my data» (contract: banda/piani/CONTRATTO-export-dati-20261024.md).
 *
 * The team's data comes from the team's live `jobs.db`, through the chat's channel (this computer's team,
 * an existing team, the VPS the app made), as six closed sources: not the eight files of the web's
 * `/export`, which nobody writes any more. The page never names a path: the native side opens the
 * system's «Save as» window, and closing it is `cancelled`, not an error. Exporting is a read: it works in
 * the read-only view too, and needs the chat connected.
 *
 * Account data is read by the page from the cloud with the person's own session (lib/account-export.ts);
 * only the text of the file comes here, to be saved.
 */
export const EXPORT_SOURCES = ["positions", "scores", "applications", "companies", "feedback", "notes"] as const;
export const EXPORT_FORMATS = ["json", "csv"] as const;
export type ExportSource = (typeof EXPORT_SOURCES)[number];
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface TeamExportRequest {
  source: ExportSource;
  format: ExportFormat;
  /** First day to include, `YYYY-MM-DD`; both ends are inside the range. */
  from?: string;
  to?: string;
}

/** `count` only for the team's data (the rows written); an error is a closed code of the error catalog. */
export type ExportOutcome =
  | { ok: true; outcome: "saved"; count?: number }
  | { ok: true; outcome: "cancelled" }
  | { ok: false; error: string };

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  const code = (error as { code?: unknown } | null)?.code;
  return { ok: false, error: typeof code === "string" && code ? code : fallback };
}

/** What the native side answered, as the page may trust it. */
function outcomeOf(reply: unknown, withCount: boolean): ExportOutcome {
  const { outcome, count } = (typeof reply === "object" && reply !== null ? reply : {}) as { outcome?: unknown; count?: unknown };
  if (outcome === "cancelled") return { ok: true, outcome: "cancelled" };
  if (outcome === "saved") {
    return withCount && typeof count === "number" && Number.isSafeInteger(count) && count >= 0
      ? { ok: true, outcome: "saved", count }
      : { ok: true, outcome: "saved" };
  }
  return { ok: false, error: "export_save_failed" };
}

/** Saves one source of the team's data, in the file the person picks. */
export async function exportTeamData(request: TeamExportRequest): Promise<ExportOutcome> {
  if (!isTauri()) return { ok: false, error: "desktop_only" };
  try {
    return outcomeOf(await invoke("export_team_data", { request }), true);
  } catch (error) {
    return failure(error, "export_save_failed");
  }
}

/** Saves the text of the account's data (a JSON object the page built), in the file the person picks. */
export async function saveAccountExport(text: string): Promise<ExportOutcome> {
  if (!isTauri()) return { ok: false, error: "desktop_only" };
  try {
    return outcomeOf(await invoke("export_account_save", { text }), false);
  } catch (error) {
    return failure(error, "export_save_failed");
  }
}
