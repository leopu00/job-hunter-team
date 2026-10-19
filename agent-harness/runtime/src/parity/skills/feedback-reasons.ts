/**
 * The closed vocabulary of a judgement's reason (JHT-T05), as
 * `shared/feedback-reasons.json` says it. The runtime ships without the
 * `shared/` folder, so the list is copied here and a test
 * (`tests/feedback-reasons.test.ts`) holds the copy equal to the file.
 */

export const FEEDBACK_REASONS: readonly string[] = ["too_senior", "too_junior", "wrong_location", "salary_low", "wrong_stack", "company", "scam_or_gone", "closed", "already_applied", "other"];

/** The old list's codes, and what each becomes. */
const LEGACY: Readonly<Record<string, string>> = {
  closed: "closed",
  already_applied: "already_applied",
  company: "company",
  other: "other",
  not_interested: "other",
  mismatch: "other",
  conditions: "other",
};

/** What the agents may read of a code: a fixed phrase, never the user's words. */
export const FEEDBACK_REASON_LABELS: Readonly<Record<string, string>> = {
  too_senior: "too senior",
  too_junior: "too junior",
  wrong_location: "wrong location",
  salary_low: "salary too low",
  wrong_stack: "wrong stack",
  company: "unwanted company",
  scam_or_gone: "scam or gone",
  closed: "closed",
  already_applied: "already applied",
  other: "other",
};

/**
 * A stored reason as a code of the vocabulary, or null when there is none.
 * A free text is `other`: the text never travels, only the code.
 */
export function safeReason(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (FEEDBACK_REASONS.includes(text)) return text;
  return Object.prototype.hasOwnProperty.call(LEGACY, text) ? (LEGACY[text] as string) : "other";
}
