/**
 * Every test file starts with JHT_HOME in a folder of its own.
 *
 * Several modules of the CLI work out their paths from JHT_HOME (or ~/.jht) when they are imported, so a test that
 * sets it afterwards is too late: the first of them to run on a Mac or a CI user wrote `.team-halted.flag` in the
 * real ~/.jht (team-state-guard: a fake `jht team stop` that works), which stops the team of the person at the
 * next boot, and a fake start took away the Stop of the person. Set here, before the file imports anything.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// The home is named like the real one (.jht) and does not exist yet, as on a person's computer: tests that look
// for ".jht" in a path, or for a missing home, behave as they always did.
const root = mkdtempSync(join(tmpdir(), "jht-home-sandbox-"));
process.env.JHT_HOME = join(root, ".jht");

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
