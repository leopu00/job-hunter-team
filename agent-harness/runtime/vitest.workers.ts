/**
 * How many test workers vitest 2 may start at once.
 *
 * Vitest 2.1.x does not read VITEST_MAX_WORKERS (the variable the shared build queue sets): it starts about one worker
 * per core, and each worker of this suite weighs around 2 GB, so on a laptop a plain `vitest run` fills the memory.
 * The cap is set in the config instead: the number in VITEST_MAX_WORKERS when it is a positive integer, else the one
 * in VITEST_MAX_FORKS / VITEST_MAX_THREADS, else half of the cores and at most four.
 */
export const DEFAULT_MAX_WORKERS = 4;

function positiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value.trim())) return undefined;
  const number = Number(value.trim());
  return number >= 1 ? number : undefined;
}

export function maxWorkers(env: Record<string, string | undefined>, cores: number): number {
  const asked =
    positiveInteger(env["VITEST_MAX_WORKERS"]) ??
    positiveInteger(env["VITEST_MAX_FORKS"]) ??
    positiveInteger(env["VITEST_MAX_THREADS"]);
  if (asked !== undefined) return asked;
  return Math.max(1, Math.min(DEFAULT_MAX_WORKERS, Math.floor(cores / 2)));
}
