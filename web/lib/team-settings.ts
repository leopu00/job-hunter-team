/**
 * The team settings the site may change on the box: working hours and the model
 * and effort of each role (web capace, phase 6).
 *
 * The site never writes the box's config. It asks the door (`POST /api/team/settings`,
 * action `settings.update`, L2): the database keeps the desire in team_state
 * (`desired_settings`, stamped by a trigger in `desired_settings_at`), the box
 * applies it and writes `settings_applied_at`. This file reads that row, says
 * whether the latest desire is waiting or applied, and builds what the site sends.
 *
 * The lists are the box's (cli/src/lib/team-settings.js) and the schema's
 * (shared/config/schema.ts): a test keeps them equal.
 */

export const SETTINGS_ROLES = [
  "capitano",
  "scout",
  "analista",
  "scorer",
  "scrittore",
  "critico",
  "sentinella",
  "assistente",
  "mentor",
  "closer",
] as const;
export const MODEL_CLASSES = ["sol", "terra", "luna"] as const;
export const EFFORTS = ["low", "medium", "high"] as const;
export const WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

export type SettingsRole = (typeof SETTINGS_ROLES)[number];
export type ModelClass = (typeof MODEL_CLASSES)[number];
export type Effort = (typeof EFFORTS)[number];
export type RoleModel = { model?: ModelClass; effort?: Effort };
export type RoleModels = Partial<Record<SettingsRole, RoleModel>>;

export type Weekday = (typeof WEEKDAYS)[number];
export type WorkingHours = {
  timezone: string;
  windows: { days: Weekday[]; start: string; end: string }[];
};

/** What the site asked last, as the database keeps it. */
export type DesiredSettings = {
  /** undefined = never asked from the site; null = asked 24/7. */
  workingHours: WorkingHours | null | undefined;
  roleModels: RoleModels;
  desiredAt: string | null;
  appliedAt: string | null;
};

/** none: nothing asked from the site; pending: the box has not applied it yet; applied. */
export type SettingsStatus = "none" | "pending" | "applied";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const stamp = (v: unknown): string | null =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;

function readRoleModels(value: unknown): RoleModels {
  const out: RoleModels = {};
  if (!isPlainObject(value)) return out;
  for (const role of SETTINGS_ROLES) {
    const entry = value[role];
    if (!isPlainObject(entry)) continue;
    const next: RoleModel = {};
    if (MODEL_CLASSES.includes(entry.model as ModelClass))
      next.model = entry.model as ModelClass;
    if (EFFORTS.includes(entry.effort as Effort))
      next.effort = entry.effort as Effort;
    out[role] = next;
  }
  return out;
}

function readWorkingHours(value: unknown): WorkingHours | null | undefined {
  if (value === null) return null;
  if (!isPlainObject(value) || typeof value.timezone !== "string")
    return undefined;
  if (!Array.isArray(value.windows)) return undefined;
  const windows = value.windows.filter(
    (w): w is WorkingHours["windows"][number] =>
      isPlainObject(w) &&
      Array.isArray(w.days) &&
      w.days.every((d) => (WEEKDAYS as readonly unknown[]).includes(d)) &&
      typeof w.start === "string" &&
      typeof w.end === "string",
  );
  if (windows.length !== value.windows.length) return undefined;
  return { timezone: value.timezone, windows };
}

/** The desire from the team_state row that GET /api/team-state returns (`state`). */
export function readDesired(state: unknown): DesiredSettings {
  const row = isPlainObject(state) ? state : {};
  const desired = isPlainObject(row.desired_settings)
    ? row.desired_settings
    : {};
  return {
    workingHours:
      "working_hours" in desired
        ? readWorkingHours(desired.working_hours)
        : undefined,
    roleModels: readRoleModels(desired.role_models),
    desiredAt: stamp(row.desired_settings_at),
    appliedAt: stamp(row.settings_applied_at),
  };
}

/** Whether the latest desire is applied: the box writes a stamp at least as new as the desire's. */
export function settingsStatus(
  desiredAt: string | null,
  appliedAt: string | null,
): SettingsStatus {
  if (desiredAt === null) return "none";
  if (appliedAt === null) return "pending";
  return Date.parse(appliedAt) >= Date.parse(desiredAt) ? "applied" : "pending";
}

const sameEntry = (a: RoleModel | undefined, b: RoleModel | undefined) =>
  (a?.model ?? null) === (b?.model ?? null) &&
  (a?.effort ?? null) === (b?.effort ?? null);

/**
 * The role_models to send. The database keeps only the latest `role_models` the site
 * sent, and the box replaces only the roles it gets: so the site sends again every
 * role it set before (to keep showing it), and the roles changed now. A role put
 * back on the default goes as {} (the box drops it), and only if it changed now:
 * a {} sent every time would wipe a role set later on the desktop.
 */
export function roleModelsToSend(
  saved: RoleModels,
  edited: RoleModels,
): RoleModels {
  const out: RoleModels = {};
  for (const role of SETTINGS_ROLES) {
    const before = saved[role];
    const after = edited[role];
    if (!sameEntry(before, after)) {
      const entry: RoleModel = {};
      if (after?.model) entry.model = after.model;
      if (after?.effort) entry.effort = after.effort;
      out[role] = entry;
    } else if (before && (before.model || before.effort)) {
      out[role] = { ...before };
    }
  }
  return out;
}

/** True when the edited roles differ from the saved ones. */
export function roleModelsChanged(
  saved: RoleModels,
  edited: RoleModels,
): boolean {
  return SETTINGS_ROLES.some((role) => !sameEntry(saved[role], edited[role]));
}

/** The door's answer, as the page needs it. */
export type SaveResult = { ok: true } | { ok: false; code: string };

/** Asks the door. `params` is one key: { working_hours } or { role_models }. */
export async function saveTeamSettings(
  params: { working_hours: WorkingHours | null } | { role_models: RoleModels },
  fetchImpl: typeof fetch = fetch,
): Promise<SaveResult> {
  let res: Response;
  try {
    res = await fetchImpl("/api/team/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ params }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, code: "network" };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok && isPlainObject(body) && body.ok === true) return { ok: true };
  const code =
    isPlainObject(body) && typeof body.error === "string" ? body.error : "";
  return { ok: false, code: code || `http_${res.status}` };
}

/** Reads the desire from the site's own team_state route. null when it cannot be read. */
export async function loadDesired(
  fetchImpl: typeof fetch = fetch,
): Promise<DesiredSettings | null> {
  try {
    const res = await fetchImpl("/api/team-state", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { state?: unknown };
    return readDesired(body?.state ?? null);
  } catch {
    return null;
  }
}

/** The refusal codes the page explains in words; any other is the generic sentence. */
export const KNOWN_REFUSALS = [
  "reauth_required",
  "unauthenticated",
  "rate_limited",
  "invalid_params",
  "network",
] as const;
export type KnownRefusal = (typeof KNOWN_REFUSALS)[number];

export function refusalKey(code: string): KnownRefusal | "generic" {
  return (KNOWN_REFUSALS as readonly string[]).includes(code)
    ? (code as KnownRefusal)
    : "generic";
}
