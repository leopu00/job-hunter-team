/**
 * The provider port.
 *
 * This is the only surface through which the runtime reaches a model. No call
 * site outside `src/core/provider/` may import an AI SDK symbol — see HHT ADR 0004
 * decision 4. That rule is what keeps the loop replaceable: a different loop is
 * a third implementation of this interface, not a rewrite.
 */

import type { z } from "zod";
import type { ResponseMeta } from "../trace.ts";
import type { Pricing, Usage } from "../usage.ts";

export type ProviderId = "mock" | "anthropic" | "openai" | "openai-compatible";

export interface ModelCapabilities {
  toolCalling: boolean;
  structuredOutput: boolean;
  /** The provider can search the web on the model's behalf (`ProviderPort.webSearch`). */
  webSearch: boolean;
}

/**
 * What a model can do and what it costs. Capabilities are declared here, never
 * inferred from a provider or model name (HHT ADR 0001 decision 5).
 */
export interface ModelProfile {
  providerId: ProviderId;
  modelId: string;
  capabilities: ModelCapabilities;
  /** Null when the price is not known. A live run then refuses to start. */
  pricing: Pricing | null;
  /**
   * Output tokens we ask for when a request does not say. This is our policy,
   * not the model's ceiling: we deliberately do not record per-model ceilings,
   * because a wrong one is a 400 at request time and they change with every
   * release. Keep it comfortably below every model we target.
   */
  defaultMaxOutputTokens: number;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw arguments as returned by the model. Validate before trusting. */
  args: unknown;
}

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  schema: z.ZodType;
}

export type FinishReason =
  | "stop"
  | "tool-calls"
  | "length"
  | "content-filter"
  | "error"
  | "other";

export interface GenerateRequest {
  system: string;
  messages: Message[];
  tools?: ToolSpec[];
  maxOutputTokens?: number;
  /** Wall-clock cap for this one call. A hung request must not hang the run. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: Usage;
  /** Provider-side facts about the call, for the trace. */
  response?: ResponseMeta;
}

export interface WebSearchRequest {
  query: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface WebSearchResult {
  /** The model's digest of what the search found, with the facts it relies on. */
  text: string;
  sources: Array<{ url: string; title?: string }>;
  /** Searches the provider ran and will bill. */
  searches: number;
  usage: Usage;
}

/**
 * Where OpenAI requests go when not straight to api.openai.com: a key proxy
 * on the same host, say, that holds the real key and accepts a placeholder.
 */
export interface OpenAISettings {
  baseURL?: string;
}

/** Endpoint settings for any OpenAI-compatible provider (HHT ADR 0001 decision 2). */
export interface OpenAICompatibleSettings {
  name: string;
  baseURL: string;
  apiKey: string;
}

export interface ProviderPort {
  readonly profile: ModelProfile;
  /** One model call. The loop around it belongs to the runtime, not here. */
  generate(request: GenerateRequest): Promise<GenerateResult>;
  /**
   * A web search run by the provider, answered in one call. Present only when
   * `profile.capabilities.webSearch` is true. Search is a provider feature, not
   * something the runtime can do with a plain HTTP client: the providers own
   * the index.
   */
  webSearch?(request: WebSearchRequest): Promise<WebSearchResult>;
}
