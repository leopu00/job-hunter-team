import { invoke, isTauri } from "@tauri-apps/api/core";

/** The eight fields the team needs before it can start, in the order of the card. */
export const PROFILE_KEYS = ["name", "email", "target_role", "location", "experience_years", "seniority_target", "skills", "languages"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

export interface ProfileField {
  key: ProfileKey;
  /** Whether the team's own rule (validate_profile.py) counts the field as there. */
  ok: boolean;
  /** A short value for name, target_role, location, seniority_target and experience_years; never the email. */
  preview?: string;
  /** How many skills or languages the profile has; for those two only. */
  count?: number;
}

export type ProfileProgress =
  | { ok: true; required: number; done: number; ready: boolean; fields: ProfileField[] }
  | { ok: false; error: "profile_unavailable" | "profile_unreadable" };

const PREVIEW_KEYS: readonly ProfileKey[] = ["name", "target_role", "location", "seniority_target", "experience_years"];
const COUNT_KEYS: readonly ProfileKey[] = ["skills", "languages"];

const invalid = () => ({ code: "profile_progress_invalid" });

/**
 * How far the candidate profile is from what the team needs to start, read from the team's own file by the app. A
 * closed shape: anything else throws `profile_progress_invalid`. No argument crosses; the answer is not a rule the
 * page recalculates: `ok` per row and `done`/`ready` are the team's. The email never carries a preview.
 */
export async function readProfileProgress(): Promise<ProfileProgress> {
  if (!isTauri()) throw { code: "desktop_only" };
  const reply = await invoke<unknown>("profile_progress_read");
  if (!reply || typeof reply !== "object") throw invalid();
  const body = reply as Record<string, unknown>;
  if (body.ok === false) {
    return { ok: false, error: body.error === "profile_unreadable" ? "profile_unreadable" : "profile_unavailable" };
  }
  const rows = body.fields;
  if (body.ok !== true || !Array.isArray(rows) || rows.length !== PROFILE_KEYS.length) throw invalid();
  const fields: ProfileField[] = rows.map((raw, index) => {
    const row = raw as Record<string, unknown> | null;
    const key = PROFILE_KEYS[index]!;
    if (!row || row.key !== key || typeof row.ok !== "boolean") throw invalid();
    const field: ProfileField = { key, ok: row.ok };
    if (PREVIEW_KEYS.includes(key) && typeof row.preview === "string" && row.preview !== "") field.preview = row.preview;
    if (COUNT_KEYS.includes(key)) {
      if (typeof row.count !== "number" || !Number.isInteger(row.count) || row.count < 0) throw invalid();
      field.count = row.count;
    }
    return field;
  });
  const done = fields.filter((field) => field.ok).length;
  return { ok: true, required: fields.length, done, ready: done === fields.length, fields };
}
