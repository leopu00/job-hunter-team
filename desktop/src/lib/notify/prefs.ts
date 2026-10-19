/**
 * The new-position notifications' switch, kept on this device (localStorage): the settings page
 * turns it on and off, the watchers read it. Off by default: a notification shows in the system's
 * notification centre, on the locked screen and in a shared screen. Turned on, it starts without
 * details ("New position found"); the title and the company show only when the person asks.
 */
export const NOTIFY_PREFS_KEY = "jht.desktop.notify.new-position";
/** Fired on window when the switch changes, so the watchers start or stop at once. */
export const NOTIFY_PREFS_EVENT = "jht:notify-prefs-changed";

export type NotifyPrefs = {
  /** notifications for a new position at all */
  enabled: boolean;
  /** the position's title and company in the notification; false = "New position found" only */
  details: boolean;
};

export const NOTIFY_OFF: NotifyPrefs = { enabled: false, details: false };

export function readNotifyPrefs(): NotifyPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTIFY_PREFS_KEY) ?? "null") as Partial<NotifyPrefs> | null;
    if (!raw || typeof raw !== "object" || raw.enabled !== true) return { ...NOTIFY_OFF };
    return { enabled: true, details: raw.details === true };
  } catch {
    return { ...NOTIFY_OFF };
  }
}

/** Writes the switch. Turning it on without saying otherwise starts without details. */
export function writeNotifyPrefs(next: { enabled: boolean; details?: boolean }): NotifyPrefs {
  const prefs: NotifyPrefs = next.enabled ? { enabled: true, details: next.details === true } : { ...NOTIFY_OFF };
  try {
    localStorage.setItem(NOTIFY_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // a storage that refuses: the switch stays as it was read
  }
  window.dispatchEvent(new Event(NOTIFY_PREFS_EVENT));
  return prefs;
}
