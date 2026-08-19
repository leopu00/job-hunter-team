import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Output, generateText, stepCountIs, tool } from "ai";

import { ScoutProposalBatchSchema, type Usage } from "../contract.js";
import { WorkerFault } from "../errors.js";
import type { StepReservation } from "../guardrails.js";
import {
  SearchJobsInputSchema,
  SearchJobsResultSchema,
  ReadJobInputSchema,
  ReadJobResultSchema,
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
    const reservations = new Map<number, StepReservation>();

    try {
      const result = await generateText({
        model,
        system: context.systemPrompt,
        prompt: context.prompt,
        tools: {
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
        },
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
        onStepFinish: async ({ stepNumber, usage, finishReason }) => {
          const reservation = reservations.get(stepNumber);
          if (!reservation) throw new WorkerFault("INTERNAL_ERROR");
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
      if (context.signal.aborted) {
        throw new WorkerFault("TIMEOUT", {
          retryable: true,
          limit: "timeout_ms",
          cause: error,
        });
      }
      throw new WorkerFault("PROVIDER_ERROR", {
        retryable: true,
        cause: error,
      });
    }
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
