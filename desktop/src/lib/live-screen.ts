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

/** Apre (o porta in primo piano) la finestra staccata dello schermo live. */
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
