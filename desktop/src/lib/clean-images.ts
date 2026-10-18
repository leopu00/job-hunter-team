import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ExecutionHost } from "./onboarding";

/** Why `jht clean-images` removed nothing ("" = it ran), as the native side passes it on. */
export const CLEAN_IMAGES_SKIPPED = [
  "", "opt-out", "runtime-not-installed", "upgrade-in-progress", "upgrade-pending",
  "current-unidentified", "current-not-running", "previous-unidentified",
  "containers-unreadable", "images-unreadable", "unknown",
] as const;
export type CleanImagesSkipped = (typeof CLEAN_IMAGES_SKIPPED)[number];

/** What «Free up space» did: the `imagePrune` block of `jht clean-images --json`. */
export interface CleanImagesOutcome {
  removed: number;
  freedBytes: number;
  refused: number;
  inUse: number;
  skipped: CleanImagesSkipped;
  /** The images live in Podman's virtual machine (macOS): the space is freed there. */
  virtualMachine: boolean;
}

const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function parseCleanImagesOutcome(value: unknown): CleanImagesOutcome | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (!count(r.removed) || !count(r.freedBytes) || !count(r.refused) || !count(r.inUse) ||
      typeof r.virtualMachine !== "boolean" ||
      !(CLEAN_IMAGES_SKIPPED as readonly unknown[]).includes(r.skipped)) return null;
  return {
    removed: r.removed, freedBytes: r.freedBytes, refused: r.refused, inUse: r.inUse,
    skipped: r.skipped as CleanImagesSkipped, virtualMachine: r.virtualMachine,
  };
}

/**
 * Runs the cleaning on the team's host: `host` is the one being set up, null
 * the saved one. Rejects with `{ code }` (the engine off, a failure, …).
 */
export async function cleanImages(host: ExecutionHost | null): Promise<CleanImagesOutcome> {
  if (!isTauri()) throw { code: "desktop_only" };
  const outcome = parseCleanImagesOutcome(await invoke("onboarding_clean_images", { host }));
  if (!outcome) throw { code: "clean_images_failed" };
  return outcome;
}

/** The catalog entry that tells an outcome, with the freed size when it names one. */
export function cleanImagesResult(outcome: CleanImagesOutcome): { code: string; bytes?: number } {
  if (outcome.removed > 0) {
    return { code: outcome.virtualMachine ? "clean_images_freed_vm" : "clean_images_freed", bytes: outcome.freedBytes };
  }
  switch (outcome.skipped) {
    case "":
      return { code: outcome.inUse > 0 ? "clean_images_in_use" : outcome.refused > 0 ? "clean_images_refused" : "clean_images_nothing" };
    case "runtime-not-installed": return { code: "clean_images_nothing" };
    case "opt-out": return { code: "clean_images_kept_by_choice" };
    case "upgrade-in-progress":
    case "upgrade-pending": return { code: "clean_images_upgrade" };
    case "current-unidentified":
    case "current-not-running": return { code: "clean_images_container_off" };
    case "previous-unidentified": return { code: "clean_images_dates_unreadable" };
    case "containers-unreadable":
    case "images-unreadable": return { code: "clean_images_engine_unreadable" };
    default: return { code: "clean_images_kept" };
  }
}
