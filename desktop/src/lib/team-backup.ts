import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * A backup of what the person owns in the team, saved on this computer
 * (contract: banda/piani/CONTRATTO-backup-20261024.md).
 *
 * What goes in is decided by the native side, never by the page: a snapshot of the team's database, the
 * profile, the chats and the documents of the applications, the language, and the configuration with every
 * secret emptied. The provider sign-ins, the cloud token and the logs never go. The file is one `.tar.gz`
 * saved where the person says in the system's «Save as» window; closing it is `cancelled`, not an error.
 * Making one is a read of the team: it works in the read-only view too, and needs the chat connected.
 * It is NOT encrypted: the page says so before saving. Restoring is not here (a contract of its own).
 */
export type BackupPhase = "plan" | "snapshot" | "copy" | "verify";
export const BACKUP_PHASES: readonly BackupPhase[] = ["plan", "snapshot", "copy", "verify"];

/** `done` of `total` bytes; both 0 while the phase has no size (planning). */
export interface BackupProgress {
  phase: BackupPhase;
  done: number;
  total: number;
}

export type BackupOutcome =
  | { ok: true; outcome: "saved"; bytes: number; files: number }
  | { ok: true; outcome: "cancelled" }
  | { ok: false; error: string };

/** What a backup says it holds: paths and sizes, never the contents. */
export interface BackupManifest {
  format: 1;
  createdAt: string | null;
  files: { path: string; bytes: number }[];
  /** What was left out of this backup, and why (`too_large`, `outside_home`, `not_allowed`, …). */
  excluded: { path: string | null; reason: string | null }[];
  /** What no backup ever holds (the cloud token, the sign-ins, the logs…). */
  alwaysExcluded: string[];
}

export type BackupInspectOutcome =
  | { ok: true; outcome: "opened"; manifest: BackupManifest; verified: boolean; problems: string[] }
  | { ok: true; outcome: "cancelled" }
  | { ok: false; error: string };

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  const code = (error as { code?: unknown } | null)?.code;
  return { ok: false, error: typeof code === "string" && code ? code : fallback };
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The manifest as the page may trust it, or nothing. */
export function manifestOf(value: unknown): BackupManifest | null {
  if (!isObject(value) || value.format !== 1 || !Array.isArray(value.files) || !Array.isArray(value.excluded) || !Array.isArray(value.alwaysExcluded)) return null;
  const files: BackupManifest["files"] = [];
  for (const entry of value.files) {
    if (!isObject(entry) || typeof entry.path !== "string" || !isCount(entry.bytes)) return null;
    files.push({ path: entry.path, bytes: entry.bytes });
  }
  const excluded = value.excluded.filter(isObject).map((entry) => ({ path: textOrNull(entry.path), reason: textOrNull(entry.reason) }));
  const alwaysExcluded = value.alwaysExcluded.filter((name): name is string => typeof name === "string");
  return { format: 1, createdAt: textOrNull(value.createdAt), files, excluded, alwaysExcluded };
}

/** Makes a backup in the file the person picks. */
export async function backupCreate(): Promise<BackupOutcome> {
  if (!isTauri()) return { ok: false, error: "desktop_only" };
  try {
    const reply: unknown = await invoke("backup_create");
    const { outcome, bytes, files } = (isObject(reply) ? reply : {}) as Record<string, unknown>;
    if (outcome === "cancelled") return { ok: true, outcome: "cancelled" };
    if (outcome === "saved" && isCount(bytes) && isCount(files)) return { ok: true, outcome: "saved", bytes, files };
    return { ok: false, error: "backup_save_failed" };
  } catch (error) {
    return failure(error, "backup_save_failed");
  }
}

/** Stops the backup that is running, between two blocks; the part file and the team's folder go away. */
export async function backupCancel(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("backup_cancel");
  } catch {
    /* nothing running, or not the app's window: there is nothing to say */
  }
}

/** Opens a backup the person picks and checks it against its own manifest. The team is not touched. */
export async function backupInspect(): Promise<BackupInspectOutcome> {
  if (!isTauri()) return { ok: false, error: "desktop_only" };
  try {
    const reply: unknown = await invoke("backup_inspect");
    if (isObject(reply) && reply.outcome === "cancelled") return { ok: true, outcome: "cancelled" };
    if (isObject(reply) && reply.outcome === "opened" && typeof reply.verified === "boolean" && Array.isArray(reply.problems)) {
      const manifest = manifestOf(reply.manifest);
      if (manifest) return { ok: true, outcome: "opened", manifest, verified: reply.verified, problems: reply.problems.filter((problem): problem is string => typeof problem === "string") };
    }
    return { ok: false, error: "backup_not_a_backup" };
  } catch (error) {
    return failure(error, "backup_not_a_backup");
  }
}

/** Calls `listener` with the progress of the backup that runs; returns the function that stops listening. */
export async function onBackupProgress(listener: (progress: BackupProgress) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  try {
    return await listen<unknown>("backup-progress", (event) => {
      const { phase, done, total } = (isObject(event.payload) ? event.payload : {}) as Record<string, unknown>;
      if (BACKUP_PHASES.includes(phase as BackupPhase) && isCount(done) && isCount(total)) listener({ phase: phase as BackupPhase, done, total });
    });
  } catch {
    return () => {};
  }
}
