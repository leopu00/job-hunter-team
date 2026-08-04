/**
 * Osservazione client del rendezvous "Sync now".
 *
 * Realtime resta il percorso veloce, ma non e' una conferma affidabile da
 * solo: un websocket puo' perdere l'UPDATE mentre la VPS completa davvero
 * il push. In quel caso un reload vedeva `sync_completed_at`, mentre la
 * pagina aperta aspettava fino al falso timeout. Questo poller e' volutamente
 * bounded e vive solo durante una richiesta esplicita dell'utente.
 */

export function timestampAdvanced(
  candidate: string | null | undefined,
  baseline: string | null | undefined,
): boolean {
  if (!candidate) return false;
  const candidateMs = Date.parse(candidate);
  if (Number.isNaN(candidateMs)) return false;
  if (!baseline) return true;
  const baselineMs = Date.parse(baseline);
  return Number.isNaN(baselineMs) || candidateMs > baselineMs;
}

export type SyncFailureStatus = "timeout" | "push_failed" | "ack_failed";

export interface SyncObservation {
  completedAt: string | null;
  lastAction: string | null;
  lastActionAt: string | null;
}

export type SyncTerminalOutcome =
  | { status: "completed"; completedAt: string }
  | { status: SyncFailureStatus };

/**
 * Interpreta solo esiti appartenenti alla richiesta corrente. `last_action`
 * e' condiviso con altri comandi: action e timestamp devono quindi essere
 * entrambi quelli del rendezvous sync appena aperto.
 */
export function syncTerminalOutcome(
  observation: SyncObservation,
  baselineCompletion: string | null,
  requestedAt: string | null,
): SyncTerminalOutcome | null {
  if (timestampAdvanced(observation.completedAt, baselineCompletion)) {
    return { status: "completed", completedAt: observation.completedAt! };
  }

  if (!requestedAt || !observation.lastActionAt) return null;
  const requestedMs = Date.parse(requestedAt);
  const actionMs = Date.parse(observation.lastActionAt);
  if (
    Number.isNaN(requestedMs) ||
    Number.isNaN(actionMs) ||
    actionMs <= requestedMs
  )
    return null;
  const action = observation.lastAction;
  // La VPS puo' completare mentre la PATCH che apre il rendezvous sta ancora
  // tornando al browser. In quel caso la risposta contiene gia' il nuovo
  // completion e il client lo adotta come baseline: l'action atomica e
  // correlata evita di attendere un secondo avanzamento che non arrivera'.
  if (
    action === "sync:completed" &&
    observation.completedAt &&
    !Number.isNaN(Date.parse(observation.completedAt))
  )
    return { status: "completed", completedAt: observation.completedAt };
  if (action === "sync:timeout") return { status: "timeout" };
  if (action === "sync:push_failed") return { status: "push_failed" };
  if (action === "sync:ack_failed") return { status: "ack_failed" };
  return null;
}

interface WaitForSyncOutcomeOptions {
  baselineCompletion: string | null;
  requestedAt: string | null;
  readObservation: () => Promise<SyncObservation>;
  isCancelled?: () => boolean;
  intervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Ritorna il primo completion timestamp successivo alla baseline, oppure
 * null a timeout/cancellazione. Gli errori di una singola lettura sono
 * gestiti dal chiamante come `null`: una rete intermittente non deve
 * trasformare un sync riuscito in errore al primo pacchetto perso.
 */
export async function waitForSyncOutcome({
  baselineCompletion,
  requestedAt,
  readObservation,
  isCancelled = () => false,
  intervalMs = 1_000,
  timeoutMs = 180_000,
  now = Date.now,
  sleep = defaultSleep,
}: WaitForSyncOutcomeOptions): Promise<SyncTerminalOutcome | null> {
  const deadline = now() + timeoutMs;

  while (!isCancelled()) {
    const outcome = syncTerminalOutcome(
      await readObservation(),
      baselineCompletion,
      requestedAt,
    );
    if (outcome) return outcome;
    // Realtime puo' chiudere la richiesta mentre la GET e' in volo: non
    // lasciare un timer orfano prima di osservare di nuovo la cancellazione.
    if (isCancelled()) return null;

    const remaining = deadline - now();
    if (remaining <= 0) return null;
    await sleep(Math.min(intervalMs, remaining));
  }

  return null;
}
