/**
 * The exclusions of the profile the user accepted, as they act on a score (JHT-T24): the twin of
 * `shared/skills/profile_exclusions.py` for what the runtime does with them. It READS the table and
 * applies the penalty; accepting and withdrawing are the user's, written by that script alone.
 *
 * The rule is the script's: each code matches the position by the structured columns it was frozen
 * from, the penalty is fixed per code, and the sum never takes off more than the cap.
 */

import type { Database } from "./jobs-db.ts";
import { FEEDBACK_REASON_LABELS } from "../parity/skills/feedback-reasons.ts";

export const EXCLUSION_CODES = ["company", "wrong_location", "salary_low", "wrong_stack"] as const;
export type ExclusionCode = (typeof EXCLUSION_CODES)[number];

const PENALTY: Readonly<Record<ExclusionCode, number>> = { company: 30, wrong_location: 15, salary_low: 15, wrong_stack: 15 };
const CAP = 30;

type Params = Record<string, unknown>;
export interface ActiveExclusion {
  code: ExclusionCode;
  params: Params;
}

interface PositionFacts {
  company_id: number | null;
  loc_country_code: string | null;
  remote_type: string | null;
  work_mode: string | null;
  salary_estimated_max: number | null;
  salary_estimated_currency: string | null;
  role_family: string | null;
}

/** The exclusions in force, in the fixed order of the codes. */
export function activeExclusions(db: Database): ActiveExclusion[] {
  const table = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'profile_exclusions'").get();
  if (!table) return [];
  const found: ActiveExclusion[] = [];
  for (const row of db.prepare("SELECT code, params FROM profile_exclusions WHERE status = 'active'").all() as Array<{
    code: string;
    params: string | null;
  }>) {
    if (!(EXCLUSION_CODES as readonly string[]).includes(row.code)) continue;
    try {
      const parsed: unknown = JSON.parse(row.params ?? "");
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        found.push({ code: row.code as ExclusionCode, params: parsed as Params });
      }
    } catch {
      // a row nobody could read acts as no rule
    }
  }
  return found.sort((a, b) => EXCLUSION_CODES.indexOf(a.code) - EXCLUSION_CODES.indexOf(b.code));
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function exclusionMatches(position: PositionFacts, code: ExclusionCode, params: Params): boolean {
  if (code === "company") return position.company_id !== null && list(params["company_ids"]).includes(position.company_id);
  if (code === "wrong_location") {
    const country = (position.loc_country_code ?? "").trim().toUpperCase();
    const remote = position.remote_type === "full_remote" || position.work_mode === "remote";
    return country !== "" && !remote && list(params["country_codes"]).includes(country);
  }
  if (code === "salary_low") {
    const currency = (position.salary_estimated_currency ?? "").trim().toUpperCase();
    const ceilings = (params["ceilings"] ?? {}) as Record<string, unknown>;
    const ceiling = Object.prototype.hasOwnProperty.call(ceilings, currency) ? ceilings[currency] : undefined;
    return position.salary_estimated_max !== null && typeof ceiling === "number" && position.salary_estimated_max <= ceiling;
  }
  const family = (position.role_family ?? "").trim();
  return family !== "" && list(params["role_families"]).includes(family);
}

/** What to take off a position's total, and which codes matched; nothing when none does. */
export function exclusionPenalty(db: Database, positionId: number): { points: number; codes: ExclusionCode[] } {
  const rules = activeExclusions(db);
  if (rules.length === 0) return { points: 0, codes: [] };
  const position = db
    .prepare(
      "SELECT company_id, loc_country_code, remote_type, work_mode, salary_estimated_max, salary_estimated_currency, role_family FROM positions WHERE id = ?",
    )
    .get(positionId) as PositionFacts | undefined;
  if (!position) return { points: 0, codes: [] };
  const codes = rules.filter((r) => exclusionMatches(position, r.code, r.params)).map((r) => r.code);
  return { points: Math.min(CAP, codes.reduce((sum, code) => sum + PENALTY[code], 0)), codes };
}

/** The line a score carries on top of its breakdown: the fixed phrases and the codes, nothing else. */
export function exclusionBreakdownLine(points: number, codes: readonly ExclusionCode[]): string {
  return `EXCLUSION -${points}: ${codes.map((code) => `${FEEDBACK_REASON_LABELS[code] ?? code} (${code})`).join(", ")}`;
}
