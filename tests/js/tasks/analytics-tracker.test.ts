import { describe, it, expect, beforeEach } from "vitest";
import {
  recordCall, getModelCost, setModelCost, estimateCost,
  getSummary, getEntries, getEntryCount, clearEntries,
  formatTokenCount, formatUsd,
} from "../../../shared/analytics/usage-tracker.js";
import type { TokenUsage, ModelCost } from "../../../shared/analytics/types.js";

beforeEach(() => clearEntries());

describe("recordCall", () => {
  it("registra una chiamata con token totale calcolato", () => {
    const entry = recordCall({
      provider: "claude", model: "claude-sonnet-4-6",
      tokens: { input: 100, output: 50 }, latencyMs: 200,
    });
    expect(entry.id).toBeTruthy();
    expect(entry.tokens.total).toBe(150);
    expect(entry.success).toBe(true);
    expect(entry.latencyMs).toBe(200);
  });

  it("calcola costo con pricing table", () => {
    const entry = recordCall({
      provider: "claude", model: "claude-sonnet-4-6",
      tokens: { input: 1_000_000, output: 500_000 }, latencyMs: 1000,
    });
    expect(entry.costUsd).toBeGreaterThan(0);
  });

  it("registra errori con success=false", () => {
    const entry = recordCall({
      provider: "openai", model: "gpt-4o",
      tokens: { input: 10, output: 0 }, latencyMs: 5000,
      success: false, error: "timeout",
    });
    expect(entry.success).toBe(false);
    expect(entry.error).toBe("timeout");
  });

  it("include cache token nel totale", () => {
    const entry = recordCall({
      provider: "claude", model: "claude-opus-4-6",
      tokens: { input: 100, output: 50, cacheRead: 200, cacheWrite: 30 },
      latencyMs: 500,
    });
    expect(entry.tokens.total).toBe(380);
  });
});

describe("getModelCost / setModelCost", () => {
  it("ritorna costo per modello noto", () => {
    const cost = getModelCost("claude", "claude-sonnet-4-6");
    expect(cost).toBeDefined();
    expect(cost!.input).toBe(3);
    expect(cost!.output).toBe(15);
  });

  it("ritorna undefined per modello sconosciuto", () => {
    expect(getModelCost("openai", "gpt-99")).toBeUndefined();
  });

  it("permette di aggiungere costi custom", () => {
    setModelCost("minimax", "custom-model", { input: 2, output: 8 });
    expect(getModelCost("minimax", "custom-model")).toEqual({ input: 2, output: 8 });
  });
});

describe("estimateCost", () => {
  it("calcola costo per milione di token", () => {
    const tokens: TokenUsage = { input: 1_000_000, output: 500_000, total: 1_500_000 };
    const cost: ModelCost = { input: 3, output: 15 };
    const result = estimateCost(tokens, cost);
    expect(result).toBe(10.5); // 3 + 7.5
  });
});

describe("getSummary", () => {
  it("aggrega per provider con conteggi corretti", () => {
    recordCall({ provider: "claude", model: "claude-sonnet-4-6", tokens: { input: 100, output: 50 }, latencyMs: 200 });
    recordCall({ provider: "claude", model: "claude-sonnet-4-6", tokens: { input: 200, output: 100 }, latencyMs: 400 });
    recordCall({ provider: "openai", model: "gpt-4o", tokens: { input: 50, output: 25 }, latencyMs: 150 });

    const summary = getSummary();
    expect(summary.totalCalls).toBe(3);
    expect(summary.byProvider).toHaveLength(2);
    const claude = summary.byProvider.find((p) => p.provider === "claude");
    expect(claude!.calls).toBe(2);
  });

  it("calcola latenza p95", () => {
    for (let i = 0; i < 20; i++) {
      recordCall({ provider: "claude", model: "claude-sonnet-4-6", tokens: { input: 10, output: 5 }, latencyMs: 100 + i * 10 });
    }
    const summary = getSummary();
    expect(summary.latency.p95Ms).toBeGreaterThan(summary.latency.avgMs);
    expect(summary.latency.count).toBe(20);
  });

  it("filtra per timestamp con parametro since", () => {
    const old = Date.now() - 100_000;
    recordCall({ provider: "claude", model: "claude-sonnet-4-6", tokens: { input: 10, output: 5 }, latencyMs: 100 });
    const summary = getSummary(Date.now() + 1000);
    expect(summary.totalCalls).toBe(0);
  });

  it("conta errori nel summary", () => {
    recordCall({ provider: "openai", model: "gpt-4o", tokens: { input: 10, output: 0 }, latencyMs: 100, success: false });
    recordCall({ provider: "openai", model: "gpt-4o", tokens: { input: 10, output: 5 }, latencyMs: 100 });
    expect(getSummary().totalErrors).toBe(1);
  });
});

describe("getEntries / getEntryCount", () => {
  it("ritorna tutte le entry registrate", () => {
    recordCall({ provider: "claude", model: "claude-sonnet-4-6", tokens: { input: 10, output: 5 }, latencyMs: 100 });
    recordCall({ provider: "openai", model: "gpt-4o", tokens: { input: 20, output: 10 }, latencyMs: 200 });
    expect(getEntries()).toHaveLength(2);
    expect(getEntryCount()).toBe(2);
  });
});

describe("formatTokenCount / formatUsd", () => {
  it("formatta token in k/m", () => {
    expect(formatTokenCount(500)).toBe("500");
    expect(formatTokenCount(1_500)).toBe("1.5k");
    expect(formatTokenCount(15_000)).toBe("15k");
    expect(formatTokenCount(2_500_000)).toBe("2.5m");
  });

  it("formatta USD con precisione appropriata", () => {
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatUsd(0.005)).toBe("$0.0050");
  });
});
