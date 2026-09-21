import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { SyntheticJobSource, syntheticCatalogueNow } from "../src/tools.js";

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
    const progress = stderr
      .split(/\r?\n/)
      .filter((line) => line.startsWith("JHT_TEAM_PROGRESS:"))
      .map(
        (line) =>
          JSON.parse(line.slice("JHT_TEAM_PROGRESS:".length)) as {
            role: string;
            status: string;
          },
      );
    expect(progress).toContainEqual(
      expect.objectContaining({ role: "captain", status: "working" }),
    );
    expect(progress).toContainEqual(
      expect.objectContaining({ role: "sentinel", status: "completed" }),
    );
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

/**
 * The offline run must not age. `postedWithinDays` is a sliding window and the
 * fixture's dates are fixed, so a run judged against the wall clock slowly
 * loses its own catalogue: on 20/09 five vacancies were inside the window, on
 * 21/09 three, and `team-cli` failed with TARGET_COUNT_NOT_MET on a repository
 * where nothing about it had changed — while `SyntheticJobSource` had carried a
 * frozen default all along and the CLI overrode it with `new Date()`.
 */
describe("the offline catalogue is read against its own clock", () => {
  it("anchors on the newest posting, whatever day it is read", async () => {
    const jobs = JSON.parse(
      await readFile(
        join(packageRoot, "fixtures", "jobs.synthetic.json"),
        "utf8",
      ),
    ) as Array<{ postedAt: string }>;
    const newest = Math.max(
      ...jobs.map((job) => new Date(job.postedAt).getTime()),
    );

    expect(syntheticCatalogueNow(jobs)().getTime()).toBe(newest);
  });

  it("keeps every vacancy inside the window that the clock would drop", async () => {
    const raw = JSON.parse(
      await readFile(
        join(packageRoot, "fixtures", "jobs.synthetic.json"),
        "utf8",
      ),
    ) as Array<{
      postedAt: string;
      location: string;
      remoteType: string;
      title: string;
    }>;
    const search = {
      targetRole: raw[0]!.title,
      location: raw[0]!.location,
      workMode: raw[0]!.remoteType,
      postedWithinDays: 30,
      limit: 10,
    } as never;

    const anchored = await new SyntheticJobSource(
      raw,
      syntheticCatalogueNow(raw),
    ).search(search);
    // A year after the fixture was written, the wall clock leaves nothing at all.
    const aged = new Date(
      syntheticCatalogueNow(raw)().getTime() + 365 * 86_400_000,
    );
    const stale = await new SyntheticJobSource(raw, () => aged).search(search);

    expect(anchored.jobs.length).toBeGreaterThan(0);
    expect(stale.jobs.length).toBe(0);
  });
});
