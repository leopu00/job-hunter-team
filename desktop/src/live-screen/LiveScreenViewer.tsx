import { useCallback, useEffect, useRef, useState } from "react";
import type { RfbOptions } from "@novnc/novnc";
import {
  isLiveScreenError,
  liveScreenSession,
  type LiveScreenSession,
} from "../lib/live-screen";

/** Il sottoinsieme di RFB (noVNC) che il viewer tocca: iniettabile nei test. */
export interface ScreenConnection extends EventTarget {
  viewOnly: boolean;
  scaleViewport: boolean;
  resizeSession: boolean;
  background: string;
  disconnect(): void;
}

export type ConnectionFactory = (
  target: HTMLElement,
  url: string,
  options: RfbOptions,
) => Promise<ScreenConnection>;

type ViewerState =
  | { phase: "connecting" }
  | { phase: "live" }
  | { phase: "waiting"; reason: "not_running" | "disconnected" | "rejected" }
  | { phase: "error"; message: string };

// Il container riparte, lo schermo si riaccende, la password cambia: il
// viewer riprova da solo invece di chiedere all'utente di riaprire la finestra.
export const RETRY_DELAY_MS = 3000;

const createRfb: ConnectionFactory = async (target, url, options) => {
  const { default: RFB } = await import("@novnc/novnc");
  return new RFB(target, url, options);
};

const WAITING_COPY: Record<"not_running" | "disconnected" | "rejected", string> = {
  not_running:
    "Lo schermo del CLOSER non è acceso. Avvia il container jht: la finestra si collega da sola.",
  disconnected: "Collegamento interrotto. Nuovo tentativo tra pochi secondi…",
  rejected: "Lo schermo si è riavviato con una nuova chiave. Mi ricollego…",
};

function errorMessage(error: unknown): string {
  if (isLiveScreenError(error)) {
    switch (error.code) {
      case "invalid_port":
        return "JHT_LIVE_SCREEN_PORT non è una porta valida (1024-65535).";
      case "invalid_password":
        return "Il file della chiave dello schermo è danneggiato o non è un file regolare.";
      case "home_missing":
        return "Non trovo la cartella ~/.jht di questo utente.";
      default:
        return "Impossibile collegarsi allo schermo del CLOSER.";
    }
  }
  return "Impossibile collegarsi allo schermo del CLOSER.";
}

export function LiveScreenViewer({
  loadSession = liveScreenSession,
  connect = createRfb,
}: {
  loadSession?: () => Promise<LiveScreenSession>;
  connect?: ConnectionFactory;
}) {
  const screenRef = useRef<HTMLDivElement>(null);
  const connectionRef = useRef<ScreenConnection | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  const [state, setState] = useState<ViewerState>({ phase: "connecting" });

  const scheduleRetry = useCallback((run: () => void) => {
    if (retryRef.current) clearTimeout(retryRef.current);
    retryRef.current = setTimeout(run, RETRY_DELAY_MS);
  }, []);

  const start = useCallback(async () => {
    if (!aliveRef.current || !screenRef.current) return;
    connectionRef.current?.disconnect();
    connectionRef.current = null;
    setState({ phase: "connecting" });

    let session: LiveScreenSession;
    try {
      session = await loadSession();
    } catch (error) {
      if (!aliveRef.current) return;
      if (isLiveScreenError(error) && error.code === "screen_not_running") {
        setState({ phase: "waiting", reason: "not_running" });
        scheduleRetry(() => void start());
      } else {
        setState({ phase: "error", message: errorMessage(error) });
      }
      return;
    }

    let connection: ScreenConnection;
    try {
      connection = await connect(screenRef.current, session.url, {
        credentials: { password: session.password },
        shared: true,
      });
    } catch {
      if (!aliveRef.current) return;
      setState({ phase: "waiting", reason: "disconnected" });
      scheduleRetry(() => void start());
      return;
    }
    if (!aliveRef.current) {
      connection.disconnect();
      return;
    }

    // Sola visione anche lato client: il server rifiuta già l'input
    // (x11vnc -viewonly), qui evitiamo che mouse e tastiera ci provino.
    connection.viewOnly = true;
    connection.scaleViewport = true;
    connection.resizeSession = false;
    connection.background = "#050605";
    connectionRef.current = connection;

    let rejected = false;
    connection.addEventListener("connect", () => {
      if (aliveRef.current) setState({ phase: "live" });
    });
    connection.addEventListener("securityfailure", () => {
      rejected = true;
    });
    connection.addEventListener("disconnect", () => {
      if (!aliveRef.current || connectionRef.current !== connection) return;
      connectionRef.current = null;
      setState({ phase: "waiting", reason: rejected ? "rejected" : "disconnected" });
      scheduleRetry(() => void start());
    });
  }, [connect, loadSession, scheduleRetry]);

  useEffect(() => {
    aliveRef.current = true;
    void start();
    return () => {
      aliveRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      connectionRef.current?.disconnect();
      connectionRef.current = null;
    };
  }, [start]);

  const live = state.phase === "live";

  return (
    <main className="live-screen">
      <header className="live-screen__bar">
        <span className={`live-screen__dot live-screen__dot--${state.phase}`} aria-hidden="true" />
        <strong>Schermo del CLOSER</strong>
        <span className="live-screen__status" role="status">
          {state.phase === "connecting" && "Collegamento…"}
          {live && "In diretta · sola visione"}
          {state.phase === "waiting" && "In attesa"}
          {state.phase === "error" && "Errore"}
        </span>
        {state.phase === "error" && (
          <button className="live-screen__retry" type="button" onClick={() => void start()}>
            Riprova
          </button>
        )}
      </header>
      <div className="live-screen__stage">
        {/* Mai nascosto: noVNC misura il contenitore per scalare lo schermo, e
            un elemento display:none misura zero. L'avviso gli sta sopra. */}
        <div
          ref={screenRef}
          className="live-screen__canvas"
          data-testid="live-screen-canvas"
          aria-label="Schermo del browser del CLOSER"
        />
        {!live && (
          <p className="live-screen__notice">
            {state.phase === "connecting" && "Mi collego allo schermo del container…"}
            {state.phase === "waiting" && WAITING_COPY[state.reason]}
            {state.phase === "error" && state.message}
          </p>
        )}
      </div>
    </main>
  );
}
