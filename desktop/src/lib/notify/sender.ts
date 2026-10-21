import { isTauri } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { SystemNotification } from "./fresh";

/** Set once the app has asked the system for the permission: a refusal is not asked again. */
export const NOTIFY_ASKED_KEY = "jht.desktop.notify.asked";

export type NotifyDeps = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<string>;
  sendNotification: (n: { title: string; body: string }) => void;
};

const PLUGIN: NotifyDeps = { isPermissionGranted, requestPermission, sendNotification };

function asked(): boolean {
  try {
    return localStorage.getItem(NOTIFY_ASKED_KEY) === "1";
  } catch {
    return true;
  }
}

function markAsked(): void {
  try {
    localStorage.setItem(NOTIFY_ASKED_KEY, "1");
  } catch {
    // a storage that refuses: the next time asks again, which is better than never asking
  }
}

/**
 * Shows the notifications. The system's permission is asked by the app, once, the first time there
 * is something to show; refused (now or before), nothing is shown and nothing is asked again.
 * Nothing is logged: a notification's text is the position's title and company.
 */
export async function deliver(notes: SystemNotification[], deps: NotifyDeps = PLUGIN): Promise<"none" | "sent" | "denied"> {
  if (notes.length === 0) return "none";
  if (deps === PLUGIN && !isTauri()) return "none";
  try {
    let granted = await deps.isPermissionGranted();
    if (!granted) {
      if (asked()) return "denied";
      markAsked();
      granted = (await deps.requestPermission()) === "granted";
    }
    if (!granted) return "denied";
    for (const n of notes) deps.sendNotification({ title: n.title, body: n.body });
    return "sent";
  } catch {
    return "denied";
  }
}
