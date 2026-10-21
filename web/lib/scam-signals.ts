/**
 * The scam signals of a position (JHT-T06): what `shared/skills/scam_signals.py`
 * stored in `positions.scam_signals`. A warning, never an exclusion: the position
 * stays where it is and keeps its status.
 *
 *   one signal (or several of the same family)  → "badge": a «suspicious» badge with the reasons
 *   signals of two different families           → "section": the «suspicious» section
 *
 * The families are the same as the skill's (tests/test_scam_signals.py pins the
 * two tables against each other).
 */
export const SCAM_SIGNAL_CODES = [
  "same_text_many_places",
  "advance_payment",
  "company_unverifiable",
  "private_chat_only",
] as const;

export type ScamSignalCode = (typeof SCAM_SIGNAL_CODES)[number];
export type ScamBucket = "badge" | "section";

export interface ScamSignals {
  codes: ScamSignalCode[];
  bucket: ScamBucket;
}

export const SCAM_FAMILY: Record<
  ScamSignalCode,
  "text" | "company" | "contact"
> = {
  same_text_many_places: "text",
  advance_payment: "text",
  company_unverifiable: "company",
  private_chat_only: "contact",
};

/** The stored JSON (or an already parsed object), cleaned: unknown codes dropped, bucket recomputed. */
export function parseScamSignals(raw: unknown): ScamSignals | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const stored = (value as { codes?: unknown } | null)?.codes;
  if (!Array.isArray(stored)) return null;
  const codes = SCAM_SIGNAL_CODES.filter((code) => stored.includes(code));
  if (codes.length === 0) return null;
  const families = new Set(codes.map((code) => SCAM_FAMILY[code]));
  return { codes, bucket: families.size >= 2 ? "section" : "badge" };
}

/**
 * The list's view of the «suspicious» section: "hide" leaves it out of the normal
 * list, "only" shows nothing else. Nothing is deleted or re-statused either way.
 */
export function filterByScamView<
  T extends { scam_signals?: ScamSignals | null },
>(rows: T[], view: "hide" | "only"): T[] {
  const wantSection = view === "only";
  return rows.filter((p) => isInSuspectSection(p.scam_signals) === wantSection);
}

export function isInSuspectSection(
  signals: ScamSignals | null | undefined,
): boolean {
  return signals?.bucket === "section";
}
