import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { appLocale } from "../lib/app-locale";
import { reconnectDirectChat } from "../lib/direct-chat";
import { describeError, errorCodeOf } from "../lib/error-catalog";
import type { OnboardingProviderLoginAction, OnboardingProviderLoginState, SubscriptionProvider } from "../lib/onboarding";
import { closeOnboardingProviderLogin, sendOnboardingProviderInput, startOnboardingProviderLogin } from "../lib/onboarding-runtime";
import { OAuthLoginTakeover } from "../oauth-login-takeover";
import { PROVIDER_LOGIN_TEXT, PROVIDER_NAMES } from "./provider-login.i18n";
import { readProviderLoginState, type LoginProvider, type ProviderLoginResult, type ProviderLoginState } from "./provider-login-native";

/** What the app knows of the team's provider sign-in right now. */
export type LoginView =
  | { kind: "loading" }
  | { kind: "state"; state: ProviderLoginState; provider: LoginProvider }
  | { kind: "failed"; code: string };

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

/** The state is read again this often while the app is open, and whenever the window comes back. */
export const REREAD_EVERY_MS = 5 * 60 * 1000;

const SUBSCRIPTION: readonly string[] = ["claude", "codex", "kimi"];
/** After a sign-in these states say the credentials are still not there: the sign-in did not do what it says. */
const STILL_WITHOUT_LOGIN: readonly ProviderLoginState[] = ["expired", "missing", "unreadable"];

function mergeAction(actions: OnboardingProviderLoginAction[], action: OnboardingProviderLoginAction) {
  return [...actions.filter((current) => current.kind !== action.kind), action];
}

function toView(result: ProviderLoginResult): LoginView {
  return result.ok ? { kind: "state", state: result.state, provider: result.provider } : { kind: "failed", code: result.error };
}

/**
 * Owns the state of the provider sign-in of the team on this computer and the window to sign in again. The sign-in is the same
 * device login the setup uses (`onboarding_provider_login`), started on its own: it needs nothing of the setup around it.
 */
export function ProviderLoginProvider({ enabled, rememberedProvider, children }: { enabled: boolean; rememberedProvider?: SubscriptionProvider; children: ReactNode }) {
  const [view, setView] = useState<LoginView>({ kind: "loading" });
  const [login, setLogin] = useState<OnboardingProviderLoginState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const readToken = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  // The provider the team last said it signs in to: a read that fails later does not make the sign-in guess.
  const knownProvider = useRef<SubscriptionProvider | null>(null);
  if (view.kind === "state" && SUBSCRIPTION.includes(view.provider)) knownProvider.current = view.provider as SubscriptionProvider;
  const attemptRef = useRef(0);
  const sessionRef = useRef<string | null>(null);
  const inputRequestRef = useRef<string | null>(null);
  const exitRef = useRef<{ attempt: number; reject: (error: Error) => void } | null>(null);
  const stoppingRef = useRef<number | null>(null);
  const locale = appLocale();

  const readNow = useCallback(async () => {
    const mine = ++readToken.current;
    const result = await readProviderLoginState();
    if (readToken.current === mine) setView(toView(result));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void readNow();
    const timer = setInterval(() => void readNow(), REREAD_EVERY_MS);
    const focused = () => void readNow();
    window.addEventListener("focus", focused);
    return () => {
      readToken.current += 1;
      clearInterval(timer);
      window.removeEventListener("focus", focused);
    };
  }, [enabled, readNow]);

  const windowOpen = login !== null;
  useEffect(() => {
    if (!windowOpen) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [windowOpen]);

  const failureText = useCallback((code: string) => {
    const described = describeError(code, { locale });
    return `${described.text} ${described.action}`;
  }, [locale]);

  const cancel = useCallback(async () => {
    const sessionId = sessionRef.current;
    const attempt = attemptRef.current;
    stoppingRef.current = attempt;
    try {
      if (sessionId) await closeOnboardingProviderLogin(sessionId);
    } catch (error) {
      stoppingRef.current = null;
      throw error;
    }
    attemptRef.current = attempt + 1;
    if (sessionId && sessionRef.current === sessionId) sessionRef.current = null;
    inputRequestRef.current = null;
    const pending = exitRef.current;
    if (pending?.attempt === attempt) {
      exitRef.current = null;
      pending.reject(new Error("provider-login-closed"));
    }
    stoppingRef.current = null;
    setLogin(null);
  }, []);

  const signInNow = useCallback(async () => {
    // one window at a time
    if (sessionRef.current || (attemptRef.current > 0 && exitRef.current)) return;
    const provider: SubscriptionProvider = knownProvider.current ?? rememberedProvider ?? "codex";
    const attempt = ++attemptRef.current;
    const current = () => attemptRef.current === attempt;
    let sessionId: string | null = null;
    let invalidAction = false;
    const fail = (code: string) => {
      if (!current()) return;
      inputRequestRef.current = null;
      setLogin((open) => open ? { ...open, status: "error", connectionState: "disconnected", actions: [], safeErrorMessage: failureText(code), exitCode: null } : open);
    };
    inputRequestRef.current = null;
    setLogin({ provider, status: "connecting", actions: [], connectionState: "connecting", startedAt: Date.now() });
    let resolveExit!: () => void;
    let rejectExit!: (error: Error) => void;
    const exit = new Promise<void>((resolve, reject) => {
      resolveExit = resolve;
      rejectExit = reject;
    });
    void exit.catch(() => undefined);
    exitRef.current = { attempt, reject: rejectExit };
    try {
      sessionId = await startOnboardingProviderLogin({ kind: "local" }, (event) => {
        if (!current()) return;
        if (event.kind === "invalid_action") {
          invalidAction = true;
          fail("provider_relogin_failed");
          rejectExit(new Error(event.code));
          return;
        }
        if (event.kind === "state") {
          const actions: OnboardingProviderLoginAction[] = event.action.kind === "device" ? event.action.actions : [event.action];
          const input = actions.find((action) => action.kind === "input");
          inputRequestRef.current = input?.kind === "input" ? input.inputRequest.id : null;
          setLogin((open) => open ? { ...open, status: "needs_user_action", connectionState: "connected", actions: actions.reduce(mergeAction, open.actions) } : open);
          return;
        }
        inputRequestRef.current = null;
        setLogin((open) => open ? {
          ...open,
          status: event.code === 0 ? "verifying" : "error",
          connectionState: event.code === 0 ? "connected" : "disconnected",
          actions: event.code === 0 ? open.actions.filter((action) => action.kind !== "input") : [],
          safeErrorMessage: event.code === 0 ? undefined : failureText("provider_relogin_failed"),
          exitCode: event.code,
        } : open);
        if (event.code === 0) resolveExit();
        else rejectExit(new Error("provider-login-failed"));
      }, () => undefined);
      if (!current()) {
        await closeOnboardingProviderLogin(sessionId).catch(() => undefined);
        sessionId = null;
        return;
      }
      sessionRef.current = sessionId;
      setLogin((open) => open?.status === "connecting" ? { ...open, connectionState: "connected" } : open);
      await exit;
      await closeOnboardingProviderLogin(sessionId);
      sessionRef.current = null;
      sessionId = null;
      if (exitRef.current?.attempt === attempt) exitRef.current = null;
      if (!current()) return;
      // The window says the sign-in ended; the team says whether it holds. A read that cannot be made proves nothing either way.
      const after = await readProviderLoginState();
      if (!current()) return;
      if (after.ok && STILL_WITHOUT_LOGIN.includes(after.state)) {
        setView(toView(after));
        fail("provider_relogin_unverified");
        return;
      }
      setView(after.ok ? toView(after) : viewRef.current);
      setLogin(null);
      void readNow();
    } catch (error) {
      if (exitRef.current?.attempt === attempt) exitRef.current = null;
      if (sessionId && sessionRef.current === sessionId) {
        await closeOnboardingProviderLogin(sessionId).catch(() => undefined);
        sessionRef.current = null;
      }
      if (stoppingRef.current === attempt) {
        stoppingRef.current = null;
        return;
      }
      if (!current() || invalidAction) return;
      const code = errorCodeOf(error);
      // a start that was refused says its own reason; anything else is the sign-in not completing
      fail(code && code !== "provider-login-failed" ? code : "provider_relogin_failed");
    }
  }, [failureText, readNow, rememberedProvider]);

  const sendInput = useCallback(async (input: string) => {
    const sessionId = sessionRef.current;
    const requestId = inputRequestRef.current;
    if (!sessionId || !requestId) throw new Error("provider-input-not-requested");
    await sendOnboardingProviderInput(sessionId, requestId, input);
    if (sessionRef.current !== sessionId || inputRequestRef.current !== requestId) return;
    inputRequestRef.current = null;
    setLogin((open) => open ? {
      ...open,
      status: open.actions.some((action) => action.kind === "input" && action.inputRequest.id === requestId) ? "verifying" : open.status,
      actions: open.actions.filter((action) => action.kind !== "input" || action.inputRequest.id !== requestId),
    } : open);
  }, []);

  const restart = useCallback(async () => {
    await cancel();
    await signInNow();
  }, [cancel, signInNow]);

  const reconnect = useCallback(async () => {
    try {
      await reconnectDirectChat();
    } catch (error) {
      setView({ kind: "failed", code: errorCodeOf(error) ?? "disconnected" });
      return;
    }
    await readNow();
  }, [readNow]);

  // leaving the page (or the team) ends a sign-in window that is still open
  useEffect(() => () => {
    attemptRef.current += 1;
    const sessionId = sessionRef.current;
    sessionRef.current = null;
    if (sessionId) void closeOnboardingProviderLogin(sessionId).catch(() => undefined);
  }, []);

  const api = useMemo<ProviderLoginApi | null>(
    () => (enabled ? {
      view,
      signingIn: login !== null,
      signIn: () => void signInNow(),
      reread: () => void readNow(),
      reconnect: () => void reconnect(),
    } : null),
    [enabled, login, readNow, reconnect, signInNow, view],
  );

  const t = PROVIDER_LOGIN_TEXT[locale];
  return (
    <ProviderLoginContext.Provider value={api}>
      {children}
      {enabled && login && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t.dialogLabel}
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
              onSubmitInput={sendInput}
              onCancel={cancel}
              onRestart={restart}
            />
          </div>
        </div>
      )}
    </ProviderLoginContext.Provider>
  );
}
