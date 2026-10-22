// The scam signals of a position (JHT-T06) as the cloud stores them (migration 096,
// positions.scam_signals): the closed codes and the bucket, never the text of the ad.
// Same rule as shared/skills/scam_signals.py and web/lib/scam-signals.ts (a test pins
// the three on the same inputs): only the known codes survive, the bucket is recomputed
// from the families, and the text is the skill's own compact, key-sorted JSON.

const FAMILY = {
  same_text_many_places: 'text',
  advance_payment: 'text',
  company_unverifiable: 'company',
  private_chat_only: 'contact',
};

/** The canonical JSON of a stored value, or null when nothing usable is in it. */
export function canonicalScamSignals(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const stored = value && typeof value === 'object' ? value.codes : null;
  if (!Array.isArray(stored)) return null;
  const codes = Object.keys(FAMILY).filter((code) => stored.includes(code));
  if (codes.length === 0) return null;
  const families = new Set(codes.map((code) => FAMILY[code]));
  return JSON.stringify({ bucket: families.size >= 2 ? 'section' : 'badge', codes, v: 1 });
}
