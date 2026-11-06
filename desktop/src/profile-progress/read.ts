import { invoke, isTauri } from "@tauri-apps/api/core";
import { reconnectDirectChat } from "../lib/direct-chat";
import { parseProfileProgressReply, type ProfileProgressReading } from "./contract";

/** What a read of the team's profile came to: the reading, or why there is none (the team has no profile yet, or it cannot be read). */
export type ProfileProgressRead = { ok: true; reading: ProfileProgressReading } | { ok: false; code: string };

/**
 * Reads the profile of the team in view, read-only: the backend asks the team's own check which of the eight
 * fields are filled (it works in the read-only view too) and answers a closed shape. The email never comes.
 */
export async function readProfileProgress(reconnect: () => Promise<unknown> = reconnectDirectChat): Promise<ProfileProgressRead> {
  if (!isTauri()) return { ok: false, code: "desktop_only" };
  const first = await readOnce();
  if (first.ok || first.code !== "disconnected") return first;
  // The chat is not connected (the page was opened before the team was, or the team was restarted under it): it is connected
  // again once and the read repeated; the person is told the reason only if that does not help.
  try {
    await reconnect();
  } catch {
    return first;
  }
  return readOnce();
}

const PLAIN_CODE = /^[a-z][a-z0-9_]{0,63}$/;

async function readOnce(): Promise<ProfileProgressRead> {
  try {
    const reply = await invoke<unknown>("profile_progress_read");
    const reading = parseProfileProgressReply(reply);
    if (reading) return { ok: true, reading };
    const failed = reply !== null && typeof reply === "object" && (reply as { ok?: unknown }).ok === false;
    // a failure the backend named, in plain words; an answer off the closed shape is not «there is no profile yet»
    if (!failed) return { ok: false, code: "profile_reply_unexpected" };
    const error = (reply as { error?: unknown }).error;
    return { ok: false, code: typeof error === "string" && PLAIN_CODE.test(error) ? error : "profile_unreadable" };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { ok: false, code: typeof code === "string" && PLAIN_CODE.test(code) && code !== "read_failed" ? code : "profile_unreadable" };
  }
}
