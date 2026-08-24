import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AnalystApiWorker } from "./analyst-worker.js";
import { AnalystWorkerInputSchema } from "./analyst-contract.js";
import type { ImportedCandidateContext } from "./candidate-profile-import.js";
import {
  buildWorkerInput,
  type CandidateProfile,
} from "./candidate-profile.js";
import type { RunLimits } from "./contract.js";
import { ModelProfileSchema, type ModelProfile } from "./model-profile.js";
import {
  CaptainApiWorker,
  CaptainWorkerInputSchema,
  CriticApiWorker,
  CriticWorkerInputSchema,
  SentinelApiWorker,
  SentinelWorkerInputSchema,
  WriterApiWorker,
  WriterWorkerInputSchema,
  type CaptainProposal,
  type SentinelProposal,
} from "./prototype-roles.js";
import {
  API_SCORER_SCALE_VERSION,
  ScorerWorkerInputSchema,
} from "./scorer-contract.js";
import { ScorerApiWorker } from "./scorer-worker.js";
import {
  TeamPipelineDb,
  type AgentAccounting,
  type PipelineRole,
  type TeamClaim,
  type TeamEvent,
  type TeamPositionSnapshot,
  type TeamRunSummary,
} from "./team-db.js";
import type { ScoutJobSource } from "./tools.js";
import { ScoutApiWorker } from "./worker.js";

export type ApiTeamRunnerOptions = {
  workspaceDir: string;
  candidate: ImportedCandidateContext;
  modelProfile: unknown;
  source: ScoutJobSource;
  liveEnabled?: boolean;
  env?: NodeJS.ProcessEnv;
  budgetUsd?: number;
  maxAgentCostUsd?: number;
  targetScores?: number;
  targetReviews?: number;
  now?: () => Date;
};

export type ApiTeamRunResult = {
  runId: string;
  databasePath: string;
  artifactDirectory: string;
  summary: TeamRunSummary;
  captain: CaptainProposal;
  sentinel: SentinelProposal;
  positions: Array<{
    sourceId: string;
    title: string;
    company: string;
    score: number;
    state: string;
    cvPath?: string;
    criticScore?: number;
    criticVerdict?: string;
  }>;
  usage: ReturnType<TeamPipelineDb["agentUsage"]>;
  events: TeamEvent[];
};

type TaskWorkerResult = {
  proposal: unknown;
  cost: { amountUsd: number };
  usage: { inputTokens: number; outputTokens: number };
};

type TaskWorkerOutcome<R extends TaskWorkerResult> =
  | { ok: true; result: R }
  | {
      ok: false;
      error: {
        code: string;
        cost?: { amountUsd: number };
        usage?: { inputTokens: number; outputTokens: number };
      };
    };

export class ApiTeamRunner {
  private readonly profile: ModelProfile;
  private readonly now: () => Date;
  private readonly targetScores: number;
  private readonly targetReviews: number;
  private readonly budgetUsd: number;
  private readonly reservationUsd: number;

  constructor(private readonly options: ApiTeamRunnerOptions) {
    this.profile = ModelProfileSchema.parse(options.modelProfile);
    this.now = options.now ?? (() => new Date());
    this.targetScores = options.targetScores ?? 5;
    this.targetReviews = options.targetReviews ?? 2;
    this.budgetUsd = options.budgetUsd ?? 0;
    this.reservationUsd =
      this.profile.provider === "mock" ? 0 : (options.maxAgentCostUsd ?? 0.02);
    if (this.targetScores < 1 || this.targetScores > 10)
      throw new Error("targetScores must be between 1 and 10");
    if (this.targetReviews < 0 || this.targetReviews > this.targetScores)
      throw new Error("targetReviews must be between zero and targetScores");
    if (this.profile.provider !== "mock" && this.budgetUsd <= 0)
      throw new Error("Live team runs require a positive shared budget");
    if (
      this.profile.provider !== "mock" &&
      (this.reservationUsd <= 0 || this.reservationUsd > this.budgetUsd)
    )
      throw new Error("Invalid live per-agent budget reservation");
  }

  async run(): Promise<ApiTeamRunResult> {
    const runId = randomUUID();
    const runDirectory = join(this.options.workspaceDir, "runs", runId);
    const agentDirectory = join(runDirectory, "agents");
    const artifactDirectory = join(runDirectory, "artifacts");
    const databasePath = join(this.options.workspaceDir, "data", "team.db");
    await Promise.all([
      mkdir(agentDirectory, { recursive: true }),
      mkdir(artifactDirectory, { recursive: true }),
    ]);
    const db = new TeamPipelineDb(databasePath, this.now);
    let started = false;
    try {
      db.createRun({
        runId,
        targetScores: this.targetScores,
        targetReviews: this.targetReviews,
        budgetUsd: this.budgetUsd,
      });
      started = true;

      const captain = await this.runCaptain(db, runId, agentDirectory);
      await this.runScout(db, runId, agentDirectory);
      await this.drainAnalysts(db, runId, agentDirectory);
      await this.drainScorers(db, runId, agentDirectory);
      this.authorizeTopCvs(db, runId);
      await this.drainWriters(db, runId, agentDirectory);
      await this.drainCritics(db, runId, agentDirectory);
      const sentinel = await this.runSentinel(db, runId, agentDirectory);
      const positions = await this.exportArtifacts(
        db,
        runId,
        artifactDirectory,
      );
      const summary = db.completeRun(runId);
      const result: ApiTeamRunResult = {
        runId,
        databasePath,
        artifactDirectory,
        summary,
        captain,
        sentinel,
        positions,
        usage: db.agentUsage(runId),
        events: db.listEvents(runId),
      };
      await writeFile(
        join(runDirectory, "team-result.json"),
        `${JSON.stringify(result, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      return result;
    } catch (error) {
      if (started) {
        try {
          db.failRun(runId, safeErrorCode(error));
        } catch {
          // Preserve the original failure if the isolated audit DB is broken.
        }
      }
      throw error;
    } finally {
      db.close();
    }
  }

  private async runCaptain(
    db: TeamPipelineDb,
    runId: string,
    agentDirectory: string,
  ): Promise<CaptainProposal> {
    const reservation = db.reserveAgentRun(
      runId,
      "captain",
      "captain-1",
      this.reservationUsd,
    );
    try {
      const input = CaptainWorkerInputSchema.parse({
        contractVersion: "1",
        runId,
        role: "captain",
        workPhase: "ON",
        queues: { discovery: this.targetScores, cv_review: this.targetReviews },
        activeAgents: [
          { id: "scout-1", role: "scout", state: "idle" },
          { id: "analyst-1", role: "analyst", state: "idle" },
          { id: "analyst-2", role: "analyst", state: "idle" },
          { id: "scorer-1", role: "scorer", state: "idle" },
          { id: "scorer-2", role: "scorer", state: "idle" },
          { id: "writer-1", role: "writer", state: "idle" },
          { id: "writer-2", role: "writer", state: "idle" },
          { id: "critic-1", role: "critic", state: "idle" },
          { id: "critic-2", role: "critic", state: "idle" },
          { id: "sentinel-1", role: "sentinel", state: "idle" },
        ],
        tickets: [
          {
            id: "goal-five-scores-two-cvs",
            kind: "pipeline_goal",
            summary: "Score five positions and review two requested CV drafts.",
          },
        ],
        limits: this.limits(),
      });
      const worker = new CaptainApiWorker(this.profile, {
        runtimeDir: await this.agentRuntime(agentDirectory, "captain-1"),
        liveEnabled: this.options.liveEnabled,
        env: this.options.env,
      });
      const outcome = await worker.run(input);
      if (!outcome.ok) throw new TeamAgentError("captain", outcome.error.code);
      db.completeAgentRun(reservation, accounting(outcome.result));
      return outcome.result.proposal;
    } catch (error) {
      db.releaseAgentRun(reservation, safeErrorCode(error));
      throw error;
    }
  }

  private async runScout(
    db: TeamPipelineDb,
    runId: string,
    agentDirectory: string,
  ): Promise<void> {
    const reservation = db.reserveAgentRun(
      runId,
      "scout",
      "scout-1",
      this.reservationUsd,
    );
    try {
      const input = buildWorkerInput(
        {
          ...this.options.candidate.profile,
          search: {
            ...this.options.candidate.profile.search,
            maxCandidates: this.targetScores,
          },
        },
        runId,
        this.limits(),
      );
      const worker = new ScoutApiWorker(this.profile, {
        runtimeDir: await this.agentRuntime(agentDirectory, "scout-1"),
        source: this.options.source,
        liveEnabled: this.options.liveEnabled,
        env: this.options.env,
      });
      const outcome = await worker.run(input);
      if (!outcome.ok) throw new TeamAgentError("scout", outcome.error.code);
      db.completeAgentRun(reservation, accounting(outcome.result));
      if (outcome.result.proposals.length !== this.targetScores) {
        throw new TeamAgentError("scout", "TARGET_COUNT_NOT_MET");
      }
      db.ingestScoutProposals(runId, "scout-1", outcome.result.proposals);
    } catch (error) {
      if (db.summary(runId).reservedUsd > 0) {
        try {
          db.releaseAgentRun(reservation, safeErrorCode(error));
        } catch {
          // The reservation was already completed before a downstream check.
        }
      }
      throw error;
    }
  }

  private async drainAnalysts(
    db: TeamPipelineDb,
    runId: string,
    agentDirectory: string,
  ): Promise<void> {
    await this.drainRole(
      db,
      runId,
      "analyst",
      ["analyst-1", "analyst-2"],
      async (claim) => {
        const snapshot = db.position(runId, claim.sourceId);
        const input = AnalystWorkerInputSchema.parse({
          contractVersion: "1",
          runId,
          role: "analyst",
          position: snapshot.scout,
          candidate: this.options.candidate.profile,
          activeRoleFamilies: this.options.candidate.profile.targets.roles,
          limits: this.limits(),
        });
        const worker = new AnalystApiWorker(this.profile, {
          runtimeDir: await this.agentRuntime(agentDirectory, claim.agentId),
          liveEnabled: this.options.liveEnabled,
          env: this.options.env,
        });
        const result = await this.runTaskWithValidationRetry(
          db,
          claim,
          (maxCostUsd) =>
            worker.run({
              ...input,
              limits: { ...input.limits, maxCostUsd },
            }),
        );
        db.completeAnalyst(claim, result.proposal, accounting(result));
      },
    );
  }

  private async drainScorers(
    db: TeamPipelineDb,
    runId: string,
    agentDirectory: string,
  ): Promise<void> {
    await this.drainRole(
      db,
      runId,
      "scorer",
      ["scorer-1", "scorer-2"],
      async (claim) => {
        const snapshot = db.position(runId, claim.sourceId);
        const input = ScorerWorkerInputSchema.parse({
          contractVersion: "1",
          runId,
          role: "scorer",
          scaleVersion: API_SCORER_SCALE_VERSION,
          scout: snapshot.scout,
          analyst: snapshot.analyst,
          candidate: this.options.candidate.profile,
          authorization: {
            authorizationVersion: "1",
            authorized: true,
            scope: "score_position",
            authorizationId: `score-${claim.sourceId}`,
            sourceId: claim.sourceId,
            authorizedBy: "captain-1",
            authorizedAt: this.now().toISOString(),
          },
          limits: this.limits(),
        });
        const worker = new ScorerApiWorker(this.profile, {
          runtimeDir: await this.agentRuntime(agentDirectory, claim.agentId),
          liveEnabled: this.options.liveEnabled,
          env: this.options.env,
        });
        const result = await this.runTaskWithValidationRetry(
          db,
          claim,
          (maxCostUsd) =>
            worker.run({
              ...input,
              limits: { ...input.limits, maxCostUsd },
            }),
        );
        db.completeScorer(claim, result.proposal, accounting(result));
      },
    );
  }

  private authorizeTopCvs(db: TeamPipelineDb, runId: string): void {
    const eligible = db
      .listPositions(runId)
      .filter(
        (position) =>
          position.state === "scored" &&
          (position.scorer?.totalScore ?? 0) >= 50,
      )
      .sort(
        (left, right) =>
          (right.scorer?.totalScore ?? 0) - (left.scorer?.totalScore ?? 0) ||
          left.sourceId.localeCompare(right.sourceId),
      )
      .slice(0, this.targetReviews);
    if (eligible.length !== this.targetReviews)
      throw new TeamAgentError("writer", "CV_TARGET_NOT_ELIGIBLE");
    for (const position of eligible) {
      db.requestCv({
        runId,
        sourceId: position.sourceId,
        authorizationId: `cv-${position.sourceId}`,
        authorizedBy: "user-goal",
      });
    }
  }

  private async drainWriters(
    db: TeamPipelineDb,
    runId: string,
    agentDirectory: string,
  ): Promise<void> {
    await this.drainRole(
      db,
      runId,
      "writer",
      ["writer-1", "writer-2"],
      async (claim) => {
        const snapshot = db.position(runId, claim.sourceId);
        const input = WriterWorkerInputSchema.parse({
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
            jdSummary: snapshot.analyst?.jdSummary,
            score: snapshot.scorer?.totalScore,
          },
          candidateEvidence: this.options.candidate.writerEvidence,
          limits: this.limits(),
        });
        const worker = new WriterApiWorker(this.profile, {
          runtimeDir: await this.agentRuntime(agentDirectory, claim.agentId),
          liveEnabled: this.options.liveEnabled,
          env: this.options.env,
        });
        const result = await this.runTaskWithValidationRetry(
          db,
          claim,
          (maxCostUsd) =>
            worker.run({
              ...input,
              limits: { ...input.limits, maxCostUsd },
            }),
        );
        db.completeWriter(claim, result.proposal, accounting(result));
      },
    );
  }

  private async drainCritics(
    db: TeamPipelineDb,
    runId: string,
    agentDirectory: string,
  ): Promise<void> {
    await this.drainRole(
      db,
      runId,
      "critic",
      ["critic-1", "critic-2"],
      async (claim) => {
        const snapshot = db.position(runId, claim.sourceId);
        const input = CriticWorkerInputSchema.parse({
          contractVersion: "1",
          runId,
          role: "critic",
          sourceId: snapshot.sourceId,
          url: snapshot.scout.url,
          round: 1,
          jobDescription: snapshot.scout.jdText,
          document: { kind: "cv", markdown: snapshot.writer?.markdown },
          limits: this.limits(),
        });
        const worker = new CriticApiWorker(this.profile, {
          runtimeDir: await this.agentRuntime(agentDirectory, claim.agentId),
          liveEnabled: this.options.liveEnabled,
          env: this.options.env,
        });
        const result = await this.runTaskWithValidationRetry(
          db,
          claim,
          (maxCostUsd) =>
            worker.run({
              ...input,
              limits: { ...input.limits, maxCostUsd },
            }),
        );
        db.completeCritic(claim, result.proposal, accounting(result));
      },
    );
  }

  private async runSentinel(
    db: TeamPipelineDb,
    runId: string,
    agentDirectory: string,
  ): Promise<SentinelProposal> {
    const reservation = db.reserveAgentRun(
      runId,
      "sentinel",
      "sentinel-1",
      this.reservationUsd,
    );
    try {
      const summary = db.summary(runId);
      const input = SentinelWorkerInputSchema.parse({
        contractVersion: "1",
        runId,
        role: "sentinel",
        teamBudgetUsd: this.budgetUsd || 1,
        spentUsd: summary.spentUsd,
        agents: db.agentUsage(runId).map((usage) => ({
          id: usage.agentId,
          role: usage.role,
          tokens: usage.inputTokens + usage.outputTokens,
          costUsd: usage.costUsd,
          rateTokensPerMinute: 0,
        })),
        limits: this.limits(),
      });
      const worker = new SentinelApiWorker(this.profile, {
        runtimeDir: await this.agentRuntime(agentDirectory, "sentinel-1"),
        liveEnabled: this.options.liveEnabled,
        env: this.options.env,
      });
      const outcome = await worker.run(input);
      if (!outcome.ok) throw new TeamAgentError("sentinel", outcome.error.code);
      db.completeAgentRun(reservation, accounting(outcome.result));
      return outcome.result.proposal;
    } catch (error) {
      db.releaseAgentRun(reservation, safeErrorCode(error));
      throw error;
    }
  }

  private async drainRole(
    db: TeamPipelineDb,
    runId: string,
    role: PipelineRole,
    agentIds: string[],
    execute: (claim: TeamClaim) => Promise<void>,
  ): Promise<void> {
    let stopped = false;
    const results = await Promise.allSettled(
      agentIds.map(async (agentId) => {
        while (!stopped) {
          const claim = db.claimNext(runId, role, agentId, this.reservationUsd);
          if (!claim) return;
          try {
            await execute(claim);
          } catch (error) {
            stopped = true;
            db.releaseClaim(claim, safeErrorCode(error));
            throw error;
          }
        }
      }),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
  }

  private async runTaskWithValidationRetry<R extends TaskWorkerResult>(
    db: TeamPipelineDb,
    claim: TeamClaim,
    execute: (maxCostUsd: number) => Promise<TaskWorkerOutcome<R>>,
  ): Promise<R> {
    let remainingBudget = claim.reservationUsd;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const outcome = await execute(remainingBudget);
      if (outcome.ok) return outcome.result;
      if (outcome.error.cost && outcome.error.usage) {
        remainingBudget = db.recordClaimAttempt(
          claim,
          outcome.error.code,
          accounting({
            cost: outcome.error.cost,
            usage: outcome.error.usage,
          }),
        );
      } else if (outcome.error.code === "OUTPUT_VALIDATION") {
        throw new TeamAgentError(claim.role, "MISSING_FAILURE_ACCOUNTING");
      }
      if (
        outcome.error.code !== "OUTPUT_VALIDATION" ||
        attempt === 2 ||
        remainingBudget <= 0
      ) {
        throw new TeamAgentError(claim.role, outcome.error.code);
      }
    }
    throw new TeamAgentError(claim.role, "RETRY_EXHAUSTED");
  }

  private async exportArtifacts(
    db: TeamPipelineDb,
    runId: string,
    artifactDirectory: string,
  ): Promise<ApiTeamRunResult["positions"]> {
    const positions = db.listPositions(runId);
    const result: ApiTeamRunResult["positions"] = [];
    for (const position of positions) {
      let cvPath: string | undefined;
      if (position.writer && position.critic) {
        cvPath = join(artifactDirectory, `${position.sourceId}.cv.md`);
        await Promise.all([
          writeFile(cvPath, `${position.writer.markdown}\n`, {
            encoding: "utf8",
            flag: "wx",
          }),
          writeFile(
            join(artifactDirectory, `${position.sourceId}.critic.json`),
            `${JSON.stringify(position.critic, null, 2)}\n`,
            { encoding: "utf8", flag: "wx" },
          ),
        ]);
      }
      result.push({
        sourceId: position.sourceId,
        title: position.scout.title,
        company: position.scout.company,
        score: requiredScore(position),
        state: position.state,
        ...(cvPath ? { cvPath } : {}),
        ...(position.critic
          ? {
              criticScore: position.critic.score,
              criticVerdict: position.critic.verdict,
            }
          : {}),
      });
    }
    return result;
  }

  private limits(): RunLimits {
    return {
      maxInputTokensPerStep: 32_000,
      maxOutputTokensPerStep: 6_000,
      maxTotalOutputTokens: 6_000,
      maxResultBytes: 300_000,
      maxSteps: 10,
      maxToolCalls: 16,
      maxWebSearches: 1,
      timeoutMs: 180_000,
      maxCostUsd: this.reservationUsd,
    };
  }

  private async agentRuntime(
    agentDirectory: string,
    agentId: string,
  ): Promise<string> {
    const directory = join(agentDirectory, agentId);
    await mkdir(directory, { recursive: true });
    return directory;
  }
}

class TeamAgentError extends Error {
  constructor(
    readonly role: string,
    readonly code: string,
  ) {
    super(`${role}:${code}`);
  }
}

function accounting(result: {
  cost: { amountUsd: number };
  usage: { inputTokens: number; outputTokens: number };
}): AgentAccounting {
  return {
    costUsd: result.cost.amountUsd,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  };
}

function safeErrorCode(error: unknown): string {
  if (
    error instanceof TeamAgentError &&
    /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code)
  ) {
    return error.code;
  }
  return "TEAM_RUN_FAILED";
}

function requiredScore(position: TeamPositionSnapshot): number {
  if (!position.scorer) throw new Error("POSITION_NOT_SCORED");
  return position.scorer.totalScore;
}
