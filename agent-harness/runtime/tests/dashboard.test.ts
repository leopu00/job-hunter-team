/**
 * The dashboard (B-02) draws what the traces wrote and nothing else: a figure
 * no trace carries stays `—`, never an estimate. These feed it records as the
 * runtime writes them and read its three pages as a person would, at the
 * sizes a tmux pane takes: full screen, and a corner of it.
 */

import { describe, expect, it } from "vitest";

import { ago, Board, cells, hubAnswer, PAGES, resultOf, SILENT_MS, type Page } from "../src/cli/dashboard.ts";
import type { TraceLine } from "../src/core/trace.ts";

const T0 = Date.parse("2026-09-23T20:00:00.000Z");
const FULL = { cols: 200, rows: 60 };
const RUN = "2026-09-23T20-00-00-000Z-aaaa";
const ROSTER = ["capitano", "scout", "analista", "scorer", "scrittore", "critico", "assistente", "mentor", "sentinella"];
let seq = 0;

function rec(agent: string, ms: number, event: Record<string, unknown>, runId = RUN): TraceLine {
  return { ts: new Date(T0 + ms).toISOString(), seq: ++seq, runId, role: agent, ...event } as TraceLine;
}

const started = (agent: string, budgetUsd = 0.5) =>
  rec(agent, 0, {
    type: "run_started", pid: 1, providerId: "openai", modelId: "gpt-5-mini", live: true, pricing: { inputPerMTokUsd: 1, outputPerMTokUsd: 1 },
    budgetUsd, limits: { maxWebSearches: 8 }, permissionMode: "auto", workdir: "/w", tools: [], node: "22", platform: "test",
  });

const round = (agent: string, ms: number, steps: number, costUsd: number, extra: Record<string, unknown> = {}) =>
  rec(agent, ms, {
    type: "round_finished", round: steps, durationMs: 100, finishReason: "tool-calls", usage: { inputTokens: 1000, outputTokens: 50 },
    costUsd, costInUsd: costUsd, costOutUsd: 0, text: "", toolCalls: [],
    run: { steps, toolCalls: 0, totalTokens: 1050 * steps, costUsd, webSearches: 2, remainingMs: 60_000 },
    ...extra,
  });

const call = (agent: string, ms: number, id: string, name: string, args: unknown, summary = "") =>
  rec(agent, ms, { type: "tool_started", round: 1, callId: id, name, args, summary });
const done = (agent: string, ms: number, id: string, name: string, result = "ok", outcome = "accepted") =>
  rec(agent, ms, { type: "tool_finished", callId: id, name, outcome, durationMs: 40, resultChars: result.length, resultCut: false, result });

const spawn = (board: Board, ms: number, answer: Record<string, unknown>, asked = "scout · gpt-5-mini · 0.2 USD") => {
  board.handle("capitano-1", call("capitano-1", ms, `s${ms}`, "spawn_agent", {}, asked));
  board.handle("capitano-1", done("capitano-1", ms + 1, `s${ms}`, "spawn_agent", JSON.stringify(answer, null, 2), answer["ok"] === false ? "failed" : "accepted"));
};

const frame = (board: Board, ms: number, page: Page = "agents", size = FULL) => board.frame(T0 + ms, size, "test", page).join("\n");
const lineOf = (text: string, label: string) => text.split("\n").find((l) => l.includes(label)) ?? "";
/** An agent's row on the AGENTS page: its state glyph, then its name. */
const rowOf = (text: string, agent: string) => text.split("\n").find((l) => new RegExp(`^ \\S{1,2} +${agent} `, "u").test(l)) ?? "";
/** The line of facts under an agent's row. */
const factsOf = (text: string, agent: string) => {
  const lines = text.split("\n");
  return lines[lines.indexOf(rowOf(text, agent)) + 1] ?? "";
};

describe("the dashboard leaves empty what no trace carries", () => {
  it("shows no figure for the piggy bank or the key proxy before the hub has answered", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1"));
    const text = frame(board, 1_000, "money");
    expect(lineOf(text, "piggy bank")).not.toMatch(/\$\d/);
    expect(lineOf(text, "piggy bank")).toContain("left — of —");
    expect(lineOf(text, "key proxy")).not.toMatch(/\d/);
  });

  it("shows the run's cap from the start and its spend only once a round has written it", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1", 0.4));
    expect(rowOf(frame(board, 1_000), "scout-1")).toContain("— / $0.4000");
    board.handle("scout-1", round("scout-1", 2_000, 3, 0.0123));
    const text = frame(board, 2_500);
    expect(rowOf(text, "scout-1")).toContain("$0.0123 / $0.4000");
    expect(factsOf(text, "scout-1")).toContain("search 2/8");
    expect(lineOf(frame(board, 2_500, "money"), "$0.0123 / $0.4000")).toContain("@round 3");
  });

  it("counts in the money bar only the spend the runs reported, and says how many have not", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1", 0.4));
    board.handle("scout-2", started("scout-2", 0.5));
    board.handle("scout-1", round("scout-1", 2_000, 1, 0.1));
    expect(lineOf(frame(board, 3_000, "money"), "run caps")).toContain("$0.9000 given to 2 runs · $0.1000 spent (1 not reported yet)");
  });
});

describe("a line from another version does not take the screen down", () => {
  it("draws a run_started without limits and a round without its run totals, leaving their figures blank", () => {
    const board = new Board();
    const { limits: _limits, ...old } = started("scout-1", 0.4) as TraceLine & { limits?: unknown };
    board.handle("scout-1", old as TraceLine);
    const { run: _run, usage: _usage, ...bare } = round("scout-1", 1_000, 1, 0.2) as TraceLine & { run?: unknown; usage?: unknown };
    board.handle("scout-1", bare as TraceLine);
    for (const page of PAGES) expect(() => frame(board, 2_000, page)).not.toThrow();
    expect(rowOf(frame(board, 2_000), "scout-1")).toContain("— / $0.4000");
  });
});

describe("the AGENTS page is the whole team, always", () => {
  it("has a row for every role of the product before any trace, each switched off", () => {
    const text = frame(new Board(), 0);
    for (const role of ROSTER) expect(rowOf(text, role)).toMatch(/○ .*no trace/);
    expect(text).toContain("waiting for the first trace");
  });

  it("keeps the rows of the roles that have not run when others light up", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1"));
    const text = frame(board, 1_000);
    expect(rowOf(text, "scout-1")).toMatch(/^ 🟢 /u);
    expect(rowOf(text, "scout")).toBe("");
    for (const role of ROSTER.filter((r) => r !== "scout")) expect(rowOf(text, role)).toContain("no trace");
    const lines = text.split("\n");
    expect(lines.indexOf(rowOf(text, "capitano"))).toBeLessThan(lines.indexOf(rowOf(text, "scout-1")));
    expect(lines.indexOf(rowOf(text, "scout-1"))).toBeLessThan(lines.indexOf(rowOf(text, "analista")));
  });

  it("says in one glyph where each run stands, and in words only what the glyph cannot", () => {
    const board = new Board();
    for (const agent of ["scout-1", "scout-2", "analista-1", "scorer-1"]) board.handle(agent, started(agent));
    board.handle("scout-2", rec("scout-2", 1_000, { type: "run_finished", reason: "completed", steps: 1, toolCalls: 0, usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.1, durationMs: 1 }));
    board.handle("analista-1", rec("analista-1", 1_000, { type: "run_failed", code: "budget_exhausted", message: "no" }));
    board.handle("scout-1", rec("scout-1", SILENT_MS + 4_000, { type: "turn_started", turn: 2 }));
    const text = frame(board, SILENT_MS + 5_000);
    expect(rowOf(text, "scout-1")).toMatch(/^ 🟢 /u);
    expect(rowOf(text, "scout-2")).toMatch(/^ 🔵 .*completed 19\.0s ago/u);
    expect(rowOf(text, "analista-1")).toMatch(/^ 🔴 .*budget_exhausted/u);
    // A run that stopped writing is silent, not dead: the trace cannot tell which.
    expect(rowOf(text, "scorer-1")).toMatch(/^ 🟡 .*silent 20\.0s/u);
    expect(rowOf(text, "scorer-1")).not.toMatch(/died|dead|failed/);
  });

  it("moves: an agent at work draws its activity, a quiet one only dots", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1"));
    board.handle("scorer-1", started("scorer-1"));
    // Both started at 0, which is past the activity line by now; only the scout worked since.
    for (let i = 0; i < 6; i++) board.handle("scout-1", call("scout-1", 600_000 + i * 1_000, `a${i}`, "grep", {}, "x"));
    const text = frame(board, 606_000);
    expect(rowOf(text, "scout-1")).toMatch(/[▁▂▃▄▅▆▇█]/);
    expect(rowOf(text, "scorer-1")).not.toMatch(/[▁▂▃▄▅▆▇█]/);
  });

  it("names the tool in flight, and forgets it when it returns", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1"));
    board.handle("scout-1", call("scout-1", 1_000, "c1", "web_search", {}, "rust jobs rome"));
    expect(rowOf(frame(board, 3_000), "scout-1")).toMatch(/⚙ web_search rust jobs rome 2\.0s/);
    board.handle("scout-1", done("scout-1", 3_500, "c1", "web_search"));
    expect(rowOf(frame(board, 4_000), "scout-1")).not.toContain("web_search");
  });

  it("shows who spawned whom, a booking with no trace yet in its role's place, and who wrote to whom", () => {
    const board = new Board();
    board.handle("capitano-1", started("capitano-1"));
    spawn(board, 1_000, { ok: true, agent: "scout-2", booked_usd: 0.2, left_usd: 0.3 });
    spawn(board, 2_000, { ok: true, agent: "scorer-1", booked_usd: 0.1, left_usd: 0.2 });
    board.handle("scout-2", { ...started("scout-2", 0.2), ts: new Date(T0 + 3_000).toISOString() });
    for (const ms of [4_000, 4_500]) board.handle("scout-2", call("scout-2", ms, `m${ms}`, "send_message", { to: "capitano", text: "[RES]" }, "to capitano"));
    const text = frame(board, 5_000);
    expect(factsOf(text, "scout-2")).toContain("↳ spawned by capitano-1 · booked $0.2000");
    expect(factsOf(text, "scout-2")).toContain("✉ → capitano ×2");
    expect(rowOf(text, "scorer-1")).toMatch(/○ .*booked \$0\.1000 by capitano-1 3\.0s ago · no trace yet/);
    // The booking takes the scorer's place: the role's switched-off row goes.
    expect(rowOf(text, "scorer")).toBe("");
  });

  it("starts every name in the same column, whether the row is lit, booked or switched off", () => {
    const board = new Board();
    board.handle("capitano-1", started("capitano-1"));
    spawn(board, 1_000, { ok: true, agent: "scorer-1", booked_usd: 0.1, left_usd: 0.2 });
    const text = frame(board, 2_000);
    const column = (agent: string) => {
      const row = rowOf(text, agent);
      return cells(row.slice(0, row.indexOf(agent)));
    };
    expect(column("capitano-1")).toBe(5);
    expect(column("scorer-1")).toBe(5);
    expect(column("scrittore")).toBe(5);
  });

  it("follows the newest run of an agent and ignores lines of an older one", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1", 0.4));
    board.handle("scout-1", { ...started("scout-1", 0.9), runId: "2026-09-23T21-00-00-000Z-bbbb" });
    board.handle("scout-1", round("scout-1", 2_000, 5, 0.3));
    expect(rowOf(frame(board, 2_500), "scout-1")).toContain("— / $0.9000");
  });
});

describe("the RESULTS page calls out what the team made, and rings for it", () => {
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
    const text = frame(board, 3_000, "results");
    expect(lineOf(text, "Rust Developer")).toMatch(/^ 🆕 .*scout-1 Rust Developer @ Ferrous/u);
    expect(lineOf(text, "🆕 1")).toMatch(/^ 🆕 1$/u);
    // The tab says how many results wait there.
    expect(text.split("\n")[1]).toContain("🔔 RESULTS 1");
  });

  it("names a score, a CV and a word to the person, and only files the person gets", () => {
    expect(resultOf("db_update", { args: ["position", "7", "--score", "82"] }, "")).toEqual({ kind: "update", text: "position 7: score 82" });
    expect(resultOf("db_update", { args: ["position", "7", "--notes", "x"] }, "")).toBeUndefined();
    expect(resultOf("write_file", { path: "/jht_home/user/cv/CV_Acme.md" }, "")).toEqual({ kind: "file", text: "cv/CV_Acme.md" });
    expect(resultOf("write_file", { path: "/jht_home/agents/scout-1/notes.md" }, "")).toBeUndefined();
    expect(resultOf("notify_user", { text: "Two new\npositions. 🎯" }, "")).toEqual({ kind: "person", text: "Two new positions." });
  });

  it("rings for a failed run, warns once when a run nears its cap, and a refusal warns without ringing", () => {
    const board = new Board();
    board.handle("capitano-1", started("capitano-1"));
    spawn(board, 500, { ok: false, reason: "cap_usd 0.3 does not fit: 0.1 USD of the session's 0.6 is left." });
    expect(board.bells).toBe(0);
    board.handle("scout-1", started("scout-1", 0.4));
    board.handle("scout-1", round("scout-1", 1_000, 1, 0.37));
    board.handle("scout-1", round("scout-1", 2_000, 2, 0.39));
    board.handle("scout-1", rec("scout-1", 3_000, { type: "run_failed", code: "budget_exhausted", message: "no" }));
    const text = frame(board, 4_000, "results");
    expect(text.split("\n").filter((l) => l.startsWith(" 💸 "))).toHaveLength(1);
    expect(lineOf(text, "failed: budget_exhausted")).toMatch(/^ 🔴 /u);
    expect(lineOf(text, "spawn refused")).toMatch(/^ 🚫 .*cap_usd 0\.3 does not fit/u);
    expect(board.bells).toBe(1);
  });

  it("keeps a pictograph an agent wrote out of the screen: a joined emoji does not take the same cells everywhere", () => {
    const board = new Board();
    board.handle("capitano-1", started("capitano-1"));
    board.handle("capitano-1", rec("capitano-1", 1_000, { type: "message_in", from: "person", text: "👨‍✈️ go faster ⚠️ now" }));
    expect(lineOf(frame(board, 2_000, "results"), "person:")).toContain("person: go faster now");
  });
});

describe("the MONEY page", () => {
  it("takes the piggy bank from the hub's answer, says whose and how old, and lists every launcher answer", () => {
    const board = new Board();
    board.handle("capitano-1", started("capitano-1"));
    spawn(board, 1_000, { ok: true, spawn_id: "3f9a0c1d2e4b5a67", agent: "scout-2", booked_usd: 0.2, left_usd: 0.35 });
    spawn(board, 2_000, { ok: false, reason: "cap_usd 0.3 does not fit." }, "scorer · gpt-5-mini · 0.3 USD");
    const text = frame(board, 11_001, "money");
    expect(lineOf(text, "piggy bank")).toContain("left $0.3500 of —");
    expect(lineOf(text, "piggy bank")).toContain("hub → capitano-1 · spawn_agent · 10.0s ago");
    expect(lineOf(text, "scout-2 booked")).toMatch(/^ ✓ .*asked scout · gpt-5-mini · 0\.2 USD → scout-2 booked \$0\.2000 · left \$0\.3500/u);
    // The refusal names a figure in its prose, but carries no left_usd: the piggy bank keeps the last one.
    expect(lineOf(text, "refused:")).toMatch(/^ 🚫 .*asked scorer · gpt-5-mini · 0\.3 USD → refused: cap_usd 0\.3 does not fit\./u);
    const lines = text.split("\n");
    expect(lines.indexOf(lineOf(text, "refused:"))).toBeLessThan(lines.indexOf(lineOf(text, "scout-2 booked")));
  });

  it("reads left_usd from a result the trace cut short", () => {
    const whole = JSON.stringify({ session: "2026-09-23-a", left_usd: 0.12, spawns: Array.from({ length: 80 }, (_, i) => ({ id: `${i}`, agent: `scout-${i}` })) }, null, 2);
    expect(hubAnswer(whole.slice(0, 200))).toMatchObject({ leftUsd: 0.12, session: "2026-09-23-a" });
    expect(hubAnswer("Error: hub unreachable")).not.toHaveProperty("leftUsd");
  });

  it("shows the waits on a 429 as the rounds wrote them, and the spend by role", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1", 0.4));
    board.handle("scout-2", started("scout-2", 0.4));
    board.handle("scout-1", round("scout-1", 1_000, 1, 0.1, { backoff: { attempts: 3, waitedMs: 14_000 } }));
    board.handle("scout-2", round("scout-2", 1_000, 1, 0.05));
    const money = frame(board, 2_000, "money");
    expect(lineOf(money, "$0.1000 / $0.4000")).toContain("429: 1 round waited 14.0s");
    expect(lineOf(money, "by role")).toContain("scout $0.1500");
    expect(factsOf(frame(board, 2_000), "scout-1")).toContain("429: 1 round waited 14.0s");
  });
});

describe("the screen says something when nothing runs", () => {
  it("says the team is idle and since when, and keeps how the last runs ended", () => {
    const board = new Board();
    board.handle("scout-1", started("scout-1"));
    board.handle("scout-1", rec("scout-1", 1_000, { type: "run_finished", reason: "completed", steps: 4, toolCalls: 3, usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.2, durationMs: 1_000 }));
    const text = frame(board, 1_000 + 3 * 86_400_000);
    expect(text.split("\n")[0]).toContain("IDLE · last activity 3d 0h ago");
    expect(rowOf(text, "scout-1")).toMatch(/^ 🔵 .*\$0\.2000 \/ \$0\.5000 .*completed 3d 0h ago/u);
  });

  it("with no trace at all, says so in the banner", () => {
    expect(frame(new Board(), 0).split("\n")[0]).toContain("NO TRACE YET");
  });

  it("writes elapsed time as a person reads it", () => {
    expect(ago(42_000)).toBe("42.0s");
    expect(ago(5 * 3_600_000 + 7 * 60_000)).toBe("5h07m");
    expect(ago(61 * 3_600_000)).toBe("2d 13h");
  });
});

describe("the screen fits the pane", () => {
  it("counts an emoji and a wide character as two cells, a colour code as none", () => {
    expect(cells("🟢")).toBe(2);
    expect(cells("中")).toBe(2);
    expect(cells("\x1b[32mok\x1b[39m")).toBe(2);
  });

  const busy = () => {
    const board = new Board();
    board.handle("capitano-1", started("capitano-1", 0.3));
    for (const agent of ["scout-1", "scout-2", "analista-1", "scorer-1", "scrittore-1"]) {
      board.handle(agent, started(agent, 0.4));
      board.handle(agent, round(agent, 1_000, 2, 0.05, { backoff: { attempts: 2, waitedMs: 3_000 } }));
      board.handle(agent, call(agent, 1_500, `x-${agent}`, "web_search", {}, "a very long query 中文 ".repeat(20)));
    }
    spawn(board, 2_000, { ok: true, agent: "scout-2", booked_usd: 0.4, left_usd: 0.1 });
    spawn(board, 2_100, { ok: false, reason: "a long refusal ".repeat(20) });
    for (let i = 0; i < 40; i++) board.handle("scout-1", call("scout-1", 3_000 + i, `p${i}`, "db_insert", { args: ["position", "--title", `Role ${i}`] }));
    for (let i = 0; i < 40; i++) board.handle("scout-1", done("scout-1", 3_100 + i, `p${i}`, "db_insert"));
    return board;
  };

  for (const size of [{ cols: 45, rows: 12 }, { cols: 60, rows: 16 }, { cols: 80, rows: 24 }, { cols: 120, rows: 30 }, { cols: 200, rows: 60 }]) {
    it(`never draws past ${size.cols}x${size.rows} on any page, and keeps the banner and the tabs`, () => {
      const board = busy();
      for (const page of PAGES) {
        const lines = board.frame(T0 + 5_000, size, "a header long enough to be cut ".repeat(10), page);
        expect(lines.length).toBeLessThanOrEqual(size.rows);
        for (const line of lines) expect(cells(line)).toBeLessThanOrEqual(size.cols);
        expect(lines[0]).toContain("JHT · API TEAM");
        expect(lines[1]).toContain("AGENTS");
      }
      expect(board.frame(T0 + 5_000, size, "", "results").join("\n")).toContain("Role 39");
    });
  }
});
