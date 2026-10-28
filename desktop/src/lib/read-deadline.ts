/**
 * How long a page waits for its data before it says it could not read it. A read that never
 * answers (a host that takes the connection and says nothing, a lock that is never released)
 * must end in a message with a way to try again, never in a loading skeleton that stays.
 */
export const PAGE_READ_DEADLINE_MS = 25_000;

/**
 * How long a read that was not answered still counts as running. A host that takes the connection and
 * says nothing never ends the read, and asking again must not wait for ever for it: past this time a
 * new ask starts a new read.
 */
export const READ_IN_FLIGHT_MAX_MS = 60_000;

const running = new Map<string, { read: Promise<unknown>; since: number }>();

/**
 * Starts a read unless one with the same key is still running, and then waits for that one. A read
 * that outlives its deadline is not cancelled (the answer of a host over ssh cannot be taken back),
 * so asking again while it runs must not start a second one beside it: on a VPS two readers at once
 * are what the host refuses. The page says it could not read and the new ask waits for the same
 * answer; when it ends, or after `READ_IN_FLIGHT_MAX_MS`, the next ask starts a new read. The key
 * names what is read and for whom (the page and the filters that change the data).
 */
export function readOnce<T>(key: string, start: () => Promise<T>): Promise<T> {
  const current = running.get(key);
  if (current && Date.now() - current.since < READ_IN_FLIGHT_MAX_MS) return current.read as Promise<T>;
  // started at once, as a call to the loader was before: only a loader that throws becomes a failed read
  let started: Promise<T>;
  try {
    started = start();
  } catch (error) {
    started = Promise.reject(error);
  }
  const read: Promise<T> = started.finally(() => {
    if (running.get(key)?.read === read) running.delete(key);
  });
  running.set(key, { read, since: Date.now() });
  return read;
}

/**
 * Forgets the reads that are running, so none of them is waited for again. For the end of an
 * account's session: the next account's page must never wait for a read the last one started.
 */
export function forgetReadsInFlight(): void {
  running.clear();
}

export class ReadDeadlineError extends Error {
  constructor() {
    super("page_read_deadline");
  }
}

export function withReadDeadline<T>(work: Promise<T>, ms: number = PAGE_READ_DEADLINE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ReadDeadlineError()), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}
