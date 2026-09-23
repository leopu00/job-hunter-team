/**
 * The dashboard (B-02) shows what the traces wrote and nothing else: a figure
 * no trace carries stays `—`, never an estimate. These feed it records as the
 * runtime writes them and read the frame as a person would.
 */

import { describe, expect, it } from "vitest";

import { Board, hubAnswer, SILENT_MS } from "../src/cli/dashboard.ts";
import type { TraceLine } from "../src/core/trace.ts";

const T0 = Date.parse("2026-09-23T20:00:00.000Z");
const SIZE = { cols: 200, rows: 60 };
let seq = 0;

function rec(agent: string, ms: number, event: Record<string, unknown>, runId = "2026-09-23T20-00-00-000Z-aaaa"): TraceLine {
  return { ts: new Date(T0 + ms).toISOString(), seq: ++seq, runId, role: agent, ...event } as TraceLine;
}

const started = (agent: string, budgetUsd = 0.5) =>
  rec(agent, 0, {
    type: "run_started", pid: 1, providerId: "openai", modelId: "gpt-5-mini", live: true, pricing: { inputPerMTokUsd: 1, outputPerMTokUsd: 1 },
    budgetUsd, limits: { maxWebSearches: 8 }, permissionMode: "auto", workdir: "/w", tools: [], node: "22", platform: "test",
  });

const round = (agent: string, ms: number, steps: number, costUsd: number) =>
  rec(agent, ms, {
    type: "round_finished", round: steps, durationMs: 100, finishReason: "tool-calls", usage: { inputTokens: 1000, outputTokens: 50 },
    costUsd, costInUsd: costUsd, costOutUsd: 0, text: "", toolCalls: [],
    run: { steps, toolCalls: 0, totalTokens: 1050 * steps, costUsd, webSearches: 2, remainingMs: 60_000 },
  });

const frame = (board: Board, ms: number) => board.frame(T0 + ms, SIZE, "test").join("\n");
const rowOf = (text: string, agent: string) => text.split("\n").find((l) => l.trimStart().startsWith(agent)) ?? "";
const lineOf = (text: string, label: string) => text.split("\n").find((l) => l.includes(label)) ?? "";

describe("the dashboard leaves empty what no trace carries", () => {
  it("shows no figure for the piggy bank or the key proxy before the hub has answered", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1"));
    const text = frame(board, 1_000);
    expect(lineOf(text, "PIGGY BANK")).not.toMatch(/\$\d/);
    expect(lineOf(text, "PIGGY BANK")).toContain("left — of —");
    expect(lineOf(text, "KEY PROXY")).not.toMatch(/\d/);
  });

  it("shows the run's cap from the start and its spend only once a round has written it", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1", 0.4));
    expect(rowOf(frame(board, 1_000), "scout-1")).toContain("— / $0.4000");
    board.handle("scout-1", round("scout-1", 2_000, 3, 0.0123));
    const row = rowOf(frame(board, 2_500), "scout-1");
    expect(row).toContain("$0.0123 / $0.4000");
    expect(row).toContain("@round 3");
    expect(row).toContain("2/8");
  });
});

describe("the piggy bank is the hub's last answer to the CAPITANO", () => {
  it("takes left_usd from a spawn the hub accepted, and says whose answer and how old", () => {
    const board = new Board();
    board.handle("capitano-1", started("capitano-1"));
    board.handle("capitano-1", rec("capitano-1", 1_000, { type: "tool_started", round: 1, callId: "c1", name: "spawn_agent", args: {}, summary: "scout-2 · gpt-5-mini · 0.2 USD" }));
    board.handle(
      "capitano-1",
      rec("capitano-1", 1_500, {
        type: "tool_finished", callId: "c1", name: "spawn_agent", outcome: "accepted", durationMs: 40, resultChars: 90, resultCut: false,
        result: JSON.stringify({ ok: true, spawn_id: "3f9a0c1d2e4b5a67", agent: "scout-2", booked_usd: 0.2, left_usd: 0.35 }, null, 2),
      }),
    );
    const text = frame(board, 11_500);
    expect(lineOf(text, "PIGGY BANK")).toContain("left $0.3500 of —");
    expect(lineOf(text, "PIGGY BANK")).toContain("hub's answer to capitano-1 · spawn_agent · 10.0s ago");
    expect(text).toContain("scout-2 · booked $0.2 · left $0.35");
  });

  it("puts a refusal in the feed with the launcher's reason, and keeps the last figure it had", () => {
    const board = new Board();
    board.handle("capitano-1", started("capitano-1"));
    board.handle(
      "capitano-1",
      rec("capitano-1", 1_000, {
        type: "tool_finished", callId: "c2", name: "spawn_agent", outcome: "failed", durationMs: 5, resultChars: 90, resultCut: false,
        result: JSON.stringify({ ok: false, reason: "cap_usd 0.3 does not fit: 0.1 USD of the session's 0.6 is left." }, null, 2),
      }),
    );
    const text = frame(board, 2_000);
    expect(text).toContain("refused: cap_usd 0.3 does not fit: 0.1 USD of the session's 0.6 is left.");
    // The refusal names a figure in its prose, but carries no left_usd: the line stays empty.
    expect(lineOf(text, "PIGGY BANK")).toContain("left — of —");
  });

  it("reads left_usd from a result the trace cut short", () => {
    const whole = JSON.stringify({ session: "2026-09-23-a", left_usd: 0.12, spawns: Array.from({ length: 80 }, (_, i) => ({ id: `${i}`, agent: `scout-${i}` })) }, null, 2);
    expect(hubAnswer(whole.slice(0, 200))).toMatchObject({ leftUsd: 0.12, session: "2026-09-23-a" });
    expect(hubAnswer("Error: hub unreachable")).not.toHaveProperty("leftUsd");
  });
});

describe("what each agent is doing now", () => {
  it("names the tool in flight, and forgets it when it returns", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1"));
    board.handle("scout-1", rec("scout-1", 1_000, { type: "tool_started", round: 1, callId: "c1", name: "web_search", args: {}, summary: "rust jobs rome" }));
    expect(rowOf(frame(board, 3_000), "scout-1")).toMatch(/⚙ web_search rust jobs rome 2\.0s/);
    board.handle("scout-1", rec("scout-1", 3_500, { type: "tool_finished", callId: "c1", name: "web_search", outcome: "accepted", durationMs: 2500, resultChars: 1, result: "x", resultCut: false }));
    expect(rowOf(frame(board, 4_000), "scout-1")).not.toContain("web_search");
  });

  it("calls a run that stopped writing silent, not dead: the trace cannot tell which", () => {
    const board = new Board();
    board.handle("scorer-1", started("scorer-1"));
    expect(rowOf(frame(board, SILENT_MS - 1), "scorer-1")).toContain("● live");
    const late = rowOf(frame(board, SILENT_MS + 5_000), "scorer-1");
    expect(late).toContain("◌ silent 20.0s");
    expect(late).not.toMatch(/died|dead|failed/);
  });

  it("follows the newest run of an agent and ignores lines of an older one", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1", 0.4));
    board.handle("scout-1", { ...started("scout-1", 0.9), runId: "2026-09-23T21-00-00-000Z-bbbb" });
    board.handle("scout-1", round("scout-1", 2_000, 5, 0.3));
    expect(rowOf(frame(board, 2_500), "scout-1")).toContain("— / $0.9000");
  });
});
