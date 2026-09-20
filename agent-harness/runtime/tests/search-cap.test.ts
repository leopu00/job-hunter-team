/**
 * T19: the run's search cap and the worst case checked before a call.
 *
 * T13 run 2: 34 searches, 82 % of a 0.50 USD budget, no position saved; and
 * the round that crossed the cap was paid in full (0.0033 USD over), because
 * the budget was only checked after it.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRound, TurnAccount, type AgentEvent } from "../src/core/agent-loop.ts";
import { MemoryAuditLog, NullAuditLog } from "../src/core/audit.ts";
import { loadConfig } from "../src/config.ts";
import { DEFAULT_LIMITS, Guardrails, type Limits } from "../src/core/guardrails.ts";
import { appendLedger } from "../src/core/ledger.ts";
import { PermissionPolicy } from "../src/core/permissions.ts";
import { MockProvider, type ScriptedTurn } from "../src/core/provider/mock.ts";
import type { WebSearchResult } from "../src/core/provider/port.ts";
import { RoleSession, type SessionEvent } from "../src/core/role-session.ts";
import type { Pricing } from "../src/core/usage.ts";
import { TraceView } from "../src/cli/render.ts";
import { BUDGET_TOO_LOW, createWebSearchTool, SEARCHES_EXHAUSTED } from "../src/tools/web-search.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jht-search-cap-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const FREE: Pricing = { inputPerMTokUsd: 0, outputPerMTokUsd: 0, webSearchPerCallUsd: 0 };

function found(searches: number): WebSearchResult {
  return { text: `found ${searches}`, sources: [], searches, usage: { inputTokens: 10, outputTokens: 10 } };
}

/** A session whose model asks for one search per round, `calls` rounds, then stops. */
function searchingSession(options: { calls: number; results: WebSearchResult[]; limits: Partial<Limits>; pricing?: Pricing }) {
  const script: ScriptedTurn[] = [];
  for (let i = 0; i < options.calls; i++) script.push({ toolCalls: [{ name: "web_search", args: { query: `query ${i}` } }] });
  script.push({ text: "Saved what I had." });
  const provider = new MockProvider(script, { searches: options.results });
  const pricing = options.pricing ?? FREE;
  Object.assign(provider, { profile: { ...provider.profile, pricing } });
  const guardrails = new Guardrails({ limits: { ...DEFAULT_LIMITS, ...options.limits }, pricing });
  const events: SessionEvent[] = [];
  const session = new RoleSession({
    provider,
    guardrails,
    audit: new MemoryAuditLog(),
    systemPrompt: "You are a test role.",
    tools: [createWebSearchTool(provider, pricing.webSearchPerCallUsd ?? 0)],
    permissions: new PermissionPolicy({ mode: "auto", freeReadRoots: [] }),
    onEvent: (e) => events.push(e),
  });
  const results = () => events.flatMap((e) => (e.type === "tool_finished" ? [e] : []));
  return { provider, guardrails, session, results };
}

describe("JHT_API_MAX_WEB_SEARCHES", () => {
  it("is 8 unless set, takes 0, and refuses anything but a whole number", () => {
    expect(loadConfig({}).limits.maxWebSearches).toBe(8);
    expect(loadConfig({ JHT_API_MAX_WEB_SEARCHES: "3" }).limits.maxWebSearches).toBe(3);
    expect(loadConfig({ JHT_API_MAX_WEB_SEARCHES: "0" }).limits.maxWebSearches).toBe(0);
    for (const bad of ["-1", "1.5", "many", "8x"]) {
      expect(() => loadConfig({ JHT_API_MAX_WEB_SEARCHES: bad }), bad).toThrowError(expect.objectContaining({ code: "config_invalid" }));
    }
  });
});

describe("the search cap", () => {
  it("counts the searches the provider ran, and past the cap answers without calling it", async () => {
    // Cap 3: the first call runs 2 searches, the second 2 more (4, over the cap: counted as run),
    // the third is refused without reaching the provider.
    const { provider, guardrails, session, results } = searchingSession({ calls: 3, results: [found(2), found(2)], limits: { maxWebSearches: 3 } });
    await session.send("Go.");

    expect(provider.searches.map((s) => s.query)).toEqual(["query 0", "query 1"]);
    expect(guardrails.state.webSearches).toBe(4);
    expect(guardrails.webSearchesLeft).toBe(0);
    const [first, second, third] = results();
    expect(first).toMatchObject({ outcome: "accepted", details: { webSearches: 2 } });
    expect(second).toMatchObject({ outcome: "accepted", details: { webSearches: 2 } });
    expect(third).toMatchObject({ outcome: "failed", result: SEARCHES_EXHAUSTED });
    expect(SEARCHES_EXHAUSTED).toContain("Use the results you already have, save what you found and close the cycle.");
    // The model read the refusal and closed: the run went on, it was not ended.
    expect(provider.remaining).toBe(0);
  });

  it("with 0 never calls the provider", async () => {
    const { provider, session, results } = searchingSession({ calls: 2, results: [found(1)], limits: { maxWebSearches: 0 } });
    await session.send("Go.");
    expect(provider.searches).toEqual([]);
    expect(results().map((r) => r.result)).toEqual([SEARCHES_EXHAUSTED, SEARCHES_EXHAUSTED]);
  });

  it("refuses a search whose worst case no longer fits the budget, without calling the provider", async () => {
    // 1 USD per million tokens: a call is booked for four searches, as the key proxy books it
    // (T19-a): ~100,000 input tokens written to the cache (0.20), 4,096 output (0.004) and four
    // fees (0.04), 0.244. Booked for one search it would be 0.064, for two 0.124: 0.2 of budget
    // would have let either run.
    const pricing: Pricing = { inputPerMTokUsd: 1, outputPerMTokUsd: 1, webSearchPerCallUsd: 0.01, cacheWritePerMTokUsd: 1 };
    const { provider, guardrails, session, results } = searchingSession({ calls: 1, results: [found(1)], limits: { budgetUsd: 0.2 }, pricing });
    await session.send("Go.");
    expect(provider.searches).toEqual([]);
    expect(results()[0]).toMatchObject({ outcome: "failed", result: BUDGET_TOO_LOW });
    expect(guardrails.state.webSearches).toBe(0);
    expect(guardrails.state.costUsd).toBeLessThanOrEqual(0.2);
  });
});

describe("the worst case of a round, before it starts", () => {
  const LONG = "x".repeat(300_000);

  it("refuses a round that could cross the budget, and never calls the provider", async () => {
    const provider = new MockProvider([{ text: "done", usage: { inputTokens: 1, outputTokens: 1 } }]);
    const pricing: Pricing = { inputPerMTokUsd: 1, outputPerMTokUsd: 1 };
    Object.assign(provider, { profile: { ...provider.profile, pricing } });
    // 300,000 characters: at least 110,000 tokens, 0.11 USD at 1 USD per million. The budget is 0.1.
    const guardrails = new Guardrails({ limits: { ...DEFAULT_LIMITS, budgetUsd: 0.1 }, pricing });
    const events: AgentEvent[] = [];
    await expect(
      runRound(
        { provider, guardrails, audit: new NullAuditLog(), emit: (e) => events.push(e), now: Date.now },
        { system: LONG, messages: [{ role: "user", content: "go" }], tools: [], account: new TurnAccount(Date.now) },
      ),
    ).rejects.toMatchObject({ code: "budget_exhausted", message: expect.stringContaining("could cost up to") });
    expect(provider.requests).toEqual([]);
    expect(guardrails.state.costUsd).toBe(0);
  });

  it("lets the same round run when its worst case fits", async () => {
    const provider = new MockProvider([{ text: "done", usage: { inputTokens: 100_000, outputTokens: 10 } }]);
    const pricing: Pricing = { inputPerMTokUsd: 1, outputPerMTokUsd: 1 };
    Object.assign(provider, { profile: { ...provider.profile, pricing } });
    const guardrails = new Guardrails({ limits: { ...DEFAULT_LIMITS, budgetUsd: 0.5, maxTotalTokens: 10_000_000 }, pricing });
    await runRound(
      { provider, guardrails, audit: new NullAuditLog(), emit: () => {}, now: Date.now },
      { system: LONG, messages: [{ role: "user", content: "go" }], tools: [], account: new TurnAccount(Date.now) },
    );
    expect(provider.requests).toHaveLength(1);
  });

  it("learns a denser text from the rounds it saw", () => {
    const g = new Guardrails({ limits: DEFAULT_LIMITS, pricing: FREE });
    expect(g.estimateInputTokens(3_000)).toBe(1_100);
    // A round of 1,000 characters that took 800 tokens (CJK, say): the next estimate follows it.
    g.observeInput(1_000, 800);
    expect(g.estimateInputTokens(3_000)).toBe(2_640);
    // A lighter round does not lower it.
    g.observeInput(1_000, 100);
    expect(g.estimateInputTokens(3_000)).toBe(2_640);
  });
});

describe("the search count in the monitor and the ledger", () => {
  it("shows each search against the cap, and the total in the summary", () => {
    const lines: string[] = [];
    const view = new TraceView({ write: (line) => lines.push(line) });
    view.handle({
      type: "run_started", pid: 1, providerId: "mock", modelId: "mock", live: false, pricing: FREE, budgetUsd: 1,
      limits: { maxWebSearches: 8 }, permissionMode: "auto", workdir: "/w", tools: ["web_search"], node: "22", platform: "test",
    });
    view.handle({ type: "round_started", round: 1, messages: 1, contextChars: 10 });
    view.handle({
      type: "round_finished", round: 1, durationMs: 1, finishReason: "tool-calls", usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0,
      costInUsd: 0, costOutUsd: 0, text: "", toolCalls: [{ id: "c1", name: "web_search", args: { query: "q" } }],
      run: { steps: 1, toolCalls: 1, totalTokens: 2, costUsd: 0, webSearches: 0, remainingMs: 1_000 },
    });
    view.handle({ type: "tool_started", round: 1, callId: "c1", name: "web_search", summary: "q", risk: "network" } as never);
    view.handle({ type: "tool_finished", callId: "c1", name: "web_search", outcome: "accepted", result: "r", resultChars: 1, durationMs: 1, details: { webSearches: 2 } } as never);
    view.summary();
    const screen = lines.join("\n");
    expect(screen).toContain("searches 2 of 8");
    expect(screen).toMatch(/search\s+2 of 8/);
  });

  it("records the searches in the ledger's note, beside the cache writes", async () => {
    const path = join(dir, "openai-spesa.tsv");
    const base = { at: new Date(0), role: "scout-1", model: "openai/gpt-5.6-luna", costUsd: 0.3, runId: "r", note: "completed" };
    appendLedger(path, { ...base, usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 10 }, webSearches: 8 });
    appendLedger(path, { ...base, usage: { inputTokens: 1, outputTokens: 1 }, webSearches: 0 });
    const [header, searched, none] = (await readFile(path, "utf8")).split("\n");
    expect(searched?.split("\t")).toHaveLength(header!.split("\t").length);
    expect(searched?.endsWith("\tcompleted; cache_write_tokens=10; web_searches=8")).toBe(true);
    expect(none?.endsWith("\tcompleted")).toBe(true);
  });
});
