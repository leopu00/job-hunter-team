import { useEffect, useState } from "react";
import { appLocale } from "../app-locale";
import { existingTeamConnectionKey, useExistingTeamReadOnly } from "../existing-team-readonly";
import { readDesktopVpsNewestPositions } from "../existing-team-positions";
import { supabase } from "../supabase";
import { notificationsFor, type FoundPosition } from "./fresh";
import { NOTIFY_PREFS_EVENT, NOTIFY_PREFS_KEY, readNotifyPrefs } from "./prefs";
import { deliver } from "./sender";
import { watchCloudPositions, watchVpsPositions } from "./watch";

/**
 * The system notifications for a new position, for the whole session (mounted next to the Shell):
 * over an existing team's VPS while its read-only view is open, from the cloud otherwise. Nothing
 * runs, and nothing is read, while the switch is off (lib/notify/prefs.ts).
 */
export function NewPositionNotifier() {
  const [enabled, setEnabled] = useState(() => readNotifyPrefs().enabled);
  useEffect(() => {
    const sync = () => setEnabled(readNotifyPrefs().enabled);
    const onStorage = (e: StorageEvent) => e.key === NOTIFY_PREFS_KEY && sync();
    window.addEventListener(NOTIFY_PREFS_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(NOTIFY_PREFS_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const readOnly = useExistingTeamReadOnly();
  // the view's opening and its connection: a new one starts a new watch, a closed one stops it
  const vpsKey = readOnly ? existingTeamConnectionKey() : null;

  useEffect(() => {
    if (!enabled) return;
    // the switch and the choice of details are read when there is something to say
    const onNew = (rows: FoundPosition[]) => void deliver(notificationsFor(rows, readNotifyPrefs(), appLocale()));
    if (readOnly) return vpsKey ? watchVpsPositions({ read: () => readDesktopVpsNewestPositions(), onNew }) : undefined;
    return watchCloudPositions({ client: supabase, onNew });
  }, [enabled, readOnly === null, vpsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
