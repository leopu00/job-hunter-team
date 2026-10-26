import { useEffect, useState } from "react";
import type { Locale } from "@/i18n/config";
import { appLocale } from "../lib/app-locale";
import { describeError, errorCodeOf } from "../lib/error-catalog";
import { downgradeExistingTeamToReadOnly } from "../lib/existing-team-readonly";
import { vpsLinkStatusBridge } from "../lib/vps-link-status";
import {
  clearWriteAccessNotice,
  reportWriteAccessRemovalFailed,
  useWriteAccessNotice,
  writeAccessBridge,
} from "../lib/write-access-restored";
import { WRITE_ACCESS_RESTORED_TEXT } from "./write-access-restored.i18n";

/**
 * The fixed row at every start where the full connection came back (lib/write-access-restored.ts): which team
 * it is on, what persists and for how long, and the way to take it away. It stays until the person switches to
 * read only; it is never a toast. After a refused removal it says that this run is read only and the saved
 * access may come back, with the catalog's sentence for the code.
 */
export function WriteAccessRestoredBanner({ locale: localeOverride }: { locale?: Locale }) {
  const notice = useWriteAccessNotice();
  const locale = localeOverride ?? appLocale();
  const [where, setWhere] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const restored = notice?.kind === "restored";

  useEffect(() => {
    if (!restored) return undefined;
    let live = true;
    // The user and the masked address of the saved VPS: already short on the native side, no SSH call.
    void vpsLinkStatusBridge
      .status()
      .then((status) => {
        if (live) setWhere(`${status.user} · ${status.addressMasked}`);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [restored]);

  if (!notice) return null;
  const t = WRITE_ACCESS_RESTORED_TEXT[locale];

  async function switchToReadOnly() {
    setBusy(true);
    try {
      await writeAccessBridge.off();
      downgradeExistingTeamToReadOnly();
      clearWriteAccessNotice();
    } catch (error) {
      // The native side revoked the permission in memory before it tried the file: this run is read only
      // whatever happened, so the view says so too, and the row stays to say what is left.
      downgradeExistingTeamToReadOnly();
      reportWriteAccessRemovalFailed(errorCodeOf(error) ?? "existing_team_full_link_not_removed");
    } finally {
      setBusy(false);
    }
  }

  if (notice.kind === "removal_failed") {
    const failure = describeError(notice.code, { locale });
    return (
      <div
        role="alert"
        data-testid="write-access-removal-failed"
        className="px-4 py-2 text-[12px] flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)]"
        style={{ background: "var(--color-panel)", color: "var(--color-red)" }}
      >
        <strong>{t.removalFailed}</strong>
        <span>{failure.text} {failure.action}</span>
        <button
          type="button"
          onClick={() => clearWriteAccessNotice()}
          className="ml-auto underline text-[var(--color-bright)]"
        >
          OK
        </button>
      </div>
    );
  }
  return (
    <div
      role="status"
      data-testid="write-access-restored"
      className="px-4 py-2 text-[12px] flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)]"
      style={{ background: "var(--color-panel)", color: "var(--color-white)" }}
    >
      <strong>{t.title.replace("{where}", where ?? t.fallbackWhere)}</strong>
      <span className="text-[var(--color-muted)]">{t.note}</span>
      <button
        type="button"
        data-testid="write-access-switch"
        disabled={busy}
        onClick={() => void switchToReadOnly()}
        className="ml-auto rounded border border-[var(--color-border)] px-2 py-0.5 hover:border-[var(--color-border-glow)] disabled:opacity-60"
      >
        {busy ? t.switching : t.switchToReadOnly}
      </button>
    </div>
  );
}
