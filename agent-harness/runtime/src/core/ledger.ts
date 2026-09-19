/**
 * The spend ledger: one line per live run, in a TSV the whole team shares.
 *
 * The API budget is small and common to every role, so what each live run
 * cost must be written down where the people who keep the budget read it —
 * not only in a trace on the machine that ran it. The file's columns are
 * fixed by the team (`data ruolo modello token_in token_cached token_out usd
 * run_id note`); the header is written only when the file is new or empty.
 *
 * A mock run spends nothing and writes nothing here.
 */

import { appendFileSync, closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { dirname } from "node:path";

import type { Usage } from "./usage.ts";

export const LEDGER_HEADER = ["data", "ruolo", "modello", "token_in", "token_cached", "token_out", "usd", "run_id", "note"];

export interface LedgerEntry {
  at: Date;
  role: string;
  /** `provider/model`, as the trace names it. */
  model: string;
  usage: Usage;
  costUsd: number;
  runId: string;
  /** How the run ended: `completed`, `stopped`, or a failure code. */
  note: string;
}

/** The line for `entry`, without its newline. Tabs and newlines inside a field become spaces. */
export function ledgerLine(entry: LedgerEntry): string {
  return [
    entry.at.toISOString(),
    entry.role,
    entry.model,
    String(entry.usage.inputTokens),
    String(entry.usage.cachedInputTokens ?? 0),
    String(entry.usage.outputTokens),
    entry.costUsd.toFixed(6),
    entry.runId,
    // The team's columns are fixed: cache writes, billed on top, ride in the note.
    (entry.usage.cacheWriteTokens ?? 0) > 0 ? `${entry.note}; cache_write_tokens=${entry.usage.cacheWriteTokens}` : entry.note,
  ]
    .map((field) => field.replace(/[\t\r\n]+/g, " "))
    .join("\t");
}

/**
 * Appends `entry` to the ledger at `path`. Synchronous, so a run that is
 * about to exit cannot lose its line.
 */
export function appendLedger(path: string, entry: LedgerEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  const size = sizeOf(path);
  // A file edited by hand may lack its last newline: the line must not glue onto it.
  const lead = size === 0 ? `${LEDGER_HEADER.join("\t")}\n` : lastByte(path, size) === 0x0a ? "" : "\n";
  appendFileSync(path, `${lead}${ledgerLine(entry)}\n`, "utf8");
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function lastByte(path: string, size: number): number | undefined {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(1);
    readSync(fd, buffer, 0, 1, size - 1);
    return buffer[0];
  } finally {
    closeSync(fd);
  }
}
