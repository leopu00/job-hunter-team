import { stateText } from "../lib/onboarding-state.i18n";

/** The native codes that say the record of the local profile is not there (or not readable): trying again cannot change it. */
const PROFILE_GONE = new Set(["local_profile_not_found", "local_profile_invalid", "local_profile_unavailable"]);

export function profileIsGone(code: string | null | undefined): boolean {
  return code != null && PROFILE_GONE.has(code);
}

/**
 * The page that stands where the dashboard would be when the account's scope could not be opened. A profile whose
 * record is gone from this computer (the app's data were cleaned, restored from another copy, or belong to another
 * build) cannot be opened by trying again: the page says so and leads out (to the choice of profile, or to forgetting
 * this one). Any other cause keeps «Try again», and a local profile may still leave for the choice.
 */
export function AccountScopeError({
  code,
  onRetry,
  onChoose,
  onForget,
}: {
  code?: string | null;
  onRetry: () => void;
  /** a local profile leaves for the choice of profile; absent for an account */
  onChoose?: () => void;
  /** a local profile whose record is gone is dropped from the app's list */
  onForget?: () => void;
}) {
  const t = stateText();
  const gone = profileIsGone(code);
  return (
    <main role="alert">
      <p>{gone ? t.profileGoneError : t.accountScopeError}</p>
      {!gone && <button type="button" onClick={onRetry}>{t.retry}</button>}
      {onChoose && <button type="button" onClick={onChoose}>{t.chooseAnotherProfile}</button>}
      {gone && onForget && <button type="button" onClick={onForget}>{t.forgetThisProfile}</button>}
    </main>
  );
}
