import { invoke, isTauri } from "@tauri-apps/api/core";
import { parseProfileProgressReply, type ProfileProgressReading } from "./contract";

/** What a read of the team's profile came to: the reading, or why there is none (the team has no profile yet, or it cannot be read). */
export type ProfileProgressRead = { ok: true; reading: ProfileProgressReading } | { ok: false; code: string };

/**
 * Reads the profile of the team in view, read-only: the backend asks the team's own check which of the eight
 * fields are filled (it works in the read-only view too) and answers a closed shape. The email never comes.
 */
export async function readProfileProgress(): Promise<ProfileProgressRead> {
  if (!isTauri()) return { ok: false, code: "desktop_only" };
  try {
    const reply = await invoke<unknown>("profile_progress_read");
    const reading = parseProfileProgressReply(reply);
    if (reading) return { ok: true, reading };
    const error = (reply as { error?: unknown } | null)?.error;
    return { ok: false, code: typeof error === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(error) ? error : "profile_unreadable" };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { ok: false, code: typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : "profile_unreadable" };
  }
}
