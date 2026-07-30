/**
 * Test unitari — AgentRunner (esecuzione turno agente)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgentTurn, onAgentEvent, type LLMProviderFn } from "./agent-runner.js";
import type { ResolvedAgent, AgentEvent } from "./types.js";
import type { Tool } from "../tools/types.js";

const agent: ResolvedAgent = {
  id: "t", name: "T", model: "m", provider: "p",
  workspaceDir: "/tmp/t", agentDir: "/tmp/a/t", thinking: "medium", contextTokens: 200_000,
};

function textLLM(text: string): LLMProviderFn {
  return async () => ({
    content: text, stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 },
  });
}

function toolLLM(): LLMProviderFn {
  let n = 0;
  return async () => {
    if (++n === 1) return {
      content: "", stop_reason: "tool_use" as const,
      tool_calls: [{ id: "tc1", name: "echo", arguments: '{"x":1}' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    return { content: "done", stop_reason: "end_turn" as const, usage: { input_tokens: 15, output_tokens: 3 } };
  };
}

const echoTool: Tool = {
  name: "echo", label: "Echo", description: "echo",
  execute: async (_id, args) => ({ content: [{ type: "text", text: JSON.stringify(args) }], details: {} }),
};

describe("AgentRunner", () => {
  it("turno semplice ritorna testo", async () => {
    const r = await runAgentTurn(agent, { message: "ciao" }, textLLM("Risposta"));
    assert.equal(r.stopReason, "end_turn");
    assert.equal(r.payloads.length, 1);
    assert.equal(r.payloads[0].kind, "text");
  });

  it("tool loop: chiama tool e completa", async () => {
    const r = await runAgentTurn(agent, { message: "go", tools: [echoTool] }, toolLLM());
    const kinds = r.payloads.map((p) => p.kind);
    assert.ok(kinds.includes("tool_use"));
    assert.ok(kinds.includes("tool_result"));
    assert.ok(kinds.includes("text"));
  });

  it("tool non trovato ritorna messaggio errore", async () => {
    let n = 0;
    const llm: LLMProviderFn = async () => {
      if (++n === 1) return {
        content: "", stop_reason: "tool_use" as const,
        tool_calls: [{ id: "tc1", name: "missing", arguments: "{}" }],
        usage: { input_tokens: 5, output_tokens: 5 },
      };
      return { content: "ok", stop_reason: "end_turn" as const, usage: { input_tokens: 5, output_tokens: 2 } };
    };
    const r = await runAgentTurn(agent, { message: "test" }, llm);
    const tr = r.payloads.find((p) => p.kind === "tool_result");
    assert.ok(tr && tr.kind === "tool_result" && tr.content.includes("non trovato"));
  });

  it("errore provider produce stopReason error", async () => {
    const llm: LLMProviderFn = async () => { throw new Error("crash"); };
    const r = await runAgentTurn(agent, { message: "test" }, llm);
    assert.equal(r.stopReason, "error");
    assert.ok(r.error?.includes("crash"));
  });

  it("eventi turn_start e turn_end emessi", async () => {
    const evts: AgentEvent[] = [];
    const unsub = onAgentEvent((e) => evts.push(e));
    await runAgentTurn(agent, { message: "ping" }, textLLM("pong"));
    unsub();
    assert.ok(evts.some((e) => e.type === "turn_start"));
    assert.ok(evts.some((e) => e.type === "turn_end"));
  });

  it("usage accumulato su iterazioni multiple", async () => {
    const r = await runAgentTurn(agent, { message: "go", tools: [echoTool] }, toolLLM());
    assert.equal(r.usage.inputTokens, 25);
    assert.equal(r.usage.outputTokens, 8);
    assert.equal(r.usage.totalTokens, 33);
  });

  it("max_tokens stop viene riportato", async () => {
    const llm: LLMProviderFn = async () => ({
      content: "troncato", stop_reason: "max_tokens",
      tool_calls: [{ id: "tc1", name: "x", arguments: "{}" }],
      usage: { input_tokens: 10, output_tokens: 100 },
    });
    const r = await runAgentTurn(agent, { message: "test" }, llm);
    assert.equal(r.stopReason, "max_tokens");
  });

  it("model e provider da opts sovrascrivono agent", async () => {
    const r = await runAgentTurn(agent, { message: "t", model: "cm", provider: "cp" }, textLLM("ok"));
    assert.equal(r.model, "cm");
    assert.equal(r.provider, "cp");
  });
});
