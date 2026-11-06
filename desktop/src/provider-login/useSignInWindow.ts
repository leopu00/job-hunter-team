import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Locale } from "@/i18n/config";
import { describeError, errorCodeOf } from "../lib/error-catalog";
import { mergeProviderLoginAction, type OnboardingProviderLoginState, type SubscriptionProvider } from "../lib/onboarding";
import {
  closeOnboardingProviderLogin,
  sendOnboardingProviderInput,
  startOnboardingProviderLogin,
  type OnboardingInteractiveEvent,
} from "../lib/onboarding-runtime";

type SetLogin = Dispatch<SetStateAction<OnboardingProviderLoginState | null>>;

/** The one login window's bookkeeping: which attempt is current, its session, the input it waits for, how it ends. */
interface Session {
  attempt: number;
  id: string | null;
  inputRequest: string | null;
  exit: { attempt: number; reject: (error: Error) => void } | null;
  stopping: number | null;
}

interface Run {
  session: Session;
  attempt: number;
  current: () => boolean;
  fail: (code: string) => void;
  setLogin: SetLogin;
  failureText: (code: string) => string;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/** What the window shows for one event of the device login, and how the login stands after it. */
function applyLoginEvent(event: OnboardingInteractiveEvent, run: Run): "invalid" | "ended" | "failed" | null {
  if (event.kind === "invalid_action") return "invalid";
  if (event.kind === "state") {
    const actions = event.action.kind === "device" ? event.action.actions : [event.action];
    const input = actions.find((action) => action.kind === "input");
    run.session.inputRequest = input?.kind === "input" ? input.inputRequest.id : null;
    run.setLogin((open) => open ? { ...open, status: "needs_user_action", connectionState: "connected", actions: actions.reduce(mergeProviderLoginAction, open.actions) } : open);
    return null;
  }
  run.session.inputRequest = null;
  const ok = event.code === 0;
  run.setLogin((open) => open ? {
    ...open,
    status: ok ? "verifying" : "error",
    connectionState: ok ? "connected" : "disconnected",
    actions: ok ? open.actions.filter((action) => action.kind !== "input") : [],
    safeErrorMessage: ok ? undefined : run.failureText("provider_relogin_failed"),
    exitCode: event.code,
  } : open);
  return ok ? "ended" : "failed";
}

/** One run of the device login, to its end: "ended" when the provider said it finished, null otherwise (the window says why). */
async function runSession(run: Run): Promise<"ended" | null> {
  const { session, attempt, current } = run;
  let sessionId: string | null = null;
  let invalid = false;
  const exit = deferred();
  session.exit = { attempt, reject: exit.reject };
  try {
    sessionId = await startOnboardingProviderLogin({ kind: "local" }, (event) => {
      if (!current()) return;
      const outcome = applyLoginEvent(event, run);
      if (outcome === "invalid") {
        invalid = true;
        run.fail("provider_relogin_failed");
        exit.reject(new Error("provider_action_invalid"));
      } else if (outcome === "ended") exit.resolve();
      else if (outcome === "failed") exit.reject(new Error("provider-login-failed"));
    }, () => undefined);
    if (!current()) {
      await closeOnboardingProviderLogin(sessionId).catch(() => undefined);
      return null;
    }
    session.id = sessionId;
    run.setLogin((open) => open?.status === "connecting" ? { ...open, connectionState: "connected" } : open);
    await exit.promise;
    await closeOnboardingProviderLogin(sessionId);
    session.id = null;
    if (session.exit?.attempt === attempt) session.exit = null;
    return current() ? "ended" : null;
  } catch (error) {
    if (session.exit?.attempt === attempt) session.exit = null;
    if (sessionId && session.id === sessionId) {
      await closeOnboardingProviderLogin(sessionId).catch(() => undefined);
      session.id = null;
    }
    if (session.stopping === attempt) {
      session.stopping = null;
      return null;
    }
    // a start that was refused says its own reason; anything else is the sign-in not completing
    if (current() && !invalid) run.fail(errorCodeOf(error) ?? "provider_relogin_failed");
    return null;
  }
}

/** «Cancel»: the session ends, the run waiting for it ends quietly, the window closes. */
async function cancelSession(session: Session, setLogin: SetLogin): Promise<void> {
  const sessionId = session.id;
  const attempt = session.attempt;
  session.stopping = attempt;
  try {
    if (sessionId) await closeOnboardingProviderLogin(sessionId);
  } catch (error) {
    session.stopping = null;
    throw error;
  }
  session.attempt = attempt + 1;
  if (sessionId && session.id === sessionId) session.id = null;
  session.inputRequest = null;
  const pending = session.exit;
  if (pending?.attempt === attempt) {
    session.exit = null;
    pending.reject(new Error("provider-login-closed"));
  }
  session.stopping = null;
  setLogin(null);
}

/** The code or text the provider asked for, sent to the waiting session. */
async function sendSessionInput(session: Session, setLogin: SetLogin, input: string): Promise<void> {
  const sessionId = session.id;
  const requestId = session.inputRequest;
  if (!sessionId || !requestId) throw new Error("provider-input-not-requested");
  await sendOnboardingProviderInput(sessionId, requestId, input);
  if (session.id !== sessionId || session.inputRequest !== requestId) return;
  session.inputRequest = null;
  setLogin((open) => open ? {
    ...open,
    status: open.actions.some((action) => action.kind === "input" && action.inputRequest.id === requestId) ? "verifying" : open.status,
    actions: open.actions.filter((action) => action.kind !== "input" || action.inputRequest.id !== requestId),
  } : open);
}

interface SignInOptions {
  locale: Locale;
  /** Which provider the window names (the team's, else the one the app remembers). */
  provider: () => SubscriptionProvider;
  /** Asks the team after the window ended; true when it holds the new sign-in. */
  holds: () => Promise<boolean>;
}

/**
 * The window to sign in to the provider again: the setup's own device login (`onboarding_provider_login`) on this computer's team,
 * with nothing of the setup around it. One window at a time; leaving the app's team ends a window still open.
 */
export function useSignInWindow({ locale, provider, holds }: SignInOptions) {
  const [login, setLogin] = useState<OnboardingProviderLoginState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sessionRef = useRef<Session>({ attempt: 0, id: null, inputRequest: null, exit: null, stopping: null });

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

  const signIn = useCallback(async () => {
    const session = sessionRef.current;
    if (session.id || session.exit) return;
    const attempt = ++session.attempt;
    const current = () => session.attempt === attempt;
    const fail = (code: string) => {
      if (!current()) return;
      session.inputRequest = null;
      setLogin((open) => open ? { ...open, status: "error", connectionState: "disconnected", actions: [], safeErrorMessage: failureText(code), exitCode: null } : open);
    };
    session.inputRequest = null;
    setLogin({ provider: provider(), status: "connecting", actions: [], connectionState: "connecting", startedAt: Date.now() });
    if (await runSession({ session, attempt, current, fail, setLogin, failureText }) !== "ended") return;
    // The window says the sign-in ended; the team says whether it holds.
    const held = await holds();
    if (!current()) return;
    if (held) setLogin(null);
    else fail("provider_relogin_unverified");
  }, [failureText, holds, provider]);

  const cancel = useCallback(() => cancelSession(sessionRef.current, setLogin), []);
  const sendInput = useCallback((input: string) => sendSessionInput(sessionRef.current, setLogin, input), []);
  const restart = useCallback(async () => {
    await cancel();
    await signIn();
  }, [cancel, signIn]);

  useEffect(() => () => {
    const session = sessionRef.current;
    session.attempt += 1;
    const sessionId = session.id;
    session.id = null;
    if (sessionId) void closeOnboardingProviderLogin(sessionId).catch(() => undefined);
  }, []);

  return { login, now, signIn, cancel, sendInput, restart };
}
