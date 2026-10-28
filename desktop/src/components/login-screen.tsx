import { useCallback, useEffect, useRef, useState } from "react";
import {
  listBrowsers,
  readBrowserChoice,
  saveBrowserChoice,
  type BrowserChoice,
  type InstalledBrowser,
} from "../lib/browsers";
import {
  cancelGoogleSignIn,
  LoginError,
  signInWithGoogle,
  supabaseConfigured,
  type LoginErrorCode,
  type SignInOptions,
} from "../lib/supabase";
import {
  createAndActivateLocalProfile,
  listLocalProfiles,
  readLocalProfile,
  readTeamOwnerCopy,
  selectLocalProfileById,
  type LocalProfile,
} from "../lib/local-profile";
import PublicPageLinks from "./PublicPageLinks";
import { describeError } from "../lib/error-catalog";
import { LOGIN_ERROR_CATALOG_CODE } from "../lib/login-error-codes";
import { DASHBOARD_PAGE, goTo } from "../lib/pages";
import { OnboardingArtwork } from "../onboarding/OnboardingArtwork";
import { appLocale } from "../lib/app-locale";
import { readDesktopTeamOwnerIdentity, type DesktopTeamOwnerIdentity } from "../lib/desktop-team-owner";
import { LOGIN_TEXT } from "./login-screen.i18n";
import { LOCAL_PROFILES_TEXT } from "./local-profiles.i18n";
import "./login-screen.css";

/** The sentence and the action for a login error, from the error catalog. */
function loginErrorCopy(code: LoginErrorCode, locale: string): { text: string; action: string } {
  return describeError(LOGIN_ERROR_CATALOG_CODE[code], { fallback: "login_failed", locale });
}

export interface LoginScreenProps {
  /** Sostituibili nei test; di norma il login vero. */
  signIn?: (options: SignInOptions) => Promise<void>;
  cancel?: () => Promise<void>;
  loadBrowsers?: () => Promise<InstalledBrowser[]>;
  configured?: boolean;
  /** every saved local profile, in the order they were made */
  listLocal?: () => LocalProfile[];
  /** the profile used last */
  readLocal?: () => LocalProfile | null;
  /** the profile the renderer believes owns the team of this computer (the backend's marker decides, inside the app) */
  ownerLocal?: () => LocalProfile | null;
  /** who the backend's owner marker names: it wins over `ownerLocal` once it answers */
  readOwner?: () => Promise<DesktopTeamOwnerIdentity | null>;
  /** adds a profile to the list: the saved ones stay */
  createLocal?: (displayName: string) => Promise<LocalProfile>;
  /** chooses a saved profile by its id */
  selectLocal?: (profileId: string) => LocalProfile;
  onLocalReady?: () => void;
  onChooseGoogle?: () => boolean | Promise<boolean>;
  onResetLocalPlayground?: () => Promise<void>;
  onRecoverLocalPlayground?: () => Promise<void>;
}

type CopyState = "idle" | "copied" | "failed";

/**
 * La schermata «Accedi con Google». Non decide cosa viene dopo: a login
 * riuscito cambia la sessione, e chi usa `useSession` passa alla dashboard.
 *
 * Si sceglie il browser in cui aprire Google (l'ultima scelta resta), oppure
 * nessuno: il link si copia e si incolla dove si vuole. Il ritorno arriva
 * all'app in ogni caso, dal listener su loopback.
 */
export function LoginScreen({
  signIn = signInWithGoogle,
  cancel = cancelGoogleSignIn,
  loadBrowsers = listBrowsers,
  configured = supabaseConfigured,
  listLocal = listLocalProfiles,
  readLocal = readLocalProfile,
  ownerLocal = readTeamOwnerCopy,
  readOwner = readDesktopTeamOwnerIdentity,
  createLocal = createAndActivateLocalProfile,
  selectLocal = selectLocalProfileById,
  onLocalReady = () => goTo(DASHBOARD_PAGE),
  onChooseGoogle,
  onResetLocalPlayground,
  onRecoverLocalPlayground,
}: LoginScreenProps) {
  const locale = appLocale();
  const t = LOGIN_TEXT[locale];
  const profilesText = LOCAL_PROFILES_TEXT[locale];
  const [browsers, setBrowsers] = useState<InstalledBrowser[]>([]);
  const [choice, setChoice] = useState<BrowserChoice>("default");
  const [waiting, setWaiting] = useState(false);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyState>("idle");
  const [localSetup, setLocalSetup] = useState(false);
  const [localName, setLocalName] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState(false);
  // the backend's owner: undefined until it answers (or when it cannot), null when no local profile owns the team
  const [nativeOwnerId, setNativeOwnerId] = useState<string | null | undefined>(undefined);
  const linkField = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<LoginError | null>(
    configured ? null : new LoginError("not-configured"),
  );

  useEffect(() => {
    let active = true;
    loadBrowsers()
      .catch(() => [] as InstalledBrowser[])
      .then((found) => {
        if (!active) return;
        setBrowsers(found);
        setChoice(readBrowserChoice(found));
      });
    return () => {
      active = false;
    };
  }, [loadBrowsers]);

  useEffect(() => {
    let active = true;
    readOwner().then(
      (identity) => { if (active) setNativeOwnerId(identity?.kind === "local" ? identity.profileId ?? null : null); },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [readOwner]);

  const start = useCallback(async () => {
    setError(null);
    setLocalError(false);
    setAuthorizeUrl(null);
    setCopy("idle");
    setWaiting(true);
    try {
      if (await onChooseGoogle?.()) return;
      saveBrowserChoice(choice);
      await signIn({ browser: choice, onAuthorizeUrl: setAuthorizeUrl });
    } catch (failure) {
      setError(failure instanceof LoginError ? failure : new LoginError("unknown"));
    } finally {
      setWaiting(false);
      setAuthorizeUrl(null);
    }
  }, [choice, onChooseGoogle, signIn]);

  const stop = useCallback(() => {
    cancel().catch(() => undefined);
  }, [cancel]);

  const copyLink = useCallback(async () => {
    if (!authorizeUrl) return;
    try {
      await navigator.clipboard.writeText(authorizeUrl);
      setCopy("copied");
      return;
    } catch {
      // WebView senza Clipboard API: si ripiega sulla selezione del campo.
    }
    const field = linkField.current;
    field?.select();
    setCopy(field && document.execCommand?.("copy") ? "copied" : "failed");
  }, [authorizeUrl]);

  const showCancelled = error?.code === "cancelled";
  const keychainBlocked = error?.code === "keychain-failed";
  const manual = choice === "manual";

  // no profile yet: the name is asked, and the first one is made
  const useLocal = useCallback(() => {
    setError(null);
    setLocalError(false);
    setLocalSetup(true);
  }, []);

  const chooseLocal = useCallback((profileId: string) => {
    if (localBusy) return;
    setError(null);
    setLocalError(false);
    setLocalBusy(true);
    try {
      // Do not carry an IPC scope transition across a WebView navigation.
      // DashboardApp activates and validates this saved capability.
      selectLocal(profileId);
      onLocalReady();
    } catch {
      setLocalError(true);
    } finally {
      setLocalBusy(false);
    }
  }, [localBusy, onLocalReady, selectLocal]);

  const createLocalIdentity = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!localName.trim() || localBusy) return;
    setLocalBusy(true);
    setLocalError(false);
    try {
      await createLocal(localName);
      onLocalReady();
    } catch {
      setLocalError(true);
    } finally {
      setLocalBusy(false);
    }
  }, [createLocal, localBusy, localName, onLocalReady]);

  const resetLocalPlayground = useCallback(async () => {
    if (!onResetLocalPlayground || localBusy) return;
    setLocalBusy(true);
    setLocalError(false);
    try {
      await onResetLocalPlayground();
      setLocalName("");
      setLocalSetup(true);
    } catch {
      setLocalError(true);
    } finally {
      setLocalBusy(false);
    }
  }, [localBusy, onResetLocalPlayground]);

  const recoverLocalPlayground = useCallback(async () => {
    if (!onRecoverLocalPlayground || localBusy) return;
    setLocalBusy(true);
    setLocalError(false);
    try {
      await onRecoverLocalPlayground();
      setLocalName("");
      setLocalSetup(true);
    } catch {
      setLocalError(true);
    } finally {
      setLocalBusy(false);
    }
  }, [localBusy, onRecoverLocalPlayground]);

  const savedProfiles = listLocal();
  const hasSavedLocalProfile = savedProfiles.length > 0;
  const lastUsedId = readLocal()?.profileId ?? null;
  const ownerId = nativeOwnerId !== undefined ? nativeOwnerId : ownerLocal()?.profileId ?? null;

  return (
    <main className="page login-screen" lang={locale}>
      <section className="login-card" aria-labelledby="login-title">
        <img src="/jht-mark.svg" alt="" className="login-card__mark" />
        <OnboardingArtwork name="identity" className="login-card__artwork" />
        <p className="eyebrow">{t.eyebrow}</p>
        <h1 id="login-title">{t.title}</h1>
        <p className="login-card__lede">
          {t.lede}
        </p>

        {localSetup ? (
          <form className="login-card__local" onSubmit={createLocalIdentity}>
            <label>
              <span>{t.name}</span>
              <input
                autoFocus
                autoComplete="nickname"
                value={localName}
                onChange={(event) => setLocalName(event.target.value)}
                maxLength={80}
              />
            </label>
            <p className="login-card__note">{t.localNote}</p>
            {hasSavedLocalProfile && <p className="login-card__note">{profilesText.newProfileNote}</p>}
            {!localName.trim() && <p className="login-card__note" id="login-name-missing" role="status">{t.nameMissing}</p>}
            <button className="primary-button" type="submit" disabled={!localName.trim() || localBusy} aria-describedby={!localName.trim() ? "login-name-missing" : undefined}>
              {localBusy ? t.preparing : t.continueLocal}
            </button>
            <button className="login-card__secondary" type="button" onClick={() => setLocalSetup(false)} disabled={localBusy}>
              {t.back}
            </button>
          </form>
        ) : waiting ? (
          <div className="login-card__waiting" role="status">
            <p>
              {manual
                ? t.manualWait
                : t.browserWait}
            </p>
            {authorizeUrl && (
              <div className="login-card__link">
                <input
                  ref={linkField}
                  readOnly
                  value={authorizeUrl}
                  aria-label={t.linkLabel}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button className="login-card__secondary" type="button" onClick={copyLink}>
                  {copy === "copied" ? t.copied : t.copy}
                </button>
              </div>
            )}
            {copy === "failed" && (
              <p className="login-card__note">{t.copyFailed}</p>
            )}
            <button className="login-card__secondary" type="button" onClick={stop}>
              {t.cancel}
            </button>
          </div>
        ) : (
          <>
            <label className="login-card__browser">
              <span>{t.openWith}</span>
              <select
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
                disabled={!configured || keychainBlocked}
              >
                <option value="default">{t.defaultBrowser}</option>
                {browsers.map((browser) => (
                  <option key={browser.id} value={browser.id}>
                    {browser.name}
                  </option>
                ))}
                <option value="manual">{t.manualBrowser}</option>
              </select>
            </label>
            <button
              className="primary-button login-card__google"
              type="button"
              onClick={start}
              disabled={!configured || keychainBlocked}
            >
              <GoogleIcon /> {keychainBlocked ? t.restart : t.google}
            </button>
            <div className="login-card__separator" aria-hidden="true"><span>{t.or}</span></div>
            {hasSavedLocalProfile ? (
              <section className="login-card__profiles" aria-labelledby="login-profiles-title">
                <h2 id="login-profiles-title">{profilesText.listTitle}</h2>
                <ul aria-label={profilesText.listAria}>
                  {savedProfiles.map((profile) => (
                    <li key={profile.profileId}>
                      <button
                        className="login-card__local-button"
                        type="button"
                        onClick={() => chooseLocal(profile.profileId)}
                        disabled={localBusy}
                      >
                        {localBusy ? t.preparing : profilesText.useProfile.replace("{name}", () => profile.displayName)}
                      </button>
                      {(profile.profileId === ownerId || profile.profileId === lastUsedId) && (
                        <span className="login-card__tags">
                          {profile.profileId === ownerId && <span data-testid="login-profile-owner">{profilesText.teamHere}</span>}
                          {profile.profileId === lastUsedId && <span data-testid="login-profile-last">{profilesText.lastUsed}</span>}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <button
                  className="login-card__secondary"
                  type="button"
                  onClick={useLocal}
                  disabled={localBusy}
                >
                  {profilesText.newProfile}
                </button>
              </section>
            ) : (
              <button
                className="login-card__local-button"
                type="button"
                onClick={useLocal}
                disabled={localBusy}
              >
                {localBusy ? t.preparing : t.useLocal}
              </button>
            )}
            {onResetLocalPlayground && hasSavedLocalProfile && (
              <button
                className="login-card__secondary"
                type="button"
                onClick={() => void resetLocalPlayground()}
                disabled={localBusy}
              >
                {t.resetLocal}
              </button>
            )}
            {onRecoverLocalPlayground && !hasSavedLocalProfile && (
              <button
                className="login-card__secondary"
                type="button"
                onClick={() => void recoverLocalPlayground()}
                disabled={localBusy}
              >
                {t.recoverLocal}
              </button>
            )}
          </>
        )}

        {error && !showCancelled && (
          <p className="login-card__error" role="alert">
            {loginErrorCopy(error.code, locale).text}
            {error.code === "denied" && error.detail ? ` (${error.detail})` : null}
            {` ${loginErrorCopy(error.code, locale).action}`}
          </p>
        )}
        {showCancelled && <p className="login-card__note">{loginErrorCopy("cancelled", locale).text}</p>}
        <PublicPageLinks className="login-card__note" />
        {localError && (
          <p className="login-card__error" role="alert">
            {t.localError}
          </p>
        )}
      </section>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
