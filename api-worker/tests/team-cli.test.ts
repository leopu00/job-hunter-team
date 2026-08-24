import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("API team CLI", () => {
  it("prints a privacy-safe collaboration summary", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "jht-team-cli-"));
    const { stdout, stderr } = await run(
      process.execPath,
      ["--import", "tsx", "src/team-cli.ts", "--workspace", workspace],
      { cwd: packageRoot },
    );
    const result = JSON.parse(stdout) as {
      ok: boolean;
      summary: { scored: number; reviewed: number };
      timeline: Array<{ from: string | null; to: string | null }>;
    };

    expect(stderr).not.toContain("TEAM_CLI_FAILED");
    expect(result).toMatchObject({
      ok: true,
      summary: { scored: 5, reviewed: 2 },
    });
    expect(
      result.timeline.some(
        (event) => event.from === "scout" && event.to === "analyst",
      ),
    ).toBe(true);
    expect(
      result.timeline.some(
        (event) => event.from === "writer" && event.to === "critic",
      ),
    ).toBe(true);
    expect(stdout).not.toContain("candidate@example.invalid");
    expect(stdout).not.toContain("Synthetic Candidate");
  }, 60_000);
});
