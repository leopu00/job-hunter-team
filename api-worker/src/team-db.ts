import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  AnalystProposalSchema,
  type AnalystProposal,
} from "./analyst-contract.js";
import {
  ScoutCandidateProposalSchema,
  type ScoutCandidateProposal,
} from "./contract.js";
import {
  CriticProposalSchema,
  WriterProposalSchema,
  type CriticProposal,
  type WriterProposal,
} from "./prototype-roles.js";
import {
  ScorerProposalSchema,
  type ScorerProposal,
} from "./scorer-contract.js";

export type PipelineRole = "analyst" | "scorer" | "writer" | "critic";
export type CoordinatingRole = "captain" | "scout" | "sentinel";

export type TeamAgentReservation = {
  reservationId: string;
  runId: string;
  role: CoordinatingRole;
  agentId: string;
  token: string;
  reservationUsd: number;
};

export type TeamPositionState =
  | "new"
  | "analysing"
  | "checked"
  | "scoring"
  | "scored"
  | "write_queued"
  | "writing"
  | "review_queued"
  | "reviewing"
  | "reviewed"
  | "excluded";

export type TeamClaim = {
  taskId: string;
  runId: string;
  sourceId: string;
  role: PipelineRole;
  agentId: string;
  token: string;
  reservationUsd: number;
};

export type AgentAccounting = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};

export type TeamPositionSnapshot = {
  sourceId: string;
  state: TeamPositionState;
  scout: ScoutCandidateProposal;
  analyst?: AnalystProposal;
  scorer?: ScorerProposal;
  writer?: WriterProposal;
  critic?: CriticProposal;
};

export type TeamRunSummary = {
  runId: string;
  status: "running" | "completed" | "failed";
  targetScores: number;
  targetReviews: number;
  scored: number;
  reviewed: number;
  spentUsd: number;
  reservedUsd: number;
  states: Record<string, number>;
};

export type TeamEvent = {
  sequence: number;
  runId: string;
  sourceId: string | null;
  actor: string;
  event: string;
  fromRole: string | null;
  toRole: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type TeamAgentUsage = {
  agentId: string;
  role: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};

const ROLE_STATES: Record<
  PipelineRole,
  { queued: TeamPositionState; active: TeamPositionState }
> = {
  analyst: { queued: "new", active: "analysing" },
  scorer: { queued: "checked", active: "scoring" },
  writer: { queued: "write_queued", active: "writing" },
  critic: { queued: "review_queued", active: "reviewing" },
};

const ZERO_ACCOUNTING: AgentAccounting = {
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
};

export class TeamPipelineDb {
  private readonly db: DatabaseSync;

  constructor(
    readonly path: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;",
    );
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  createRun(input: {
    runId: string;
    targetScores: number;
    targetReviews: number;
    budgetUsd: number;
  }): void {
    if (!isUuid(input.runId)) throw new Error("runId must be a UUID");
    if (!Number.isInteger(input.targetScores) || input.targetScores < 1)
      throw new Error("targetScores must be a positive integer");
    if (
      !Number.isInteger(input.targetReviews) ||
      input.targetReviews < 0 ||
      input.targetReviews > input.targetScores
    )
      throw new Error("targetReviews must be between zero and targetScores");
    if (!Number.isFinite(input.budgetUsd) || input.budgetUsd < 0)
      throw new Error("budgetUsd must be non-negative");
    const timestamp = this.now().toISOString();
    this.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO team_runs(run_id, status, target_scores, target_reviews, budget_usd, spent_usd, created_at, updated_at) " +
            "VALUES (?, 'running', ?, ?, ?, 0, ?, ?)",
        )
        .run(
          input.runId,
          input.targetScores,
          input.targetReviews,
          input.budgetUsd,
          timestamp,
          timestamp,
        );
      this.event(input.runId, null, "captain", "run_started", null, "scout", {
        targetScores: input.targetScores,
        targetReviews: input.targetReviews,
        budgetUsd: input.budgetUsd,
      });
    });
  }

  ingestScoutProposals(
    runId: string,
    agentId: string,
    rawProposals: unknown[],
  ): void {
    const proposals = rawProposals.map((proposal) =>
      ScoutCandidateProposalSchema.parse(proposal),
    );
    this.transaction(() => {
      this.assertRunningRun(runId);
      for (const proposal of proposals) {
        this.db
          .prepare(
            "INSERT INTO team_positions(run_id, source_id, url, state, scout_json, updated_at) " +
              "VALUES (?, ?, ?, 'new', ?, ?)",
          )
          .run(
            runId,
            proposal.sourceId,
            proposal.url,
            JSON.stringify(proposal),
            this.now().toISOString(),
          );
        this.enqueueTask(runId, proposal.sourceId, "analyst");
        this.event(
          runId,
          proposal.sourceId,
          agentId,
          "handoff_queued",
          "scout",
          "analyst",
          {},
        );
      }
    });
  }

  reserveAgentRun(
    runId: string,
    role: CoordinatingRole,
    agentId: string,
    reservationUsd: number,
  ): TeamAgentReservation {
    assertAgentId(agentId);
    if (!Number.isFinite(reservationUsd) || reservationUsd < 0)
      throw new Error("reservationUsd must be non-negative");
    return this.transaction(() => {
      const run = this.assertRunningRun(runId);
      if (
        Number(run.spent_usd) + this.reservedUsd(runId) + reservationUsd >
        Number(run.budget_usd) + Number.EPSILON
      ) {
        throw new Error("TEAM_BUDGET_EXCEEDED");
      }
      const reservationId = randomUUID();
      const token = randomUUID();
      const timestamp = this.now().toISOString();
      this.db
        .prepare(
          "INSERT INTO team_agent_runs(id, run_id, role, agent_id, status, claim_token, reservation_usd, cost_usd, input_tokens, output_tokens, created_at, updated_at) " +
            "VALUES (?, ?, ?, ?, 'active', ?, ?, 0, 0, 0, ?, ?)",
        )
        .run(
          reservationId,
          runId,
          role,
          agentId,
          token,
          reservationUsd,
          timestamp,
          timestamp,
        );
      this.event(runId, null, agentId, "agent_run_reserved", null, role, {
        reservationUsd,
      });
      return {
        reservationId,
        runId,
        role,
        agentId,
        token,
        reservationUsd,
      };
    });
  }

  completeAgentRun(
    reservation: TeamAgentReservation,
    accounting: AgentAccounting,
  ): void {
    assertAccounting(accounting);
    this.transaction(() => {
      const row = this.assertAgentReservation(reservation);
      if (accounting.costUsd > Number(row.reservation_usd) + 1e-9)
        throw new Error("TASK_BUDGET_EXCEEDED");
      const timestamp = this.now().toISOString();
      this.db
        .prepare(
          "UPDATE team_agent_runs SET status='completed', reservation_usd=0, cost_usd=?, input_tokens=?, output_tokens=?, updated_at=? WHERE id=?",
        )
        .run(
          accounting.costUsd,
          accounting.inputTokens,
          accounting.outputTokens,
          timestamp,
          reservation.reservationId,
        );
      this.db
        .prepare(
          "UPDATE team_runs SET spent_usd=spent_usd+?, updated_at=? WHERE run_id=?",
        )
        .run(accounting.costUsd, timestamp, reservation.runId);
      this.event(
        reservation.runId,
        null,
        reservation.agentId,
        "agent_run_completed",
        reservation.role,
        "captain",
        {
          costUsd: accounting.costUsd,
          inputTokens: accounting.inputTokens,
          outputTokens: accounting.outputTokens,
        },
      );
    });
  }

  releaseAgentRun(reservation: TeamAgentReservation, errorCode: string): void {
    if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(errorCode))
      throw new Error("errorCode must be a safe identifier");
    this.transaction(() => {
      this.assertAgentReservation(reservation);
      this.db
        .prepare(
          "UPDATE team_agent_runs SET status='failed', reservation_usd=0, last_error=?, updated_at=? WHERE id=?",
        )
        .run(errorCode, this.now().toISOString(), reservation.reservationId);
      this.event(
        reservation.runId,
        null,
        reservation.agentId,
        "agent_run_failed",
        reservation.role,
        "captain",
        { errorCode },
      );
    });
  }

  claimNext(
    runId: string,
    role: PipelineRole,
    agentId: string,
    reservationUsd: number,
  ): TeamClaim | undefined {
    assertAgentId(agentId);
    if (!Number.isFinite(reservationUsd) || reservationUsd < 0)
      throw new Error("reservationUsd must be non-negative");
    return this.transaction(() => {
      const run = this.assertRunningRun(runId);
      const reserved = this.reservedUsd(runId);
      if (
        Number(run.spent_usd) + reserved + reservationUsd >
        Number(run.budget_usd) + Number.EPSILON
      ) {
        throw new Error("TEAM_BUDGET_EXCEEDED");
      }
      const row = this.db
        .prepare(
          "SELECT id, source_id FROM team_tasks WHERE run_id=? AND role=? AND status='queued' " +
            "ORDER BY created_at, id LIMIT 1",
        )
        .get(runId, role);
      if (!row) return undefined;
      const sourceId = String(row.source_id);
      const position = this.db
        .prepare(
          "SELECT state FROM team_positions WHERE run_id=? AND source_id=?",
        )
        .get(runId, sourceId);
      if (!position || position.state !== ROLE_STATES[role].queued)
        throw new Error("INVALID_PIPELINE_STATE");
      const token = randomUUID();
      const timestamp = this.now().toISOString();
      this.db
        .prepare(
          "UPDATE team_tasks SET status='claimed', agent_id=?, claim_token=?, reservation_usd=?, attempts=attempts+1, updated_at=? WHERE id=?",
        )
        .run(agentId, token, reservationUsd, timestamp, row.id);
      this.db
        .prepare(
          "UPDATE team_positions SET state=?, updated_at=? WHERE run_id=? AND source_id=?",
        )
        .run(ROLE_STATES[role].active, timestamp, runId, sourceId);
      this.event(runId, sourceId, agentId, "task_claimed", null, role, {
        reservationUsd,
      });
      return {
        taskId: String(row.id),
        runId,
        sourceId,
        role,
        agentId,
        token,
        reservationUsd,
      };
    });
  }

  completeAnalyst(
    claim: TeamClaim,
    rawProposal: unknown,
    accounting: AgentAccounting = ZERO_ACCOUNTING,
  ): void {
    const proposal = AnalystProposalSchema.parse(rawProposal);
    this.completeClaim(claim, accounting, "analyst", (snapshot) => {
      assertIdentity(snapshot, proposal.sourceId, proposal.url);
      const nextState =
        proposal.decision === "checked" ? "checked" : "excluded";
      this.db
        .prepare(
          "UPDATE team_positions SET state=?, analyst_json=?, updated_at=? WHERE run_id=? AND source_id=?",
        )
        .run(
          nextState,
          JSON.stringify(proposal),
          this.now().toISOString(),
          claim.runId,
          claim.sourceId,
        );
      if (proposal.decision === "checked") {
        this.enqueueTask(claim.runId, claim.sourceId, "scorer");
        this.event(
          claim.runId,
          claim.sourceId,
          claim.agentId,
          "handoff_queued",
          "analyst",
          "scorer",
          { decision: proposal.decision },
        );
      } else {
        this.event(
          claim.runId,
          claim.sourceId,
          claim.agentId,
          "position_excluded",
          "analyst",
          null,
          { decision: proposal.decision, exclusionTag: proposal.exclusionTag },
        );
      }
    });
  }

  completeScorer(
    claim: TeamClaim,
    rawProposal: unknown,
    accounting: AgentAccounting = ZERO_ACCOUNTING,
  ): void {
    const proposal = ScorerProposalSchema.parse(rawProposal);
    this.completeClaim(claim, accounting, "scorer", (snapshot) => {
      assertIdentity(snapshot, proposal.sourceId, proposal.url);
      const nextState = proposal.decision === "scored" ? "scored" : "excluded";
      this.db
        .prepare(
          "UPDATE team_positions SET state=?, scorer_json=?, score=?, updated_at=? WHERE run_id=? AND source_id=?",
        )
        .run(
          nextState,
          JSON.stringify(proposal),
          proposal.totalScore,
          this.now().toISOString(),
          claim.runId,
          claim.sourceId,
        );
      this.event(
        claim.runId,
        claim.sourceId,
        claim.agentId,
        "score_recorded",
        "scorer",
        null,
        { decision: proposal.decision, score: proposal.totalScore },
      );
    });
  }

  requestCv(input: {
    runId: string;
    sourceId: string;
    authorizationId: string;
    authorizedBy: string;
  }): void {
    assertAgentId(input.authorizationId);
    assertAgentId(input.authorizedBy);
    this.transaction(() => {
      this.assertRunningRun(input.runId);
      const row = this.db
        .prepare(
          "SELECT state, score FROM team_positions WHERE run_id=? AND source_id=?",
        )
        .get(input.runId, input.sourceId);
      if (!row || row.state !== "scored" || Number(row.score) < 50)
        throw new Error("CV_REQUEST_NOT_ELIGIBLE");
      this.db
        .prepare(
          "UPDATE team_positions SET state='write_queued', updated_at=? WHERE run_id=? AND source_id=?",
        )
        .run(this.now().toISOString(), input.runId, input.sourceId);
      this.enqueueTask(input.runId, input.sourceId, "writer");
      this.event(
        input.runId,
        input.sourceId,
        input.authorizedBy,
        "cv_authorized",
        null,
        "writer",
        { authorizationId: input.authorizationId },
      );
    });
  }

  completeWriter(
    claim: TeamClaim,
    rawProposal: unknown,
    accounting: AgentAccounting = ZERO_ACCOUNTING,
  ): void {
    const proposal = WriterProposalSchema.parse(rawProposal);
    this.completeClaim(claim, accounting, "writer", (snapshot) => {
      assertIdentity(snapshot, proposal.sourceId, proposal.url);
      if (proposal.documentKind !== "cv")
        throw new Error("PIPELINE_REQUIRES_CV");
      this.db
        .prepare(
          "UPDATE team_positions SET state='review_queued', writer_json=?, updated_at=? WHERE run_id=? AND source_id=?",
        )
        .run(
          JSON.stringify(proposal),
          this.now().toISOString(),
          claim.runId,
          claim.sourceId,
        );
      this.enqueueTask(claim.runId, claim.sourceId, "critic");
      this.event(
        claim.runId,
        claim.sourceId,
        claim.agentId,
        "handoff_queued",
        "writer",
        "critic",
        { documentKind: "cv" },
      );
    });
  }

  completeCritic(
    claim: TeamClaim,
    rawProposal: unknown,
    accounting: AgentAccounting = ZERO_ACCOUNTING,
  ): void {
    const proposal = CriticProposalSchema.parse(rawProposal);
    this.completeClaim(claim, accounting, "critic", (snapshot) => {
      assertIdentity(snapshot, proposal.sourceId, proposal.url);
      this.db
        .prepare(
          "UPDATE team_positions SET state='reviewed', critic_json=?, updated_at=? WHERE run_id=? AND source_id=?",
        )
        .run(
          JSON.stringify(proposal),
          this.now().toISOString(),
          claim.runId,
          claim.sourceId,
        );
      this.event(
        claim.runId,
        claim.sourceId,
        claim.agentId,
        "cv_reviewed",
        "critic",
        "captain",
        { score: proposal.score, verdict: proposal.verdict },
      );
    });
  }

  releaseClaim(claim: TeamClaim, errorCode: string): void {
    if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(errorCode))
      throw new Error("errorCode must be a safe identifier");
    this.transaction(() => {
      this.assertClaim(claim, claim.role);
      const timestamp = this.now().toISOString();
      this.db
        .prepare(
          "UPDATE team_tasks SET status='queued', agent_id=NULL, claim_token=NULL, reservation_usd=0, last_error=?, updated_at=? WHERE id=?",
        )
        .run(errorCode, timestamp, claim.taskId);
      this.db
        .prepare(
          "UPDATE team_positions SET state=?, updated_at=? WHERE run_id=? AND source_id=?",
        )
        .run(
          ROLE_STATES[claim.role].queued,
          timestamp,
          claim.runId,
          claim.sourceId,
        );
      this.event(
        claim.runId,
        claim.sourceId,
        claim.agentId,
        "task_released",
        claim.role,
        claim.role,
        { errorCode },
      );
    });
  }

  position(runId: string, sourceId: string): TeamPositionSnapshot {
    const row = this.db
      .prepare("SELECT * FROM team_positions WHERE run_id=? AND source_id=?")
      .get(runId, sourceId);
    if (!row) throw new Error("POSITION_NOT_FOUND");
    return parsePosition(row);
  }

  listPositions(runId: string): TeamPositionSnapshot[] {
    return this.db
      .prepare("SELECT * FROM team_positions WHERE run_id=? ORDER BY source_id")
      .all(runId)
      .map(parsePosition);
  }

  summary(runId: string): TeamRunSummary {
    const run = this.db
      .prepare("SELECT * FROM team_runs WHERE run_id=?")
      .get(runId);
    if (!run) throw new Error("RUN_NOT_FOUND");
    const counts = this.db
      .prepare(
        "SELECT state, count(*) AS count FROM team_positions WHERE run_id=? GROUP BY state",
      )
      .all(runId);
    const scored = this.db
      .prepare(
        "SELECT count(*) AS count FROM team_positions WHERE run_id=? AND scorer_json IS NOT NULL",
      )
      .get(runId);
    const reviewed = this.db
      .prepare(
        "SELECT count(*) AS count FROM team_positions WHERE run_id=? AND critic_json IS NOT NULL",
      )
      .get(runId);
    return {
      runId,
      status: String(run.status) as TeamRunSummary["status"],
      targetScores: Number(run.target_scores),
      targetReviews: Number(run.target_reviews),
      scored: Number(scored?.count ?? 0),
      reviewed: Number(reviewed?.count ?? 0),
      spentUsd: Number(run.spent_usd),
      reservedUsd: this.reservedUsd(runId),
      states: Object.fromEntries(
        counts.map((row) => [String(row.state), Number(row.count)]),
      ),
    };
  }

  completeRun(runId: string): TeamRunSummary {
    return this.transaction(() => {
      const summary = this.summary(runId);
      if (
        summary.scored < summary.targetScores ||
        summary.reviewed < summary.targetReviews ||
        summary.reservedUsd !== 0
      ) {
        throw new Error("TEAM_TARGETS_NOT_MET");
      }
      const timestamp = this.now().toISOString();
      this.db
        .prepare(
          "UPDATE team_runs SET status='completed', updated_at=? WHERE run_id=? AND status='running'",
        )
        .run(timestamp, runId);
      this.event(runId, null, "captain", "run_completed", "critic", null, {
        scored: summary.scored,
        reviewed: summary.reviewed,
        spentUsd: summary.spentUsd,
      });
      return { ...summary, status: "completed" };
    });
  }

  failRun(runId: string, errorCode: string): void {
    if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(errorCode))
      throw new Error("errorCode must be a safe identifier");
    this.transaction(() => {
      const run = this.db
        .prepare("SELECT status FROM team_runs WHERE run_id=?")
        .get(runId);
      if (!run) throw new Error("RUN_NOT_FOUND");
      if (run.status !== "running") return;
      this.db
        .prepare(
          "UPDATE team_runs SET status='failed', updated_at=? WHERE run_id=?",
        )
        .run(this.now().toISOString(), runId);
      this.event(runId, null, "captain", "run_failed", null, null, {
        errorCode,
      });
    });
  }

  listEvents(runId: string): TeamEvent[] {
    return this.db
      .prepare("SELECT * FROM team_events WHERE run_id=? ORDER BY sequence")
      .all(runId)
      .map((row) => ({
        sequence: Number(row.sequence),
        runId: String(row.run_id),
        sourceId: row.source_id === null ? null : String(row.source_id),
        actor: String(row.actor),
        event: String(row.event),
        fromRole: row.from_role === null ? null : String(row.from_role),
        toRole: row.to_role === null ? null : String(row.to_role),
        detail: JSON.parse(String(row.detail_json)) as Record<string, unknown>,
        createdAt: String(row.created_at),
      }));
  }

  agentUsage(runId: string): TeamAgentUsage[] {
    const coordinating = this.db
      .prepare(
        "SELECT agent_id, role, cost_usd, input_tokens, output_tokens FROM team_agent_runs WHERE run_id=? AND status='completed'",
      )
      .all(runId);
    const pipeline = this.db
      .prepare(
        "SELECT agent_id, role, cost_usd, input_tokens, output_tokens FROM team_tasks WHERE run_id=? AND status='completed'",
      )
      .all(runId);
    const totals = new Map<string, TeamAgentUsage>();
    for (const row of [...coordinating, ...pipeline]) {
      const agentId = String(row.agent_id);
      const role = String(row.role);
      const key = `${role}:${agentId}`;
      const current = totals.get(key) ?? {
        agentId,
        role,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      current.costUsd += Number(row.cost_usd);
      current.inputTokens += Number(row.input_tokens);
      current.outputTokens += Number(row.output_tokens);
      totals.set(key, current);
    }
    return [...totals.values()].sort((left, right) =>
      `${left.role}:${left.agentId}`.localeCompare(
        `${right.role}:${right.agentId}`,
      ),
    );
  }

  private completeClaim(
    claim: TeamClaim,
    accounting: AgentAccounting,
    expectedRole: PipelineRole,
    apply: (snapshot: TeamPositionSnapshot) => void,
  ): void {
    assertAccounting(accounting);
    this.transaction(() => {
      const task = this.assertClaim(claim, expectedRole);
      if (accounting.costUsd > Number(task.reservation_usd) + 1e-9)
        throw new Error("TASK_BUDGET_EXCEEDED");
      const snapshot = this.position(claim.runId, claim.sourceId);
      apply(snapshot);
      const timestamp = this.now().toISOString();
      this.db
        .prepare(
          "UPDATE team_tasks SET status='completed', cost_usd=?, input_tokens=?, output_tokens=?, reservation_usd=0, updated_at=? WHERE id=?",
        )
        .run(
          accounting.costUsd,
          accounting.inputTokens,
          accounting.outputTokens,
          timestamp,
          claim.taskId,
        );
      this.db
        .prepare(
          "UPDATE team_runs SET spent_usd=spent_usd+?, updated_at=? WHERE run_id=?",
        )
        .run(accounting.costUsd, timestamp, claim.runId);
      this.event(
        claim.runId,
        claim.sourceId,
        claim.agentId,
        "task_completed",
        expectedRole,
        null,
        {
          costUsd: accounting.costUsd,
          inputTokens: accounting.inputTokens,
          outputTokens: accounting.outputTokens,
        },
      );
    });
  }

  private assertClaim(claim: TeamClaim, expectedRole: PipelineRole) {
    if (claim.role !== expectedRole) throw new Error("CLAIM_ROLE_MISMATCH");
    const task = this.db
      .prepare("SELECT * FROM team_tasks WHERE id=?")
      .get(claim.taskId);
    if (
      !task ||
      task.status !== "claimed" ||
      task.run_id !== claim.runId ||
      task.source_id !== claim.sourceId ||
      task.role !== expectedRole ||
      task.agent_id !== claim.agentId ||
      task.claim_token !== claim.token
    ) {
      throw new Error("INVALID_TASK_CLAIM");
    }
    return task;
  }

  private assertAgentReservation(reservation: TeamAgentReservation) {
    const row = this.db
      .prepare("SELECT * FROM team_agent_runs WHERE id=?")
      .get(reservation.reservationId);
    if (
      !row ||
      row.status !== "active" ||
      row.run_id !== reservation.runId ||
      row.role !== reservation.role ||
      row.agent_id !== reservation.agentId ||
      row.claim_token !== reservation.token
    ) {
      throw new Error("INVALID_AGENT_RESERVATION");
    }
    return row;
  }

  private assertRunningRun(runId: string) {
    const run = this.db
      .prepare("SELECT * FROM team_runs WHERE run_id=?")
      .get(runId);
    if (!run) throw new Error("RUN_NOT_FOUND");
    if (run.status !== "running") throw new Error("RUN_NOT_RUNNING");
    return run;
  }

  private enqueueTask(
    runId: string,
    sourceId: string,
    role: PipelineRole,
  ): void {
    const timestamp = this.now().toISOString();
    this.db
      .prepare(
        "INSERT INTO team_tasks(id, run_id, source_id, role, status, reservation_usd, cost_usd, input_tokens, output_tokens, attempts, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, 'queued', 0, 0, 0, 0, 0, ?, ?)",
      )
      .run(randomUUID(), runId, sourceId, role, timestamp, timestamp);
  }

  private reservedUsd(runId: string): number {
    const tasks = this.db
      .prepare(
        "SELECT coalesce(sum(reservation_usd), 0) AS total FROM team_tasks WHERE run_id=? AND status='claimed'",
      )
      .get(runId);
    const agents = this.db
      .prepare(
        "SELECT coalesce(sum(reservation_usd), 0) AS total FROM team_agent_runs WHERE run_id=? AND status='active'",
      )
      .get(runId);
    return Number(tasks?.total ?? 0) + Number(agents?.total ?? 0);
  }

  private event(
    runId: string,
    sourceId: string | null,
    actor: string,
    event: string,
    fromRole: string | null,
    toRole: string | null,
    detail: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        "INSERT INTO team_events(run_id, source_id, actor, event, from_role, to_role, detail_json, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        runId,
        sourceId,
        actor,
        event,
        fromRole,
        toRole,
        JSON.stringify(detail),
        this.now().toISOString(),
      );
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS team_runs (
        run_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
        target_scores INTEGER NOT NULL,
        target_reviews INTEGER NOT NULL,
        budget_usd REAL NOT NULL,
        spent_usd REAL NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS team_positions (
        run_id TEXT NOT NULL REFERENCES team_runs(run_id),
        source_id TEXT NOT NULL,
        url TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('new','analysing','checked','scoring','scored','write_queued','writing','review_queued','reviewing','reviewed','excluded')),
        scout_json TEXT NOT NULL,
        analyst_json TEXT,
        scorer_json TEXT,
        writer_json TEXT,
        critic_json TEXT,
        score INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(run_id, source_id),
        UNIQUE(run_id, url)
      );
      CREATE TABLE IF NOT EXISTS team_tasks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('analyst','scorer','writer','critic')),
        status TEXT NOT NULL CHECK(status IN ('queued','claimed','completed')),
        agent_id TEXT,
        claim_token TEXT,
        reservation_usd REAL NOT NULL,
        cost_usd REAL NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        attempts INTEGER NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(run_id, source_id, role),
        FOREIGN KEY(run_id, source_id) REFERENCES team_positions(run_id, source_id)
      );
      CREATE INDEX IF NOT EXISTS team_tasks_queue_idx ON team_tasks(run_id, role, status, created_at);
      CREATE TABLE IF NOT EXISTS team_agent_runs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES team_runs(run_id),
        role TEXT NOT NULL CHECK(role IN ('captain','scout','sentinel')),
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','completed','failed')),
        claim_token TEXT NOT NULL,
        reservation_usd REAL NOT NULL,
        cost_usd REAL NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS team_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES team_runs(run_id),
        source_id TEXT,
        actor TEXT NOT NULL,
        event TEXT NOT NULL,
        from_role TEXT,
        to_role TEXT,
        detail_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS team_events_run_idx ON team_events(run_id, sequence);
    `);
  }
}

function parsePosition(row: Record<string, unknown>): TeamPositionSnapshot {
  return {
    sourceId: String(row.source_id),
    state: String(row.state) as TeamPositionState,
    scout: ScoutCandidateProposalSchema.parse(
      JSON.parse(String(row.scout_json)),
    ),
    ...(row.analyst_json === null
      ? {}
      : {
          analyst: AnalystProposalSchema.parse(
            JSON.parse(String(row.analyst_json)),
          ),
        }),
    ...(row.scorer_json === null
      ? {}
      : {
          scorer: ScorerProposalSchema.parse(
            JSON.parse(String(row.scorer_json)),
          ),
        }),
    ...(row.writer_json === null
      ? {}
      : {
          writer: WriterProposalSchema.parse(
            JSON.parse(String(row.writer_json)),
          ),
        }),
    ...(row.critic_json === null
      ? {}
      : {
          critic: CriticProposalSchema.parse(
            JSON.parse(String(row.critic_json)),
          ),
        }),
  };
}

function assertIdentity(
  snapshot: TeamPositionSnapshot,
  sourceId: string,
  url: string,
): void {
  if (snapshot.sourceId !== sourceId || snapshot.scout.url !== url)
    throw new Error("PROPOSAL_IDENTITY_MISMATCH");
}

function assertAgentId(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(value))
    throw new Error("Invalid agent identifier");
}

function assertAccounting(value: AgentAccounting): void {
  if (!Number.isFinite(value.costUsd) || value.costUsd < 0)
    throw new Error("Invalid task cost");
  if (!Number.isInteger(value.inputTokens) || value.inputTokens < 0)
    throw new Error("Invalid input token count");
  if (!Number.isInteger(value.outputTokens) || value.outputTokens < 0)
    throw new Error("Invalid output token count");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
