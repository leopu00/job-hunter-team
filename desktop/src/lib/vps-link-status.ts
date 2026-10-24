import { invoke } from "@tauri-apps/api/core";

/**
 * What the app knows about its connection to the team on a VPS, for Settings → «VPS connection».
 * Everything here is already masked or short on the native side: no whole address, no key path, no
 * secret. The command reads what is saved on this computer and makes no SSH call.
 */
export type VpsLinkState = "linked" | "unreachable" | "expired";

export interface VpsLinkStatus {
  /** `203.0.xxx.xxx` style: never the whole address. */
  addressMasked: string;
  user: string;
  /** The pinned SSH fingerprint, `SHA256:…`; null when none is pinned. */
  fingerprint: string | null;
  state: VpsLinkState;
  /** Seconds since the epoch of the last successful check; null when there has been none. */
  lastOkAt: number | null;
  /** The code of the last failure (the error catalog describes it); null when the last check was fine. */
  lastErrorCode: string | null;
  /** `read`: the read-only view; `full`: the team is connected in full. */
  mode: "read" | "full";
  /** The container, the image and the revision the team declared, in a short form. */
  container: string | null;
  image: string | null;
  revision: string | null;
  /** The direct chat to the team is ready. */
  chatReady: boolean;
}

export interface VpsLinkStatusBridge {
  /** Reads the saved connection's status. Refused (code) when nothing is saved. */
  status(): Promise<VpsLinkStatus>;
  /** Removes the saved connection (selection, candidate, connection config). Confirmed by the person first. */
  unlink(): Promise<void>;
}

export const vpsLinkStatusBridge: VpsLinkStatusBridge = {
  status() {
    return invoke<VpsLinkStatus>("existing_team_link_status");
  },
  unlink() {
    return invoke<void>("existing_team_unlink");
  },
};
