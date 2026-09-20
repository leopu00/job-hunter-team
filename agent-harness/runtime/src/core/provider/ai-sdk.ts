/**
 * The live provider, on the AI SDK.
 *
 * This is the ONLY file in the codebase allowed to import from `ai` or
 * `@ai-sdk/*` (HHT ADR 0004 decision 4). Everything else speaks `ProviderPort`.
 * Keeping the import surface here is what makes the loop swappable.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  APICallError,
  generateText,
  stepCountIs,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ProviderMetadata,
  type ReasoningOutput,
  type ToolSet,
} from "ai";

import { HarnessError } from "../errors.ts";
import type { ResponseMeta } from "../trace.ts";
import type {
  GenerateRequest,
  GenerateResult,
  Message,
  ModelProfile,
  OpenAICompatibleSettings,
  OpenAISettings,
  ProviderPort,
  Reasoning,
  ToolSpec,
  WebSearchRequest,
  WebSearchResult,
} from "./port.ts";
import { MAX_SEARCHES_PER_CALL } from "./port.ts";

/** A single model call that takes longer than this is a stuck call, not a slow one. */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * OpenAI keeps nothing between calls: `store: false`, so no request can point
 * at a stored item (`item_reference`), and every call asks for the reasoning
 * back encrypted, so the next one can carry it in full. The key proxy on the
 * VPS refuses any other shape.
 */
const OPENAI_STATELESS = { store: false, include: ["reasoning.encrypted_content"] };

/**
 * The provider call, and at most one more when the provider said 429 (T27).
 *
 * 12 of 59 refusals in the live runs of 20/09 were upstream 429s, and each
 * one ended a run with the money it had already spent. The SDK does retry a
 * 429 by itself — twice, back to back, with no jitter and without reading
 * `retry-after` — which is how six roles rebuild the very queue that caused
 * the 429. So the SDK's own retrying is turned off (`maxRetries: 0`) and the
 * runtime does it: **one** more attempt, only on 429, after a wait that
 * grows with the attempt, is spread by jitter, and obeys the provider's
 * `retry-after` when it sends one.
 *
 * A 429 is refused before the provider serves anything, so a second attempt
 * bills nothing extra and books nothing extra: the attempts are sequential,
 * one reservation at a time, and the round's worst case is unchanged.
 */
const MAX_ATTEMPTS = 2;

/** First wait, doubled per attempt, before jitter. */
const RETRY_BASE_MS = 2_000;

/** However long the provider asks for, nobody waits more than this. */
const RETRY_MAX_MS = 30_000;

const SEARCH_SYSTEM =
  "Search the web for the query and report what you found: the facts that answer it, " +
  "with numbers, names and dates as the sources state them. Say plainly when the " +
  "sources disagree or when nothing relevant was found. No preamble.";

export class AiSdkProvider implements ProviderPort {
  readonly profile: ModelProfile;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  #model: LanguageModel;

  constructor(options: {
    profile: ModelProfile;
    openAICompatible?: OpenAICompatibleSettings | undefined;
    openAI?: OpenAISettings | undefined;
    /**
     * Test seam: the HTTP client the OpenAI provider uses, so where a request
     * goes and with which key can be checked without a network. Production
     * never passes it.
     */
    fetch?: typeof globalThis.fetch | undefined;
    /**
     * Test seam. Supplying a model skips provider resolution, so the mapping
     * below can be exercised through the real AI SDK code path without a key
     * and without a network call. Production never passes it.
     */
    model?: LanguageModel | undefined;
    /**
     * The wait before the second attempt of a 429, for tests that must not
     * sleep for real: a wait of seconds makes a test slow and, with jitter,
     * unstable. Production never passes it.
     */
    sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
  }) {
    this.profile = options.profile;
    this.#sleep = options.sleep ?? wait;
    this.#model =
      options.model ?? resolveModel(options.profile, options.openAICompatible, options.openAI, options.fetch);
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    if (request.tools?.length && !this.profile.capabilities.toolCalling) {
      throw new HarnessError(
        "model_incapable",
        `Model ${this.profile.modelId} is not declared as tool-calling, but tools were requested.`,
      );
    }

    try {
      const result = await attempt(() => generateText({
        model: this.#model,
        system: request.system,
        messages: request.messages.map(toModelMessage),
        tools: toToolSet(request.tools ?? []),
        ...(this.profile.providerId === "openai" ? { providerOptions: { openai: OPENAI_STATELESS } } : {}),
        // The loop belongs to the runtime. One model call per `generate`.
        stopWhen: stepCountIs(1),
        // The retrying is the runtime's (`attempt`), not the SDK's.
        maxRetries: 0,
        maxOutputTokens: request.maxOutputTokens ?? this.profile.defaultMaxOutputTokens,
        timeout: { totalMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS },
        ...(request.signal ? { abortSignal: request.signal } : {}),
      }), request.signal, this.#sleep);

      return {
        text: result.text,
        toolCalls: result.toolCalls.map((call) => ({
          id: call.toolCallId,
          name: call.toolName,
          args: call.input,
        })),
        finishReason: result.finishReason,
        reasoning: result.reasoning
          .filter((part): part is ReasoningOutput => part.type === "reasoning")
          .map((part): Reasoning => ({ text: part.text, ...(part.providerMetadata ? { replay: part.providerMetadata } : {}) })),
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          cachedInputTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
          cacheWriteTokens: result.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
          reasoningTokens: result.usage.outputTokenDetails?.reasoningTokens ?? 0,
        },
        response: responseMeta(result.response),
      };
    } catch (cause) {
      if (cause instanceof HarnessError) throw cause;
      throw new HarnessError("provider_failed", "The provider call failed.", { cause });
    }
  }

  async webSearch(request: WebSearchRequest): Promise<WebSearchResult> {
    if (!this.profile.capabilities.webSearch) {
      throw new HarnessError("model_incapable", `Model ${this.profile.modelId} is not declared as able to search the web.`);
    }
    try {
      const result = await attempt(() => generateText({
        model: this.#model,
        system: SEARCH_SYSTEM,
        prompt: request.query,
        tools: searchToolSet(this.profile),
        // OpenAI's cap on built-in tool calls lives on the request, not on the tool.
        ...(this.profile.providerId === "openai"
          ? { providerOptions: { openai: { ...OPENAI_STATELESS, maxToolCalls: MAX_SEARCHES_PER_CALL } } }
          : {}),
        // Server-side search runs inside this one call; there is no client step to loop over.
        stopWhen: stepCountIs(1),
        maxRetries: 0,
        maxOutputTokens: this.profile.defaultMaxOutputTokens,
        timeout: { totalMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS },
        ...(request.signal ? { abortSignal: request.signal } : {}),
      }), request.signal, this.#sleep);

      const seen = new Set<string>();
      const sources: WebSearchResult["sources"] = [];
      for (const source of result.sources) {
        if (source.sourceType !== "url" || seen.has(source.url)) continue;
        seen.add(source.url);
        sources.push({ url: source.url, ...(source.title ? { title: source.title } : {}) });
      }

      return {
        text: result.text,
        sources,
        // A failed search is not billed, but we cannot tell which failed: count
        // every search call, which errs towards overstating spend.
        searches: result.content.filter((part) => part.type === "tool-call" && part.providerExecuted).length,
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          cachedInputTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
          // A search writes to the cache too (19/09 calibration: 4,400 of 8,712).
          cacheWriteTokens: result.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
        },
      };
    } catch (cause) {
      if (cause instanceof HarnessError) throw cause;
      throw new HarnessError("provider_failed", "The provider call failed.", { cause });
    }
  }
}

/** Id, serving model and rate-limit headers. Never the body: that is the reply itself. */
function responseMeta(response: { id?: string; modelId?: string; headers?: Record<string, string> }): ResponseMeta {
  const rateLimit = Object.fromEntries(
    Object.entries(response.headers ?? {}).filter(([name]) => /ratelimit/i.test(name)),
  );
  return {
    ...(response.id ? { id: response.id } : {}),
    ...(response.modelId ? { modelId: response.modelId } : {}),
    ...(Object.keys(rateLimit).length > 0 ? { rateLimit } : {}),
  };
}

function resolveModel(
  profile: ModelProfile,
  compatible: OpenAICompatibleSettings | undefined,
  openAISettings: OpenAISettings | undefined,
  fetchImpl: typeof globalThis.fetch | undefined,
): LanguageModel {
  switch (profile.providerId) {
    case "anthropic":
      return anthropic(profile.modelId);
    case "openai":
      // The key is whatever OPENAI_API_KEY holds: behind a key proxy it is a
      // placeholder, so nothing here checks its shape.
      return openAISettings?.baseURL || fetchImpl
        ? createOpenAI({
            ...(openAISettings?.baseURL ? { baseURL: openAISettings.baseURL } : {}),
            ...(fetchImpl ? { fetch: fetchImpl } : {}),
          })(profile.modelId)
        : openai(profile.modelId);
    case "openai-compatible": {
      if (!compatible) {
        throw new HarnessError(
          "config_invalid",
          "Provider 'openai-compatible' needs a base URL and an API key.",
        );
      }
      return createOpenAICompatible(compatible)(profile.modelId);
    }
    case "mock":
      throw new HarnessError("config_invalid", "The mock provider does not go through the AI SDK.");
  }
}

function toModelMessage(message: Message): ModelMessage {
  switch (message.role) {
    case "user":
      return { role: "user", content: message.content };

    case "assistant": {
      if (!message.toolCalls?.length && !message.reasoning?.length) {
        return { role: "assistant", content: message.content };
      }
      return {
        role: "assistant",
        content: [
          // Reasoning first, as the model produced it, with the provider's data
          // for it: on OpenAI that is what becomes a full reasoning item.
          ...(message.reasoning ?? []).map((part) => ({
            type: "reasoning" as const,
            text: part.text,
            ...(part.replay ? { providerOptions: part.replay as ProviderMetadata } : {}),
          })),
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...(message.toolCalls ?? []).map((call) => ({
            type: "tool-call" as const,
            toolCallId: call.id,
            toolName: call.name,
            input: call.args,
          })),
        ],
      };
    }

    case "tool":
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.callId,
            toolName: message.name,
            output: { type: "text", value: message.content },
          },
        ],
      };
  }
}

/**
 * Tools are declared without an `execute`, so the SDK hands the call back to us
 * instead of running it. Dispatch is the runtime's, and it is closed: an
 * unknown tool name is rejected by the caller, never invoked.
 */
function toToolSet(specs: ToolSpec[]): ToolSet {
  // The cast is the price of a runtime tool list: `ToolSet` is written for a
  // literal object whose tool types the SDK can infer, and our specs arrive as
  // an array. Nothing is loosened at runtime — every schema is still a real one.
  return Object.fromEntries(
    specs.map((spec) => [
      spec.name,
      tool({ description: spec.description, inputSchema: spec.schema }),
    ]),
  ) as ToolSet;
}

/**
 * The provider's own search tool. Executed on the provider's side, so unlike
 * `toToolSet` these tools never come back to the runtime as calls to dispatch.
 */
function searchToolSet(profile: ModelProfile): ToolSet {
  switch (profile.providerId) {
    case "openai":
      // `low`: the fewest result tokens, which are billed at the model's input
      // price. It is also the only shape the key proxy lets through.
      return { web_search: openai.tools.webSearch({ searchContextSize: "low" }) } as ToolSet;
    case "anthropic":
      return { web_search: anthropic.tools.webSearch_20250305({ maxUses: MAX_SEARCHES_PER_CALL }) } as ToolSet;
    default:
      throw new HarnessError("model_incapable", `Provider '${profile.providerId}' has no web search.`);
  }
}

/**
 * Runs `call`, and on a 429 waits and runs it once more. Everything else is
 * raised as it comes: a 500, a timeout or a bad request is not a queue.
 */
export async function attempt<T>(
  call: () => Promise<T>,
  signal?: AbortSignal,
  sleep: (ms: number, signal?: AbortSignal) => Promise<void> = wait,
): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await call();
    } catch (error) {
      const waitMs = retryAfterMs(error, n);
      if (n >= MAX_ATTEMPTS || waitMs === null || signal?.aborted) throw error;
      await sleep(waitMs, signal);
      // A stop that arrives while we wait ends the wait, and the run: §9 says
      // the operator's stop is immediate, and a `retry-after` of half a minute
      // would otherwise hold the role for all of it (SICUREZZA, T27).
      if (signal?.aborted) throw error;
    }
  }
}

/** The wait before another attempt, or null when the error is not a 429. */
function retryAfterMs(error: unknown, attemptNumber = 1): number | null {
  if (!is429(error)) return null;
  const asked = retryAfterHeader(error);
  // The provider's own figure when it sends one; otherwise a wait that grows
  // with the attempt. Jitter either way: without it the roles that were
  // refused together come back together, and the queue forms again.
  const base = asked ?? RETRY_BASE_MS * 2 ** (attemptNumber - 1);
  return Math.min(RETRY_MAX_MS, Math.round(base * (0.75 + Math.random() * 0.5)));
}

/**
 * A 429 from the provider, however the SDK wrapped it. The depth is bounded:
 * a chain that loops back on itself would otherwise never end, and no error
 * of the SDK's nests five deep (SICUREZZA, T27).
 */
function is429(error: unknown, depth = 0): boolean {
  if (depth > 5) return false;
  if (APICallError.isInstance(error) && error.statusCode === 429) return true;
  const errors = (error as { errors?: unknown })?.errors;
  if (Array.isArray(errors) && errors.some((e) => is429(e, depth + 1))) return true;
  const cause = (error as { cause?: unknown })?.cause;
  return cause !== undefined && cause !== error && is429(cause, depth + 1);
}

/** `retry-after`, in milliseconds, when the provider sent one in seconds. */
function retryAfterHeader(error: unknown): number | null {
  const headers = APICallError.isInstance(error) ? error.responseHeaders : undefined;
  const raw = headers?.["retry-after"];
  if (raw === undefined) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
}

/** Waits `ms`, or until the run is abandoned, whichever comes first. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((done) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      done();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}
