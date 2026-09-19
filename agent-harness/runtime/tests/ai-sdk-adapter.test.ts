/**
 * Tests for the live adapter's mapping, through the real AI SDK.
 *
 * The deterministic provider covers the runtime but goes *around* this file, so
 * without these tests the only code that ever talks to a model would be the only
 * code never executed. A fake language model is injected below: `generateText`,
 * the tool machinery and the message conversion are all the SDK's real ones —
 * what is faked is the HTTP call, nothing above it.
 */

import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AiSdkProvider } from "../src/core/provider/ai-sdk.ts";
import { isHarnessError } from "../src/core/errors.ts";
import type { Message, ModelProfile, ToolSpec } from "../src/core/provider/port.ts";

const PROFILE: ModelProfile = {
  providerId: "anthropic",
  modelId: "claude-sonnet-5",
  capabilities: { toolCalling: true, structuredOutput: true, webSearch: false },
  pricing: { inputPerMTokUsd: 2, outputPerMTokUsd: 10 },
  defaultMaxOutputTokens: 4_096,
};

const USAGE = {
  inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 34, text: 34, reasoning: 0 },
};

const ECHO_TOOL: ToolSpec = {
  name: "submit_result",
  description: "Record the profile.",
  schema: z.object({ mode: z.enum(["rent", "buy"]) }),
};

function providerReturning(result: {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: string }
  >;
  finishReason: { unified: "stop" | "tool-calls"; raw: string | undefined };
}) {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({ ...result, usage: USAGE, warnings: [] }),
  });
  return { model, provider: new AiSdkProvider({ profile: PROFILE, model }) };
}

describe("AiSdkProvider", () => {
  it("maps a plain text answer back through the port", async () => {
    const { provider } = providerReturning({
      content: [{ type: "text", text: "Renting or buying?" }],
      finishReason: { unified: "stop", raw: "end_turn" },
    });

    const result = await provider.generate({
      system: "You are the scout.",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.text).toBe("Renting or buying?");
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 34, cachedInputTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 });
  });

  it("maps a tool call back through the port with parsed arguments", async () => {
    const { provider } = providerReturning({
      content: [
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "submit_result",
          input: JSON.stringify({ mode: "rent" }),
        },
      ],
      finishReason: { unified: "tool-calls", raw: "tool_use" },
    });

    const result = await provider.generate({
      system: "You are the scout.",
      messages: [{ role: "user", content: "renting" }],
      tools: [ECHO_TOOL],
    });

    expect(result.finishReason).toBe("tool-calls");
    expect(result.toolCalls).toEqual([
      { id: "call-1", name: "submit_result", args: { mode: "rent" } },
    ]);
  });

  it("converts a full transcript — user, assistant tool call, tool result", async () => {
    const { provider, model } = providerReturning({
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: "end_turn" },
    });

    const messages: Message[] = [
      { role: "user", content: "renting in Rome" },
      {
        role: "assistant",
        content: "Recording that.",
        toolCalls: [{ id: "call-1", name: "submit_result", args: { mode: "rent" } }],
      },
      {
        role: "tool",
        callId: "call-1",
        name: "submit_result",
        content: "Error: the profile did not validate.",
      },
    ];

    await provider.generate({ system: "You are the scout.", messages, tools: [ECHO_TOOL] });

    const call = model.doGenerateCalls[0];
    expect(call).toBeDefined();
    const prompt = call!.prompt;

    expect(prompt.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);

    const assistant = prompt[2];
    expect(assistant?.role).toBe("assistant");
    expect(assistant?.content).toEqual([
      { type: "text", text: "Recording that." },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "submit_result",
        input: { mode: "rent" },
      },
    ]);

    const toolMessage = prompt[3];
    expect(toolMessage?.role).toBe("tool");
    expect(toolMessage?.content).toEqual([
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "submit_result",
        output: { type: "text", value: "Error: the profile did not validate." },
      },
    ]);
  });

  it("passes the tool through to the model with its JSON schema", async () => {
    const { provider, model } = providerReturning({
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: "end_turn" },
    });

    await provider.generate({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [ECHO_TOOL],
    });

    const tools = model.doGenerateCalls[0]?.tools;
    expect(tools).toHaveLength(1);
    expect(tools?.[0]).toMatchObject({ type: "function", name: "submit_result" });
    // No `execute`: dispatch stays ours, so the SDK hands the call back.
    expect(JSON.stringify(tools?.[0])).toContain("mode");
  });

  it("refuses tools on a model that does not declare tool calling", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({ content: [], finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE, warnings: [] }),
    });
    const provider = new AiSdkProvider({
      profile: { ...PROFILE, capabilities: { toolCalling: false, structuredOutput: false, webSearch: false } },
      model,
    });

    await expect(
      provider.generate({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [ECHO_TOOL] }),
    ).rejects.toSatisfy((e: unknown) => isHarnessError(e) && e.code === "model_incapable");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("wraps a provider failure in the error taxonomy", async () => {
    const provider = new AiSdkProvider({
      profile: PROFILE,
      model: new MockLanguageModelV4({
        doGenerate: async () => {
          throw new Error("connection reset");
        },
      }),
    });

    await expect(
      provider.generate({ system: "s", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toSatisfy((e: unknown) => isHarnessError(e) && e.code === "provider_failed");
  });
});

/**
 * `resolveModel` is the branch the test seam above deliberately bypasses, so it
 * gets its own coverage. Constructing a model performs no request: these assert
 * that both providers we intend to use are actually wired, and that a misuse
 * fails with our error rather than something from inside the SDK.
 */
describe("AiSdkProvider — provider resolution", () => {
  const KEYS = { ANTHROPIC_API_KEY: "test-key", OPENAI_API_KEY: "test-key" };

  function withEnv<T>(fn: () => T): T {
    const saved = { ...process.env };
    Object.assign(process.env, KEYS);
    try {
      return fn();
    } finally {
      for (const key of Object.keys(KEYS)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  }

  it.each([
    ["anthropic", "claude-sonnet-5"],
    ["openai", "gpt-5.6-terra"],
  ] as const)("resolves a %s model", (providerId, modelId) => {
    withEnv(() => {
      const provider = new AiSdkProvider({
        profile: { ...PROFILE, providerId, modelId },
      });
      expect(provider.profile.modelId).toBe(modelId);
    });
  });

  it("resolves an OpenAI-compatible endpoint from its settings", () => {
    const provider = new AiSdkProvider({
      profile: { ...PROFILE, providerId: "openai-compatible", modelId: "some-model" },
      openAICompatible: {
        name: "openai-compatible",
        baseURL: "https://example.invalid/v1",
        apiKey: "test-key",
      },
    });
    expect(provider.profile.providerId).toBe("openai-compatible");
  });

  it("refuses an OpenAI-compatible endpoint with no settings", () => {
    expect(
      () =>
        new AiSdkProvider({
          profile: { ...PROFILE, providerId: "openai-compatible", modelId: "some-model" },
        }),
    ).toThrowError(expect.objectContaining({ code: "config_invalid" }));
  });

  it("refuses to route the mock profile through the SDK", () => {
    expect(
      () => new AiSdkProvider({ profile: { ...PROFILE, providerId: "mock", modelId: "mock-1" } }),
    ).toThrowError(expect.objectContaining({ code: "config_invalid" }));
  });
});

describe("AiSdkProvider — cached tokens", () => {
  it("reports prefix-cache reads separately from the input total", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 1_000, noCache: 200, cacheRead: 800, cacheWrite: 0 },
          outputTokens: { total: 20, text: 20, reasoning: 0 },
        },
        warnings: [],
      }),
    });
    const provider = new AiSdkProvider({ profile: PROFILE, model });
    const result = await provider.generate({ system: "s", messages: [{ role: "user", content: "hi" }] });
    expect(result.usage).toMatchObject({ inputTokens: 1_000, outputTokens: 20, cachedInputTokens: 800 });
  });
});

describe("AiSdkProvider — web search", () => {
  it("counts provider-run searches, keeps unique URL sources and maps usage", async () => {
    const calls: unknown[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        calls.push(options);
        return {
          content: [
            { type: "tool-call", toolCallId: "ws-1", toolName: "web_search", input: '{"query":"tram Monteverde"}', providerExecuted: true },
            { type: "tool-result", toolCallId: "ws-1", toolName: "web_search", result: [] },
            { type: "tool-call", toolCallId: "ws-2", toolName: "web_search", input: '{"query":"tram 8 Roma"}', providerExecuted: true },
            { type: "tool-result", toolCallId: "ws-2", toolName: "web_search", result: [] },
            { type: "source", sourceType: "url", id: "s1", url: "https://example.com/atac", title: "ATAC" },
            { type: "source", sourceType: "url", id: "s2", url: "https://example.com/atac", title: "ATAC again" },
            { type: "text", text: "Tram 8 serves Monteverde." },
          ],
          finishReason: { unified: "stop", raw: "end_turn" },
          usage: USAGE,
          warnings: [],
        };
      },
    });
    const provider = new AiSdkProvider({ profile: { ...PROFILE, capabilities: { ...PROFILE.capabilities, webSearch: true } }, model });

    const result = await provider.webSearch({ query: "tram Monteverde" });

    expect(result).toEqual({
      text: "Tram 8 serves Monteverde.",
      sources: [{ url: "https://example.com/atac", title: "ATAC" }],
      searches: 2,
      usage: { inputTokens: 120, outputTokens: 34, cachedInputTokens: 0 },
    });
    expect(JSON.stringify(calls[0])).toContain("tram Monteverde");
  });

  it("refuses a model not declared as able to search", async () => {
    const { provider } = providerReturning({ content: [], finishReason: { unified: "stop", raw: undefined } });
    await expect(provider.webSearch({ query: "x" })).rejects.toMatchObject({ code: "model_incapable" });
  });
});

describe("OpenAI through a key proxy", () => {
  it("sends the request to the configured base URL, with the placeholder key as is", async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    // The SDK's real OpenAI provider builds the request; only the socket is fake.
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input instanceof Request ? input.url : input), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ error: { message: "offline test", type: "test" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const previous = process.env["OPENAI_API_KEY"];
    process.env["OPENAI_API_KEY"] = "placeholder";
    try {
      const provider = new AiSdkProvider({
        profile: { ...PROFILE, providerId: "openai", modelId: "gpt-5.6-luna" },
        openAI: { baseURL: "http://127.0.0.1:8787/v1" },
        fetch: fakeFetch,
      });
      const error = await provider.generate({ system: "s", messages: [{ role: "user", content: "hi" }] }).catch((e: unknown) => e);
      expect(isHarnessError(error) && error.code).toBe("provider_failed");
    } finally {
      if (previous === undefined) delete process.env["OPENAI_API_KEY"];
      else process.env["OPENAI_API_KEY"] = previous;
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.url.startsWith("http://127.0.0.1:8787/v1/")).toBe(true);
    expect(seen[0]?.auth).toBe("Bearer placeholder");
  });
});

describe("OpenAI web search, as the key proxy admits it", () => {
  it("asks for one search at low context size, and nothing else on the tool", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    // The SDK's real OpenAI provider builds the request; only the socket is fake.
    const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ error: { message: "offline test", type: "test" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const previous = process.env["OPENAI_API_KEY"];
    process.env["OPENAI_API_KEY"] = "placeholder";
    try {
      const provider = new AiSdkProvider({
        profile: { ...PROFILE, providerId: "openai", modelId: "gpt-5.6-luna", capabilities: { ...PROFILE.capabilities, webSearch: true } },
        openAI: { baseURL: "http://127.0.0.1:8787/v1" },
        fetch: fakeFetch,
      });
      await expect(provider.webSearch({ query: "offerte lavoro Roma" })).rejects.toMatchObject({ code: "provider_failed" });
    } finally {
      if (previous === undefined) delete process.env["OPENAI_API_KEY"];
      else process.env["OPENAI_API_KEY"] = previous;
    }
    expect(bodies[0]?.["max_tool_calls"]).toBe(1);
    expect(bodies[0]?.["tools"]).toEqual([{ type: "web_search", search_context_size: "low" }]);
  });
});
