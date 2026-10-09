import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/i18n/config";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { MAIL_TEXT } from "../pages/mail/mail.i18n";
import { MAIL_SAVED_EVENT, mailStatus, type MailStatus } from "../lib/mail";
import { navigate, useLocation, useRefresh } from "./router";

/**
 * The fixed warning while the mailbox password must be rotated: it was
 * readable by the agents. Sending keeps working; the warning stays until a
 * new password is saved on the Mail page. With no data (no broker, an old
 * broker, a broker that is down) there is no warning.
 */
export function MailRotationBanner({ loadStatus = mailStatus, locale: localeOverride }: { loadStatus?: () => Promise<MailStatus>; locale?: Locale }) {
  const locale = localeOverride ?? appLocale();
  const [pending, setPending] = useState(false);
  const { path } = useLocation();

  const read = useCallback(() => {
    loadStatus()
      .then((status) => setPending(status.rotationPending))
      .catch(() => setPending(false));
  }, [loadStatus]);

  useEffect(() => {
    read();
    window.addEventListener("focus", read);
    window.addEventListener(MAIL_SAVED_EVENT, read);
    return () => {
      window.removeEventListener("focus", read);
      window.removeEventListener(MAIL_SAVED_EVENT, read);
    };
  }, [read]);
  useRefresh(read);

  if (!pending) return null;
  const copy = describeError("mail_rotation_pending", { locale });
  return (
    <div
      role="alert"
      data-testid="mail-rotation-banner"
      className="px-4 py-2 text-[12px] flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)]"
      style={{ background: "var(--color-panel)", color: "var(--color-white)" }}
    >
      <strong>{copy.text}</strong>
      <span className="text-[var(--color-muted)]">{copy.action}</span>
      {path !== "/mail" && (
        <button
          type="button"
          className="ml-auto px-3 py-1 rounded border border-[var(--color-border)] text-[11px] font-semibold"
          onClick={() => navigate("/mail")}
        >
          {MAIL_TEXT[locale].openMail}
        </button>
      )}
    </div>
  );
}
