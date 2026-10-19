import { useCallback, useEffect, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { brokerLoginStatus, openBrokerLoginView, type BrokerLoginStatus } from "../../lib/broker-login";
import { describeError, errorCodeOf } from "../../lib/error-catalog";
import { PROFILE_PAGE_TEXT } from "./profile-page.i18n";

type Status = { state: "loading" } | { state: "known"; status: BrokerLoginStatus } | { state: "unknown" };

/**
 * The LinkedIn login for the applications. It happens in the broker's own
 * browser, shown here in a separate window with keyboard and mouse: the
 * agents never see the password or the session.
 */
export function LinkedinLoginCard({
  loadStatus = brokerLoginStatus,
  open = openBrokerLoginView,
}: {
  loadStatus?: () => Promise<BrokerLoginStatus>;
  open?: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(() => {
    loadStatus()
      .then((value) => setStatus({ state: "known", status: value }))
      .catch(() => setStatus({ state: "unknown" }));
  }, [loadStatus]);

  useEffect(() => {
    read();
    // Back from the login window: the status may have changed.
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [read]);

  async function start() {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      await open();
    } catch (failure) {
      const described = describeError(errorCodeOf(failure), { fallback: "view_unavailable", locale: appLocale() });
      setError(`${described.text} ${described.action}`);
    } finally {
      setOpening(false);
    }
  }

  const t = PROFILE_PAGE_TEXT[appLocale()];
  const loggedIn = status.state === "known" && status.status.linkedin === "logged_in";
  return (
    <section aria-label={t.linkedinAria} className="max-w-6xl mx-auto px-5 mt-8">
      <h2 className="text-[13px] font-semibold">{t.linkedinTitle}</h2>
      <p className="mt-1 text-[12px] text-[var(--color-muted)]">
        {t.linkedinIntro}
      </p>
      <p className="mt-2 text-[12px]">
        {t.statusLabel}{" "}
        {status.state === "loading" && t.statusLoading}
        {status.state === "unknown" && t.statusUnknown}
        {status.state === "known" && (loggedIn ? t.statusLoggedIn : t.statusLoggedOut)}
      </p>
      <button
        type="button"
        className="mt-3 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px]"
        onClick={() => void start()}
        disabled={opening}
      >
        {opening ? t.opening : loggedIn ? t.loginAgain : t.login}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-[12px]" style={{ color: "var(--color-red)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
