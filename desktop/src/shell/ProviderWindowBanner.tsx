import { useEffect, useState } from "react";
import type { Locale } from "@/i18n/config";
import { appLocale } from "../lib/app-locale";
import { windowNotice, windowNoticeText, type WindowNotice } from "../lib/provider-window";
import { readProviderWindow, type ProviderWindowResult } from "../lib/provider-window-native";

/** How often the team's reading is asked again; the bridge itself writes one every few minutes. */
export const WINDOW_POLL_MS = 60_000;

/**
 * A line at the top while the AI provider's work window is nearly or fully used: the team may stop, or has stopped and
 * resumes when the window renews. It reads what the team already records (nothing is measured here), asks once a minute,
 * and goes away by itself when the reading is old, missing, or the window has renewed. It does not ask the person for
 * anything.
 */
export function ProviderWindowBanner({
  read = readProviderWindow, locale: localeOverride, now = Date.now, pollMs = WINDOW_POLL_MS,
}: { read?: () => Promise<ProviderWindowResult>; locale?: Locale; now?: () => number; pollMs?: number }) {
  const locale = localeOverride ?? appLocale();
  const [notice, setNotice] = useState<WindowNotice | null>(null);

  useEffect(() => {
    let live = true;
    const ask = () => {
      read()
        .then((result) => { if (live) setNotice(windowNotice(result, now())); })
        .catch(() => { if (live) setNotice(null); });
    };
    ask();
    const timer = setInterval(ask, pollMs);
    return () => { live = false; clearInterval(timer); };
  }, [read, now, pollMs]);

  if (!notice) return null;
  return (
    <div
      role="status"
      data-testid="provider-window-banner"
      data-kind={notice.kind}
      className="px-4 py-2 text-[12px] border-b border-[var(--color-border)]"
      style={{ background: "var(--color-panel)", color: notice.kind === "done" ? "var(--color-yellow)" : "var(--color-white)" }}
    >
      <strong>{windowNoticeText(notice, locale)}</strong>
    </div>
  );
}
