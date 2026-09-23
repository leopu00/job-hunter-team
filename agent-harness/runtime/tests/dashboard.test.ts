/**
 * The dashboard (B-02) draws what the traces wrote and nothing else: a figure
 * no trace carries stays `—`, never an estimate. These feed it records as the
 * runtime writes them and read the frame as a person would, at the sizes a
 * tmux pane takes: full screen, and a corner of it.
 */

import { describe, expect, it } from "vitest";

import { ago, Board, hubAnswer, resultOf, SILENT_MS } from "../src/cli/dashboard.ts";
import { width } from "../src/cli/render.ts";
import type { TraceLine } from "../src/core/trace.ts";

const T0 = Date.parse("2026-09-23T20:00:00.000Z");
const FULL = { cols: 200, rows: 60 };
const RUN = "2026-09-23T20-00-00-000Z-aaaa";
let seq = 0;

function rec(agent: string, ms: number, event: Record<string, unknown>, runId = RUN): TraceLine {
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

const call = (agent: string, ms: number, id: string, name: string, args: unknown, summary = "") =>
  rec(agent, ms, { type: "tool_started", round: 1, callId: id, name, args, summary });
const done = (agent: string, ms: number, id: string, name: string, result = "ok", outcome = "accepted") =>
  rec(agent, ms, { type: "tool_finished", callId: id, name, outcome, durationMs: 40, resultChars: result.length, resultCut: false, result });

const spawn = (board: Board, ms: number, answer: Record<string, unknown>) => {
  board.handle("capitano-1", call("capitano-1", ms, `s${ms}`, "spawn_agent", {}, "scout · gpt-5-mini · 0.2 USD"));
  board.handle("capitano-1", done("capitano-1", ms + 1, `s${ms}`, "spawn_agent", JSON.stringify(answer, null, 2), answer["ok"] === false ? "failed" : "accepted"));
};

const frame = (board: Board, ms: number, size = FULL) => board.frame(T0 + ms, size, "test").join("\n");
const lineOf = (text: string, label: string) => text.split("\n").find((l) => l.includes(label)) ?? "";
/** An agent's node: past the tree's branches, its name and then its state or its booking (the money bar's legend names agents too). */
const nodeOf = (text: string, agent: string) =>
  text.split("\n").find((l) => new RegExp(`^${agent}\\s+(●|◌|■|✗|booked)`).test(l.replace(/^[\s├└│─▶]+/, ""))) ?? "";
/** The line of facts under an agent's node. */
const factsOf = (text: string, agent: string) => {
  const lines = text.split("\n");
  return lines[lines.indexOf(nodeOf(text, agent)) + 1] ?? "";
};

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
    expect(nodeOf(frame(board, 1_000), "scout-1")).toContain("— / $0.4000");
    board.handle("scout-1", round("scout-1", 2_000, 3, 0.0123));
    const text = frame(board, 2_500);
    expect(nodeOf(text, "scout-1")).toContain("$0.0123 / $0.4000 @round 3");
    expect(factsOf(text, "scout-1")).toContain("search 2/8");
  });

  it("counts in the money bar only the spend the runs reported, and says how many have not", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1", 0.4));
    board.handle("scout-2", started("scout-2", 0.5));
    board.handle("scout-1", round("scout-1", 2_000, 1, 0.1));
    expect(lineOf(frame(board, 3_000), "RUN CAPS")).toContain("$0.9000 given to 2 runs · $0.1000 spent (1 not reported yet)");
  });
});

describe("the piggy bank is the hub's last answer to the CAPITANO", () => {
  it("takes left_usd from a spawn the hub accepted, and says whose answer and how old", () => {
    const board = new Board();
    board.handle("capitano-1", started("capitano-1"));
    spawn(board, 1_000, { ok: true, spawn_id: "3f9a0c1d2e4b5a67", agent: "scout-2", booked_usd: 0.2, left_usd: 0.35 });
    const text = frame(board, 11_001);
    expect(lineOf(text, "PIGGY BANK")).toContain("left $0.3500 of —");
    expect(lineOf(text, "PIGGY BANK")).toContain("hub → capitano-1 · spawn_agent · 10.0s ago");
    expect(text).toContain("scout-2 · booked $0.2 · left $0.35");
  });

  it("warns of a refusal with the launcher's reason, and keeps the last figure it had", () => {
    const board = new Board();
    board.handle("capitano-1", started("capitano-1"));
    spawn(board, 1_000, { ok: false, reason: "cap_usd 0.3 does not fit: 0.1 USD of the session's 0.6 is left." });
    const text = frame(board, 2_000);
    expect(lineOf(text, "▲")).toContain("spawn refused: cap_usd 0.3 does not fit");
    // The refusal names a figure in its prose, but carries no left_usd: the line stays empty.
    expect(lineOf(text, "PIGGY BANK")).toContain("left — of —");
    // A warning is not a result: it does not ring.
    expect(board.bells).toBe(0);
  });

  it("reads left_usd from a result the trace cut short", () => {
    const whole = JSON.stringify({ session: "2026-09-23-a", left_usd: 0.12, spawns: Array.from({ length: 80 }, (_, i) => ({ id: `${i}`, agent: `scout-${i}` })) }, null, 2);
    expect(hubAnswer(whole.slice(0, 200))).toMatchObject({ leftUsd: 0.12, session: "2026-09-23-a" });
    expect(hubAnswer("Error: hub unreachable")).not.toHaveProperty("leftUsd");
  });
});

describe("the team is drawn with its relations", () => {
  it("puts a child under the CAPITANO that spawned it, and a booked child with no trace as a booking", () => {
    const board = new Board();
    board.handle("capitano-1", started("capitano-1"));
    board.handle("scout-1", started("scout-1"));
    spawn(board, 1_000, { ok: true, agent: "scout-2", booked_usd: 0.2, left_usd: 0.3 });
    spawn(board, 2_000, { ok: true, agent: "scorer-1", booked_usd: 0.1, left_usd: 0.2 });
    board.handle("scout-2", { ...started("scout-2", 0.2), ts: new Date(T0 + 3_000).toISOString() });
    const text = frame(board, 5_000);
    expect(nodeOf(text, "scout-2")).toMatch(/^ ├─▶ /);
    expect(nodeOf(text, "scorer-1")).toMatch(/^ └─▶ .*booked \$0\.1000 3\.0s ago · no trace yet/);
    // A member of the base team is a peer, drawn at the top.
    expect(nodeOf(text, "scout-1")).toMatch(/^ {2}scout-1/);
    const lines = text.split("\n");
    expect(lines.indexOf(nodeOf(text, "capitano-1"))).toBeLessThan(lines.indexOf(nodeOf(text, "scout-2")));
  });

  it("draws who wrote to whom, with how many times", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1"));
    board.handle("scout-1", round("scout-1", 500, 1, 0.01));
    for (const ms of [1_000, 2_000]) board.handle("scout-1", call("scout-1", ms, `m${ms}`, "send_message", { to: "capitano", text: "[RES]" }, "to capitano"));
    expect(factsOf(frame(board, 3_000), "scout-1")).toContain("✉ → capitano ×2");
  });

  it("names every role of the product that has left no trace", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1"));
    const line = lineOf(frame(board, 1_000), "no trace here:");
    expect(line).toContain("capitano · analista · scorer");
    expect(line).not.toContain("scout");
  });
});

describe("results are called out, and ring", () => {
  it("rings for a new position, not for a company, a failed insert or a message between agents", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1"));
    board.handle("scout-1", call("scout-1", 1_000, "a", "db_insert", { args: ["company", "--name", "Acme"] }));
    board.handle("scout-1", done("scout-1", 1_001, "a", "db_insert"));
    board.handle("scout-1", call("scout-1", 1_100, "b", "db_insert", { args: ["position", "--title", "Nope", "--company", "X"] }));
    board.handle("scout-1", done("scout-1", 1_101, "b", "db_insert", "Error", "failed"));
    board.handle("scout-1", call("scout-1", 1_200, "c", "send_message", { to: "capitano", text: "hi" }));
    board.handle("scout-1", done("scout-1", 1_201, "c", "send_message"));
    expect(board.bells).toBe(0);
    board.handle("scout-1", call("scout-1", 2_000, "d", "db_insert", { args: ["position", "--title", "Rust Developer", "--company", "Ferrous"] }));
    board.handle("scout-1", done("scout-1", 2_001, "d", "db_insert"));
    expect(board.bells).toBe(1);
    expect(lineOf(frame(board, 3_000), "✦")).toContain("scout-1 new position: Rust Developer @ Ferrous");
  });

  it("names a score, a CV and a word to the person, and only files the person gets", () => {
    expect(resultOf("db_update", { args: ["position", "7", "--score", "82"] }, "")).toBe("position 7: score 82");
    expect(resultOf("db_update", { args: ["position", "7", "--notes", "x"] }, "")).toBeUndefined();
    expect(resultOf("write_file", { path: "/jht_home/user/cv/CV_Acme.md" }, "")).toBe("file written: cv/CV_Acme.md");
    expect(resultOf("write_file", { path: "/jht_home/agents/scout-1/notes.md" }, "")).toBeUndefined();
    expect(resultOf("notify_user", { text: "Two new\npositions." }, "")).toBe("to the person: Two new positions.");
  });

  it("rings for a failed run, and warns once when a run nears its cap", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1", 0.4));
    board.handle("scout-1", round("scout-1", 1_000, 1, 0.37));
    board.handle("scout-1", round("scout-1", 2_000, 2, 0.39));
    board.handle("scout-1", rec("scout-1", 3_000, { type: "run_failed", code: "budget_exhausted", message: "no" }));
    const text = frame(board, 4_000);
    expect(text.split("\n").filter((l) => l.includes("of its $0.4000 cap"))).toHaveLength(1);
    expect(lineOf(text, "✗ ")).toBeTruthy();
    expect(board.bells).toBe(1);
  });
});

describe("what each agent is doing now", () => {
  it("names the tool in flight, and forgets it when it returns", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1"));
    board.handle("scout-1", call("scout-1", 1_000, "c1", "web_search", {}, "rust jobs rome"));
    expect(nodeOf(frame(board, 3_000), "scout-1")).toMatch(/⚙ web_search rust jobs rome 2\.0s/);
    board.handle("scout-1", done("scout-1", 3_500, "c1", "web_search"));
    expect(nodeOf(frame(board, 4_000), "scout-1")).not.toContain("web_search");
  });

  it("calls a run that stopped writing silent, not dead: the trace cannot tell which", () => {
    const board = new Board();
    board.handle("scorer-1", started("scorer-1"));
    expect(nodeOf(frame(board, SILENT_MS - 1), "scorer-1")).toContain("● live");
    const late = nodeOf(frame(board, SILENT_MS + 5_000), "scorer-1");
    expect(late).toContain("◌ silent 20.0s");
    expect(late).not.toMatch(/died|dead|failed/);
  });

  it("follows the newest run of an agent and ignores lines of an older one", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1", 0.4));
    board.handle("scout-1", { ...started("scout-1", 0.9), runId: "2026-09-23T21-00-00-000Z-bbbb" });
    board.handle("scout-1", round("scout-1", 2_000, 5, 0.3));
    expect(nodeOf(frame(board, 2_500), "scout-1")).toContain("— / $0.9000");
  });
});

describe("the screen says something when nothing runs", () => {
  it("says the team is idle and since when, and keeps how the last runs ended", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1"));
    board.handle("scout-1", rec("scout-1", 1_000, { type: "run_finished", reason: "completed", steps: 4, toolCalls: 3, usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.2, durationMs: 1_000 }));
    const text = frame(board, 1_000 + 3 * 86_400_000);
    expect(text.split("\n")[0]).toContain("TEAM IDLE · last activity 3d 0h ago");
    expect(nodeOf(text, "scout-1")).toContain("■ completed");
    expect(nodeOf(text, "scout-1")).toContain("$0.2000 / $0.5000 @end");
  });

  it("with no trace at all, says it waits and names the team it waits for", () => {
    const text = frame(new Board(), 0);
    expect(text.split("\n")[0]).toContain("NO TRACE YET");
    expect(text).toContain("waiting for the first trace");
    expect(lineOf(text, "no trace here:")).toContain("capitano · scout · analista");
  });

  it("writes elapsed time as a person reads it", () => {
    expect(ago(42_000)).toBe("42.0s");
    expect(ago(5 * 3_600_000 + 7 * 60_000)).toBe("5h07m");
    expect(ago(61 * 3_600_000)).toBe("2d 13h");
  });
});

describe("the screen fits the pane", () => {
  const busy = () => {
    const board = new Board();
    board.handle("capitano-1", started("capitano-1", 0.3));
    for (const agent of ["scout-1", "scout-2", "analista-1", "scorer-1", "scrittore-1"]) {
      board.handle(agent, started(agent, 0.4));
      board.handle(agent, round(agent, 1_000, 2, 0.05));
      board.handle(agent, call(agent, 1_500, `x-${agent}`, "web_search", {}, "a very long query ".repeat(20)));
    }
    spawn(board, 2_000, { ok: true, agent: "scout-2", booked_usd: 0.4, left_usd: 0.1 });
    for (let i = 0; i < 40; i++) board.handle("scout-1", call("scout-1", 3_000 + i, `p${i}`, "db_insert", { args: ["position", "--title", `Role ${i}`] }));
    for (let i = 0; i < 40; i++) board.handle("scout-1", done("scout-1", 3_100 + i, `p${i}`, "db_insert"));
    return board;
  };

  for (const size of [{ cols: 45, rows: 12 }, { cols: 60, rows: 16 }, { cols: 80, rows: 24 }, { cols: 120, rows: 30 }, { cols: 200, rows: 60 }]) {
    it(`never draws past ${size.cols}x${size.rows}, and keeps the banner and the results in it`, () => {
      const lines = busy().frame(T0 + 5_000, size, "a header long enough to be cut ".repeat(10));
      expect(lines.length).toBeLessThanOrEqual(size.rows);
      for (const line of lines) expect(width(line)).toBeLessThanOrEqual(size.cols);
      expect(lines[0]).toContain("JHT · API TEAM");
      expect(lines.join("\n")).toContain("RESULTS");
      expect(lines.join("\n")).toContain("new position: Role 39");
    });
  }
});
