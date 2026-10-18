import { useSyncExternalStore } from "react";
import { appLocale } from "./app-locale";
import { EXISTING_TEAM_READONLY_TEXT } from "./existing-team-readonly.i18n";
import { startVpsLink, stopVpsLink } from "./vps-link";

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

/**
 * What the connection's own probe said about the two agent sessions, and when.
 * Only that probe reads them (the command behind a refresh does not), so the
 * pages show them as the connection's value with its time, never as a fresh read.
 */
export interface ConnectionProbe {
  at: number;
  captainRunning: boolean;
  assistantRunning: boolean;
  /**
   * Who took the probe: the connection (the default), or the check that follows an explicit
   * «Attiva assistente». The pages say which, so a value is never given a time it was not read at.
   */
  source?: "connection" | "assistant_start";
}

export interface ExistingTeamReadOnly {
  /** The team's assistant session is running (the read-only probe said so). */
  assistantActive: boolean;
  /** The connection's probe of the sessions; null when the caller gave none. */
  connection: ConnectionProbe | null;
}

let current: ExistingTeamReadOnly | null = null;
/** What the last page of the list could not do as asked; null when it did all. */
let readNotice: ReadNotice | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function enterExistingTeamReadOnly(assistantActive: boolean, connection: ConnectionProbe | null = null): void {
  if (current?.assistantActive === assistantActive && current.connection === connection) return;
  const opening = current === null;
  current = { assistantActive, connection };
  readNotice = null;
  // A connection probe that just worked is a contact; the header starts from it.
  if (opening || connection) startVpsLink(connection !== null);
  emit();
}

export function leaveExistingTeamReadOnly(): void {
  if (!current) return;
  current = null;
  readNotice = null;
  stopVpsLink();
  emit();
}

export function existingTeamReadOnly(): ExistingTeamReadOnly | null {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportPositionsNotice(notice: ReadNotice | null): void {
  if (readNotice === notice) return;
  readNotice = notice;
  if (current) emit();
}

export function useExistingTeamReadNotice(): ReadNotice | null {
  return useSyncExternalStore(subscribe, () => readNotice, () => readNotice);
}

export function useExistingTeamReadOnly(): ExistingTeamReadOnly | null {
  return useSyncExternalStore(subscribe, existingTeamReadOnly, existingTeamReadOnly);
}

/** The sentence on every disabled control: honest about why nothing writes. */
export function existingTeamReadOnlyReason(state: ExistingTeamReadOnly): string {
  const text = EXISTING_TEAM_READONLY_TEXT[appLocale()];
  return state.assistantActive ? text.connectionReadOnly : text.assistantOff;
}
