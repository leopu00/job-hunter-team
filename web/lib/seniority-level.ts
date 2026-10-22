/**
 * The seniority an advert asks for (JHT-T45), as the cloud keeps it in
 * `positions.seniority_level`: a word of a closed set, lowest to highest, or
 * NULL when the advert does not say. The same set as the local database
 * (`SENIORITY_LEVELS` in shared/skills/_db.py), as the CLI's push and as the
 * CHECK of migration 097; tests/js/tasks/seniority-level-cloud.test.ts pins them.
 */
export const SENIORITY_LEVELS = ["junior", "mid", "senior", "lead"] as const;

export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

/** The level to store: a word of the set exactly as written, anything else is NULL (never rewritten into a level). */
export function canonicalSeniorityLevel(value: unknown): SeniorityLevel | null {
  return typeof value === "string" &&
    (SENIORITY_LEVELS as readonly string[]).includes(value)
    ? (value as SeniorityLevel)
    : null;
}
