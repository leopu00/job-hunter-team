import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * The live screen of the CLOSER, turned on and off from the app through the native `screen_status` / `screen_set` commands
 * (src-tauri/src/screen_control.rs, `jht screen on|off|status --json`). The page names no command line: the state is one of five
 * words, and a reply outside that shape is an error, never a state made up. A change is answered with the state read AFTER it.
 * The window that shows the screen is opened by `openLiveScreen` (lib/live-screen.ts).
 */
export const SCREEN_STATES = ["not_installed", "downloading", "ready", "running", "error"] as const;
export type ScreenState = (typeof SCREEN_STATES)[number];

export type ScreenOutcome = { ok: true; state: ScreenState } | { ok: false; code: string };

const CODE = /^[a-z][a-z0-9_]{0,63}$/;

export function parseScreenState(value: unknown): ScreenState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = (value as { state?: unknown }).state;
  return typeof state === "string" && (SCREEN_STATES as readonly string[]).includes(state) ? (state as ScreenState) : null;
}

async function ask(command: string, args: Record<string, unknown>): Promise<ScreenOutcome> {
  if (!isTauri()) return { ok: false, code: "desktop_only" };
  try {
    const state = parseScreenState(await invoke<unknown>(command, args));
    return state ? { ok: true, state } : { ok: false, code: "screen_failed" };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { ok: false, code: typeof code === "string" && CODE.test(code) ? code : "screen_failed" };
  }
}

/** Whether the screen is on. */
export const readScreenState = (): Promise<ScreenOutcome> => ask("screen_status", {});

/** Turns the screen on (the first time it downloads the tools: minutes) or off, and answers the state read afterwards. */
export const setScreen = (on: boolean): Promise<ScreenOutcome> => ask("screen_set", { on });
