import { invoke, isTauri } from "@tauri-apps/api/core";

/** Dati di connessione allo stream in sola visione dello schermo del CLOSER. */
export interface LiveScreenSession {
  url: string;
  password: string;
}

export interface LiveScreenError {
  code:
    | "screen_not_running"
    | "invalid_password"
    | "invalid_port"
    | "home_missing"
    | "window_failed";
}

/**
 * Apre (o porta in primo piano) la finestra staccata dello schermo live.
 * Oggi nessuna schermata la chiama. La vista interattiva del broker
 * (lib/broker-login.ts) usa la stessa finestra, aperta dal lato nativo con
 * `live_screen::open_window`.
 */
export async function openLiveScreen(): Promise<boolean> {
  if (!isTauri()) return false;
  await invoke("open_live_screen");
  return true;
}

/**
 * Riletta a ogni tentativo di connessione: un riavvio del container ruota la
 * password, e una copia tenuta in memoria resterebbe rifiutata per sempre.
 */
export async function liveScreenSession(): Promise<LiveScreenSession> {
  return invoke<LiveScreenSession>("live_screen_session");
}

export function isLiveScreenError(value: unknown): value is LiveScreenError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

/**
 * The error-catalog code for a live-screen failure. `invalid_port` here is
 * the screen's own port setting, not a VPS port, so it has its own entry;
 * anything unexpected is the generic "cannot connect to the screen".
 */
export function liveScreenErrorCode(error: unknown): string {
  if (!isLiveScreenError(error)) return "live_screen_failed";
  switch (error.code) {
    case "invalid_port":
      return "live_screen_invalid_port";
    case "invalid_password":
    case "home_missing":
    case "window_failed":
    case "screen_not_running":
      return error.code;
    default:
      return "live_screen_failed";
  }
}
