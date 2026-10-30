import { useSyncExternalStore } from "react";
import { existingTeamView } from "./existing-team-readonly";

/**
 * The pages show the data of the team on THIS computer: a profile with no cloud account has nothing else to
 * show. Its positions, scores and applications are read from the team's jobs.db through the same native read
 * as an existing team's VPS (existing-team-positions.ts), the cloud is not asked, and nothing writes.
 *
 * A module store like the existing team's view, for the same reason: the pages read their data in effects that
 * run before any parent effect could switch it on, so the dashboard sets it while it renders (`setLocalTeamData`
 * changes only a variable) and the subscribers hear of it right after.
 */
let identity: string | null = null;
/** The last read of the team said its container is not running (and no read has worked since). */
let stopped = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `key` is the identity whose local team the pages read; null: not in this mode. Safe to call while rendering. */
export function setLocalTeamData(key: string | null): void {
  if (identity === key) return;
  identity = key;
  stopped = false;
  queueMicrotask(emit);
}

/** Whose local team the pages read, for what is kept per team for a few seconds; null outside this mode. Never leaves the page. */
export function localTeamDataKey(): string | null {
  return identity;
}

export function localTeamData(): boolean {
  return identity !== null;
}

/** Where a page takes its data from the team's own database: an existing team's VPS, or this computer's team. */
export function teamDataFromTheTeam(): boolean {
  return identity !== null || existingTeamView() !== null;
}

/** What a native read of the team answered: `code` is its failure, null when it worked. */
export function reportLocalTeamRead(code: string | null): void {
  if (identity === null) return;
  const next = code === "local_team_not_running";
  if (next === stopped) return;
  stopped = next;
  emit();
}

export function useLocalTeamData(): boolean {
  return useSyncExternalStore(subscribe, localTeamData, localTeamData);
}

export function useLocalTeamStopped(): boolean {
  return useSyncExternalStore(subscribe, () => identity !== null && stopped, () => false);
}
