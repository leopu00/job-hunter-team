import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * The program that drives the team's agents (Codex or Pi) and the state of its login, through the native
 * `harness_choice_read` / `harness_choice_set` commands (src-tauri/src/harness_choice.rs). The page names no
 * file and no command line: the choice is one of two names, and a reply outside the closed shape is an error,
 * never a choice made up.
 */
export const HARNESSES = ["codex", "pi"] as const;
export type HarnessName = (typeof HARNESSES)[number];
export const HARNESS_LOGINS = ["signed_in", "signed_out", "not_needed", "unknown"] as const;
export type HarnessLogin = (typeof HARNESS_LOGINS)[number];

export interface HarnessChoice {
  harness: HarnessName;
  /** The team's active provider (lowercase letters), empty when it cannot be told. */
  provider: string;
  /** Whether Pi may be chosen with this provider and this kind of access. */
  piAllowed: boolean;
  login: HarnessLogin;
}

export type HarnessOutcome = { ok: true; value: HarnessChoice } | { ok: false; code: string };

const CODE = /^[a-z][a-z0-9_]{0,63}$/;

export function parseHarnessChoice(value: unknown): HarnessChoice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const { harness, provider, piAllowed, login } = r;
  if (typeof harness !== "string" || !(HARNESSES as readonly string[]).includes(harness)) return null;
  if (typeof provider !== "string" || !/^[a-z]{0,16}$/.test(provider)) return null;
  if (typeof piAllowed !== "boolean") return null;
  if (typeof login !== "string" || !(HARNESS_LOGINS as readonly string[]).includes(login)) return null;
  return { harness: harness as HarnessName, provider, piAllowed, login: login as HarnessLogin };
}

async function ask(command: string, args: Record<string, unknown>): Promise<HarnessOutcome> {
  if (!isTauri()) return { ok: false, code: "desktop_only" };
  try {
    const value = parseHarnessChoice(await invoke<unknown>(command, args));
    return value ? { ok: true, value } : { ok: false, code: "harness_unavailable" };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { ok: false, code: typeof code === "string" && CODE.test(code) ? code : "harness_unavailable" };
  }
}

/** Which program drives the agents now, and whether its login is there. */
export const readHarnessChoice = (): Promise<HarnessOutcome> => ask("harness_choice_read", {});

/** Chooses the program. The team must be restarted to start on it: the page says so. */
export const setHarnessChoice = (harness: HarnessName): Promise<HarnessOutcome> => ask("harness_choice_set", { harness });
