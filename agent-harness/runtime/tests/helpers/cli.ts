/**
 * What a test that starts the runtime as a PROCESS needs to know.
 *
 * `npm run role` is the product's own entry point, so a handful of tests run
 * it for real: a child `node --experimental-strip-types src/cli/run.ts`, which
 * type-strips the runtime on the fly, lays out an agent's home from a copy of
 * `agents/`, and drives a mock provider for two turns. On an idle machine each
 * takes one to three seconds — comfortably under vitest's 5 s default, and
 * that is the trap: the whole suite runs these in parallel with everything
 * else, and on a loaded machine one of them crosses 5 s and goes red for a
 * reason that has nothing to do with what it checks.
 *
 * It happened on 21/09: `parity-scrittore-run` timed out on the first run of
 * the merged suite and passed twice on its own. A test that passes or fails
 * with the load is a test that will lie one day, in the direction that costs
 * most — a red nobody believes.
 *
 * So these tests carry an explicit timeout, and `test-hygiene.test.ts` refuses
 * a new one that does not. The number is not "big enough to be safe": it is
 * ten times the measured cost, which leaves a hung child process failing the
 * test rather than hanging the suite.
 */
export const CLI_RUN_TIMEOUT_MS = 30_000;
