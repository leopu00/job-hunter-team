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

/**
 * Scrive l'ACK e considera successo solo una risposta 2xx. Nessun body o
 * messaggio d'errore viene restituito: l'esito può essere loggato senza
 * trascinare URL, hostname o identificatori infrastrutturali.
 */
export async function acknowledgeSync({ reader, fetchFn = fetch, url, token, completedAt, signal }) {
  if (reader) {
    try {
      await reader.patchTeamState({ sync_completed_at: completedAt });
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
      body: JSON.stringify({ sync_completed_at: completedAt }),
    });
    if (!res.ok) {
      return { status: 'ack_failed', httpStatus: res.status, retryable: res.status >= 500 };
    }
    return { status: 'completed', completedAt, via: 'http' };
  } catch (error) {
    return { status: timeoutFailure(error) ? 'timeout' : 'ack_failed', retryable: true };
  }
}
