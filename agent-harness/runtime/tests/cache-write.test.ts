/**
 * Cache writes (T1c): OpenAI reports `input_tokens_details.cache_write_tokens`,
 * and the runtime charges them as the key proxy does — on top of the input
 * price, at the cache-write rate — so a run's cap, trace and ledger never
 * show less than the proxy settles.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRound, TurnAccount, type AgentEvent } from "../src/core/agent-loop.ts";
import { NullAuditLog } from "../src/core/audit.ts";
import { DEFAULT_LIMITS, Guardrails } from "../src/core/guardrails.ts";
import { appendLedger } from "../src/core/ledger.ts";
import { modelProfile } from "../src/core/provider/catalog.ts";
import { MockProvider } from "../src/core/provider/mock.ts";
import { costUsd } from "../src/core/usage.ts";
import { TraceView } from "../src/cli/render.ts";

const LUNA = modelProfile({ providerId: "openai", modelId: "gpt-5.6-luna" }).pricing!;
const MINI = modelProfile({ providerId: "openai", modelId: "gpt-5-mini" }).pricing!;

/** The one live calibration request of 2026-09-19 on luna (web-search-prezzi-vps-res.txt). */
const CALIBRATION = { inputTokens: 8_712, outputTokens: 194, cachedInputTokens: 0, cacheWriteTokens: 4_400, reasoningTokens: 89 };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jht-api-cw-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("cache-write pricing", () => {
  it("prices the calibration request with long-context rates and cache writes on top", () => {
    // 8,712 × 0.40 + 4,400 × 0.50 + 194 × 1.80, per million.
    expect(costUsd(CALIBRATION, LUNA)).toBeCloseTo(0.0034848 + 0.0022 + 0.0003492, 10);
    // Never below what the proxy settled for the same tokens (0.0119752 with the search fee).
    expect(costUsd(CALIBRATION, LUNA) + LUNA.webSearchPerCallUsd!).toBeGreaterThan(0.0119752);
  });

  it("charges mini's cache writes at twice its input price", () => {
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 1_000_000 }, MINI)).toBeCloseTo(0.25 + 0.5, 10);
  });

  it("counts cache writes against the budget", () => {
    const g = new Guardrails({ limits: { ...DEFAULT_LIMITS, budgetUsd: 0.0006 }, pricing: MINI });
    // 0.00025 of input alone fits; the 0.0005 of cache writes on top does not.
    expect(() => g.recordUsage({ inputTokens: 1_000, outputTokens: 0, cacheWriteTokens: 1_000 })).toThrowError(
      expect.objectContaining({ code: "budget_exhausted" }),
    );
  });
});

describe("cache writes in the round, the trace and the monitor", () => {
  it("puts them in the round's usage and in its input cost, so in + out = total", async () => {
    const provider = new MockProvider([{ text: "done", usage: CALIBRATION }]);
    Object.assign(provider, { profile: { ...provider.profile, pricing: LUNA } });
    const events: AgentEvent[] = [];
    const guardrails = new Guardrails({ limits: { ...DEFAULT_LIMITS, budgetUsd: 1 }, pricing: LUNA });
    await runRound(
      { provider, guardrails, audit: new NullAuditLog(), emit: (e) => events.push(e), now: Date.now },
      { system: "s", messages: [{ role: "user", content: "go" }], tools: [], account: new TurnAccount(Date.now) },
    );
    const round = events.find((e) => e.type === "round_finished");
    expect(round?.type === "round_finished" && round.usage.cacheWriteTokens).toBe(4_400);
    if (round?.type !== "round_finished") throw new Error("no round");
    expect(round.costInUsd).toBeCloseTo(0.0034848 + 0.0022, 10);
    expect(round.costInUsd + round.costOutUsd).toBeCloseTo(round.costUsd, 12);
    expect(guardrails.state.costUsd).toBeCloseTo(round.costUsd, 12);

    const lines: string[] = [];
    const view = new TraceView({ write: (line) => lines.push(line) });
    view.handle({
      type: "run_started", pid: 1, providerId: "openai", modelId: "gpt-5.6-luna", live: true, pricing: LUNA, budgetUsd: 1,
      limits: {}, permissionMode: "auto", workdir: "/w", tools: [], node: "22", platform: "test",
    });
    for (const event of events) view.handle(event);
    view.summary();
    const screen = lines.join("\n");
    expect(screen).toContain("4,400 cache write");
    expect(screen).toContain("cache wr");
  });
});

describe("cache writes in the ledger", () => {
  it("records them in the note, keeping the team's columns", async () => {
    const path = join(dir, "openai-spesa.tsv");
    appendLedger(path, { at: new Date(0), role: "scout", model: "openai/gpt-5.6-luna", usage: CALIBRATION, costUsd: 0.016, runId: "r", note: "completed" });
    appendLedger(path, { at: new Date(0), role: "scout", model: "openai/gpt-5.6-luna", usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0, runId: "s", note: "completed" });
    const [header, withWrites, without] = (await readFile(path, "utf8")).split("\n");
    expect(withWrites?.split("\t")).toHaveLength(header!.split("\t").length);
    expect(withWrites?.endsWith("\tcompleted; cache_write_tokens=4400")).toBe(true);
    expect(without?.endsWith("\tcompleted")).toBe(true);
  });
});
