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
import "./login-screen.css";

const MESSAGES: Record<LoginErrorCode, string> = {
  "not-configured":
    "Questa build non sa a quale account collegarsi: mancano VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.",
  "not-desktop": "L'accesso funziona solo dentro l'app desktop.",
  "port-busy":
    "Un altro programma occupa la porta del ritorno dal browser. Chiudi l'altro accesso in corso e riprova.",
  "browser-failed": "Non riesco ad aprire il browser scelto. Scegline un altro o copia il link.",
  "browser-not-found": "Il browser scelto non c'è più. Scegline un altro.",
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
}: LoginScreenProps) {
  const [browsers, setBrowsers] = useState<InstalledBrowser[]>([]);
  const [choice, setChoice] = useState<BrowserChoice>("default");
  const [waiting, setWaiting] = useState(false);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyState>("idle");
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
    setAuthorizeUrl(null);
    setCopy("idle");
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
  }, [signIn, choice]);

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
  const manual = choice === "manual";

  return (
    <main className="page login-screen">
      <section className="login-card" aria-labelledby="login-title">
        <img src="/jht-mark.svg" alt="" className="login-card__mark" />
        <p className="eyebrow">Pannello di controllo</p>
        <h1 id="login-title">Accedi</h1>
        <p className="login-card__lede">
          Entra con il tuo account per vedere le tue posizioni e la tua dashboard.
        </p>

        {waiting ? (
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
                disabled={!configured}
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
              disabled={!configured}
            >
              <GoogleIcon /> Accedi con Google
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
