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

/** Esito terminale già pubblicato per questa stessa richiesta, se presente. */
export function syncRendezvousTerminal(requestedAt, lastAction, lastActionAt) {
  const status = String(lastAction || '').startsWith('sync:')
    ? String(lastAction).slice('sync:'.length)
    : '';
  if (!OBSERVABLE_STATUSES.has(status)) return null;
  const requested = Date.parse(requestedAt || '');
  const observed = Date.parse(lastActionAt || '');
  return Number.isFinite(requested) && Number.isFinite(observed) && observed >= requested
    ? status
    : null;
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

export const OBSERVABLE_STATUSES = new Set([
  'completed',
  'timeout',
  'push_failed',
  'ack_failed',
]);

/**
 * Comando observed correlabile alla richiesta. Non contiene timestamp: quelli
 * sono proprietà del database/server che applica il CAS, mai del clock VPS.
 */
export function observedSyncOutcome(status, requestedAt) {
  if (!OBSERVABLE_STATUSES.has(status)) return null;
  const requested = Date.parse(requestedAt || '');
  if (!Number.isFinite(requested)) return null;
  return {
    expected_requested_at: requestedAt,
    status,
  };
}

/**
 * Pubblica un esito terminale con compare-and-set sulla richiesta osservata.
 * Esiste un solo proprietario del CAS: l'endpoint HTTP autenticato col token
 * device. Restituisce timestamp creati dal server e `applied=false` quando
 * una richiesta più nuova ha sostituito quella che il box stava servendo.
 */
export async function publishSyncOutcome({
  fetchFn = fetch,
  url,
  token,
  expectedRequestedAt,
  outcomeStatus,
  signal,
}) {
  const command = observedSyncOutcome(outcomeStatus, expectedRequestedAt);
  if (!command) return { status: 'publish_failed', retryable: false };

  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify(command),
    });
    if (res.status === 409) {
      return { status: 'superseded', retryable: false, via: 'http' };
    }
    if (!res.ok) {
      return { status: 'publish_failed', httpStatus: res.status, retryable: res.status >= 500 };
    }
    const result = await res.json().catch(() => null);
    if (result?.applied !== true || result?.status !== outcomeStatus) {
      return { status: 'publish_failed', retryable: true };
    }
    return {
      status: 'published',
      outcomeStatus,
      syncCompletedAt: result.sync_completed_at ?? null,
      lastActionAt: result.last_action_at ?? null,
      via: 'http',
    };
  } catch (error) {
    return { status: timeoutFailure(error) ? 'timeout' : 'publish_failed', retryable: true };
  }
}

/** ACK di successo: wrapper compatto sul publisher CAS comune. */
export async function acknowledgeSync(options) {
  const result = await publishSyncOutcome({ ...options, outcomeStatus: 'completed' });
  if (result.status === 'published') {
    return {
      status: 'completed',
      completedAt: result.syncCompletedAt,
      via: result.via,
    };
  }
  if (result.status === 'superseded') return result;
  if (result.status === 'timeout') return result;
  return {
    status: 'ack_failed',
    ...(result.httpStatus ? { httpStatus: result.httpStatus } : {}),
    retryable: result.retryable !== false,
  };
}
