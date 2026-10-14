import { resumeOnboardingSnapshot } from "./onboarding-runtime";

/**
 * What the existing team's VPS reports about itself, and nothing more: the
 * fields the read-only probe the connection already runs returns. Each is a
 * yes or a no; no name, account or path of the provider ever reaches here.
 */
export const TEAM_STATUS_FIELDS = [
  "runtimeInstalled",
  "containerRunning",
  "providerConfigured",
  "providerAuthenticated",
  "captainRunning",
  "assistantRunning",
  "profileReady",
  "assistantWelcomed",
] as const;

export type TeamStatusField = (typeof TEAM_STATUS_FIELDS)[number];
export type TeamStatusFields = Record<TeamStatusField, boolean>;

/**
 * Never read; read at a moment; or the read that failed, with the code the
 * core gave. A reading is only ever shown with its time, and a failed read
 * clears the last good one: an old snapshot is not offered as the present.
 */
export type TeamStatusReading =
  | { kind: "unknown" }
  | { kind: "read"; at: number; fields: TeamStatusFields }
  | { kind: "error"; at: number; code: string };

/** The eight fields, if the reply has all of them as booleans; null otherwise. */
export function pickTeamStatusFields(snapshot: unknown): TeamStatusFields | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const record = snapshot as Record<string, unknown>;
  const fields = {} as TeamStatusFields;
  for (const field of TEAM_STATUS_FIELDS) {
    if (typeof record[field] !== "boolean") return null;
    fields[field] = record[field] as boolean;
  }
  return fields;
}

/** The real code of a failed native call, or a name for what is not one. */
export function teamStatusErrorCode(error: unknown): string {
  const code = typeof error === "string" ? error : (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(code) ? code : "desktop_transport_unavailable";
}

/**
 * Reads the team's state again through the same read-only command the
 * connection uses (the persisted host, the selected target, one fixed remote
 * probe): not a copy kept in memory.
 */
export async function readTeamStatus(
  read: () => Promise<unknown> = resumeOnboardingSnapshot,
  now: () => number = Date.now,
): Promise<TeamStatusReading> {
  try {
    const fields = pickTeamStatusFields(await read());
    return fields
      ? { kind: "read", at: now(), fields }
      : { kind: "error", at: now(), code: "desktop_bad_reply" };
  } catch (error) {
    return { kind: "error", at: now(), code: teamStatusErrorCode(error) };
  }
}
