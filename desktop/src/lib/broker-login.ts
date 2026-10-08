import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * The interactive view of the broker's screen, for the LinkedIn login
 * (src-tauri/src/broker_view.rs). The login happens only in the broker's own
 * browser; the app shows that screen and passes keyboard and mouse to it.
 */
export interface BrokerLoginStatus {
  view: "idle" | "waiting" | "connected";
  linkedin: "logged_in" | "login_required";
  lastReason: "logged_in" | "token_expired" | "login_timeout" | "stopped" | null;
}

/** The connection for the view window, with its one-time token. */
export interface BrokerViewSession {
  url: string;
}

/** Starts a login session in the broker and opens its window (or focuses it). */
export async function openBrokerLoginView(): Promise<void> {
  if (!isTauri()) throw { code: "desktop_only" };
  await invoke("broker_login_view_open");
}

/**
 * Asked once by the view window: the token is single-use, a second request
 * answers `token_expired`.
 */
export async function brokerLoginViewSession(): Promise<BrokerViewSession> {
  return invoke<BrokerViewSession>("broker_login_view_session");
}

/** Ends the session in the broker, the SSH tunnel and the window. */
export async function closeBrokerLoginView(): Promise<void> {
  await invoke("broker_login_view_close");
}

export async function brokerLoginStatus(): Promise<BrokerLoginStatus> {
  if (!isTauri()) throw { code: "desktop_only" };
  return invoke<BrokerLoginStatus>("broker_login_status");
}
