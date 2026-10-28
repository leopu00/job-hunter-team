import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** The three ways out, as the native side knows them. */
export type ExitMode = "ordered" | "forced" | "detach";
export const EXIT_MODES: readonly ExitMode[] = ["ordered", "forced", "detach"];

/** Where the team is, as far as leaving goes: only «local» is offered the three ways. */
export type ExitTeam = "local" | "vps" | "none";

export interface ExitProgress {
  /** The Capitano wrote its flag: every agent has noted where it was and stopped. */
  ready: boolean;
  /** Sessions still open in the container. */
  active: number;
}

/** The event the native side sends when the window's close button or ⌘Q asks to leave. */
export const EXIT_EVENT = "app-exit-requested";
/** The navbar button asks the same question the close button does, from inside the page. */
export const EXIT_OPEN_EVENT = "jht:app-exit-open";

const CHOICE_KEY = "jht.app-exit.choice";

/** The way the person asked to remember, or null. Storage can be missing or blocked: no choice then. */
export function rememberedExit(): ExitMode | null {
  try {
    const value = localStorage.getItem(CHOICE_KEY);
    return EXIT_MODES.find((mode) => mode === value) ?? null;
  } catch {
    return null;
  }
}

export function rememberExit(mode: ExitMode | null): void {
  try {
    if (mode) localStorage.setItem(CHOICE_KEY, mode);
    else localStorage.removeItem(CHOICE_KEY);
  } catch {
    /* the choice is asked again next time */
  }
}

const TEAMS: readonly ExitTeam[] = ["local", "vps", "none"];

export function parseExitTeam(value: unknown): ExitTeam | null {
  if (!value || typeof value !== "object") return null;
  const team = (value as { team?: unknown }).team;
  return TEAMS.find((known) => known === team) ?? null;
}

export function parseExitProgress(value: unknown): ExitProgress | null {
  if (!value || typeof value !== "object") return null;
  const { ready, active } = value as { ready?: unknown; active?: unknown };
  if (typeof ready !== "boolean" || typeof active !== "number" || !Number.isSafeInteger(active) || active < 0) return null;
  return { ready, active };
}

/** The native side's refusal: `{ code }`. Anything else is an unanswered call. */
export function exitErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code ? code : "app_exit_unanswered";
}

/** Where the team is. Resolves to null when it cannot be told (no account yet, not the desktop): the window then just closes. */
export async function exitTeam(): Promise<ExitTeam | null> {
  if (!isTauri()) return null;
  try {
    return parseExitTeam(await invoke("app_exit_state"));
  } catch {
    return null;
  }
}

/** Calls the native side; rejects with `{ code }`. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw { code: "desktop_only" };
  try {
    return (await invoke(command, args)) as T;
  } catch (error) {
    throw { code: exitErrorCode(error) };
  }
}

/** The page is showing the question (or applying the remembered choice): a second close only asks again. */
export const exitAcknowledge = () => call<void>("app_exit_ack");
/** The person stayed. */
export const exitCancel = () => call<void>("app_exit_cancel");
/** «In order», first half: the order goes to the Capitano. */
export const exitOrder = () => call<void>("app_exit_order");
export async function exitPoll(): Promise<ExitProgress> {
  const progress = parseExitProgress(await call<unknown>("app_exit_poll"));
  if (!progress) throw { code: "app_exit_unanswered" };
  return progress;
}
/** Leaves. `ordered` and `forced` stop the container and the machine first; a failure keeps the app open. */
export const exitFinish = (mode: ExitMode) => call<void>("app_exit_finish", { mode });

/** Listens for a request to leave from the close button or ⌘Q; returns the way to stop listening. */
export async function onExitRequested(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  return listen(EXIT_EVENT, handler);
}
