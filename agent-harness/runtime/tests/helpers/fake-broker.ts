/**
 * The broker's client (`jht-broker`) for tests that go through the runtime's own wiring: no broker
 * runs here, and the gate refuses every position it cannot find in the broker's register. This
 * puts a `jht-broker` in a directory that answers every request with one fixed line, as the real
 * client prints its answer (the first line of stdout, JSON).
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What `apply.check` answers for a position the broker holds. */
export const PROVEN = { ok: true, proven: true, destination: "web:jobs.example", origin: "user_web", instant: "2026-09-20T10:00:00.000Z" };

/** Writes `<dir>/jht-broker`; put `dir` on PATH. `/bin/sh` and `printf` need no PATH of their own. */
export function fakeBroker(dir: string, answer: unknown = PROVEN): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "jht-broker");
  writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(answer)}'\n`, { mode: 0o755 });
  chmodSync(file, 0o755);
  return dir;
}
