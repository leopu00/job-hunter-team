import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  NoObjectGeneratedError,
  Output,
  generateText,
  stepCountIs,
  tool,
  type ToolSet,
} from "ai";

import { ScoutProposalBatchSchema, type Usage } from "../contract.js";
import { WorkerFault } from "../errors.js";
import type { StepReservation } from "../guardrails.js";
import {
  SearchJobsInputSchema,
  SearchJobsResultSchema,
  ReadJobInputSchema,
  ReadJobResultSchema,
  ReadWebJobInputSchema,
  ReadWebJobEvidenceSchema,
} from "../tools.js";
import type {
  ProviderExecution,
  ProviderExecutionContext,
  ScoutProviderAdapter,
} from "./provider.js";

export class AiSdkScoutProvider implements ScoutProviderAdapter {
  constructor(private readonly apiKey: string) {}

  async run(context: ProviderExecutionContext): Promise<ProviderExecution> {
    const model = createModel(context, this.apiKey);
    const tools = createTools(context, this.apiKey);
    const reservations = new Map<number, StepReservation>();

    try {
      const result = await generateText({
        model,
        system: context.systemPrompt,
        prompt: context.prompt,
        tools,
        output: Output.object({
          name: "jht_scout_proposals_v1",
          description:
            "Proposal-only Scout output. It is never a database write or downstream hand-off.",
          schema: ScoutProposalBatchSchema,
        }),
        stopWhen: stepCountIs(context.input.limits.maxSteps),
        maxOutputTokens: context.input.limits.maxOutputTokensPerStep,
        maxRetries: 0,
        abortSignal: context.signal,
        prepareStep: ({ messages, stepNumber }) => {
          const serialized = JSON.stringify({
            system: context.systemPrompt,
            messages,
          });
          reservations.set(
            stepNumber,
            context.guard.beforeProviderStep(serialized),
          );
          return {};
        },
        onStepFinish: async ({
          stepNumber,
          usage,
          finishReason,
          toolCalls,
        }) => {
          const reservation = reservations.get(stepNumber);
          if (!reservation) throw new WorkerFault("INTERNAL_ERROR");
          context.guard.recordWebSearchCalls(
            toolCalls.filter((call) => call.toolName === "web_search").length,
          );
          await context.recordStep({
            reservation,
            usage: normalizeUsage(usage),
            finishReason,
          });
        },
      });

      return {
        output: ScoutProposalBatchSchema.parse(result.output),
        rawStopReason: result.finishReason,
      };
    } catch (error) {
      if (error instanceof WorkerFault) throw error;
      const recovered = recoverGeneratedObject(error);
      if (recovered) return recovered;
      if (context.signal.aborted) {
        throw new WorkerFault("TIMEOUT", {
          retryable: true,
          limit: "timeout_ms",
          cause: error,
        });
      }
      writeProviderDiagnostic(error);
      throw new WorkerFault("PROVIDER_ERROR", {
        retryable: true,
        cause: error,
      });
    }
  }
}

function createTools(
  context: ProviderExecutionContext,
  apiKey: string,
): ToolSet {
  if (context.discoveryMode === "web") {
    return {
      web_search: createWebSearchTool(context, apiKey),
      read_web_job: tool({
        description:
          "Read one public HTTPS job URL through an adaptive HTTP/browser cascade. It returns either deterministic structured fields or bounded visible page evidence. Call it for every candidate and ground every proposal in its output.",
        inputSchema: ReadWebJobInputSchema,
        outputSchema: ReadWebJobEvidenceSchema,
        execute: (input, options) =>
          context.tools.readWebJob(input, options.toolCallId),
      }),
    };
  }
  return {
    search_jobs: tool({
      description:
        "Search only the configured JHT job source using one target role, location and work mode from the explicit search brief.",
      inputSchema: SearchJobsInputSchema,
      outputSchema: SearchJobsResultSchema,
      execute: (input, options) =>
        context.tools.searchJobs(input, options.toolCallId),
    }),
    read_job: tool({
      description:
        "Read one job that was returned by search_jobs in this run. It cannot open arbitrary URLs or identifiers.",
      inputSchema: ReadJobInputSchema,
      outputSchema: ReadJobResultSchema,
      execute: (input, options) =>
        context.tools.readJob(input, options.toolCallId),
    }),
  };
}

function createWebSearchTool(
  context: ProviderExecutionContext,
  apiKey: string,
): ToolSet[string] {
  switch (context.profile.provider) {
    case "anthropic":
      return createAnthropic({ apiKey }).tools.webSearch_20260209({
        maxUses: context.input.limits.maxWebSearches,
      });
    case "openai":
      return createOpenAI({ apiKey }).tools.webSearch({
        externalWebAccess: true,
        searchContextSize: "high",
      });
    case "kimi":
    case "mock":
      throw new WorkerFault("CAPABILITY_UNSUPPORTED");
  }
}

function createModel(context: ProviderExecutionContext, apiKey: string) {
  switch (context.profile.provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(context.profile.model);
    case "openai":
      return createOpenAI({ apiKey })(context.profile.model);
    case "kimi": {
      if (!context.profile.baseUrl) {
        throw new WorkerFault("PROFILE_VALIDATION");
      }
      return createOpenAICompatible({
        name: "kimi",
        apiKey,
        baseURL: context.profile.baseUrl,
      })(context.profile.model);
    }
    case "mock":
      throw new WorkerFault("INTERNAL_ERROR");
  }
}

function normalizeUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): Usage {
  const inputTokens = finiteTokenCount(usage.inputTokens);
  const outputTokens = finiteTokenCount(usage.outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      finiteTokenCount(usage.totalTokens) || inputTokens + outputTokens,
  };
}

function finiteTokenCount(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined
    ? Math.max(0, Math.round(value))
    : 0;
}

function writeProviderDiagnostic(error: unknown): void {
  if (process.env.JHT_SCOUT_PROVIDER_DEBUG !== "1") return;
  const diagnostic: Record<string, unknown> = {
    name: error instanceof Error ? error.name : "UnknownError",
    message:
      error instanceof Error
        ? redactSecrets(error.message).slice(0, 2_000)
        : "Non-Error provider failure",
  };
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    diagnostic.statusCode = error.statusCode;
  }
  if (NoObjectGeneratedError.isInstance(error)) {
    diagnostic.finishReason = error.finishReason;
    diagnostic.validationIssues = generatedObjectValidationIssues(
      error.text ?? "",
    );
  }
  process.stderr.write(
    `[scout-provider-debug] ${JSON.stringify(diagnostic)}\n`,
  );
}

function recoverGeneratedObject(error: unknown): ProviderExecution | undefined {
  if (!NoObjectGeneratedError.isInstance(error)) return undefined;
  if (!error.text) return undefined;
  try {
    const raw = JSON.parse(error.text) as unknown;
    normalizeGeneratedDates(raw);
    const parsed = ScoutProposalBatchSchema.safeParse(raw);
    if (!parsed.success) return undefined;
    return { output: parsed.data, rawStopReason: error.finishReason ?? "stop" };
  } catch {
    return undefined;
  }
}

function normalizeGeneratedDates(value: unknown): void {
  if (typeof value !== "object" || value === null || !("proposals" in value)) {
    return;
  }
  const proposals = (value as { proposals?: unknown }).proposals;
  if (!Array.isArray(proposals)) return;
  for (const proposal of proposals) {
    if (
      typeof proposal !== "object" ||
      proposal === null ||
      !("postedAt" in proposal) ||
      typeof proposal.postedAt !== "string"
    ) {
      continue;
    }
    const normalized = normalizeHumanDate(proposal.postedAt);
    if (normalized) proposal.postedAt = normalized;
  }
}

function normalizeHumanDate(value: string): string | undefined {
  const candidates = [
    value,
    value.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0],
    value.match(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i,
    )?.[0],
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const timestamp = Date.parse(candidate);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return undefined;
}

function generatedObjectValidationIssues(text: string): unknown[] {
  try {
    const parsed = ScoutProposalBatchSchema.safeParse(JSON.parse(text));
    if (parsed.success) return [];
    return parsed.error.issues.slice(0, 12).map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
      message: issue.message,
    }));
  } catch (error) {
    return [
      {
        path: "",
        code: "invalid_json",
        message:
          error instanceof Error ? error.message.slice(0, 300) : "Invalid JSON",
      },
    ];
  }
}

function redactSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]");
}
