import { FormEvent, useEffect, useId, useRef, useState } from "react";
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
  providerName: string;
  action: OAuthLoginUserAction | null;
  connectionState: OAuthLoginConnectionState;
  elapsedMs: number;
  safeErrorMessage?: string | null;
  onSubmitInput: (value: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onRestart: () => Promise<void>;
  onCopy?: (value: string) => void | Promise<void>;
}

const CONNECTION_COPY: Record<OAuthLoginConnectionState, string> = {
  connecting: "Connessione in corso",
  connected: "Connesso",
  disconnected: "Connessione interrotta",
};

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
  providerName,
  action,
  connectionState,
  elapsedMs,
  safeErrorMessage,
  onSubmitInput,
  onCancel,
  onRestart,
  onCopy,
}: OAuthLoginTakeoverProps) {
  const titleId = useId();
  const instructionId = useId();
  const inputId = useId();
  const inputDescriptionId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialFocusHandledRef = useRef(false);
  const [input, setInput] = useState("");
  const [pendingAction, setPendingAction] = useState<"input" | "cancel" | "restart" | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const inputRequest = action?.kind === "input" ? action.inputRequest : undefined;
  const connected = connectionState === "connected";
  const pending = pendingAction !== null;

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

  async function copy(value: string, label: string) {
    setCopyFeedback(null);
    try {
      if (onCopy) await onCopy(value);
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else throw new Error("clipboard_unavailable");
      setCopyFeedback(`${label} copiato.`);
    } catch {
      setCopyFeedback(`Copia non riuscita. Seleziona ${label.toLocaleLowerCase("it")} e copialo manualmente.`);
    }
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
          ? "La risposta non è stata inviata. La sessione resta aperta: riprova."
          : kind === "cancel"
            ? "Non sono riuscito ad annullare la sessione. Riprova."
            : "Il riavvio non è partito. Riprova.",
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
          <p className="oauth-login-takeover__eyebrow">Intervento richiesto</p>
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>Completa l’accesso a {providerName}</h2>
        </div>
        <div className={`oauth-login-takeover__connection is-${connectionState}`}>
          <span aria-hidden="true" />
          <strong role="status" aria-live="polite" aria-atomic="true">{CONNECTION_COPY[connectionState]}</strong>
          <time dateTime={`PT${elapsedSeconds}S`} aria-label={`Tempo trascorso ${elapsed}`}>{elapsed}</time>
        </div>
      </header>

      <p id={instructionId} className="oauth-login-takeover__instruction">
        {action?.instruction ?? "Attendo una richiesta verificata dal provider."}
      </p>

      {(action?.kind === "url" || action?.kind === "code") && (
        <dl className="oauth-login-takeover__copy-grid">
          {action.kind === "url" && (
            <div>
              <dt>URL di accesso</dt>
              <dd><code>{action.safeUrl}</code></dd>
              <button type="button" onClick={() => void copy(action.safeUrl!, "URL")}>Copia URL</button>
            </div>
          )}
          {action.kind === "code" && (
            <div>
              <dt>Codice temporaneo</dt>
              <dd><code>{action.userCode}</code></dd>
              <button type="button" onClick={() => void copy(action.userCode!, "Codice")}>Copia codice</button>
            </div>
          )}
        </dl>
      )}

      {inputRequest && (
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
              {pendingAction === "input" ? "Invio…" : (inputRequest.submitLabel ?? "Invia risposta")}
            </button>
          </div>
        </form>
      )}

      {(safeErrorMessage || operationError) && (
        <p className="oauth-login-takeover__error" role="alert">{operationError ?? safeErrorMessage}</p>
      )}
      <p className="oauth-login-takeover__copy-feedback" role="status" aria-live="polite">{copyFeedback}</p>

      <footer className="oauth-login-takeover__controls">
        <p>Nessun dato del terminale viene salvato in questa schermata.</p>
        <div>
          <button type="button" className="oauth-login-takeover__cancel" onClick={() => void invoke("cancel", onCancel)} disabled={pending}>
            {pendingAction === "cancel" ? "Annullamento…" : "Annulla"}
          </button>
          <button type="button" className="oauth-login-takeover__restart" onClick={() => void invoke("restart", onRestart)} disabled={pending}>
            {pendingAction === "restart" ? "Riavvio…" : "Riavvia accesso"}
          </button>
        </div>
      </footer>
    </section>
  );
}
