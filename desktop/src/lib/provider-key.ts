import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * The API key of glm or kimi, given to the team through the native `provider_key_save` command (src-tauri/src/provider_key.rs),
 * which runs the setup of the CLI with the key on its standard input. This module only carries the key to that command: it keeps
 * no copy, writes it nowhere (no storage, no log) and answers one of two words or a code of the error catalog.
 */
export type ProviderKeyName = "glm" | "kimi";
export type ProviderKeyOutcome = { ok: true; state: "saved" | "refused" } | { ok: false; code: string };

const CODE = /^[a-z][a-z0-9_]{0,63}$/;

/** One line of 16 to 512 printable characters without spaces: the shape the setup asks for, said before anything is sent. */
export function keyShapeOk(key: string): boolean {
  return /^[!-~]{16,512}$/.test(key.trim());
}

export async function saveProviderKey(provider: ProviderKeyName, key: string): Promise<ProviderKeyOutcome> {
  if (!isTauri()) return { ok: false, code: "desktop_only" };
  try {
    const reply = await invoke<unknown>("provider_key_save", { request: { provider, key } });
    const state = (reply as { state?: unknown } | null)?.state;
    return state === "saved" || state === "refused" ? { ok: true, state } : { ok: false, code: "provider_key_failed" };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { ok: false, code: typeof code === "string" && CODE.test(code) ? code : "provider_key_failed" };
  }
}
