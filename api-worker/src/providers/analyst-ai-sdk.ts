import { Output, generateText, stepCountIs } from "ai";

import {
  AnalystProviderOutputSchema,
  countryCodeFromScoutLocation,
  parseAnalystProviderOutput,
} from "../analyst-contract.js";
import { WorkerFault } from "../errors.js";
import { createAiSdkModel, normalizeAiSdkUsage } from "./ai-sdk-runtime.js";
import { providerDiagnostic } from "./ai-sdk.js";
import type {
  AnalystProviderAdapter,
  AnalystProviderContext,
  AnalystProviderExecution,
} from "./analyst-provider.js";

export class AiSdkAnalystProvider implements AnalystProviderAdapter {
  constructor(private readonly apiKey: string) {}

  async run(
    context: AnalystProviderContext,
  ): Promise<AnalystProviderExecution> {
    const reservations = new Map<number, ReturnType<typeof reserveStep>>();
    const finished = new Set<number>();
    try {
      const result = await generateText({
        model: createAiSdkModel(context.profile, this.apiKey),
        system: context.systemPrompt,
        prompt: context.prompt,
        output: Output.object({
          name: "jht_analyst_proposal_v1",
          description:
            "Proposal-only verification and enrichment for one Scout candidate.",
          schema: AnalystProviderOutputSchema,
        }),
        stopWhen: stepCountIs(context.input.limits.maxSteps),
        maxOutputTokens: context.input.limits.maxOutputTokensPerStep,
        maxRetries: 0,
        abortSignal: context.signal,
        prepareStep: async ({ messages, stepNumber }) => {
          const reservation = reserveStep(
            context,
            JSON.stringify({ system: context.systemPrompt, messages }),
          );
          reservations.set(stepNumber, reservation);
          await context.recordRequestStarted(reservation);
          return {};
        },
        onStepFinish: async ({ stepNumber, usage, finishReason, response }) => {
          const reservation = reservations.get(stepNumber);
          if (!reservation) throw new WorkerFault("INTERNAL_ERROR");
          finished.add(stepNumber);
          await context.recordStep({
            reservation,
            usage: normalizeAiSdkUsage(usage),
            finishReason,
            responseId: response.id,
          });
        },
      });
      return {
        output: parseAnalystProviderOutput(
          result.output,
          countryCodeFromScoutLocation(context.input.position.location),
        ),
        rawStopReason: result.finishReason,
      };
    } catch (error) {
      await Promise.all(
        [...reservations.entries()]
          .filter(([stepNumber]) => !finished.has(stepNumber))
          .map(([, reservation]) =>
            context.recordRequestFailed(reservation, "provider_error"),
          ),
      );
      if (error instanceof WorkerFault) throw error;
      if (context.signal.aborted) {
        throw new WorkerFault("TIMEOUT", {
          retryable: true,
          limit: "timeout_ms",
          cause: error,
        });
      }
      if (process.env.JHT_API_PROVIDER_DEBUG === "1") {
        process.stderr.write(
          `[api-provider-debug] ${JSON.stringify({ role: "analyst", ...providerDiagnostic(error) })}\n`,
        );
      }
      if (error instanceof Error && error.name === "ZodError") {
        throw new WorkerFault("OUTPUT_VALIDATION", { cause: error });
      }
      throw new WorkerFault("PROVIDER_ERROR", {
        retryable: true,
        cause: error,
      });
    }
  }
}

function reserveStep(context: AnalystProviderContext, serialized: string) {
  return context.guard.beforeProviderStep(serialized);
}
