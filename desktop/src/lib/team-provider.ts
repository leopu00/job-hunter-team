import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Whether the team of this computer is signed in with its provider, and taking that sign-in off, through the
 * native `team_provider` command (src-tauri/src/team_provider.rs). The page names no provider and no file: the
 * team's active provider is the one asked about, and the answer is closed to three names. A reply that is not
 * in the closed shape is an error, never a sign-in made up. Taking the sign-in off needs `confirmed: true`,
 * which only the person's click on the confirmation sends.
 */
export const PROVIDERS = ["claude", "codex", "kimi"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export interface ProviderSignIn {
  provider: ProviderName;
  authenticated: boolean;
}

export type ProviderOutcome = { ok: true; value: ProviderSignIn } | { ok: false; code: string };

const CODE = /^[a-z][a-z0-9_]{0,63}$/;

function closed(reply: unknown): ProviderOutcome {
  if (typeof reply !== "object" || reply === null) return { ok: false, code: "team_provider_unavailable" };
  const { ok, provider, authenticated, error } = reply as Record<string, unknown>;
  if (ok === true) {
    if (typeof provider !== "string" || !(PROVIDERS as readonly string[]).includes(provider) || typeof authenticated !== "boolean") {
      return { ok: false, code: "team_provider_unavailable" };
    }
    return { ok: true, value: { provider: provider as ProviderName, authenticated } };
  }
  return { ok: false, code: typeof error === "string" && CODE.test(error) ? error : "team_provider_unavailable" };
}

async function ask(request: { op: "status" } | { op: "logout"; confirmed: true }): Promise<ProviderOutcome> {
  if (!isTauri()) return { ok: false, code: "desktop_only" };
  try {
    return closed(await invoke<unknown>("team_provider", { request }));
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { ok: false, code: typeof code === "string" && CODE.test(code) ? code : "team_provider_unavailable" };
  }
}

/** Whether the team's active provider has its sign-in on this computer. */
export const readProviderSignIn = (): Promise<ProviderOutcome> => ask({ op: "status" });

/** Takes the sign-in off. Call it only after the person confirmed. */
export const signOutProvider = (): Promise<ProviderOutcome> => ask({ op: "logout", confirmed: true });
