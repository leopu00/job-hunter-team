/**
 * What `work` gives, or null if it has not given anything in `ms`. The work is not cancelled: its
 * answer is dropped. For a read that decides what the first frame shows, so the page neither waits
 * for ever nor shows a guess it has to take back.
 */
export function waitAtMost<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}
