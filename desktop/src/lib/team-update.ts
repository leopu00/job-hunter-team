import { invoke, isTauri } from "@tauri-apps/api/core";
import { describeError } from "./error-catalog";

/** What a person types in the Terminal to update the team: the host's own command (`jht upgrade`). */
export const TEAM_UPDATE_COMMAND = "jht upgrade";

/**
 * True for every error whose catalog action is «Update the team…»: the team runs an older image than the app. It is read from
 * the catalog itself, so a new message that asks for the update gets the guide with no second list to keep in step.
 */
export function wantsTeamUpdate(code: string | null | undefined): boolean {
  if (typeof code !== "string") return false;
  const described = describeError(code, { locale: "en" });
  return described.known && /^Update the team\b/i.test(described.action);
}

// ── The update itself, from the app (JHT-T173) ──────────────────────────────────────────────────────────────────────
// The native side (`onboarding_team_update`, team_update.rs) runs `jht upgrade --json` on the team's host, or, on a
// test install, the installer of the onboarding again. The page only asks and tells the closed answer.

/** The phases `jht upgrade --json` names, as the native side passes them on (anything else is «unknown»). */
export const TEAM_UPDATE_PHASES = [
  "preflight", "recovery", "pull", "candidate_metadata", "activate", "commit", "verify", "check", "complete", "unknown",
] as const;
export type TeamUpdatePhase = (typeof TEAM_UPDATE_PHASES)[number];

/** The host's own sentences that have words of their own on the page. */
export const TEAM_UPDATE_REASONS = [
  "test_channel", "disk_low", "in_progress", "download_failed", "engine_unavailable", "release_unreachable",
  "podman_machine_mounts",
] as const;
export type TeamUpdateReason = (typeof TEAM_UPDATE_REASONS)[number];

export interface TeamUpdateOutcome {
  ok: boolean;
  /** A check: a newer image is there. An update: the image changed. */
  changed: boolean;
  phase: TeamUpdatePhase;
  reason: TeamUpdateReason | null;
  /** The failed update was undone: the version that worked is back. */
  rolledBack: boolean;
  restartRequired: boolean;
  previousVersion: string;
  currentVersion: string;
  /** A check: the two images compared, `<installed>:<this build's>` (12 hex each). Empty for everything else. */
  imageId: string;
  /** `upgrade`: the host's `jht upgrade`. `reinstall`: the installer of a test install, run again. */
  mode: "upgrade" | "reinstall";
}

/** Codes after which the page falls back to the guide with the command: the host cannot be updated from here. */
export const TEAM_UPDATE_GUIDE_CODES: readonly string[] = ["team_update_wrapper_outdated", "team_update_unsupported", "desktop_only"];

const VERSION_TEXT = /^[A-Za-z0-9.,:_+@/-]{0,64}$/;
const IMAGE_ID = /^([0-9a-f]{0,12}:[0-9a-f]{0,12})?$/;

export function parseTeamUpdateOutcome(value: unknown): TeamUpdateOutcome | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.ok !== "boolean" || typeof r.changed !== "boolean" || typeof r.rolledBack !== "boolean" ||
      typeof r.restartRequired !== "boolean") return null;
  if (!(TEAM_UPDATE_PHASES as readonly unknown[]).includes(r.phase)) return null;
  if (r.reason !== null && !(TEAM_UPDATE_REASONS as readonly unknown[]).includes(r.reason)) return null;
  if (r.mode !== "upgrade" && r.mode !== "reinstall") return null;
  if (typeof r.previousVersion !== "string" || !VERSION_TEXT.test(r.previousVersion)) return null;
  if (typeof r.currentVersion !== "string" || !VERSION_TEXT.test(r.currentVersion)) return null;
  if (typeof r.imageId !== "string" || !IMAGE_ID.test(r.imageId)) return null;
  return {
    ok: r.ok, changed: r.changed, phase: r.phase as TeamUpdatePhase, reason: r.reason as TeamUpdateReason | null,
    rolledBack: r.rolledBack, restartRequired: r.restartRequired, previousVersion: r.previousVersion,
    currentVersion: r.currentVersion, imageId: r.imageId, mode: r.mode,
  };
}

async function ask(action: "check" | "apply"): Promise<TeamUpdateOutcome> {
  if (!isTauri()) throw { code: "desktop_only" };
  const outcome = parseTeamUpdateOutcome(await invoke("onboarding_team_update", { action }));
  if (!outcome) throw { code: "team_update_failed" };
  return outcome;
}

/**
 * Asks whether the team is on the image of this app. Changes nothing, downloads nothing and starts no process: the native
 * side compares two digests it reads as small files (this computer only; a VPS answers `team_update_unsupported`).
 * Rejects with `{ code }`.
 */
export const checkTeamUpdate = () => ask("check");

/** Updates the team on its host. A failed update that was undone still resolves, with `ok: false` and `rolledBack`. */
export const applyTeamUpdate = () => ask("apply");

const CHECKED_KEY = "jht-team-update-checked";
/** One check a day: it asks the release server on the team's host. Storage that fails is «never asked», so it asks. */
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export function teamUpdateCheckDue(now: number = Date.now()): boolean {
  try {
    const last = Number(localStorage.getItem(CHECKED_KEY));
    return !Number.isFinite(last) || last <= 0 || now - last >= CHECK_EVERY_MS || now < last;
  } catch {
    return true;
  }
}

const ACKED_KEY = "jht-team-update-acked";

/** The pair of images (`TeamUpdateOutcome.imageId`) the person already updated the team to, or null. */
export function ackedTeamImage(): string | null {
  try {
    return localStorage.getItem(ACKED_KEY);
  } catch {
    return null;
  }
}

/**
 * After an update, the team runs the image the release had at that moment, which may be newer than the one this build was
 * made for: the pair is remembered, so the notice does not tell the same difference again. A new build, or a team on another
 * image, is a new pair and is told.
 */
export async function ackCurrentTeamImage(): Promise<void> {
  try {
    const checked = await checkTeamUpdate();
    if (checked.imageId) localStorage.setItem(ACKED_KEY, checked.imageId);
  } catch {
    /* nothing to remember: the notice may tell it once more */
  }
}

export function noteTeamUpdateChecked(now: number = Date.now()): void {
  try {
    localStorage.setItem(CHECKED_KEY, String(now));
  } catch {
    /* no storage: it asks again at the next start */
  }
}
