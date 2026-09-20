/**
 * `salary_estimate.py` as a native tool (T14, analista.md step 7: the rough
 * estimate every checked position carries).
 *
 * The same levels and JSON: L1 the declared range (from the flags, or from
 * the position's row with `--position-id`), L2 a fresh entry of the local
 * cache, L3 a web stub that never answers, L4 the neutral default with
 * `estimation_failed`. The agent then writes the range with `db_update`.
 *
 * Differences, on purpose:
 * - The cache is read from the runtime's state (`cacheFile`), never written:
 *   `--seed-cache` is the script's development switch, and it would let a
 *   caller plant 30 days of ranges every later estimate returns. Refused.
 * - The cache is JSON, and a range stored as `28000.0` reads back as 28000.
 */

import { readFileSync } from "node:fs";

import { parseArgv, type CommandSpec } from "../../db/argv.ts";
import type { Database } from "../../db/jobs-db.ts";
import { PY_SPACE_CLASS, pyJson, pyTruthy } from "../../db/py-format.ts";
import type { ScriptResult } from "../../db/tools.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { argvTool } from "./argv-tool.ts";

const SPEC: CommandSpec = {
  prog: "salary_estimate.py",
  options: [
    { flag: "--stack" },
    { flag: "--seniority" },
    { flag: "--country" },
    { flag: "--mode", default: "remote" },
    { flag: "--declared-min", type: "int" },
    { flag: "--declared-max", type: "int" },
    { flag: "--position-id", type: "int" },
    { flag: "--seed-cache", storeTrue: true },
  ],
};
const TTL_DAYS = 30;
const STRIP = new RegExp(`^[${PY_SPACE_CLASS}]+|[${PY_SPACE_CLASS}]+$`, "gu");

export interface SalaryEstimateOptions {
  db: () => Database;
  /** The runtime's copy of `salary_estimates.json`; absent or unreadable is an empty cache. */
  cacheFile?: string;
  now?: () => Date;
}

type Entry = Record<string, unknown>;

function loadCache(file: string | undefined): Record<string, Entry> {
  if (!file) return {};
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, Entry>) : {};
  } catch {
    return {};
  }
}

/** `_cache_key`: stack|seniority lowercased, country uppercased, mode lowercased. */
function cacheKey(stack: string, seniority: string, country: string, mode: string): string {
  const s = (v: string) => v.replace(STRIP, "");
  return [s(stack).toLowerCase(), s(seniority).toLowerCase(), s(country).toUpperCase(), s(mode).toLowerCase()].join("|");
}

export function salaryEstimate(argv: string[], options: SalaryEstimateOptions): ScriptResult {
  const a = parseArgv(SPEC, argv);
  if (a["seed_cache"]) {
    return {
      stdout: "",
      stderr: "--seed-cache is the script's development switch and is not available to this agent: estimate with --stack --seniority --country, or read the declared range.\n",
      exitCode: 2,
    };
  }
  const now = options.now?.() ?? new Date();
  const today = now.toISOString().slice(0, 10);
  let declaredMin = a["declared_min"] as number | null;
  let declaredMax = a["declared_max"] as number | null;
  if (pyTruthy(a["position_id"]) && (declaredMin === null || declaredMax === null)) {
    const r = options.db().prepare("SELECT salary_declared_min, salary_declared_max FROM positions WHERE id = ?").get(a["position_id"] as number) as
      | { salary_declared_min: number | null; salary_declared_max: number | null }
      | undefined;
    if (r) {
      declaredMin ??= r.salary_declared_min;
      declaredMax ??= r.salary_declared_max;
    }
  }
  const print = (result: Record<string, unknown>): ScriptResult => ({ stdout: `${pyJson(result)}\n`, exitCode: 0 });

  if (declaredMin !== null && declaredMax !== null) {
    return print({ level: 1, min: Math.trunc(declaredMin), max: Math.trunc(declaredMax), currency: "EUR", source: "declared", fetched_at: today, estimation_failed: false });
  }
  const stack = a["stack"] as string | null;
  const seniority = a["seniority"] as string | null;
  const country = a["country"] as string | null;
  if (!(pyTruthy(stack) && pyTruthy(seniority) && pyTruthy(country))) {
    return print({ level: 4, min: null, max: null, currency: "EUR", source: "default", fetched_at: today, estimation_failed: true, reason: "missing_inputs" });
  }
  const mode = pyTruthy(a["mode"]) ? (a["mode"] as string) : "remote";
  const hit = loadCache(options.cacheFile)[cacheKey(stack!, seniority!, country!, mode)];
  if (hit && typeof hit === "object") {
    const ts = hit["fetched_at_ts"];
    // dict.get(key, default): the default only when the key is missing, not when it holds null.
    const get = (k: string, fallback: unknown) => (k in hit ? hit[k] : fallback);
    const ttl = get("ttl_days", TTL_DAYS) as number;
    if (typeof ts === "number" && (now.getTime() / 1000 - ts) / 86_400 < ttl) {
      return print({
        level: 2,
        min: hit["min"] ?? null,
        max: hit["max"] ?? null,
        currency: get("currency", "EUR"),
        source: get("source", "cache"),
        fetched_at: get("fetched_at", today),
        estimation_failed: false,
      });
    }
  }
  return print({ level: 4, min: null, max: null, currency: "EUR", source: "default", fetched_at: today, estimation_failed: true, reason: "no_data_default" });
}

export function createSalaryEstimateTool(options: SalaryEstimateOptions): ToolHandler {
  return argvTool({
    name: "salary_estimate",
    script: "salary_estimate.py",
    description: "Rough salary estimate: the declared range (--declared-min/--declared-max or --position-id), else the local cache, else a neutral default with estimation_failed.",
    run: (args) => salaryEstimate(args, options),
  });
}
