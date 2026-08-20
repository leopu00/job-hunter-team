import { describe, expect, it } from "vitest";

import {
  ScoutCandidateProposalSchema,
  ScoutProposalBatchSchema,
  ScoutWorkerErrorSchema,
  ScoutWorkerInputSchema,
  ToolEventSchema,
} from "../src/index.js";
import { fixtureInput, loadFixture } from "./helpers.js";

describe("versioned Scout contracts", () => {
  it("accepts the bounded synthetic input and rejects unknown or oversized data", async () => {
    const input = await fixtureInput();
    expect(ScoutWorkerInputSchema.parse(input).contractVersion).toBe("1");

    expect(
      ScoutWorkerInputSchema.safeParse({ ...input, unexpected: true }).success,
    ).toBe(false);
    expect(
      ScoutWorkerInputSchema.safeParse({
        ...input,
        search: { ...input.search, targetRoles: ["x".repeat(161)] },
      }).success,
    ).toBe(false);
  });

  it("requires complete proposal evidence and proposal-only persistence markers", async () => {
    const jobs = (await loadFixture("jobs.synthetic.json")) as unknown[];
    const first = jobs[0];
    const valid = ScoutCandidateProposalSchema.parse({
      ...(first as object),
      matchedCriteria: ["TypeScript"],
      disposition: "proposed",
      persistence: "none",
    });
    expect(
      ScoutProposalBatchSchema.parse({
        proposals: [valid],
        exhausted: false,
        notes: [],
      }).proposals,
    ).toHaveLength(1);

    expect(
      ScoutCandidateProposalSchema.safeParse({ ...valid, jdText: "too short" })
        .success,
    ).toBe(false);
    expect(
      ScoutCandidateProposalSchema.safeParse({
        ...valid,
        url: "file:///tmp/job",
      }).success,
    ).toBe(false);
    expect(
      ScoutCandidateProposalSchema.safeParse({
        ...valid,
        postedAt: "not-a-timestamp",
      }).success,
    ).toBe(false);
    expect(
      ScoutCandidateProposalSchema.safeParse({
        ...valid,
        persistence: "sqlite",
      }).success,
    ).toBe(false);
  });

  it("validates typed tool events and sanitized public errors", () => {
    expect(
      ToolEventSchema.parse({
        contractVersion: "1",
        event: "tool",
        phase: "completed",
        timestamp: "2026-08-19T10:00:00.000Z",
        runId: "00000000-0000-4000-8000-000000000001",
        toolName: "search_jobs",
        toolCallId: "call-1",
        durationMs: 3,
      }).toolName,
    ).toBe("search_jobs");

    expect(
      ScoutWorkerErrorSchema.safeParse({
        contractVersion: "1",
        role: "scout",
        code: "TOOL_ERROR",
        message: "A safe public message.",
        retryable: false,
        secret: "forbidden-extra-field",
      }).success,
    ).toBe(false);
  });
});
