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
  | { role: "assistant"; content: string; toolCalls?: ToolCall[]; reasoning?: Reasoning[] }
  | { role: "tool"; callId: string; name: string; content: string };

/**
 * A piece of the model's reasoning, kept only to be sent back on the next
 * call. `replay` is the provider's own data for it — on OpenAI, the item id
 * and the encrypted content that lets a request with `store: false` hand the
 * reasoning back without the server keeping it. Opaque outside the adapter:
 * nothing else reads it, and the trace never records it.
 */
export interface Reasoning {
  text: string;
  replay?: Record<string, Record<string, unknown>>;
}

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
  /** The model's reasoning, for the next request to carry back. Empty on most providers. */
  reasoning?: Reasoning[];
  /** Provider-side facts about the call, for the trace. */
  response?: ResponseMeta;
  /**
   * Present only when the call was refused with a 429 and tried again: how
   * many attempts it took and how long was spent waiting between them. The
   * loop takes that time OUT of the round's duration — waiting for an
   * upstream queue is not work, and a trace that counted it as work would
   * show a rate limit as a slow model (MASTER, 23/09).
   */
  backoff?: { attempts: number; waitedMs: number };
}

/**
 * Searches one `webSearch` call may run. Each is billed (0.01 USD on OpenAI,
 * plus the result tokens at input price), and the key proxy on the VPS
 * refuses a request that does not cap them at exactly this.
 */
export const MAX_SEARCHES_PER_CALL = 1;

/**
 * Searches one `webSearch` call is booked for before it runs, as the key
 * proxy books them. The request asks for one, but OpenAI ran two under
 * `max_tool_calls: 1` in 32 of 35 requests of the T13 proxy log, never
 * three; the proxy books twice the most seen (SICUREZZA T19-a). Source: the
 * proxy calibration, agents-hq/piani/t13-vps-res.txt §4.
 */
export const SEARCHES_BOOKED_PER_CALL = 4;

/**
 * Input tokens reserved for one search before it runs: the results come back
 * as input the model reads on the provider's side (at most 12,406 per request
 * in the T13 log). The key proxy's SEARCH_TOKENS, twice that, from the same
 * calibration (agents-hq/piani/t13-vps-res.txt §4).
 */
export const SEARCH_RESERVED_INPUT_TOKENS = 25_000;

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
