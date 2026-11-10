import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Where the tools of the runtime stand, through the native `tools_tier_tick` command (src-tauri/src/tools_tier.rs).
 * The install brings the core image; the host pulls the full one in the background and switches the team to it when
 * the onboarding has closed. Each call is one round that keeps that moving and says where it is. The page passes nothing
 * and decides nothing; a reply outside the closed shape is no reply.
 */
export const TOOLS_STATES = ["none", "pending", "pulling", "ready", "failed"] as const;
export type ToolsState = (typeof TOOLS_STATES)[number];
export const TOOLS_MESSAGES = ["ui_phase_tools_pull", "ui_phase_tools_ready"] as const;
export type ToolsMessage = (typeof TOOLS_MESSAGES)[number];

export interface ToolsTier {
  state: ToolsState;
  tier: "core" | "full";
  /** The text key of the phase a step of this round announced (`jht tools pull` / `switch`), when one did. */
  message: ToolsMessage | null;
}

export function parseToolsTier(value: unknown): ToolsTier | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { state, tier, message } = value as Record<string, unknown>;
  if (typeof state !== "string" || !(TOOLS_STATES as readonly string[]).includes(state)) return null;
  if (tier !== "core" && tier !== "full") return null;
  if (message !== null && message !== undefined && !(TOOLS_MESSAGES as readonly string[]).includes(message as string)) return null;
  return { state: state as ToolsState, tier, message: (message ?? null) as ToolsMessage | null };
}

/** One round, or null when the desktop cannot answer (not the app, no team here yet, an unreadable reply). */
export async function toolsTierTick(): Promise<ToolsTier | null> {
  if (!isTauri()) return null;
  try {
    return parseToolsTier(await invoke<unknown>("tools_tier_tick"));
  } catch {
    return null;
  }
}

/** The text of what is happening, or null when there is nothing to say. */
export function toolsTierTextKey(seen: ToolsTier | null, justSwitched: boolean): ToolsMessage | null {
  if (!seen) return null;
  if (justSwitched) return "ui_phase_tools_ready";
  if (seen.tier === "core" && (seen.state === "pending" || seen.state === "pulling" || seen.state === "ready")) return "ui_phase_tools_pull";
  return null;
}

/** Milliseconds to the next round: quick while the tools move, slow when there is nothing to move, never once on full. */
export function toolsTierDelay(seen: ToolsTier | null): number | null {
  if (!seen) return 60_000;
  if (seen.tier === "full" && seen.state !== "none") return null;
  if (seen.state === "pending" || seen.state === "pulling" || seen.state === "ready") return 20_000;
  return seen.state === "failed" ? 60_000 : 300_000;
}
