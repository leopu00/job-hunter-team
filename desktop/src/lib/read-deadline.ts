/**
 * How long a page waits for its data before it says it could not read it. A read that never
 * answers (a host that takes the connection and says nothing, a lock that is never released)
 * must end in a message with a way to try again, never in a loading skeleton that stays.
 */
export const PAGE_READ_DEADLINE_MS = 25_000;

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
