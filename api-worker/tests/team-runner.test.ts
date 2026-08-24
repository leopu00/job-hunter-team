import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ApiTeamRunner,
  SyntheticJobSource,
  importCandidateProfile2026,
} from "../src/index.js";
import { fixtureProfile, loadFixture } from "./helpers.js";

describe("API team runner", () => {
  it("collaborates to produce five scores and two reviewed CVs", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "jht-api-team-"));
    const rawCandidate = await loadFixture(
      "candidate-profile-2026.synthetic.json",
    );
    const jobs = await loadFixture("jobs.synthetic.json");
    const progress: Array<{
      role: string;
      agentId: string;
      status: string;
      positionTitle?: string;
    }> = [];
    const result = await new ApiTeamRunner({
      workspaceDir,
      candidate: importCandidateProfile2026(rawCandidate),
      modelProfile: await fixtureProfile(),
      source: new SyntheticJobSource(
        jobs,
        () => new Date("2026-08-24T12:00:00Z"),
      ),
      now: () => new Date("2026-08-24T12:00:00Z"),
      budgetUsd: 0,
      onProgress: (event) => progress.push(event),
    }).run();

    expect(result.summary).toMatchObject({
      status: "completed",
      targetScores: 5,
      targetReviews: 2,
      scored: 5,
      reviewed: 2,
      spentUsd: 0,
      reservedUsd: 0,
      states: { reviewed: 2, scored: 3 },
    });
    expect(result.positions).toHaveLength(5);
    expect(result.positions.every((position) => position.score === 88)).toBe(
      true,
    );
    const reviewed = result.positions.filter((position) => position.cvPath);
    expect(reviewed).toHaveLength(2);
    for (const position of reviewed) {
      await access(position.cvPath!);
      expect(await readFile(position.cvPath!, "utf8")).toContain("# ");
      expect(position).toMatchObject({
        state: "reviewed",
        criticScore: 7.4,
        criticVerdict: "revise",
      });
    }
    expect(new Set(result.usage.map((entry) => entry.role))).toEqual(
      new Set([
        "captain",
        "scout",
        "analyst",
        "scorer",
        "writer",
        "critic",
        "sentinel",
      ]),
    );
    expect(
      result.events.filter((event) => event.event === "score_recorded"),
    ).toHaveLength(5);
    expect(
      result.events.filter((event) => event.event === "cv_reviewed"),
    ).toHaveLength(2);
    expect(result.captain.decisions[0]).toMatchObject({
      action: "assign",
      agentId: "scout-1",
    });
    expect(result.sentinel.budgetState).toBe("healthy");
    expect(progress[0]).toMatchObject({
      role: "captain",
      agentId: "captain-1",
      status: "working",
    });
    expect(progress).toContainEqual(
      expect.objectContaining({
        role: "analyst",
        status: "working",
        positionTitle: expect.any(String),
      }),
    );
    expect(progress.at(-1)).toMatchObject({
      role: "sentinel",
      agentId: "sentinel-1",
      status: "completed",
    });
  }, 60_000);
});
