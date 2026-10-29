/**
 * The profile card the onboarding shows beside the chat with the Assistant: the eight fields a profile needs
 * (the same list the team's own check uses), each done or not, and how many are done. The values here are
 * the ones the page may show; the email is never one of them (only whether it is there).
 */
export const PROFILE_FIELD_KEYS = [
  "name",
  "email",
  "target_role",
  "location",
  "experience_years",
  "seniority_target",
  "skills",
  "languages",
] as const;

export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

export interface ProfileProgressField {
  key: ProfileFieldKey;
  /** The name of the field in the app's language. */
  label: string;
  /** What to show beside it, ready to read: a short text, or the number of skills / languages. Never the email. */
  value: string | null;
  done: boolean;
}

export interface ProfileProgress {
  /** `loading`: not read yet; `ready`: read (and kept when a later read fails); `unavailable`: the team has no profile to read yet, or it cannot be read. */
  state: "loading" | "ready" | "unavailable";
  fields: ProfileProgressField[];
  filled: number;
  total: number;
}

/** What the native read answers, as the page may trust it. */
export interface ProfileProgressReading {
  required: number;
  done: number;
  ready: boolean;
  fields: { key: ProfileFieldKey; ok: boolean; preview?: string; count?: number }[];
}

export const EMPTY_PROFILE_PROGRESS: ProfileProgress = { state: "loading", fields: [], filled: 0, total: PROFILE_FIELD_KEYS.length };

const KEYS: readonly string[] = PROFILE_FIELD_KEYS;

/** The reply of `profile_progress_read` closed to its shape: the eight keys in order, once each; anything else is nothing. */
export function parseProfileProgressReply(reply: unknown): ProfileProgressReading | null {
  if (typeof reply !== "object" || reply === null) return null;
  const { ok, required, done, ready, fields } = reply as Record<string, unknown>;
  if (ok !== true || !Number.isInteger(required) || !Number.isInteger(done) || typeof ready !== "boolean" || !Array.isArray(fields)) return null;
  const total = required as number;
  const filled = done as number;
  if (total < 1 || total > 32 || filled < 0 || filled > total || fields.length !== PROFILE_FIELD_KEYS.length) return null;
  const parsed: ProfileProgressReading["fields"] = [];
  for (const [index, row] of fields.entries()) {
    if (typeof row !== "object" || row === null) return null;
    const { key, ok: rowOk, preview, count } = row as Record<string, unknown>;
    if (key !== PROFILE_FIELD_KEYS[index] || typeof rowOk !== "boolean") return null;
    const field: ProfileProgressReading["fields"][number] = { key: key as ProfileFieldKey, ok: rowOk };
    if (typeof preview === "string" && key !== "email") field.preview = preview.slice(0, 60);
    if (Number.isInteger(count) && (count as number) >= 0 && (count as number) <= 999) field.count = count as number;
    parsed.push(field);
  }
  return { required: total, done: filled, ready, fields: parsed };
}

/** The card's fields from a reading: the label from the app's words, the value ready to read. */
export function progressFromReading(reading: ProfileProgressReading, labels: Record<ProfileFieldKey, string>): ProfileProgress {
  const fields = reading.fields.map((row): ProfileProgressField => ({
    key: row.key,
    label: labels[row.key],
    value: row.key === "email" ? null : row.preview ?? (row.count !== undefined ? String(row.count) : null),
    done: row.ok,
  }));
  return { state: "ready", fields, filled: reading.done, total: reading.required };
}
