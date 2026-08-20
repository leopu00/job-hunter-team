import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelUsage, ToolSet } from "ai";

import type { Usage } from "../contract.js";
import { WorkerFault } from "../errors.js";
import type { ModelProfile } from "../model-profile.js";

export function createAiSdkModel(profile: ModelProfile, apiKey: string) {
  switch (profile.provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(profile.model);
    case "openai":
      return createOpenAI({ apiKey })(profile.model);
    case "kimi":
      if (!profile.baseUrl) throw new WorkerFault("PROFILE_VALIDATION");
      return createOpenAICompatible({
        name: "kimi",
        apiKey,
        baseURL: profile.baseUrl,
      })(profile.model);
    case "mock":
      throw new WorkerFault("INTERNAL_ERROR");
  }
}

export function createProviderWebSearchTool(
  profile: ModelProfile,
  apiKey: string,
  maxUses: number,
): ToolSet[string] {
  switch (profile.provider) {
    case "anthropic":
      return createAnthropic({ apiKey }).tools.webSearch_20260209({ maxUses });
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

export function normalizeAiSdkUsage(usage: LanguageModelUsage): Usage {
  const inputTokens = finiteTokenCount(usage.inputTokens);
  const outputTokens = finiteTokenCount(usage.outputTokens);
  const cacheReadTokens = finiteTokenCount(
    usage.inputTokenDetails?.cacheReadTokens,
  );
  const cacheWriteTokens = finiteTokenCount(
    usage.inputTokenDetails?.cacheWriteTokens,
  );
  const noCacheTokens =
    optionalTokenCount(usage.inputTokenDetails?.noCacheTokens) ??
    Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens);
  const reasoningTokens = finiteTokenCount(
    usage.outputTokenDetails?.reasoningTokens,
  );
  return {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens,
      cacheReadTokens,
      cacheWriteTokens,
    },
    outputTokens,
    outputTokenDetails: {
      textTokens:
        optionalTokenCount(usage.outputTokenDetails?.textTokens) ??
        Math.max(0, outputTokens - reasoningTokens),
      reasoningTokens,
    },
    totalTokens:
      finiteTokenCount(usage.totalTokens) || inputTokens + outputTokens,
  };
}

function finiteTokenCount(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined
    ? Math.max(0, Math.round(value))
    : 0;
}

function optionalTokenCount(value: number | undefined): number | undefined {
  return value === undefined ? undefined : finiteTokenCount(value);
}
