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
  /** Sessions the stop is waiting for in the container (the Assistente, which `team stop --all` leaves up, is not one). */
  active: number;
  /** Their names, to tell the person who is still on. */
  remaining: string[];
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

/** Whether the team's machine is on, asked during the setup only; «none» when not asked or there is no machine (Linux, a VPS). */
export type ExitMachine = "on" | "off" | "unknown" | "none";
const MACHINES: readonly ExitMachine[] = ["on", "off", "unknown", "none"];

/** What the native side tells before the question: where the team is, and how many containers that are not the team's share its machine. */
export interface ExitState {
  team: ExitTeam;
  otherContainers: number;
  machine: ExitMachine;
  /** The team's own containers running on the machine, during the setup with the machine on. */
  teamContainers: number;
}

const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0);

export function parseExitState(value: unknown): ExitState | null {
  const team = parseExitTeam(value);
  if (!team) return null;
  const { otherContainers, machine, teamContainers } = value as { otherContainers?: unknown; machine?: unknown; teamContainers?: unknown };
  return {
    team,
    otherContainers: count(otherContainers),
    machine: MACHINES.find((known) => known === machine) ?? "none",
    teamContainers: count(teamContainers),
  };
}

export function parseExitProgress(value: unknown): ExitProgress | null {
  if (!value || typeof value !== "object") return null;
  const { ready, active, remaining } = value as { ready?: unknown; active?: unknown; remaining?: unknown };
  if (typeof ready !== "boolean" || typeof active !== "number" || !Number.isSafeInteger(active) || active < 0) return null;
  const names = Array.isArray(remaining) ? remaining.filter((name): name is string => typeof name === "string" && name !== "") : [];
  return { ready, active, remaining: names };
}

/** The native side's refusal: `{ code }`. Anything else is an unanswered call. */
export function exitErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code ? code : "agent_control_unanswered";
}

/**
 * Where the team is. Resolves to null when it cannot be told (no account yet, not the desktop): the window then just closes.
 * `setup`: a setup is under way, so it also asks whether the machine is on (a look of a few seconds at most).
 */
export async function exitState(setup = false): Promise<ExitState | null> {
  if (!isTauri()) return null;
  try {
    return parseExitState(await (setup ? invoke("app_exit_state", { setup: true }) : invoke("app_exit_state")));
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
  if (!progress) throw { code: "agent_control_unanswered" };
  return progress;
}
/**
 * Leaves. `ordered` and `forced` stop the container and the machine first; `machine` (during the setup, never remembered)
 * stops only the machine; a failure keeps the app open.
 */
export const exitFinish = (mode: ExitMode | "machine") => call<void>("app_exit_finish", { mode });

/** Listens for a request to leave from the close button or ⌘Q; returns the way to stop listening. */
export async function onExitRequested(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  return listen(EXIT_EVENT, handler);
}
