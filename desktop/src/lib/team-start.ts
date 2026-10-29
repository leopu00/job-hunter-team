import { invoke, isTauri } from "@tauri-apps/api/core";

export const TEAM_START_PHASES = ["awaiting_profile", "burst", "steady"] as const;
export type TeamStartPhase = (typeof TEAM_START_PHASES)[number];

/** Where the team's first start stands, as the team's own state file says. */
export interface TeamStart {
  /** `null`: the file is not there, cannot be read or says another phase. Never counts as started. */
  phase: TeamStartPhase | null;
  /** The workers the burst opened (the roster in the file), not a check of processes. 0 with no phase. */
  workers: number;
  /** The subscription plan is declared (a plan «I don't know» is declared). */
  planDeclared: boolean;
}

/**
 * Reads where the team's first start stands. Read-only, no argument crosses. `null` when it cannot be read for any
 * reason (not connected, an older image, a malformed answer): unreadable is never «started».
 */
export async function readTeamStart(): Promise<TeamStart | null> {
  if (!isTauri()) return null;
  try {
    const reply = (await invoke<unknown>("team_start_read")) as Record<string, unknown> | null;
    if (!reply || reply.ok !== true) return null;
    const phase = reply.phase;
    const workers = reply.workers;
    if (phase !== null && !(TEAM_START_PHASES as readonly unknown[]).includes(phase)) return null;
    if (typeof workers !== "number" || !Number.isInteger(workers) || workers < 0 || workers > 1000) return null;
    if (typeof reply.planDeclared !== "boolean") return null;
    return { phase: phase as TeamStartPhase | null, workers: phase === null ? 0 : workers, planDeclared: reply.planDeclared };
  } catch {
    return null;
  }
}
