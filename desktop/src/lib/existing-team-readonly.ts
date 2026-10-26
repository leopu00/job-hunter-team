import { useSyncExternalStore } from "react";
import { appLocale } from "./app-locale";
import { EXISTING_TEAM_READONLY_TEXT } from "./existing-team-readonly.i18n";
import { startVpsLink, stopVpsLink } from "./vps-link";
import { clearWriteAccessNotice } from "./write-access-restored";

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
  /**
   * The team was connected in full («Conferma e collega» in this run of the app): the pages read
   * its VPS as in the read-only view, and what writes (chat, judgements, the agents' panel) is
   * allowed; the native side still refuses what is not granted. Absent in the read-only view.
   */
  full?: boolean;
}

let current: ExistingTeamReadOnly | null = null;
/** A new one at every opening of the view, with the connection it opened on (lib/existing-team.ts). */
let session = 0;
let connectionIdentity = "";
/** What the last page of the list could not do as asked; null when it did all. */
let readNotice: ReadNotice | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function enterExistingTeamReadOnly(
  assistantActive: boolean,
  connection: ConnectionProbe | null = null,
  identity?: string,
  full?: boolean,
): void {
  // Another connection (account, VPS, team) is another opening, never the same view refreshed.
  let opening = false;
  if (current === null || (identity !== undefined && identity !== connectionIdentity)) {
    session += 1;
    connectionIdentity = identity ?? "";
    opening = true;
  } else if (
    current.assistantActive === assistantActive &&
    current.connection === connection &&
    (full === undefined || Boolean(current.full) === full)
  ) {
    return;
  }
  // A new probe of the same opening (the assistant's start) keeps the kind of link it came on.
  const isFull = full ?? (opening ? false : Boolean(current?.full));
  current = isFull ? { assistantActive, connection, full: true } : { assistantActive, connection };
  readNotice = null;
  // A connection probe that just worked is a contact; the header starts from it.
  if (opening || connection) startVpsLink(connection !== null);
  emit();
}

export function leaveExistingTeamReadOnly(): void {
  clearWriteAccessNotice();
  if (!current) return;
  current = null;
  connectionIdentity = "";
  readNotice = null;
  stopVpsLink();
  emit();
}

/**
 * The person took the permission to write away («Switch to read only»): the same opening, the same
 * connection and probe, no longer in full. Nothing else about the view changes.
 */
export function downgradeExistingTeamToReadOnly(): void {
  if (!current || !current.full) return;
  current = { assistantActive: current.assistantActive, connection: current.connection };
  readNotice = null;
  emit();
}

/**
 * The existing team the pages read the VPS of, in either kind of link (read-only or full): where a
 * page takes its DATA from. Null when the app is not on an existing team.
 */
export function existingTeamView(): ExistingTeamReadOnly | null {
  return current;
}

/**
 * The view in which nothing writes: null for a team connected in full, whose controls work. What
 * disables a control or refuses a write asks this; where the data comes from asks `existingTeamView`.
 */
export function existingTeamReadOnly(): ExistingTeamReadOnly | null {
  return current && !current.full ? current : null;
}

/**
 * The key of what the view may keep between reads: this opening of the view and
 * the connection it opened on. Null while the view is closed: nothing is kept.
 */
export function existingTeamConnectionKey(): string | null {
  return current ? `${session}|${connectionIdentity}` : null;
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

export function useExistingTeamView(): ExistingTeamReadOnly | null {
  return useSyncExternalStore(subscribe, existingTeamView, existingTeamView);
}

/** The sentence on every disabled control: honest about why nothing writes. */
export function existingTeamReadOnlyReason(state: ExistingTeamReadOnly): string {
  const text = EXISTING_TEAM_READONLY_TEXT[appLocale()];
  if (state.full) return text.fullLinkShowsOnly;
  return state.assistantActive ? text.connectionReadOnly : text.assistantOff;
}
