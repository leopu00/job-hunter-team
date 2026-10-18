import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { appLocale } from "./app-locale";
import { runtimeText } from "./onboarding-runtime.i18n";

/**
 * «Remove JHT from this computer» (Windows): the native side runs
 * `jht.ps1 uninstall --confirm` after the person confirmed it in the app.
 * It removes the JHT Podman machine, the host runtime and the JHT commands;
 * ~/.jht, the documents, Podman and Compose stay.
 */
export type UninstallLeftover = "machine" | "runtime" | "commands";
export interface LocalUninstallOutcome {
  complete: boolean;
  left: UninstallLeftover[];
}

/** Sent once JHT is gone from this computer: the app goes back to its first start. */
export const LOCAL_RUNTIME_REMOVED_EVENT = "jht:local-runtime-removed";

const LEFTOVERS = new Set<UninstallLeftover>(["machine", "runtime", "commands"]);

export async function localUninstallAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<unknown>("onboarding_local_uninstall_available") === true;
  } catch {
    return false;
  }
}

/** Runs the removal; each phase reaches `onPhase` as a sentence of the app's language. */
export async function uninstallLocal(onPhase: (text: string) => void): Promise<LocalUninstallOutcome> {
  if (!isTauri()) throw { code: "desktop_only" };
  const channel = new Channel<unknown>();
  channel.onmessage = (phase) => {
    const key = phase && typeof phase === "object" ? (phase as { key?: unknown }).key : undefined;
    const text = typeof key === "string" ? runtimeText(key, appLocale()) : null;
    if (text) onPhase(text);
  };
  const value = await invoke<unknown>("onboarding_local_uninstall", { onPhase: channel });
  return parseOutcome(value);
}

export function parseOutcome(value: unknown): LocalUninstallOutcome {
  const row = value && typeof value === "object" ? value as { complete?: unknown; left?: unknown } : {};
  if (typeof row.complete !== "boolean" || !Array.isArray(row.left) ||
      !row.left.every((id) => LEFTOVERS.has(id as UninstallLeftover))) {
    throw { code: "uninstall_failed" };
  }
  const left = row.left as UninstallLeftover[];
  // A complete removal leaves nothing; one that is not complete names what it left.
  if (row.complete ? left.length > 0 : left.length === 0) throw { code: "uninstall_failed" };
  return { complete: row.complete, left };
}
