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
/**
 * The pages are showing what the team saved because its container is off: seconds since the epoch the data were last written,
 * 0 when the moment is not known (a team that never ran), null when they are not showing saved data. A read that is a
 * failure of the team being off leaves it as it is (a page that asks for something only the team can give must not make the
 * bar flip); only a read that worked without the mark (the team is up) or a change of team clears it.
 */
let savedAt: number | null = null;
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
  savedAt = null;
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

/** The mark a native read carries when its data are the ones the team saved: when they were last written (null: not known). */
export interface SavedMark {
  at: number | null;
}

/** What a native read of the team answered: `code` is its failure, null when it worked; `saved` is there when it worked from saved data. */
export function reportLocalTeamRead(code: string | null, saved?: SavedMark | null): void {
  if (identity === null) return;
  const nextStopped = code === "local_team_not_running";
  let nextSaved = savedAt;
  if (saved) nextSaved = typeof saved.at === "number" && saved.at > 0 ? saved.at : 0;
  else if (code === null) nextSaved = null;
  if (nextStopped === stopped && nextSaved === savedAt) return;
  stopped = nextStopped;
  savedAt = nextSaved;
  emit();
}

export function useLocalTeamData(): boolean {
  return useSyncExternalStore(subscribe, localTeamData, localTeamData);
}

export function useLocalTeamStopped(): boolean {
  return useSyncExternalStore(subscribe, () => identity !== null && stopped, () => false);
}

/** When the saved data on show were last written (seconds since the epoch; 0: not known), or null when the data are the live team's. */
export function useLocalTeamSavedAt(): number | null {
  return useSyncExternalStore(subscribe, () => (identity !== null ? savedAt : null), () => null);
}

/** Whether the pages show what the team saved (its container is off): a verdict or a change cannot be written to it from them. */
export function localTeamShowsSavedData(): boolean {
  return identity !== null && savedAt !== null;
}
