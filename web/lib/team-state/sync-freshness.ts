export interface SyncFreshnessState {
  sync_requested_at?: string | null;
  sync_completed_at?: string | null;
  last_action?: string | null;
  last_action_at?: string | null;
}

const TERMINAL_SYNC_ACTIONS = new Set([
  "sync:completed",
  "sync:timeout",
  "sync:push_failed",
  "sync:ack_failed",
]);

/** Un push periodico non puo' avanzare la freshness durante un Sync now. */
export function syncRequestIsPending(state: SyncFreshnessState | null): boolean {
  const requestedMs = Date.parse(state?.sync_requested_at ?? "");
  if (!Number.isFinite(requestedMs)) return false;
  const completedMs = Date.parse(state?.sync_completed_at ?? "");
  if (Number.isFinite(completedMs) && completedMs >= requestedMs) return false;

  const actionMs = Date.parse(state?.last_action_at ?? "");
  const terminalForRequest =
    TERMINAL_SYNC_ACTIONS.has(String(state?.last_action ?? "")) &&
    Number.isFinite(actionMs) &&
    actionMs > requestedMs;
  return !terminalForRequest;
}
