import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CandidateProfileSchema,
  JobCatalogSchema,
  StandaloneScout,
  StandaloneScoutDb,
  SyntheticJobSource,
  profileSearchLanes,
  type ScoutCandidateProposal,
} from "../src/index.js";
import { fixtureProfile, loadFixture } from "./helpers.js";

const candidateProfile = CandidateProfileSchema.parse({
  profileVersion: "1",
  targets: {
    roles: ["Platform Engineer", "Backend Engineer"],
    locations: ["Remote EU", "Rome"],
    workModes: ["remote", "hybrid"],
  },
  skills: ["TypeScript", "Node.js"],
  experienceYears: 6,
  languages: ["English C1"],
  workAuthorization: ["European Union"],
  relocation: false,
  search: { postedWithinDays: 7, maxCandidates: 2 },
});

describe("standalone Scout ecosystem", () => {
  it("runs from a profile and persists proposals in its own SQLite database", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "jht-standalone-run-"));
    const jobs = await loadFixture("jobs.synthetic.json");
    const result = await new StandaloneScout({
      agentId: "scout-test",
      workspaceDir,
      candidateProfile,
      modelProfile: await fixtureProfile(),
      source: new SyntheticJobSource(jobs),
    }).runOnce();

    expect(result.coordination.mode).toBe("solo");
    expect(result.worker.ok).toBe(true);
    expect(result.persistence?.inserted).toHaveLength(2);

    const db = new StandaloneScoutDb(result.databasePath);
    const positions = db.listPositions();
    expect(positions).toHaveLength(2);
    expect(positions.every((row) => row.status === "new")).toBe(true);
    expect(positions.every((row) => row.found_by === "scout-test")).toBe(true);
    db.close();
  });

  it("discovers active peers, claims distinct lanes and applies all dedup levels", async () => {
    const root = await mkdtemp(join(tmpdir(), "jht-standalone-db-"));
    const path = join(root, "scout.db");
    const now = () => new Date("2026-08-20T10:00:00.000Z");
    const first = new StandaloneScoutDb(path, now);
    const second = new StandaloneScoutDb(path, now);
    const third = new StandaloneScoutDb(path, now);
    const lanes = profileSearchLanes(candidateProfile);

    expect(first.coordinate("scout-1", "run-1", lanes, 60_000).mode).toBe(
      "solo",
    );
    const coordinatedSecond = second.coordinate(
      "scout-2",
      "run-2",
      lanes,
      60_000,
    );
    const coordinatedThird = third.coordinate(
      "scout-3",
      "run-3",
      lanes,
      60_000,
    );
    expect(coordinatedSecond.mode).toBe("coordinated");
    expect(coordinatedSecond.peers.map((peer) => peer.agentId)).toContain(
      "scout-1",
    );
    expect(coordinatedThird.lane).not.toEqual(coordinatedSecond.lane);

    const [job] = JobCatalogSchema.parse(
      await loadFixture("jobs.synthetic.json"),
    );
    const proposal: ScoutCandidateProposal = {
      ...job,
      matchedCriteria: [],
      disposition: "proposed",
      persistence: "none",
    };
    expect(first.persist("run-1", "scout-1", [proposal]).inserted).toEqual([1]);
    expect(
      first.persist("run-2", "scout-2", [proposal]).skipped[0]?.level,
    ).toBe(1);
    expect(
      first.persist("run-3", "scout-3", [
        {
          ...proposal,
          sourceId: "identity-copy",
          url: "https://example.test/identity-copy",
        },
      ]).skipped[0]?.level,
    ).toBe(2);
    expect(
      first.persist("run-4", "scout-4", [
        {
          ...proposal,
          sourceId: "similar-copy",
          url: "https://example.test/similar-copy",
          title: proposal.title.split(" ").reverse().join(" "),
        },
      ]).skipped[0]?.level,
    ).toBe(3);

    first.close();
    second.close();
    third.close();
  });
});
