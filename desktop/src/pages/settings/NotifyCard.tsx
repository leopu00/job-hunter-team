import { useEffect, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { NOTIFY_TEXT } from "../../lib/notify/notify.i18n";
import { NOTIFY_PREFS_EVENT, NOTIFY_PREFS_KEY, readNotifyPrefs, writeNotifyPrefs, type NotifyPrefs } from "../../lib/notify/prefs";

/**
 * The switch of the new-position notifications (lib/notify), kept on this device. Off until the
 * person turns it on; the title and the company show only when they ask. The system's permission is
 * asked later, by the notifier, the first time there is something to show.
 */
export default function NotifyCard() {
  const t = NOTIFY_TEXT[appLocale()];
  const [prefs, setPrefs] = useState<NotifyPrefs>(readNotifyPrefs);
  useEffect(() => {
    const sync = () => setPrefs(readNotifyPrefs());
    const onStorage = (event: StorageEvent) => event.key === NOTIFY_PREFS_KEY && sync();
    window.addEventListener(NOTIFY_PREFS_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(NOTIFY_PREFS_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return (
    <section
      data-testid="settings-notify"
      aria-labelledby="settings-notify-title"
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex flex-col gap-3"
    >
      <h2 id="settings-notify-title" className="text-[13px] font-semibold text-[var(--color-bright)]">
        {t.switchTitle}
      </h2>
      <label className="flex items-center gap-2 text-[12px] text-[var(--color-bright)]">
        <input
          type="checkbox"
          data-testid="settings-notify-enabled"
          checked={prefs.enabled}
          onChange={(event) => setPrefs(writeNotifyPrefs({ enabled: event.target.checked, details: prefs.details }))}
        />
        {t.switchLabel}
      </label>
      {prefs.enabled && (
        <label className="flex items-center gap-2 text-[12px] text-[var(--color-bright)]">
          <input
            type="checkbox"
            data-testid="settings-notify-details"
            checked={prefs.details}
            onChange={(event) => setPrefs(writeNotifyPrefs({ enabled: true, details: event.target.checked }))}
          />
          {t.withDetails}
        </label>
      )}
      <p className="text-[11px] text-[var(--color-muted)]">{t.lockScreen}</p>
    </section>
  );
}
