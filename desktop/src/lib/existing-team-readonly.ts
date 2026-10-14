import { useSyncExternalStore } from "react";
import { appLocale } from "./app-locale";
import { EXISTING_TEAM_READONLY_TEXT } from "./existing-team-readonly.i18n";

/**
 * The desktop is connected to an existing team's VPS only to read it. While
 * this is on, the position pages show that team's data and nothing else: the
 * server stand-ins read no cloud row (web-shims/server/supabase-server.ts), the
 * api bridge answers no write (shell/api-bridge.ts), and every control that
 * would write is disabled with the reason below.
 *
 * It is a module store, not React state, because the pages read their data in
 * effects that run before any parent effect could switch it on: whoever
 * connects turns it on before the Shell mounts, and turns it off when the
 * person leaves the read-only view, signs out or changes account.
 */
export type ReadNotice = "sort_last_action";

export interface ExistingTeamReadOnly {
  /** The team's assistant session is running (the read-only probe said so). */
  assistantActive: boolean;
}

let current: ExistingTeamReadOnly | null = null;
/** Why the last read of the team's positions failed; null when it worked. */
let readFailure: string | null = null;
/** What the last page of the list could not do as asked; null when it did all. */
let readNotice: ReadNotice | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function enterExistingTeamReadOnly(assistantActive: boolean): void {
  if (current?.assistantActive === assistantActive) return;
  current = { assistantActive };
  readFailure = null;
  readNotice = null;
  emit();
}

export function leaveExistingTeamReadOnly(): void {
  if (!current) return;
  current = null;
  readFailure = null;
  readNotice = null;
  emit();
}

export function existingTeamReadOnly(): ExistingTeamReadOnly | null {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The pages show an empty list for a list that could not be read, as the web
 * does for a query that fails; this is how the person is told it was not empty.
 */
export function reportPositionsRead(failure: string | null): void {
  if (readFailure === failure) return;
  readFailure = failure;
  if (current) emit();
}

export function reportPositionsNotice(notice: ReadNotice | null): void {
  if (readNotice === notice) return;
  readNotice = notice;
  if (current) emit();
}

export function useExistingTeamReadNotice(): ReadNotice | null {
  return useSyncExternalStore(subscribe, () => readNotice, () => readNotice);
}

export function useExistingTeamReadFailure(): string | null {
  return useSyncExternalStore(subscribe, () => readFailure, () => readFailure);
}

export function useExistingTeamReadOnly(): ExistingTeamReadOnly | null {
  return useSyncExternalStore(subscribe, existingTeamReadOnly, existingTeamReadOnly);
}

/** The sentence on every disabled control: honest about why nothing writes. */
export function existingTeamReadOnlyReason(state: ExistingTeamReadOnly): string {
  const text = EXISTING_TEAM_READONLY_TEXT[appLocale()];
  return state.assistantActive ? text.connectionReadOnly : text.assistantOff;
}
