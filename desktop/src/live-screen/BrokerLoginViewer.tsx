import { useCallback, useEffect, useRef, useState } from "react";
import {
  brokerLoginStatus,
  brokerLoginViewSession,
  closeBrokerLoginView,
  type BrokerLoginStatus,
  type BrokerViewSession,
} from "../lib/broker-login";
import { describeError, errorCodeOf } from "../lib/error-catalog";
import { createRfb, type ConnectionFactory, type ScreenConnection } from "./LiveScreenViewer";

/** RFB (noVNC) with the input side the login needs. */
interface InteractiveConnection extends ScreenConnection {
  focusOnClick?: boolean;
  focus?: () => void;
}

type ViewerState =
  | { phase: "connecting" }
  | { phase: "live" }
  | { phase: "checking" }
  | { phase: "done" }
  | { phase: "ended"; message: string };

/** After a finished login the window stays this long, then closes by itself. */
export const DONE_CLOSE_MS = 2500;

const ENDED_CODES = new Set(["token_expired", "login_timeout"]);

function failureMessage(error: unknown): string {
  const described = describeError(errorCodeOf(error), { fallback: "view_unavailable" });
  return `${described.text} ${described.action}`;
}

function endedMessage(status: BrokerLoginStatus | null): string {
  const reason = status?.lastReason;
  if (reason && ENDED_CODES.has(reason)) return failureMessage(reason);
  return "La sessione di accesso si è chiusa. Per riprovare, apri di nuovo «Accedi a LinkedIn».";
}

/**
 * The interactive view of the broker's screen, for the LinkedIn login. The
 * token is single-use: the window asks for it once and never reconnects with
 * it. When the connection ends, the broker's status says why; a finished
 * login closes the window, anything else stays on screen with its reason.
 * Nothing of the screen is kept: noVNC draws to a canvas, nothing else.
 */
export function BrokerLoginViewer({
  loadSession = brokerLoginViewSession,
  loadStatus = brokerLoginStatus,
  close = closeBrokerLoginView,
  connect = createRfb,
}: {
  loadSession?: () => Promise<BrokerViewSession>;
  loadStatus?: () => Promise<BrokerLoginStatus>;
  close?: () => Promise<void>;
  connect?: ConnectionFactory;
}) {
  const screenRef = useRef<HTMLDivElement>(null);
  const connectionRef = useRef<InteractiveConnection | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  const [state, setState] = useState<ViewerState>({ phase: "connecting" });

  const finish = useCallback(async () => {
    if (!aliveRef.current) return;
    setState({ phase: "checking" });
    let status: BrokerLoginStatus | null = null;
    try {
      status = await loadStatus();
    } catch {
      status = null;
    }
    if (!aliveRef.current) return;
    if (status?.linkedin === "logged_in" || status?.lastReason === "logged_in") {
      setState({ phase: "done" });
      closeTimerRef.current = setTimeout(() => void close().catch(() => undefined), DONE_CLOSE_MS);
      return;
    }
    setState({ phase: "ended", message: endedMessage(status) });
  }, [close, loadStatus]);

  useEffect(() => {
    aliveRef.current = true;
    void (async () => {
      if (!screenRef.current) return;
      let session: BrokerViewSession;
      try {
        session = await loadSession();
      } catch (error) {
        if (aliveRef.current) setState({ phase: "ended", message: failureMessage(error) });
        return;
      }
      let connection: InteractiveConnection;
      try {
        connection = (await connect(screenRef.current!, session.url, { shared: true })) as InteractiveConnection;
      } catch {
        if (aliveRef.current) setState({ phase: "ended", message: failureMessage("view_unavailable") });
        return;
      }
      if (!aliveRef.current) {
        connection.disconnect();
        return;
      }
      // Interactive: keyboard and mouse go to the broker's browser.
      connection.viewOnly = false;
      connection.focusOnClick = true;
      connection.scaleViewport = true;
      connection.resizeSession = false;
      connection.background = "#050605";
      connectionRef.current = connection;
      connection.addEventListener("connect", () => {
        if (!aliveRef.current) return;
        setState({ phase: "live" });
        connection.focus?.();
      });
      connection.addEventListener("disconnect", () => {
        if (connectionRef.current !== connection) return;
        connectionRef.current = null;
        void finish();
      });
    })();
    return () => {
      aliveRef.current = false;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      connectionRef.current?.disconnect();
      connectionRef.current = null;
    };
    // The token is single-use: this runs once per window, never again.
  }, []);

  const live = state.phase === "live";
  const ended = state.phase === "ended";

  return (
    <main className="live-screen">
      <header className="live-screen__bar">
        <span className={`live-screen__dot live-screen__dot--${ended ? "error" : state.phase}`} aria-hidden="true" />
        <strong>Accesso a LinkedIn</strong>
        <span className="live-screen__status" role="status">
          {state.phase === "connecting" && "Collegamento…"}
          {live && "Puoi scrivere · lo schermo è nel broker"}
          {state.phase === "checking" && "Verifica dell’accesso…"}
          {state.phase === "done" && "Accesso fatto"}
          {ended && "Sessione chiusa"}
        </span>
        {ended && (
          <button className="live-screen__retry" type="button" onClick={() => void close().catch(() => undefined)}>
            Chiudi
          </button>
        )}
      </header>
      <div className="live-screen__stage">
        <div
          ref={screenRef}
          className="live-screen__canvas"
          data-testid="live-screen-canvas"
          aria-label="Schermo del browser di accesso a LinkedIn"
        />
        {!live && (
          <p className="live-screen__notice">
            {state.phase === "connecting" && "Mi collego allo schermo di accesso…"}
            {state.phase === "checking" && "Lo schermo si è chiuso. Controllo se l’accesso è riuscito…"}
            {state.phase === "done" && "Accesso a LinkedIn fatto. La finestra si chiude da sola."}
            {ended && state.message}
          </p>
        )}
      </div>
    </main>
  );
}
