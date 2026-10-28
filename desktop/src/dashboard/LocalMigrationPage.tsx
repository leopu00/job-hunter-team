import "../onboarding/existing-team-connect.css";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import { stateText } from "../lib/onboarding-state.i18n";

/** What a native code may look like to be shown as it is (a code never holds a path, a name or a number of the person). */
const SHOWN_CODE = /^[a-z][a-z0-9_]{0,63}$/;

export interface LocalMigrationPageProps {
  phase: "required" | "migrating" | "error";
  /** The code the check or the link failed with (error phase), when it had one. */
  code?: string | null;
  retryable?: boolean;
  /** «Back to sign in» is on its way (true) or did not work (failed). */
  leaving: "idle" | "leaving" | "failed";
  onLink: () => void;
  onStayLocal: () => void;
  onRetry: () => void;
  onLeave: () => void;
}

/**
 * The page between «Continue with Google» and the dashboard when this computer holds a local profile:
 * the person links it to the account (the runtime's owner changes, with their word), stays local, or goes
 * back to the sign-in. A failure says what happened in the error catalog's own words and shows its code, and
 * never leaves the person without a way out.
 */
export function LocalMigrationPage({ phase, code, retryable, leaving, onLink, onStayLocal, onRetry, onLeave }: LocalMigrationPageProps) {
  const t = stateText();
  const locale = appLocale();
  const busy = phase === "migrating" || leaving === "leaving";
  const failed = phase === "error";
  const described = failed ? describeError(code, { locale }) : null;
  const shownCode = failed && code && SHOWN_CODE.test(code) ? code : null;
  return (
    <div className="existing-team-modal__backdrop">
      <main
        className="existing-team-modal"
        role={failed ? "alert" : undefined}
        aria-labelledby="local-migration-title"
        data-testid="local-migration"
      >
        <header className="existing-team-modal__header">
          <h2 id="local-migration-title">{failed ? t.migrationErrorTitle : t.migrationTitle}</h2>
          {described ? (
            <>
              <p>{described.text}</p>
              {described.action && <p>{described.action}</p>}
              {code !== "local_migration_recovery_required" && <p>{t.migrationStaysLocal}</p>}
              {shownCode && <p data-testid="local-migration-code">{t.errorCodeLabel}: <code>{shownCode}</code></p>}
            </>
          ) : (
            <p>{t.migrationText}</p>
          )}
          {leaving === "failed" && <p role="alert">{t.leaveFailed}</p>}
        </header>
        <div className="existing-team-modal__actions">
          {phase !== "error" && (
            <button type="button" className="existing-team-modal__primary" onClick={onLink} disabled={busy}>
              {phase === "migrating" ? t.linking : t.linkAndContinue}
            </button>
          )}
          {failed && retryable && (
            <button type="button" className="existing-team-modal__primary" onClick={onRetry} disabled={busy}>
              {t.retry}
            </button>
          )}
          <button type="button" className="existing-team-modal__secondary" onClick={onStayLocal} disabled={busy}>
            {t.cancelStayLocal}
          </button>
          <button type="button" className="existing-team-modal__secondary" onClick={onLeave} disabled={busy}>
            {leaving === "leaving" ? t.leavingToSignIn : t.backToSignIn}
          </button>
        </div>
      </main>
    </div>
  );
}
