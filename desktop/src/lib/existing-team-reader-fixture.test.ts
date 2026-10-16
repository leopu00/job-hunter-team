// @vitest-environment node
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { readerOnDatabase, readerOnProfile } from "./existing-team-reader-fixture";

const python = spawnSync("python3", ["-I", "-c", "pass"]);
const available = python.status === 0;

const SOURCE = "DB='file:/jht_home/jobs.db?mode=ro'; PROFILE_DIR='/jht_home/profile'; print(PROFILE_DIR)";
// The shape of a Windows runner's temp folder: \U and \x are the Python escapes that break.
const WINDOWS_PROFILE = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\jht-core-profile-x1\\p1";

describe("pointing the core's reader at a synthetic folder", () => {
  it("keeps a Windows path with backslashes out of Python's escape syntax", () => {
    const reader = readerOnProfile(SOURCE, WINDOWS_PROFILE);
    expect(reader).toContain(JSON.stringify(WINDOWS_PROFILE));
    expect(reader).not.toContain("/jht_home/profile");
  });

  it("builds a sqlite URI for the database, with no backslash in it", () => {
    // The URI of the same path, whatever the drive: file:///tmp/... here, file:///D:/tmp/... on a Windows runner.
    const database = join(tmpdir(), "with space", "jobs.db");
    const reader = readerOnDatabase(SOURCE, database);
    expect(reader).toContain(JSON.stringify(`${pathToFileURL(database).href}?mode=ro`));
    expect(reader).toContain("%20");
    expect(reader).not.toContain("\\");
    expect(reader).not.toContain("/jht_home/jobs.db");
  });

  it("refuses a source that no longer has the literal, instead of testing the container's path", () => {
    expect(() => readerOnProfile("print(1)", "/tmp/p")).toThrow(/literal not found/);
    expect(() => readerOnDatabase("print(1)", "/tmp/jobs.db")).toThrow(/literal not found/);
  });

  it.skipIf(!available)("hands Python back exactly the path it was given", () => {
    const run = spawnSync("python3", ["-I", "-c", readerOnProfile(SOURCE, WINDOWS_PROFILE)]);
    expect(String(run.stderr)).toBe("");
    expect(run.stdout.toString("utf8").trim()).toBe(WINDOWS_PROFILE);
  });

  it.skipIf(!available)("is what the raw substitution was not: the same path pasted in quotes does not compile", () => {
    const raw = SOURCE.replace("'/jht_home/profile'", `'${WINDOWS_PROFILE}'`);
    const run = spawnSync("python3", ["-I", "-c", raw]);
    expect(run.status).not.toBe(0);
    expect(String(run.stderr)).toMatch(/SyntaxError/);
  });
});
