/**
 * Deterministic provider.
 *
 * The default everywhere (HHT ADR 0003 and 0004, decision 4): the whole
 * runtime must be exercisable without a key, without a network and without
 * spending. It answers from a script, so a test asserts on an agent's control
 * flow rather than on a model's mood.
 */

import { HarnessError } from "../errors.ts";
import type { Usage } from "../usage.ts";
import type {
  GenerateRequest,
  GenerateResult,
  ModelProfile,
  ProviderPort,
  WebSearchRequest,
  WebSearchResult,
} from "./port.ts";

/** One scripted turn. `toolCalls` omitted means a plain text reply. */
export interface ScriptedTurn {
  text?: string;
  toolCalls?: Array<{ name: string; args: unknown }>;
  usage?: Usage;
}

export const MOCK_PROFILE: ModelProfile = {
  providerId: "mock",
  modelId: "mock-1",
  capabilities: { toolCalling: true, structuredOutput: true, webSearch: true },
  pricing: { inputPerMTokUsd: 0, outputPerMTokUsd: 0 },
  defaultMaxOutputTokens: 4_096,
};

export class MockProvider implements ProviderPort {
  readonly profile: ModelProfile = MOCK_PROFILE;

  /** Every request the provider was given, in order. Handy in assertions. */
  readonly requests: GenerateRequest[] = [];

  /** Every search the provider was asked for, in order. */
  readonly searches: WebSearchRequest[] = [];

  #script: ScriptedTurn[];
  #index = 0;
  #searchScript: WebSearchResult[];

  constructor(script: ScriptedTurn[], options: { searches?: WebSearchResult[] } = {}) {
    this.#script = script;
    this.#searchScript = [...(options.searches ?? [])];
  }

  async webSearch(request: WebSearchRequest): Promise<WebSearchResult> {
    this.searches.push(request);
    return (
      this.#searchScript.shift() ?? {
        text: `The mock provider does not search the web; nothing was found for "${request.query}".`,
        sources: [],
        searches: 0,
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      }
    );
  }

  get remaining(): number {
    return this.#script.length - this.#index;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    // A snapshot, as a real provider would serialise it: the session keeps
    // appending to the same array, and a test must see what the model saw.
    this.requests.push({ ...request, messages: [...request.messages] });

    const turn = this.#script[this.#index];
    if (turn === undefined) {
      throw new HarnessError(
        "provider_failed",
        `The mock script ran out after ${this.#index} turns.`,
      );
    }
    this.#index += 1;

    const toolCalls = (turn.toolCalls ?? []).map((call, i) => ({
      id: `mock-call-${this.#index}-${i}`,
      name: call.name,
      args: call.args,
    }));

    return {
      text: turn.text ?? "",
      toolCalls,
      finishReason: toolCalls.length > 0 ? "tool-calls" : "stop",
      usage: turn.usage ?? { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 },
    };
  }
}
