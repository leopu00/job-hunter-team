import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fanout, JsonlTrace, type TraceEvent } from "../src/core/trace.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jht-api-trace-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("JsonlTrace", () => {
  it("appends numbered records under <role>/<runId>.jsonl, readable only by the owner", async () => {
    const trace = new JsonlTrace({ dir, role: "scout", runId: "run-1", now: () => new Date("2026-09-13T10:00:00Z") });
    trace.write({ type: "message_in", from: "person", text: "I rent" });
    trace.write({ type: "turn_started", turn: 1 });

    expect(trace.path).toBe(join(dir, "scout", "run-1.jsonl"));
    const lines = (await readFile(trace.path, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { ts: "2026-09-13T10:00:00.000Z", seq: 1, runId: "run-1", role: "scout", type: "message_in", from: "person", text: "I rent" },
      { ts: "2026-09-13T10:00:00.000Z", seq: 2, runId: "run-1", role: "scout", type: "turn_started", turn: 1 },
    ]);
    expect((await stat(trace.path)).mode & 0o077).toBe(0);
  });

  it("fans one event out to every sink", () => {
    const a: TraceEvent[] = [];
    const b: TraceEvent[] = [];
    fanout((e) => a.push(e), (e) => b.push(e))({ type: "turn_started", turn: 3 });
    expect(a).toEqual([{ type: "turn_started", turn: 3 }]);
    expect(b).toEqual(a);
  });
});
