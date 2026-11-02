import { FormEvent, useEffect, useId, useRef, useState } from "react";
import type { Locale } from "@/i18n/config";
import { appLocale } from "../lib/app-locale";
import { openExternalUrl } from "../lib/external-links";
import {
  canonicalProviderLoginUrl,
  type SubscriptionProvider,
} from "../lib/onboarding";
import { TAKEOVER_TEXT } from "./oauth-login-takeover.i18n";
import "./oauth-login-takeover.css";

export type OAuthLoginConnectionState = "connecting" | "connected" | "disconnected";

export interface OAuthLoginInputRequest {
  id: string;
  label: string;
  description?: string;
  submitLabel?: string;
  secret?: boolean;
  inputMode?: "text" | "numeric";
}

export type OAuthLoginUserAction =
  | { kind: "url"; instruction: string; safeUrl: string }
  | { kind: "code"; instruction: string; userCode: string }
  | { kind: "input"; instruction: string; inputRequest: OAuthLoginInputRequest };

export interface OAuthLoginTakeoverProps {
  provider: SubscriptionProvider;
  providerName: string;
  actions: OAuthLoginUserAction[];
  verifying?: boolean;
  connectionState: OAuthLoginConnectionState;
  elapsedMs: number;
  safeErrorMessage?: string | null;
  onSubmitInput: (value: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onRestart: () => Promise<void>;
  onCopy?: (value: string) => void | Promise<void>;
  /** Opens the sign-in address in the person's browser (the app's own gate to the system browser); false when it cannot. */
  onOpenUrl?: (url: string) => Promise<boolean>;
  locale?: Locale;
}

/** A Codex device code is good for 15 minutes from the moment it is shown. */
export const DEVICE_CODE_LIFETIME_MS = 15 * 60 * 1_000;
/** Without a code or an address for this long, the screen says what the person can do (it always has «Cancel»). */
export const NO_REQUEST_HINT_AFTER_MS = 20_000;

export function formatOAuthLoginElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(milliseconds) ? milliseconds / 1_000 : 0));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function OAuthLoginTakeover({
  provider,
  providerName,
  actions,
  verifying = false,
  connectionState,
  elapsedMs,
  safeErrorMessage,
  onSubmitInput,
  onCancel,
  onRestart,
  onCopy,
  onOpenUrl = openExternalUrl,
  locale,
}: OAuthLoginTakeoverProps) {
  const t = TAKEOVER_TEXT[locale ?? appLocale()];
  const titleId = useId();
  const instructionId = useId();
  const inputId = useId();
  const inputDescriptionId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);
  const waitingRef = useRef<HTMLParagraphElement>(null);
  const initialFocusHandledRef = useRef(false);
  const [input, setInput] = useState("");
  const [pendingAction, setPendingAction] = useState<"input" | "cancel" | "restart" | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  // when the device code appeared, on the screen's own clock (`elapsedMs`): its 15 minutes run from there
  const codeShownAtRef = useRef<{ code: string; at: number } | null>(null);
  const urlAction = actions.find((action) => action.kind === "url");
  const codeAction = actions.find((action) => action.kind === "code");
  const inputAction = actions.find((action) => action.kind === "input");
  const inputRequest = inputAction?.kind === "input" ? inputAction.inputRequest : undefined;
  const safeUrl = urlAction?.kind === "url"
    ? canonicalProviderLoginUrl(provider, urlAction.safeUrl)
    : null;
  const invalidUrl = urlAction?.kind === "url" && safeUrl === null;
  const connected = connectionState === "connected";
  const pending = pendingAction !== null;
  const deviceCode = codeAction?.kind === "code" ? codeAction.userCode : null;
  if (deviceCode === null) codeShownAtRef.current = null;
  else if (codeShownAtRef.current?.code !== deviceCode) codeShownAtRef.current = { code: deviceCode, at: elapsedMs };
  const codeLeftMs = codeShownAtRef.current ? DEVICE_CODE_LIFETIME_MS - (elapsedMs - codeShownAtRef.current.at) : null;
  const codeExpired = codeLeftMs !== null && codeLeftMs <= 0;
  const noRequestYet = actions.length === 0 && !verifying && elapsedMs >= NO_REQUEST_HINT_AFTER_MS;

  useEffect(() => {
    setInput("");
    setOperationError(null);
    if (inputRequest) inputRef.current?.focus();
  }, [inputRequest?.id]);

  useEffect(() => {
    if (initialFocusHandledRef.current) return;
    initialFocusHandledRef.current = true;
    if (!inputRequest) titleRef.current?.focus();
  }, [inputRequest]);

  useEffect(() => {
    if (verifying) waitingRef.current?.focus();
  }, [verifying]);

  useEffect(() => {
    if (codeAction?.kind === "code" && !inputRequest && !invalidUrl) codeRef.current?.focus();
  }, [codeAction?.kind === "code" ? codeAction.userCode : null, inputRequest?.id, invalidUrl]);

  async function copy(value: string) {
    setCopyFeedback(null);
    try {
      if (onCopy) await onCopy(value);
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else throw new Error("clipboard_unavailable");
      setCopyFeedback(t.copied);
    } catch {
      setCopyFeedback(t.copyFailed);
    }
  }

  async function openInBrowser(url: string) {
    setCopyFeedback(null);
    let opened = false;
    try {
      opened = await onOpenUrl(url);
    } catch {
      opened = false;
    }
    if (!opened) setCopyFeedback(t.openFailed);
  }

  async function invoke(kind: "input" | "cancel" | "restart", callback: () => Promise<void>) {
    if (pending) return false;
    setPendingAction(kind);
    setOperationError(null);
    try {
      await callback();
      return true;
    } catch {
      setOperationError(
        kind === "input"
          ? t.errorInput
          : kind === "cancel"
            ? t.errorCancel
            : t.errorRestart,
      );
      return false;
    } finally {
      setPendingAction(null);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = input.trim();
    if (!inputRequest || !connected || !value || pending) return;
    if (await invoke("input", () => onSubmitInput(value))) setInput("");
  }

  const elapsed = formatOAuthLoginElapsed(elapsedMs);
  const codeLeft = codeLeftMs !== null && codeLeftMs > 0 ? formatOAuthLoginElapsed(codeLeftMs) : null;
  const elapsedSeconds = Math.max(0, Math.floor(Number.isFinite(elapsedMs) ? elapsedMs / 1_000 : 0));

  return (
    <section
      className="oauth-login-takeover"
      aria-labelledby={titleId}
      aria-describedby={instructionId}
      aria-busy={pending}
    >
      <header className="oauth-login-takeover__header">
        <div>
          <p className="oauth-login-takeover__eyebrow">{t.eyebrow}</p>
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>{t.title(providerName)}</h2>
        </div>
        <div className={`oauth-login-takeover__connection is-${connectionState}`}>
          <span aria-hidden="true" />
          <strong role="status" aria-live="polite" aria-atomic="true">{t[connectionState]}</strong>
          <time dateTime={`PT${elapsedSeconds}S`} aria-label={t.elapsed(elapsed)}>{elapsed}</time>
        </div>
      </header>

      <p
        id={instructionId}
        ref={waitingRef}
        className="oauth-login-takeover__instruction"
        role={verifying ? "status" : undefined}
        aria-live={verifying ? "polite" : undefined}
        aria-atomic={verifying ? "true" : undefined}
        tabIndex={verifying ? -1 : undefined}
      >
        {invalidUrl
          ? t.invalidUrlInstruction
          : verifying
          ? t.verifying
          : inputAction?.instruction ?? codeAction?.instruction ?? urlAction?.instruction ?? (noRequestYet ? t.waitingLong : t.waiting)}
      </p>

      {!invalidUrl && (safeUrl || codeAction) && (
        <dl className="oauth-login-takeover__copy-grid">
          {safeUrl && (
            <div>
              <dt>{t.urlTitle}</dt>
              <dd><code>{safeUrl}</code></dd>
              <button type="button" onClick={() => void copy(safeUrl)}>{t.copyUrl}</button>
              <button type="button" data-testid="oauth-open-browser" onClick={() => void openInBrowser(safeUrl)} disabled={codeExpired}>{t.openBrowser}</button>
            </div>
          )}
          {codeAction?.kind === "code" && (
            <div ref={codeRef} role="status" aria-live="polite" aria-atomic="true" tabIndex={-1}>
              <dt>{t.codeTitle}</dt>
              <dd><code style={codeExpired ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>{codeAction.userCode}</code></dd>
              <button type="button" onClick={() => void copy(codeAction.userCode)} disabled={codeExpired}>{t.copyCode}</button>
              {codeLeft && <p data-testid="oauth-code-expiry" className="oauth-login-takeover__copy-feedback">{t.expiresIn(codeLeft)}</p>}
            </div>
          )}
        </dl>
      )}

      {!invalidUrl && inputRequest && (
        <form className="oauth-login-takeover__input" onSubmit={(event) => void submit(event)}>
          <label htmlFor={inputId}>{inputRequest.label}</label>
          {inputRequest.description && <p id={inputDescriptionId}>{inputRequest.description}</p>}
          <div>
            <input
              ref={inputRef}
              id={inputId}
              type={inputRequest.secret ? "password" : "text"}
              inputMode={inputRequest.inputMode}
              autoComplete={inputRequest.secret ? "one-time-code" : "off"}
              spellCheck={false}
              value={input}
              onChange={(event) => { setOperationError(null); setInput(event.target.value); }}
              aria-describedby={inputRequest.description ? inputDescriptionId : undefined}
              disabled={!connected || pending}
              autoFocus
            />
            <button type="submit" disabled={!connected || pending || !input.trim()}>
              {pendingAction === "input" ? t.submitting : (inputRequest.submitLabel ?? t.submit)}
            </button>
          </div>
        </form>
      )}

      {(invalidUrl || safeErrorMessage || operationError || codeExpired) && (
        <p className="oauth-login-takeover__error" role="alert" data-testid="oauth-login-error">
          {invalidUrl
            ? t.invalidUrlError
            : operationError ?? safeErrorMessage ?? t.expired}
        </p>
      )}
      <p className="oauth-login-takeover__copy-feedback" role="status" aria-live="polite">{copyFeedback}</p>

      <footer className="oauth-login-takeover__controls">
        <p>{t.footer}</p>
        <div>
          <button type="button" className="oauth-login-takeover__cancel" onClick={() => void invoke("cancel", onCancel)} disabled={pending}>
            {pendingAction === "cancel" ? t.cancelling : t.cancel}
          </button>
          <button type="button" className="oauth-login-takeover__restart" onClick={() => void invoke("restart", onRestart)} disabled={pending}>
            {pendingAction === "restart" ? t.restarting : t.restart}
          </button>
        </div>
      </footer>
    </section>
  );
}
