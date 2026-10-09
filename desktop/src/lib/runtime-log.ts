import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * The local runtime's own log (src-tauri/src/runtime_log.rs): how each step
 * that prepares the team on this computer ended and what it printed, with
 * secrets taken out. The setup's error screen shows where it is and opens it.
 */
export async function runtimeLogPath(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const path = await invoke<unknown>("onboarding_runtime_log");
    return typeof path === "string" && path.trim() ? path : null;
  } catch {
    return null;
  }
}

/** Shows the log in the system's file manager; false when it did not. */
export async function openRuntimeLog(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return (await invoke<unknown>("onboarding_runtime_log_open")) === true;
  } catch {
    return false;
  }
}
