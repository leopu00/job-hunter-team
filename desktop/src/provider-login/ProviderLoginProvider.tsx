import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { appLocale } from "../lib/app-locale";
import type { OnboardingProviderLoginState, SubscriptionProvider } from "../lib/onboarding";
import { OAuthLoginTakeover } from "../oauth-login-takeover";
import { PROVIDER_LOGIN_TEXT, PROVIDER_NAMES } from "./provider-login.i18n";
import { readProviderLoginState, WITHOUT_SIGN_IN } from "./provider-login-native";
import { toView, useLoginState, type LoginView } from "./useLoginState";
import { useSignInWindow } from "./useSignInWindow";

export { REREAD_EVERY_MS, FOCUS_REREAD_MIN_MS, type LoginView } from "./useLoginState";

export interface ProviderLoginApi {
  view: LoginView;
  /** A sign-in window is open (or opening). */
  signingIn: boolean;
  /** Opens the provider's sign-in window: only the sign-in, no setup, no reinstall, no restart of the team. */
  signIn(): void;
  /** Reads the state again now. */
  reread(): void;
  /** Connects the chat again (what the read needs), then reads. */
  reconnect(): void;
}

const ProviderLoginContext = createContext<ProviderLoginApi | null>(null);

/** Null where the app does not show the team of this computer (no sign-in to manage there). */
export function useProviderLogin(): ProviderLoginApi | null {
  return useContext(ProviderLoginContext);
}

const SUBSCRIPTION: readonly string[] = ["claude", "codex", "kimi"];

/**
 * Owns the state of the provider sign-in of the team on this computer and the window to sign in again. The sign-in is the same
 * device login the setup uses, started on its own: it needs nothing of the setup around it.
 */
export function ProviderLoginProvider({ enabled, rememberedProvider, children }: { enabled: boolean; rememberedProvider?: SubscriptionProvider; children: ReactNode }) {
  const locale = appLocale();
  const { view, setView, readNow, reconnect } = useLoginState(enabled);
  // The provider the team last said it signs in to: a read that fails later does not make the sign-in guess.
  const knownProvider = useRef<SubscriptionProvider | null>(null);
  if (view.kind === "state" && SUBSCRIPTION.includes(view.provider)) knownProvider.current = view.provider as SubscriptionProvider;
  const provider = useCallback(() => knownProvider.current ?? rememberedProvider ?? "codex", [rememberedProvider]);
  // What the team says right after the sign-in is what the page shows at once (the banner does not wait for the next read). A read
  // that cannot be made leaves no «expired» banner for a sign-in just made: the card says why it cannot tell.
  const holds = useCallback(async () => {
    const after = await readProviderLoginState();
    setView(toView(after));
    return !(after.ok && WITHOUT_SIGN_IN.includes(after.state));
  }, [setView]);
  const signInWindow = useSignInWindow({ locale, provider, holds });

  const api = useMemo<ProviderLoginApi | null>(
    () => (enabled ? {
      view,
      signingIn: signInWindow.login !== null,
      signIn: () => void signInWindow.signIn(),
      reread: () => void readNow(),
      reconnect: () => void reconnect(),
    } : null),
    [enabled, readNow, reconnect, view, signInWindow.login, signInWindow.signIn],
  );

  return (
    <ProviderLoginContext.Provider value={api}>
      {children}
      {enabled && signInWindow.login && (
        <SignInDialog login={signInWindow.login} now={signInWindow.now} label={PROVIDER_LOGIN_TEXT[locale].dialogLabel}
          onInput={signInWindow.sendInput} onCancel={signInWindow.cancel} onRestart={signInWindow.restart} />
      )}
    </ProviderLoginContext.Provider>
  );
}

interface DialogProps {
  login: OnboardingProviderLoginState;
  now: number;
  label: string;
  onInput: (value: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onRestart: () => Promise<void>;
}

function SignInDialog({ login, now, label, onInput, onCancel, onRestart }: DialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-testid="provider-login-dialog"
      className="fixed inset-0 z-50 flex overflow-auto p-4"
      style={{ background: "rgba(0, 0, 0, 0.55)" }}
    >
      <div
        className="m-auto w-full max-w-xl rounded-lg border border-[var(--color-border)] p-4"
        style={{ background: "var(--color-panel)", color: "var(--color-white)" }}
      >
        <OAuthLoginTakeover
          provider={login.provider}
          providerName={PROVIDER_NAMES[login.provider]}
          actions={login.actions}
          verifying={login.status === "verifying"}
          connectionState={login.connectionState}
          elapsedMs={Math.max(0, now - login.startedAt)}
          safeErrorMessage={login.safeErrorMessage ?? null}
          onSubmitInput={onInput}
          onCancel={onCancel}
          onRestart={onRestart}
        />
      </div>
    </div>
  );
}
