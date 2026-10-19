import { useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * The state of the desktop's link to an existing team's VPS, for the header.
 *
 * Every read the pages already make reports here (a working read is a
 * contact), so nothing probes while the pages read. The core says how a read
 * failed (vps_link.rs): the network is retried here with a bounded backoff,
 * reads only; the team answering with an error, a team that is not the pinned
 * one and a changed SSH key are never retried by themselves. Actions that
 * change the team run only on a recent contact.
 */
export type LinkKind = "network" | "application" | "version" | "blocked";
export type LinkStatus = "idle" | "connected" | "reconnecting" | LinkKind;

export interface LinkState {
  status: LinkStatus;
  /** The catalog code of the last failure; null while connected or idle. */
  code: string | null;
  /** The last working read or probe (ms), null before the first one. */
  lastContact: number | null;
  /** When the next automatic retry runs (ms), only while reconnecting. */
  nextAt: number | null;
}

export type LinkReport = { ok: true } | { ok: false; kind: LinkKind; code: string };

/** The retries after a network failure: 5 tries in about 8 minutes, ±20%, then «Riprova». */
export const RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;
/** With no working read for this long, one light read checks the link (window visible only). */
export const HEARTBEAT_MS = 60_000;
/** An action that changes the team runs only on a contact this recent. */
export const ACTION_FRESH_MS = 120_000;

const KINDS: readonly string[] = ["network", "application", "version", "blocked"];
const SAFE_CODE = /^[a-z][a-z0-9_]{0,79}$/;
const IDLE: LinkState = { status: "idle", code: null, lastContact: null, nextAt: null };

/** The wait before retry number `attempt` (0-based), null once the tries are over. */
export function retryDelay(attempt: number, random: () => number = Math.random): number | null {
  const base = RETRY_DELAYS_MS[attempt];
  return base === undefined ? null : Math.round(base * (0.8 + 0.4 * random()));
}

/** A native read's reply as a report: a reply without a known kind is the application's. */
export function linkReport(reply: unknown): LinkReport {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) {
    return { ok: false, kind: "application", code: "desktop_bad_reply" };
  }
  const record = reply as Record<string, unknown>;
  if (record.ok === true) return { ok: true };
  if (record.ok !== false) return { ok: false, kind: "application", code: "desktop_bad_reply" };
  const code = typeof record.error === "string" && SAFE_CODE.test(record.error) ? record.error : "positions_unavailable";
  const kind = typeof record.kind === "string" && KINDS.includes(record.kind) ? record.kind as LinkKind : "application";
  return { ok: false, kind, code };
}

export function linkAllowsActions(state: LinkState, now: number): boolean {
  return state.status === "connected" && state.lastContact !== null && now - state.lastContact < ACTION_FRESH_MS;
}

export interface VpsLinkDeps {
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  visible(): boolean;
  /** One light read of the team (the core's `stats`). */
  probe(): Promise<LinkReport>;
  random(): number;
}

export function createVpsLink(deps: VpsLinkDeps) {
  let state = IDLE;
  let active = false;
  let timer: unknown = null;
  let probing = false;
  let dueWhileHidden = false;
  /** Retries already made in the current network series. */
  let tries = 0;
  const listeners = new Set<() => void>();

  const set = (next: LinkState) => { state = next; listeners.forEach((listener) => listener()); };
  const clear = () => { if (timer !== null) deps.clearTimer(timer); timer = null; };
  const schedule = (ms: number) => { clear(); timer = deps.setTimer(tick, ms); };

  function tick() {
    timer = null;
    if (!active) return;
    if (!deps.visible()) { dueWhileHidden = true; return; }
    void probe();
  }

  async function probe() {
    if (probing || !active) return;
    probing = true;
    let report: LinkReport;
    try {
      report = await deps.probe();
    } catch {
      report = { ok: false, kind: "application", code: "desktop_transport_unavailable" };
    }
    probing = false;
    apply(report, true);
  }

  function apply(report: LinkReport, fromProbe: boolean) {
    if (!active) return;
    if (report.ok) {
      tries = 0;
      set({ status: "connected", code: null, lastContact: deps.now(), nextAt: null });
      schedule(HEARTBEAT_MS);
      return;
    }
    if (report.kind === "network") {
      // A page failing while a retry is already planned changes nothing: one series, one timer.
      if (state.status === "reconnecting" && !fromProbe) return;
      if (state.status !== "reconnecting") tries = 0;
      const delay = retryDelay(tries, deps.random);
      if (delay === null) {
        clear();
        set({ status: "network", code: report.code, lastContact: state.lastContact, nextAt: null });
        return;
      }
      tries += 1;
      set({ status: "reconnecting", code: report.code, lastContact: state.lastContact, nextAt: deps.now() + delay });
      schedule(delay);
      return;
    }
    clear();
    tries = 0;
    set({ status: report.kind, code: report.code, lastContact: state.lastContact, nextAt: null });
  }

  return {
    /** The read-only view opened; `contact` when it opened on a probe that just worked. */
    start(contact: boolean) {
      active = true;
      tries = 0;
      dueWhileHidden = false;
      clear();
      if (contact) apply({ ok: true }, false);
      else set(IDLE);
    },
    stop() {
      active = false;
      clear();
      dueWhileHidden = false;
      set(IDLE);
    },
    report(report: LinkReport) {
      apply(report, false);
    },
    /** «Riprova»: a new series, never on a changed SSH key (the person confirms it again instead). */
    retry() {
      if (!active || probing || state.status === "blocked") return;
      clear();
      tries = 0;
      set({ ...state, status: "reconnecting", nextAt: null });
      void probe();
    },
    visibilityChanged() {
      if (deps.visible() && dueWhileHidden && active) {
        dueWhileHidden = false;
        void probe();
      }
    },
    state: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type VpsLink = ReturnType<typeof createVpsLink>;

const STATS = { op: "stats" } as const;

const link = createVpsLink({
  now: () => Date.now(),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  visible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
  probe: async () => {
    if (!isTauri()) return { ok: true };
    return linkReport(await invoke<unknown>("existing_team_positions_read", { request: STATS }));
  },
  random: () => Math.random(),
});

let watchingVisibility = false;

export function startVpsLink(contact: boolean): void {
  if (!watchingVisibility && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => link.visibilityChanged());
    watchingVisibility = true;
  }
  link.start(contact);
}

export const stopVpsLink = () => link.stop();
export const retryVpsLink = () => link.retry();
/** What a native read of the team answered (a thrown call is passed as its error). */
export const reportVpsRead = (reply: unknown) => link.report(linkReport(reply));
export const vpsLinkState = () => link.state();

export function useVpsLink(): LinkState {
  return useSyncExternalStore(link.subscribe, link.state, link.state);
}

export interface VpsLinkIdentity {
  revision: string;
  digest: string;
}

/** The pinned revision and image digest of the team the desktop reads (local files, no SSH). */
export async function readVpsLinkIdentity(): Promise<VpsLinkIdentity | null> {
  if (!isTauri()) return null;
  try {
    const reply = await invoke<unknown>("existing_team_link_identity");
    if (!reply || typeof reply !== "object") return null;
    const { ok, revision, digest } = reply as Record<string, unknown>;
    return ok === true && typeof revision === "string" && /^[0-9a-f]{40}$/.test(revision) &&
      typeof digest === "string" && /^sha256:[0-9a-f]{64}$/.test(digest)
      ? { revision, digest }
      : null;
  } catch {
    return null;
  }
}
