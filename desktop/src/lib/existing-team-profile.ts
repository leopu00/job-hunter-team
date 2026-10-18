import { invoke } from "@tauri-apps/api/core";
import type { ProfileBlock } from "@/app/(protected)/profile/ProfileView";
import { mapYamlToCanonical } from "../../../web/lib/profile-yaml-map";
import type { CandidateProfile } from "../../../web/lib/types";
import { teamStatusErrorCode } from "./existing-team-status";
import { reportVpsRead } from "./vps-link";

/**
 * The candidate profile of an existing team, read from its VPS by the core's
 * `profile` op (the same one `jht existing-team profile` runs): the fields of
 * candidate_profile.yml the cloud's own mapper reads, and the summaries/*.md.
 * Nothing else of the profile folder is read, and every thing the core could
 * not read, cut or dropped comes in the reply and is kept here as a notice.
 */
const COMMAND = "existing_team_positions_read";

export type ProfileFileState = "absent" | "too_large" | "unreadable" | "not_utf8" | "ok";
export type ProfileParse = "ok" | "invalid_yaml" | "not_a_mapping" | "aliases_unsupported" | "none";
export type SummaryState = "ok" | "too_large" | "unreadable" | "not_utf8" | "over_budget" | "absent";

export interface ProfileFile {
  state: ProfileFileState;
  bytes: number | null;
  parse: ProfileParse;
  fields: Record<string, unknown> | null;
  kept: number;
  dropped: number;
}

export interface ProfileSummary {
  name: string;
  state: SummaryState;
  bytes: number | null;
  text: string | null;
}

export interface ProfileSummaries {
  /** Whether the folder was there and could be listed. */
  state: "ok" | "absent" | "unreadable";
  items: ProfileSummary[];
  included: number;
  of: number;
}

export interface ExistingTeamProfileRead {
  file: ProfileFile;
  summaries: ProfileSummaries;
}

export type ExistingTeamProfileReading =
  | { kind: "unknown" }
  | { kind: "read"; at: number; read: ExistingTeamProfileRead }
  | { kind: "error"; at: number; code: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
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

/** Reads the profile again from the team's VPS: nothing is kept between two reads. */
export async function readExistingTeamProfile(
  read: () => Promise<unknown> = () => invoke<unknown>(COMMAND, { request: { op: "profile" } }),
  now: () => number = Date.now,
): Promise<ExistingTeamProfileReading> {
  try {
    const reply = await read();
    reportVpsRead(reply);
    if (!isRecord(reply)) return { kind: "error", at: now(), code: "desktop_bad_reply" };
    if (reply.ok === false) return { kind: "error", at: now(), code: teamStatusErrorCode(reply.error) };
    const picked = reply.ok === true ? pickProfileRead(reply.data) : null;
    return picked
      ? { kind: "read", at: now(), read: picked }
      : { kind: "error", at: now(), code: "desktop_bad_reply" };
  } catch (error) {
    reportVpsRead({ ok: false, error: teamStatusErrorCode(error) });
    return { kind: "error", at: now(), code: teamStatusErrorCode(error) };
  }
}

/** The fields the profile page treats as its base, and the ones the file does not have. */
const CORE_FIELDS = [
  "name",
  "target_role",
  "location",
  "experience_years",
  "has_degree",
  "seniority_target",
  "skills",
  "languages",
] as const;

export function missingCoreFields(fields: Record<string, unknown>): string[] {
  const holders = [fields, fields.candidate, fields.personal].filter(isRecord);
  return CORE_FIELDS.filter((field) => !holders.some((holder) => holder[field] !== undefined && holder[field] !== null));
}

export interface ExistingTeamProfileView {
  profile: CandidateProfile;
  blocks: ProfileBlock[];
  contacts: Record<string, string | null> | null;
}

/**
 * The profile as the cloud draws it: the same mapper the cloud sync runs on
 * this file, over the whitelisted fields and the summaries that were read.
 * Throws when the mapper refuses the profile (a role category that does not
 * exist, for one); the page says so instead of drawing a part of it.
 */
export function buildProfileView(read: ExistingTeamProfileRead): ExistingTeamProfileView | null {
  if (read.file.fields === null) return null;
  const summaries: Record<string, string> = {};
  for (const item of read.summaries.items) if (item.state === "ok" && item.text !== null) summaries[item.name] = item.text;
  const canonical = mapYamlToCanonical(read.file.fields, "local", summaries);
  const contacts = canonical.contacts ? (canonical.contacts as Record<string, string | null>) : null;
  return {
    profile: { id: "local", created_at: "", updated_at: "", ...canonical.profileRow } as unknown as CandidateProfile,
    blocks: canonical.blocks as unknown as ProfileBlock[],
    contacts,
  };
}
