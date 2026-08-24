import {
  NoObjectGeneratedError,
  Output,
  generateText,
  stepCountIs,
  tool,
  type ToolSet,
} from "ai";

import { ScoutProposalBatchSchema } from "../contract.js";
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
import {
  createAiSdkModel,
  createProviderWebSearchTool,
  normalizeAiSdkUsage,
} from "./ai-sdk-runtime.js";

export class AiSdkScoutProvider implements ScoutProviderAdapter {
  constructor(private readonly apiKey: string) {}

  async run(context: ProviderExecutionContext): Promise<ProviderExecution> {
    const model = createAiSdkModel(context.profile, this.apiKey);
    const tools = createTools(context, this.apiKey);
    const reservations = new Map<number, StepReservation>();
    const finishedSteps = new Set<number>();

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
        prepareStep: async ({ messages, stepNumber }) => {
          const serialized = JSON.stringify({
            system: context.systemPrompt,
            messages,
          });
          const reservation = context.guard.beforeProviderStep(serialized);
          reservations.set(stepNumber, reservation);
          await context.recordRequestStarted(reservation);
          return {};
        },
        onStepFinish: async ({
          stepNumber,
          usage,
          finishReason,
          toolCalls,
          response,
        }) => {
          const reservation = reservations.get(stepNumber);
          if (!reservation) throw new WorkerFault("INTERNAL_ERROR");
          const webSearchCalls = toolCalls.filter(
            (call) => call.toolName === "web_search",
          ).length;
          // The provider response already exists at this point. Mark the
          // attempt finished before post-response accounting can reject it.
          finishedSteps.add(stepNumber);
          await context.recordStep({
            reservation,
            usage: normalizeAiSdkUsage(usage),
            finishReason,
            webSearchCalls,
            responseId: response.id,
          });
        },
      });

      return {
        output: ScoutProposalBatchSchema.parse(result.output),
        rawStopReason: result.finishReason,
      };
    } catch (error) {
      await Promise.all(
        [...reservations.entries()]
          .filter(([stepNumber]) => !finishedSteps.has(stepNumber))
          .map(([, reservation]) =>
            context.recordRequestFailed(reservation, "provider_error"),
          ),
      );
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
      return createProviderWebSearchTool(
        context.profile,
        apiKey,
        context.input.limits.maxWebSearches,
      );
    case "openai":
      return createProviderWebSearchTool(
        context.profile,
        apiKey,
        context.input.limits.maxWebSearches,
      );
    case "kimi":
    case "mock":
      throw new WorkerFault("CAPABILITY_UNSUPPORTED");
  }
}

export function writeProviderDiagnostic(error: unknown): void {
  if (process.env.JHT_SCOUT_PROVIDER_DEBUG !== "1") return;
  process.stderr.write(
    `[scout-provider-debug] ${JSON.stringify(providerDiagnostic(error))}\n`,
  );
}

export function providerDiagnostic(error: unknown): Record<string, unknown> {
  const validationIssues = allowlistedValidationIssues(error);
  const diagnostic: Record<string, unknown> = {
    category: NoObjectGeneratedError.isInstance(error)
      ? "invalid_structured_output"
      : providerStatusCode(error) !== undefined
        ? "provider_http_error"
        : validationIssues.length > 0
          ? "output_validation"
          : "provider_error",
  };
  const statusCode = providerStatusCode(error);
  if (statusCode !== undefined) diagnostic.statusCode = statusCode;
  Object.assign(diagnostic, allowlistedProviderErrorFields(error));
  if (validationIssues.length > 0)
    diagnostic.validationIssues = validationIssues;
  if (NoObjectGeneratedError.isInstance(error)) {
    diagnostic.finishReason = allowlistedFinishReason(error.finishReason);
    diagnostic.validationCodes = generatedObjectValidationCodes(
      error.text ?? "",
    );
  }
  return diagnostic;
}

function allowlistedValidationIssues(
  error: unknown,
): Array<{ code: string; path: string }> {
  if (
    typeof error !== "object" ||
    error === null ||
    !("issues" in error) ||
    !Array.isArray(error.issues)
  ) {
    return [];
  }
  const allowedCodes = new Set([
    "custom",
    "invalid_element",
    "invalid_format",
    "invalid_key",
    "invalid_type",
    "invalid_union",
    "invalid_value",
    "not_multiple_of",
    "too_big",
    "too_small",
    "unrecognized_keys",
  ]);
  const issues: Array<{ code: string; path: string }> = [];
  for (const rawIssue of error.issues.slice(0, 12)) {
    if (typeof rawIssue !== "object" || rawIssue === null) continue;
    const issue = rawIssue as { code?: unknown; path?: unknown };
    if (typeof issue.code !== "string" || !allowedCodes.has(issue.code)) {
      continue;
    }
    const path = Array.isArray(issue.path)
      ? issue.path
          .filter(
            (part): part is string | number =>
              typeof part === "number" ||
              (typeof part === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(part)),
          )
          .join(".")
      : "";
    issues.push({ code: issue.code, path });
  }
  return issues;
}

function allowlistedProviderErrorFields(
  error: unknown,
): Record<string, string> {
  if (
    typeof error !== "object" ||
    error === null ||
    !("responseBody" in error) ||
    typeof error.responseBody !== "string"
  ) {
    return {};
  }
  try {
    const body = JSON.parse(error.responseBody) as {
      error?: {
        type?: unknown;
        code?: unknown;
        param?: unknown;
        message?: unknown;
      };
    };
    const fields: Record<string, string> = {};
    const type = allowlistedProviderIdentifier(body.error?.type);
    const code = allowlistedProviderIdentifier(body.error?.code);
    const param = allowlistedProviderIdentifier(body.error?.param);
    if (type) fields.providerType = type;
    if (code) fields.providerCode = code;
    if (param) fields.providerParam = param;
    const schemaKeyword = allowlistedSchemaKeyword(body.error?.message);
    if (schemaKeyword) fields.schemaKeyword = schemaKeyword;
    return fields;
  } catch {
    return {};
  }
}

function allowlistedSchemaKeyword(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  const keywords = [
    "$schema",
    "format",
    "pattern",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
    "const",
    "additionalProperties",
    "required",
  ];
  return keywords.find((keyword) => normalized.includes(keyword.toLowerCase()));
}

function allowlistedProviderIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^[a-zA-Z0-9_.\-[\]]{1,100}$/.test(value) ? value : undefined;
}

function providerStatusCode(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode <= 599
  ) {
    return error.statusCode;
  }
  return undefined;
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

function allowlistedFinishReason(value: string | undefined): string {
  const allowed = new Set([
    "stop",
    "length",
    "content-filter",
    "tool-calls",
    "error",
    "other",
    "unknown",
  ]);
  return value && allowed.has(value) ? value : "unknown";
}

function generatedObjectValidationCodes(text: string): string[] {
  const allowedCodes = new Set([
    "custom",
    "invalid_element",
    "invalid_format",
    "invalid_key",
    "invalid_type",
    "invalid_union",
    "invalid_value",
    "not_multiple_of",
    "too_big",
    "too_small",
    "unrecognized_keys",
  ]);
  try {
    const parsed = ScoutProposalBatchSchema.safeParse(JSON.parse(text));
    if (parsed.success) return [];
    return [
      ...new Set(
        parsed.error.issues
          .map((issue) => issue.code)
          .filter((code) => allowedCodes.has(code)),
      ),
    ].slice(0, 12);
  } catch {
    return ["invalid_json"];
  }
}
