import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendLedger, LEDGER_HEADER, type LedgerEntry } from "../src/core/ledger.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jht-api-ledger-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const ENTRY: LedgerEntry = {
  at: new Date("2026-09-19T14:00:00Z"),
  role: "scout",
  model: "openai/gpt-5.6-luna",
  usage: { inputTokens: 12_000, outputTokens: 800, cachedInputTokens: 9_000 },
  costUsd: 0.00336,
  runId: "run-1",
  note: "completed",
};

describe("ledger", () => {
  it("writes the team's header once, then one line per run", async () => {
    const path = join(dir, "sub", "openai-spesa.tsv");
    appendLedger(path, ENTRY);
    appendLedger(path, { ...ENTRY, runId: "run-2", note: "budget_exhausted" });
    expect((await readFile(path, "utf8")).split("\n")).toEqual([
      LEDGER_HEADER.join("\t"),
      "2026-09-19T14:00:00.000Z\tscout\topenai/gpt-5.6-luna\t12000\t9000\t800\t0.003360\trun-1\tcompleted",
      "2026-09-19T14:00:00.000Z\tscout\topenai/gpt-5.6-luna\t12000\t9000\t800\t0.003360\trun-2\tbudget_exhausted",
      "",
    ]);
  });

  it("appends under an existing header, and never glues onto a line missing its newline", async () => {
    const path = join(dir, "openai-spesa.tsv");
    await writeFile(path, LEDGER_HEADER.join("\t"));
    appendLedger(path, { ...ENTRY, note: "a\tnote\nwith breaks" });
    const lines = (await readFile(path, "utf8")).split("\n");
    expect(lines[0]).toBe(LEDGER_HEADER.join("\t"));
    expect(lines[1]?.split("\t")).toHaveLength(LEDGER_HEADER.length);
    expect(lines[1]?.endsWith("a note with breaks")).toBe(true);
  });
});
