import { useCallback, useEffect, useState } from "react";
import { brokerLoginStatus, openBrokerLoginView, type BrokerLoginStatus } from "../../lib/broker-login";
import { describeError, errorCodeOf } from "../../lib/error-catalog";

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
      const described = describeError(errorCodeOf(failure), { fallback: "view_unavailable" });
      setError(`${described.text} ${described.action}`);
    } finally {
      setOpening(false);
    }
  }

  const loggedIn = status.state === "known" && status.status.linkedin === "logged_in";
  return (
    <section aria-label="Accesso a LinkedIn" className="max-w-6xl mx-auto px-5 mt-8">
      <h2 className="text-[13px] font-semibold">Accesso a LinkedIn per le candidature</h2>
      <p className="mt-1 text-[12px] text-[var(--color-muted)]">
        L’accesso si fa nel browser protetto del team, in una finestra a parte: gli agenti non vedono
        né la password né la sessione.
      </p>
      <p className="mt-2 text-[12px]">
        Stato:{" "}
        {status.state === "loading" && "verifica…"}
        {status.state === "unknown" && "non disponibile"}
        {status.state === "known" && (loggedIn ? "accesso fatto" : "accesso da fare")}
      </p>
      <button
        type="button"
        className="mt-3 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px]"
        onClick={() => void start()}
        disabled={opening}
      >
        {opening ? "Apro lo schermo di accesso…" : loggedIn ? "Accedi di nuovo a LinkedIn" : "Accedi a LinkedIn"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-[12px]" style={{ color: "var(--color-red)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
