import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { AuditSink } from "./audit.js";
import {
  RemoteTypeSchema,
  ScoutToolNameSchema,
  ToolEventSchema,
  WorkModeSchema,
  type ScoutWorkerInput,
} from "./contract.js";
import { WorkerFault } from "./errors.js";
import type { RunGuard } from "./guardrails.js";

const ToolTextSchema = z.string().trim().min(1).max(160);

export const SearchJobsInputSchema = z.strictObject({
  targetRole: ToolTextSchema,
  location: ToolTextSchema,
  workMode: WorkModeSchema,
  postedWithinDays: z.number().int().min(1).max(30),
  limit: z.number().int().min(1).max(10),
});

export const JobSummarySchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(100),
  title: ToolTextSchema,
  company: ToolTextSchema,
  location: ToolTextSchema,
  remoteType: RemoteTypeSchema,
  source: ToolTextSchema,
  postedAt: z.string().datetime({ offset: true }),
});

export const SearchJobsResultSchema = z.strictObject({
  jobs: z.array(JobSummarySchema).max(10),
});

export const ReadJobInputSchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(100),
});

export const CatalogJobSchema = JobSummarySchema.extend({
  url: z.string().url().max(2_048),
  jdText: z.string().trim().min(80).max(20_000),
  requirements: z.array(ToolTextSchema).min(1).max(40),
});

export const ReadJobResultSchema = CatalogJobSchema;
export const JobCatalogSchema = z.array(CatalogJobSchema).max(100);

export type SearchJobsInput = z.infer<typeof SearchJobsInputSchema>;
export type SearchJobsResult = z.infer<typeof SearchJobsResultSchema>;
export type ReadJobInput = z.infer<typeof ReadJobInputSchema>;
export type ReadJobResult = z.infer<typeof ReadJobResultSchema>;
export type CatalogJob = z.infer<typeof CatalogJobSchema>;

export interface ScoutJobSource {
  search(input: SearchJobsInput): Promise<SearchJobsResult>;
  read(input: ReadJobInput): Promise<ReadJobResult | null>;
}

export class SyntheticJobSource implements ScoutJobSource {
  private readonly jobs: CatalogJob[];

  constructor(
    rawJobs: unknown,
    private readonly now: () => Date = () =>
      new Date("2026-08-19T12:00:00.000Z"),
  ) {
    this.jobs = JobCatalogSchema.parse(rawJobs);
  }

  async search(input: SearchJobsInput): Promise<SearchJobsResult> {
    const parsed = SearchJobsInputSchema.parse(input);
    const cutoff = this.now().getTime() - parsed.postedWithinDays * 86_400_000;
    const roleTokens = tokenize(parsed.targetRole);

    const jobs = this.jobs
      .filter((job) => new Date(job.postedAt).getTime() >= cutoff)
      .filter(
        (job) =>
          job.location.toLowerCase() === parsed.location.toLowerCase() &&
          job.remoteType === parsed.workMode,
      )
      .filter((job) => hasTokenOverlap(roleTokens, tokenize(job.title)))
      .slice(0, parsed.limit)
      .map(
        ({ url: _url, jdText: _jdText, requirements: _requirements, ...job }) =>
          job,
      );

    return SearchJobsResultSchema.parse({ jobs });
  }

  async read(input: ReadJobInput): Promise<ReadJobResult | null> {
    const parsed = ReadJobInputSchema.parse(input);
    return this.jobs.find((job) => job.sourceId === parsed.sourceId) ?? null;
  }
}

export class GuardedScoutTools {
  private readonly visibleSourceIds = new Set<string>();
  private readonly readJobs = new Map<string, ReadJobResult>();

  constructor(
    private readonly input: ScoutWorkerInput,
    private readonly source: ScoutJobSource,
    private readonly guard: RunGuard,
    private readonly audit: AuditSink,
    private readonly now: () => number = Date.now,
  ) {}

  async searchJobs(
    rawInput: unknown,
    toolCallId: string = randomUUID(),
  ): Promise<SearchJobsResult> {
    return this.execute("search_jobs", toolCallId, async () => {
      const input = SearchJobsInputSchema.parse(rawInput);
      this.assertSearchWithinBrief(input);
      const result = SearchJobsResultSchema.parse(
        await this.source.search(input),
      );
      for (const job of result.jobs) this.visibleSourceIds.add(job.sourceId);
      return result;
    });
  }

  async readJob(
    rawInput: unknown,
    toolCallId: string = randomUUID(),
  ): Promise<ReadJobResult> {
    return this.execute("read_job", toolCallId, async () => {
      const input = ReadJobInputSchema.parse(rawInput);
      if (!this.visibleSourceIds.has(input.sourceId)) {
        throw new WorkerFault("TOOL_ERROR");
      }
      const result = await this.source.read(input);
      if (!result) throw new WorkerFault("TOOL_ERROR");
      const parsed = ReadJobResultSchema.parse(result);
      this.readJobs.set(parsed.sourceId, parsed);
      return parsed;
    });
  }

  assertProposalsCameFromTools(
    proposals: Array<{
      sourceId: string;
      title: string;
      company: string;
      location: string;
      remoteType: string;
      url: string;
      source: string;
      postedAt: string;
      jdText: string;
      requirements: string[];
    }>,
  ): void {
    const seen = new Set<string>();
    for (const proposal of proposals) {
      const job = this.readJobs.get(proposal.sourceId);
      if (!job || seen.has(proposal.sourceId)) {
        throw new WorkerFault("OUTPUT_VALIDATION");
      }
      seen.add(proposal.sourceId);
      const evidenceFields = [
        "title",
        "company",
        "location",
        "remoteType",
        "url",
        "source",
        "postedAt",
        "jdText",
      ] as const;
      if (evidenceFields.some((field) => proposal[field] !== job[field])) {
        throw new WorkerFault("OUTPUT_VALIDATION");
      }
      if (
        JSON.stringify(proposal.requirements) !==
        JSON.stringify(job.requirements)
      ) {
        throw new WorkerFault("OUTPUT_VALIDATION");
      }
    }
  }

  private async execute<T>(
    toolName: z.infer<typeof ScoutToolNameSchema>,
    toolCallId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.guard.beforeToolCall();
    const startedAt = this.now();
    await this.audit.write(
      ToolEventSchema.parse({
        contractVersion: "1",
        event: "tool",
        phase: "started",
        timestamp: new Date(startedAt).toISOString(),
        runId: this.input.runId,
        toolName,
        toolCallId,
      }),
    );

    try {
      const result = await operation();
      await this.audit.write(
        ToolEventSchema.parse({
          contractVersion: "1",
          event: "tool",
          phase: "completed",
          timestamp: new Date(this.now()).toISOString(),
          runId: this.input.runId,
          toolName,
          toolCallId,
          durationMs: Math.max(0, Math.round(this.now() - startedAt)),
        }),
      );
      return result;
    } catch (error) {
      await this.audit.write(
        ToolEventSchema.parse({
          contractVersion: "1",
          event: "tool",
          phase: "failed",
          timestamp: new Date(this.now()).toISOString(),
          runId: this.input.runId,
          toolName,
          toolCallId,
          durationMs: Math.max(0, Math.round(this.now() - startedAt)),
        }),
      );
      if (error instanceof WorkerFault) throw error;
      throw new WorkerFault("TOOL_ERROR", { cause: error });
    }
  }

  private assertSearchWithinBrief(input: SearchJobsInput): void {
    const equals = (left: string, right: string) =>
      left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;

    if (
      !this.input.search.targetRoles.some((role) =>
        equals(role, input.targetRole),
      )
    ) {
      throw new WorkerFault("TOOL_ERROR");
    }
    if (
      !this.input.search.locations.some((location) =>
        equals(location, input.location),
      )
    ) {
      throw new WorkerFault("TOOL_ERROR");
    }
    if (!this.input.search.workModes.includes(input.workMode)) {
      throw new WorkerFault("TOOL_ERROR");
    }
    if (input.postedWithinDays > this.input.search.postedWithinDays) {
      throw new WorkerFault("TOOL_ERROR");
    }
    if (input.limit > this.input.search.maxCandidates) {
      throw new WorkerFault("TOOL_ERROR");
    }
  }
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && token !== "engineer"),
  );
}

function hasTokenOverlap(left: Set<string>, right: Set<string>): boolean {
  if (left.size === 0 || right.size === 0) return true;
  return [...left].some((token) => right.has(token));
}
