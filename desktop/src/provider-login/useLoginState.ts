import { useCallback, useEffect, useRef, useState } from "react";
import { reconnectDirectChat } from "../lib/direct-chat";
import { errorCodeOf } from "../lib/error-catalog";
import { readProviderLoginState, type LoginProvider, type ProviderLoginResult, type ProviderLoginState } from "./provider-login-native";

/** What the app knows of the team's provider sign-in right now. */
export type LoginView =
  | { kind: "loading" }
  | { kind: "state"; state: ProviderLoginState; provider: LoginProvider; here: boolean }
  | { kind: "failed"; code: string; here?: boolean };

/** The state is read again this often while the app is open. */
export const REREAD_EVERY_MS = 5 * 60 * 1000;
/** The window coming back reads it again, but not more often than this: each read takes the chat's channel for its time. */
export const FOCUS_REREAD_MIN_MS = 60 * 1000;

export function toView(result: ProviderLoginResult): LoginView {
  if (result.ok) return { kind: "state", state: result.state, provider: result.provider, here: result.here };
  return result.here === undefined ? { kind: "failed", code: result.error } : { kind: "failed", code: result.error, here: result.here };
}

/** The team's word on its sign-in: read at once, every few minutes, when the window comes back, and on demand. */
export function useLoginState(enabled: boolean) {
  const [view, setView] = useState<LoginView>({ kind: "loading" });
  const readToken = useRef(0);
  const lastRead = useRef(0);

  const readNow = useCallback(async () => {
    const mine = ++readToken.current;
    lastRead.current = Date.now();
    const result = await readProviderLoginState();
    if (readToken.current === mine) setView(toView(result));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void readNow();
    const timer = setInterval(() => void readNow(), REREAD_EVERY_MS);
    const focused = () => {
      if (Date.now() - lastRead.current >= FOCUS_REREAD_MIN_MS) void readNow();
    };
    window.addEventListener("focus", focused);
    return () => {
      readToken.current += 1;
      clearInterval(timer);
      window.removeEventListener("focus", focused);
    };
  }, [enabled, readNow]);

  const reconnect = useCallback(async () => {
    try {
      await reconnectDirectChat();
    } catch (error) {
      setView({ kind: "failed", code: errorCodeOf(error) ?? "disconnected" });
      return;
    }
    await readNow();
  }, [readNow]);

  return { view, setView, readNow, reconnect };
}
