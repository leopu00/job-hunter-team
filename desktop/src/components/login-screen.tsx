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
  activateSavedLocalProfile,
  createAndActivateLocalProfile,
  readLocalProfile,
  type LocalProfile,
} from "../lib/local-profile";
import { DASHBOARD_PAGE, goTo } from "../lib/pages";
import { OnboardingArtwork } from "../onboarding/OnboardingArtwork";
import "./login-screen.css";

const MESSAGES: Record<LoginErrorCode, string> = {
  "not-configured":
    "Questa build non sa a quale account collegarsi: mancano VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.",
  "not-desktop": "L'accesso funziona solo dentro l'app desktop.",
  "port-busy":
    "Un altro programma occupa la porta del ritorno dal browser. Chiudi l'altro accesso in corso e riprova.",
  "browser-failed": "Non riesco ad aprire il browser scelto. Scegline un altro o copia il link.",
  "browser-not-found": "Il browser scelto non c'è più. Scegline un altro.",
  "keychain-failed":
    "Il Portachiavi non ha concesso la chiave della sessione. Chiudi completamente Job Hunter Team e riaprila se vuoi riprovare.",
  denied: "Accesso non concesso.",
  "timed-out": "Il browser non ha risposto entro cinque minuti. Riprova.",
  cancelled: "Accesso annullato.",
  "in-progress": "Un accesso è già in corso nel browser.",
  "exchange-failed": "Google ha risposto, ma la sessione non si è aperta. Riprova.",
  unknown: "Accesso non riuscito. Riprova.",
};

export interface LoginScreenProps {
  /** Sostituibili nei test; di norma il login vero. */
  signIn?: (options: SignInOptions) => Promise<void>;
  cancel?: () => Promise<void>;
  loadBrowsers?: () => Promise<InstalledBrowser[]>;
  configured?: boolean;
  readLocal?: () => LocalProfile | null;
  createLocal?: (displayName: string) => Promise<LocalProfile>;
  activateLocal?: () => Promise<LocalProfile>;
  onLocalReady?: () => void;
  onChooseGoogle?: () => boolean | Promise<boolean>;
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
  readLocal = readLocalProfile,
  createLocal = createAndActivateLocalProfile,
  activateLocal = activateSavedLocalProfile,
  onLocalReady = () => goTo(DASHBOARD_PAGE),
  onChooseGoogle,
}: LoginScreenProps) {
  const [browsers, setBrowsers] = useState<InstalledBrowser[]>([]);
  const [choice, setChoice] = useState<BrowserChoice>("default");
  const [waiting, setWaiting] = useState(false);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyState>("idle");
  const [localSetup, setLocalSetup] = useState(false);
  const [localName, setLocalName] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState(false);
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

  const start = useCallback(async () => {
    setError(null);
    setLocalError(false);
    setAuthorizeUrl(null);
    setCopy("idle");
    if (await onChooseGoogle?.()) return;
    setWaiting(true);
    saveBrowserChoice(choice);
    try {
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

  const useLocal = useCallback(async () => {
    setError(null);
    setLocalError(false);
    const saved = readLocal();
    if (!saved) {
      setLocalSetup(true);
      return;
    }
    setLocalBusy(true);
    try {
      await activateLocal();
      onLocalReady();
    } catch {
      setLocalError(true);
    } finally {
      setLocalBusy(false);
    }
  }, [activateLocal, onLocalReady, readLocal]);

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

  return (
    <main className="page login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <img src="/jht-mark.svg" alt="" className="login-card__mark" />
        <OnboardingArtwork name="identity" className="login-card__artwork" />
        <p className="eyebrow">Pannello di controllo</p>
        <h1 id="login-title">Come vuoi iniziare?</h1>
        <p className="login-card__lede">
          Scegli Google oppure continua solo su questo dispositivo. Host e provider si scelgono dopo.
        </p>

        {localSetup ? (
          <form className="login-card__local" onSubmit={createLocalIdentity}>
            <label>
              <span>Nome visualizzato</span>
              <input
                autoFocus
                autoComplete="nickname"
                value={localName}
                onChange={(event) => setLocalName(event.target.value)}
                maxLength={80}
              />
            </label>
            <p className="login-card__note">Resta solo su questo dispositivo.</p>
            <button className="primary-button" type="submit" disabled={!localName.trim() || localBusy}>
              {localBusy ? "Preparazione…" : "Continua in locale"}
            </button>
            <button className="login-card__secondary" type="button" onClick={() => setLocalSetup(false)} disabled={localBusy}>
              Indietro
            </button>
          </form>
        ) : waiting ? (
          <div className="login-card__waiting" role="status">
            <p>
              {manual
                ? "Copia il link e aprilo nel browser in cui vuoi accedere."
                : "Completa l'accesso nel browser che si è aperto."}
            </p>
            {authorizeUrl && (
              <div className="login-card__link">
                <input
                  ref={linkField}
                  readOnly
                  value={authorizeUrl}
                  aria-label="Link di accesso"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button className="login-card__secondary" type="button" onClick={copyLink}>
                  {copy === "copied" ? "Link copiato" : "Copia link"}
                </button>
              </div>
            )}
            {copy === "failed" && (
              <p className="login-card__note">Non riesco a copiarlo: selezionalo e copialo a mano.</p>
            )}
            <button className="login-card__secondary" type="button" onClick={stop}>
              Annulla
            </button>
          </div>
        ) : (
          <>
            <label className="login-card__browser">
              <span>Apri con</span>
              <select
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
                disabled={!configured || keychainBlocked}
              >
                <option value="default">Browser predefinito</option>
                {browsers.map((browser) => (
                  <option key={browser.id} value={browser.id}>
                    {browser.name}
                  </option>
                ))}
                <option value="manual">Nessuno: copio il link</option>
              </select>
            </label>
            <button
              className="primary-button login-card__google"
              type="button"
              onClick={start}
              disabled={!configured || keychainBlocked}
            >
              <GoogleIcon /> {keychainBlocked ? "Riavvia per riprovare" : "Continua con Google"}
            </button>
            <div className="login-card__separator" aria-hidden="true"><span>oppure</span></div>
            <button
              className="login-card__local-button"
              type="button"
              onClick={() => void useLocal()}
              disabled={localBusy}
            >
              {localBusy ? "Preparazione…" : "Usa in locale"}
            </button>
          </>
        )}

        {error && !showCancelled && (
          <p className="login-card__error" role="alert">
            {MESSAGES[error.code]}
            {error.code === "denied" && error.detail ? ` (${error.detail})` : null}
          </p>
        )}
        {showCancelled && <p className="login-card__note">{MESSAGES.cancelled}</p>}
        {localError && (
          <p className="login-card__error" role="alert">
            Non riesco ad attivare il profilo locale. Nessun runtime è stato aperto.
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
