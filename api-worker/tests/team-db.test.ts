import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  API_SCORER_SCALE_VERSION,
  CriticRoleSpec,
  ScorerWorkerInputSchema,
  TeamPipelineDb,
  WriterRoleSpec,
} from "../src/index.js";
import { fixtureAnalystInput, fixtureProfile, loadFixture } from "./helpers.js";

describe("isolated team pipeline database", () => {
  it("coordinates authorized handoffs through score, CV and blind review", async () => {
    const db = await makeDb();
    const analystInput = await fixtureAnalystInput();
    const scorerFixture = (await loadFixture(
      "scorer-input.synthetic.json",
    )) as Record<string, unknown>;
    const analystProposal = scorerFixture["analyst"] as Record<string, unknown>;
    const runId = "12345678-1234-4234-8234-123456789abc";
    try {
      db.createRun({
        runId,
        targetScores: 1,
        targetReviews: 1,
        budgetUsd: 0.05,
      });
      db.ingestScoutProposals(runId, "scout-1", [analystInput.position]);

      const analystClaim = db.claimNext(runId, "analyst", "analyst-1", 0.01)!;
      expect(db.position(runId, analystClaim.sourceId).state).toBe("analysing");
      db.completeAnalyst(analystClaim, analystProposal, accounting(0.001));

      const scorerClaim = db.claimNext(runId, "scorer", "scorer-1", 0.01)!;
      const scorerInput = ScorerWorkerInputSchema.parse({
        contractVersion: "1",
        runId,
        role: "scorer",
        scaleVersion: API_SCORER_SCALE_VERSION,
        scout: analystInput.position,
        analyst: analystProposal,
        candidate: analystInput.candidate,
        authorization: {
          authorizationVersion: "1",
          authorized: true,
          scope: "score_position",
          authorizationId: "score-auth-1",
          sourceId: analystInput.position.sourceId,
          authorizedBy: "captain-1",
          authorizedAt: "2026-08-24T12:00:00.000Z",
        },
        limits: analystInput.limits,
      });
      const scorer = new (
        await import("../src/scorer-worker.js")
      ).ScorerApiWorker(await fixtureProfile(), {
        runtimeDir: await mkdtemp(join(tmpdir(), "jht-team-scorer-")),
      });
      const scorerOutcome = await scorer.run(scorerInput);
      expect(scorerOutcome.ok).toBe(true);
      if (!scorerOutcome.ok) throw new Error("Synthetic scorer failed");
      db.completeScorer(
        scorerClaim,
        scorerOutcome.result.proposal,
        accounting(0.001),
      );

      db.requestCv({
        runId,
        sourceId: analystClaim.sourceId,
        authorizationId: "cv-auth-1",
        authorizedBy: "user-goal",
      });
      const writerClaim = db.claimNext(runId, "writer", "writer-1", 0.01)!;
      const snapshot = db.position(runId, writerClaim.sourceId);
      const writerInput = WriterRoleSpec.inputSchema.parse({
        contractVersion: "1",
        runId,
        role: "writer",
        requestKind: "cv",
        userRequested: true,
        position: {
          sourceId: snapshot.sourceId,
          url: snapshot.scout.url,
          title: snapshot.scout.title,
          company: snapshot.scout.company,
          jdSummary: snapshot.analyst!.jdSummary,
          score: snapshot.scorer!.totalScore,
        },
        candidateEvidence: {
          headline: "Synthetic candidate",
          skills: analystInput.candidate.skills,
          experienceHighlights: ["Verified synthetic experience"],
        },
        limits: analystInput.limits,
      });
      const writerProposal = WriterRoleSpec.outputSchema.parse(
        WriterRoleSpec.buildMockOutput(writerInput),
      );
      db.completeWriter(writerClaim, writerProposal, accounting(0.001));

      const criticClaim = db.claimNext(runId, "critic", "critic-1", 0.01)!;
      const criticInput = CriticRoleSpec.inputSchema.parse({
        contractVersion: "1",
        runId,
        role: "critic",
        sourceId: snapshot.sourceId,
        url: snapshot.scout.url,
        round: 1,
        jobDescription: snapshot.scout.jdText,
        document: { kind: "cv", markdown: writerProposal.markdown },
        limits: analystInput.limits,
      });
      db.completeCritic(
        criticClaim,
        CriticRoleSpec.buildMockOutput(criticInput),
        accounting(0.001),
      );

      expect(db.completeRun(runId)).toMatchObject({
        status: "completed",
        scored: 1,
        reviewed: 1,
        spentUsd: 0.004,
        reservedUsd: 0,
        states: { reviewed: 1 },
      });
      expect(db.listEvents(runId).map((entry) => entry.event)).toEqual([
        "run_started",
        "handoff_queued",
        "task_claimed",
        "handoff_queued",
        "task_completed",
        "task_claimed",
        "score_recorded",
        "task_completed",
        "cv_authorized",
        "task_claimed",
        "handoff_queued",
        "task_completed",
        "task_claimed",
        "cv_reviewed",
        "task_completed",
        "run_completed",
      ]);
      expect(db.position(runId, analystClaim.sourceId)).toMatchObject({
        state: "reviewed",
        scorer: { scaleVersion: API_SCORER_SCALE_VERSION },
        writer: { documentKind: "cv" },
        critic: { verdict: "revise" },
      });
    } finally {
      db.close();
    }
  });

  it("enforces claims, state gates and one shared reservation budget", async () => {
    const db = await makeDb();
    const input = await fixtureAnalystInput();
    const runId = "22345678-1234-4234-8234-123456789abc";
    try {
      db.createRun({
        runId,
        targetScores: 1,
        targetReviews: 0,
        budgetUsd: 0.01,
      });
      db.ingestScoutProposals(runId, "scout-1", [input.position]);
      const claim = db.claimNext(runId, "analyst", "analyst-1", 0.01)!;
      expect(() =>
        db.completeAnalyst(
          { ...claim, token: "00000000-0000-4000-8000-000000000000" },
          {},
        ),
      ).toThrow();
      expect(() => db.claimNext(runId, "analyst", "analyst-2", 0.001)).toThrow(
        "TEAM_BUDGET_EXCEEDED",
      );
      db.releaseClaim(claim, "PROVIDER_ERROR");
      expect(db.summary(runId).reservedUsd).toBe(0);
      expect(db.claimNext(runId, "analyst", "analyst-2", 0.01)).toBeDefined();
    } finally {
      db.close();
    }
  });

  it("accounts coordinating agents against the same team budget", async () => {
    const db = await makeDb();
    const runId = "32345678-1234-4234-8234-123456789abc";
    try {
      db.createRun({
        runId,
        targetScores: 1,
        targetReviews: 0,
        budgetUsd: 0.02,
      });
      const scout = db.reserveAgentRun(runId, "scout", "scout-1", 0.015);
      expect(() =>
        db.reserveAgentRun(runId, "captain", "captain-1", 0.006),
      ).toThrow("TEAM_BUDGET_EXCEEDED");
      db.completeAgentRun(scout, accounting(0.004));
      expect(db.summary(runId)).toMatchObject({
        spentUsd: 0.004,
        reservedUsd: 0,
      });
      expect(db.agentUsage(runId)).toEqual([
        {
          agentId: "scout-1",
          role: "scout",
          costUsd: 0.004,
          inputTokens: 100,
          outputTokens: 50,
        },
      ]);
    } finally {
      db.close();
    }
  });
});

async function makeDb(): Promise<TeamPipelineDb> {
  const directory = await mkdtemp(join(tmpdir(), "jht-team-db-"));
  return new TeamPipelineDb(join(directory, "team.db"));
}

function accounting(costUsd: number) {
  return { costUsd, inputTokens: 100, outputTokens: 50 };
}
