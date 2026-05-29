"use client";

import { useCallback, useRef, useState } from "react";

// Stato di una singola esecuzione comando.
//   idle      → mai eseguito o reset
//   posting   → stiamo inviando il POST al backend
//   pending   → riga in team_commands creata, in attesa che subscriber
//               la prenda (polling /api/team/command/[id])
//   running   → subscriber la sta eseguendo (PATCH status=running)
//   done      → terminato OK
//   error     → terminato con errore (vedi `error`)
//   timeout   → polling scaduto (subscriber giù o lentissimo)
//   local     → endpoint ha risposto immediatamente (modalità local
//               desktop: shell exec sincrono, no bus dispatch)
export type TeamCommandState =
  | "idle"
  | "posting"
  | "pending"
  | "running"
  | "done"
  | "error"
  | "timeout"
  | "local";

type Result = {
  state: TeamCommandState;
  message: string | null;
  error: string | null;
  commandId: string | null;
  run: (endpoint: string, init?: RequestInit) => Promise<void>;
  reset: () => void;
};

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;

/**
 * Hook universale per tutti i bottoni che lanciano comandi remoti via
 * team_commands bus. Pattern:
 *
 *   1. POST sull'endpoint (es. /api/assistente/start). Il backend ritorna:
 *      - { ok:true, queued:true, command:{ id, ... } }  → cloud dispatch
 *      - { ok:true, ... }                                → local shell sync
 *      - { ok:false, error: '...' }                      → 4xx/5xx error
 *
 *   2. Se queued: polling GET /api/team/command/[id] ogni 1.5s finché
 *      status diventa 'done' o 'error'. Timeout 60s.
 *
 *   3. Espone state (`idle|posting|pending|running|done|error|timeout|local`)
 *      + message + error per la UI.
 */
export function useTeamCommandPoller(): Result {
  const [state, setState] = useState<TeamCommandState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commandId, setCommandId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState("idle");
    setMessage(null);
    setError(null);
    setCommandId(null);
  }, []);

  const run = useCallback(async (endpoint: string, init?: RequestInit) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState("posting");
    setMessage(null);
    setError(null);
    setCommandId(null);

    let postBody: {
      ok?: boolean;
      queued?: boolean;
      message?: string;
      error?: string;
      command?: { id?: string; status?: string };
    };
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        ...init,
        signal: ctrl.signal,
      });
      postBody = await res.json().catch(() => ({}));
      if (!res.ok || postBody.ok === false) {
        setState("error");
        // Normalizza error a stringa: alcuni server ritornano un oggetto in
        // `error` (es. nested {message,details}) → setError(obj) faceva
        // poi toast(obj) = "[object Object]" nel toast caller. Fix 2026-05-23.
        const errMsg =
          typeof postBody.error === 'string'
            ? postBody.error
            : (postBody.error as { message?: string } | undefined)?.message
              ?? `HTTP ${res.status}`;
        setError(errMsg);
        return;
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setState("error");
      setError(err instanceof Error ? err.message : "errore di rete");
      return;
    }

    // Local mode: backend ha eseguito sincronamente (no queue, no polling).
    if (!postBody.queued || !postBody.command?.id) {
      setState("local");
      setMessage(postBody.message || "Operazione completata");
      return;
    }

    const id = postBody.command.id;
    setCommandId(id);
    setState("pending");
    setMessage(
      postBody.message ||
        "Comando inoltrato alla VPS, attendo conferma…",
    );

    const start = Date.now();
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      if (ctrl.signal.aborted) return;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (ctrl.signal.aborted) return;
      try {
        const res = await fetch(`/api/team/command/${id}`, {
          signal: ctrl.signal,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) continue; // retry, magari deploy in corso
        if (body.status === "running") {
          setState("running");
          continue;
        }
        if (body.status === "done") {
          setState("done");
          setMessage("Operazione completata");
          return;
        }
        if (body.status === "error") {
          setState("error");
          setError(body.error || "Errore sconosciuto dal subscriber VPS");
          return;
        }
        // status='pending' → continua polling
      } catch (err) {
        if (ctrl.signal.aborted) return;
        // network blip: continua, il prossimo tick riprova
      }
    }
    setState("timeout");
    setError(
      "Timeout (60s): il subscriber sulla VPS non ha risposto. Verifica che il container `jht` sia attivo.",
    );
  }, []);

  return { state, message, error, commandId, run, reset };
}
