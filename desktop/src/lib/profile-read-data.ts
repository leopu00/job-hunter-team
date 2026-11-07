import type { ExistingTeamProfileRead, ProfileFileState, ProfileParse, ProfileSummary, ProfileSummaries, SummaryState } from "./existing-team-profile";
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

const FILE_STATES: readonly string[] = ["absent", "too_large", "unreadable", "not_utf8", "ok"];
const PARSES: readonly string[] = ["ok", "invalid_yaml", "not_a_mapping", "aliases_unsupported", "none"];
const SUMMARY_STATES: readonly string[] = ["ok", "too_large", "unreadable", "not_utf8", "over_budget"];

/** The reply's data, whole or refused: a part that is not what the core promises is a bad reply. */
export function pickProfileRead(data: unknown): ExistingTeamProfileRead | null {
  if (!isRecord(data) || !isRecord(data.profile) || !isRecord(data.summaries)) return null;
  const { profile, summaries } = data;
  if (typeof profile.state !== "string" || !FILE_STATES.includes(profile.state)) return null;
  const parse = profile.state === "ok" ? profile.parse : "none";
  if (typeof parse !== "string" || !PARSES.includes(parse)) return null;
  const fields = parse === "ok" ? profile.fields : null;
  if (parse === "ok" && !isRecord(fields)) return null;
  if (!count(profile.kept) || !count(profile.dropped)) return null;
  if (
    !["ok", "absent", "unreadable"].includes(summaries.state as string) ||
    !Array.isArray(summaries.items) ||
    !count(summaries.included) ||
    !count(summaries.of)
  ) {
    return null;
  }
  const items: ProfileSummary[] = [];
  for (const raw of summaries.items) {
    if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.state !== "string" || !SUMMARY_STATES.includes(raw.state)) {
      return null;
    }
    const text = typeof raw.text === "string" ? raw.text : null;
    if (raw.state === "ok" && text === null) return null;
    items.push({
      name: raw.name,
      state: raw.state as SummaryState,
      bytes: count(raw.bytes) ? raw.bytes : null,
      text: raw.state === "ok" ? text : null,
    });
  }
  return {
    file: {
      state: profile.state as ProfileFileState,
      bytes: count(profile.bytes) ? profile.bytes : null,
      parse: parse as ProfileParse,
      fields: parse === "ok" ? (fields as Record<string, unknown>) : null,
      kept: profile.kept,
      dropped: profile.dropped,
    },
    summaries: {
      state: summaries.state as ProfileSummaries["state"],
      items,
      included: summaries.included,
      of: summaries.of,
    },
  };
}
