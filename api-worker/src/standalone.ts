import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  CandidateProfileSchema,
  buildWorkerInput,
  profileSearchLanes,
  type CandidateProfile,
} from "./candidate-profile.js";
import type { RunLimits, ScoutWorkerOutcome } from "./contract.js";
import { ModelProfileSchema, type ModelProfile } from "./model-profile.js";
import {
  StandaloneScoutDb,
  type CoordinationResult,
  type PersistenceResult,
} from "./standalone-db.js";
import type { ScoutJobSource } from "./tools.js";
import {
  StructuredWebJobReader,
  type ScoutWebJobReader,
} from "./web-job-reader.js";
import { ScoutApiWorker } from "./worker.js";

export type StandaloneScoutOptions = {
  agentId: string;
  workspaceDir: string;
  candidateProfile: unknown;
  modelProfile: unknown;
  source: ScoutJobSource;
  liveEnabled?: boolean;
  webEnabled?: boolean;
  maxCostUsd?: number;
  maxWebSearches?: number;
  env?: NodeJS.ProcessEnv;
  webReader?: ScoutWebJobReader;
  now?: () => Date;
};

export type StandaloneScoutResult = {
  runId: string;
  databasePath: string;
  coordination: CoordinationResult;
  worker: ScoutWorkerOutcome;
  persistence?: PersistenceResult;
};

export class StandaloneScout {
  private readonly profile: CandidateProfile;
  private readonly modelProfile: ModelProfile;
  private readonly now: () => Date;

  constructor(private readonly options: StandaloneScoutOptions) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(options.agentId)) {
      throw new Error("agentId must use lowercase letters, digits and hyphens");
    }
    this.profile = CandidateProfileSchema.parse(options.candidateProfile);
    this.modelProfile = ModelProfileSchema.parse(options.modelProfile);
    this.now = options.now ?? (() => new Date());
    if (options.webEnabled && !options.liveEnabled) {
      throw new Error("Web discovery requires --live");
    }
  }

  async runOnce(): Promise<StandaloneScoutResult> {
    const runId = randomUUID();
    const databasePath = join(this.options.workspaceDir, "data", "scout.db");
    const runtimeDir = join(
      this.options.workspaceDir,
      "runs",
      this.options.agentId,
    );
    await mkdir(runtimeDir, { recursive: true });
    const db = new StandaloneScoutDb(databasePath, this.now);
    const leaseMs = 660_000;
    let coordination: CoordinationResult | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      coordination = db.coordinate(
        this.options.agentId,
        runId,
        profileSearchLanes(this.profile),
        leaseMs,
      );
      heartbeat = setInterval(
        () => db.heartbeat(this.options.agentId, runId, leaseMs),
        30_000,
      );
      heartbeat.unref();

      const input = buildWorkerInput(
        this.profile,
        runId,
        defaultLimits(
          this.modelProfile,
          this.options.maxCostUsd ?? 0,
          this.options.maxWebSearches ?? 4,
        ),
        coordination.lane,
      );
      const worker = new ScoutApiWorker(this.modelProfile, {
        runtimeDir,
        source: this.options.source,
        liveEnabled: this.options.liveEnabled,
        env: this.options.env,
        webReader: this.options.webEnabled
          ? (this.options.webReader ?? new StructuredWebJobReader())
          : undefined,
      });
      const outcome = await worker.run(input);
      if (!outcome.ok) {
        db.finish(this.options.agentId, runId, "failed");
        return { runId, databasePath, coordination, worker: outcome };
      }
      const persistence = db.persist(
        runId,
        this.options.agentId,
        outcome.result.proposals,
      );
      db.finish(this.options.agentId, runId, "idle");
      return {
        runId,
        databasePath,
        coordination,
        worker: outcome,
        persistence,
      };
    } catch (error) {
      if (coordination) db.finish(this.options.agentId, runId, "failed");
      throw error;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      db.close();
    }
  }
}

function defaultLimits(
  profile: ModelProfile,
  maxCostUsd: number,
  maxWebSearches: number,
): RunLimits {
  return {
    maxInputTokensPerStep: 128_000,
    maxOutputTokensPerStep: 3_000,
    maxTotalOutputTokens: 12_000,
    maxResultBytes: 200_000,
    maxSteps: 10,
    maxToolCalls: 20,
    maxWebSearches,
    timeoutMs: 600_000,
    maxCostUsd: profile.provider === "mock" ? 0 : maxCostUsd,
  };
}
