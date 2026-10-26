import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

/**
 * The full connection that came back at start-up. The person confirmed «Connect with write access» in an
 * earlier run of the app; the native side kept a record of that (30 days at most, this very connection) and
 * gave the permission back only after the whole reopening of the saved team passed
 * (existing_team_runtime.rs, restore_full_link_at). The window says so, in a fixed row, at every start where
 * it happens: an absent «read only» banner would not be enough to tell a permission that is on.
 *
 * `restored`: the permission is on and the row offers «Switch to read only». `removal_failed`: the person
 * asked for read only, this run no longer writes (the native side revokes first), but the saved record could
 * not be taken away, so the next start may bring the permission back: the row says it, with its code.
 */
export type WriteAccessNotice = { kind: "restored" } | { kind: "removal_failed"; code: string };

let current: WriteAccessNotice | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function set(next: WriteAccessNotice | null) {
  current = next;
  emit();
}

export function announceRestoredWriteAccess(): void {
  set({ kind: "restored" });
}

export function reportWriteAccessRemovalFailed(code: string): void {
  set({ kind: "removal_failed", code });
}

export function clearWriteAccessNotice(): void {
  if (current !== null) set(null);
}

export function writeAccessNotice(): WriteAccessNotice | null {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWriteAccessNotice(): WriteAccessNotice | null {
  return useSyncExternalStore(subscribe, writeAccessNotice, writeAccessNotice);
}

export interface WriteAccessBridge {
  /**
   * Takes the permission to write away: in memory first, then the saved record. Refused with
   * `existing_team_full_link_not_removed` when the record could not be taken away (the memory is revoked
   * anyway). The saved team stays; only the permission goes.
   */
  off(): Promise<void>;
}

export const writeAccessBridge: WriteAccessBridge = {
  off() {
    return invoke<void>("existing_team_write_access_off");
  },
};
