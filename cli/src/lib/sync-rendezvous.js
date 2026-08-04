/**
 * Contratto puro del rendezvous "Sync now". Vive fuori dal comando CLI per
 * poter collaudare timestamp, ACK HTTP e timeout senza una VPS o credenziali.
 */

export function syncRendezvousPending(requestedAt, completedAt) {
  if (!requestedAt) return false;
  const requested = Date.parse(requestedAt);
  const completed = Date.parse(completedAt || '');
  if (!Number.isFinite(requested)) return false;
  return !Number.isFinite(completed) || requested > completed;
}

export function timeoutFailure(error) {
  const name = String(error?.name || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  return name.includes('timeout') || name === 'aborterror' || code === 'etimedout';
}

export function pushRendezvousOutcome(pushResult) {
  if (pushResult?.ok === true && Number(pushResult?.skipped || 0) === 0) {
    return { status: 'ready_to_ack' };
  }
  return {
    status: pushResult?.timedOut === true ? 'timeout' : 'push_failed',
    retryable: pushResult?.authFailed !== true,
  };
}

const OBSERVABLE_STATUSES = new Set([
  'completed',
  'timeout',
  'push_failed',
  'ack_failed',
]);

/**
 * Stato observed correlabile alla richiesta senza fidarsi dell'orologio VPS:
 * anche se il box fosse indietro, `last_action_at` è almeno request+1ms.
 */
export function observedSyncOutcome(status, requestedAt, now = Date.now()) {
  if (!OBSERVABLE_STATUSES.has(status)) return null;
  const requested = Date.parse(requestedAt || '');
  const at = Number.isFinite(requested) ? Math.max(now, requested + 1) : now;
  return {
    last_action: `sync:${status}`,
    last_action_at: new Date(at).toISOString(),
  };
}

/**
 * Scrive l'ACK e considera successo solo una risposta 2xx. Nessun body o
 * messaggio d'errore viene restituito: l'esito può essere loggato senza
 * trascinare URL, hostname o identificatori infrastrutturali.
 */
export async function acknowledgeSync({
  reader,
  fetchFn = fetch,
  url,
  token,
  completedAt,
  observed = {},
  signal,
}) {
  const fields = { ...observed, sync_completed_at: completedAt };
  if (reader) {
    try {
      await reader.patchTeamState(fields);
      return { status: 'completed', completedAt, via: 'direct' };
    } catch {
      // Il canale diretto è un'ottimizzazione: il token HTTP resta il fallback.
    }
  }

  try {
    const res = await fetchFn(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      return { status: 'ack_failed', httpStatus: res.status, retryable: res.status >= 500 };
    }
    return { status: 'completed', completedAt, via: 'http' };
  } catch (error) {
    return { status: timeoutFailure(error) ? 'timeout' : 'ack_failed', retryable: true };
  }
}
