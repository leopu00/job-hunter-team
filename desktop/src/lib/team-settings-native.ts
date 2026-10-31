import { invoke } from "@tauri-apps/api/core";

/**
 * The team's working hours and the model and effort of each role, read and written through the
 * native `team_settings` command (src-tauri/src/team_settings.rs), on this computer's team and on a
 * team on a VPS alike. The page never names a host or a path.
 *
 * The model is a CLASS, never a model's name: `sol` the most capable, `terra` in between, `luna` the
 * cheapest. The page shows its own labels and sends the class; which model a class means is the
 * team's provider's business.
 *
 * `read` always works and gives the key a write must carry (`connectionKey`); a write on a VPS needs
 * the team connected in full and that key. The answer to a write is what the box holds after it,
 * read again: show that, not what was sent. A reply that is not in the closed shape is an error, never
 * a default made up.
 *
 * «Work flat out until HH:MM» (`startBurst`, `stopBurst`) is a write like the others: the full link and
 * the key. The app sends only the time; the team widens its hours, grants the burn and, when the time is
 * up, puts the usual hours back by itself, app closed or not. A read carries the burst when the box
 * sends it (`burst`); a box that does not is read as «not known», never as «none».
 */

const COMMAND = "team_settings";

export const ROLES = ["capitano", "scout", "analista", "scorer", "scrittore", "critico", "sentinella", "assistente", "mentor", "closer"] as const;
export const MODEL_CLASSES = ["sol", "terra", "luna"] as const;
export const EFFORTS = ["low", "medium", "high"] as const;
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const MIN_WINDOW_HOURS = 4;

export type Role = (typeof ROLES)[number];
export type ModelClass = (typeof MODEL_CLASSES)[number];
export type Effort = (typeof EFFORTS)[number];
export type Weekday = (typeof WEEKDAYS)[number];

export interface WorkWindow { days: Weekday[]; start: string; end: string }
/** `null` is a team that works 24/7. */
export interface WorkingHours { timezone: string; windows: WorkWindow[] }
export interface RoleModel { model?: ModelClass; effort?: Effort }
export type RoleModels = Partial<Record<Role, RoleModel>>;

/** What the launcher would use for a role: the class and the provider's model name, the effort, and whether it comes from the team's config or from its default. */
export interface EffectiveRole { model: ModelClass; modelName: string; effort: Effort; from: "config" | "default" }
export type EffectiveModels = Record<Role, EffectiveRole>;

/** A burst that is running (`until` is a UTC timestamp, `untilLocal` the team's wall clock HH:MM), or none. */
export type Burst = { active: false } | { active: true; until: string; untilLocal: string };

/**
 * What the box says to explain a silence of the team, every fact optional and on its own: the provider's work window (how much of it is
 * used, and when it reopens as a Unix time, or null), whether an agent is held by a safety containment, whether the provider has a login.
 */
export interface QuietReading {
  budget?: { usagePct: number; resetAtUnix: number | null };
  containment?: boolean;
  providerReady?: boolean;
}

export interface TeamSettings {
  /** Where the team is: this computer, or a VPS. */
  target: "local" | "vps";
  /** The key a write must carry. */
  connectionKey: string;
  workingHours: WorkingHours | null;
  roleModels: RoleModels;
  /** Per role, what the launcher would use now; absent on a team whose image does not say (never a default made up here). */
  effective?: EffectiveModels | null;
  /** The team's provider; the class is applied only with Codex (`classApplies`). */
  provider?: "codex" | "claude" | "kimi" | null;
  classApplies?: boolean | null;
  /** The «work flat out» burst; absent when the box does not say (do not read that as «none»). */
  burst?: Burst;
  /** The facts that explain a silence; absent when the box does not say (an older one): never read as «nothing to explain». */
  quiet?: QuietReading;
}

/** What a write changes: a role is changed by sending its entry, and `{}` puts it back on the default. */
export interface TeamSettingsPatch { workingHours?: WorkingHours | null; roleModels?: RoleModels }

export type TeamSettingsError =
  | "team_settings_request_invalid"
  | "team_settings_value_invalid"
  | "team_settings_read_only"
  | "team_settings_unavailable"
  | "team_settings_burst_too_soon"
  | "team_settings_burst_too_far"
  | "existing_team_runtime_outdated"
  | "existing_team_runtime_target_changed"
  | "own_vps_claim_required"
  | "own_vps_key_changed"
  | "own_vps_claim_refused"
  | "ssh_unavailable"
  | "ssh_auth_failed"
  | "ssh_connection_refused"
  | "ssh_host_unreachable"
  | "ssh_rate_limited"
  | "host_key_changed"
  | "agent_control_window"
  | "other";
export type TeamSettingsResult = { ok: true; settings: TeamSettings } | { ok: false; error: TeamSettingsError };

const KNOWN_ERRORS: ReadonlySet<string> = new Set<TeamSettingsError>([
  "team_settings_request_invalid", "team_settings_value_invalid", "team_settings_read_only", "team_settings_unavailable",
  "team_settings_burst_too_soon", "team_settings_burst_too_far",
  "existing_team_runtime_outdated", "existing_team_runtime_target_changed", "own_vps_claim_required", "own_vps_key_changed",
  "own_vps_claim_refused", "ssh_unavailable", "ssh_auth_failed", "ssh_connection_refused", "ssh_host_unreachable",
  "ssh_rate_limited", "host_key_changed", "agent_control_window",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const within = <T extends string>(list: readonly T[], value: unknown): value is T => list.includes(value as T);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function pickWindow(value: unknown): WorkWindow | null {
  if (!isRecord(value) || Object.keys(value).length !== 3 || !Array.isArray(value.days) || value.days.length === 0) return null;
  const { days, start, end } = value;
  if (!days.every((day) => within(WEEKDAYS, day)) || typeof start !== "string" || typeof end !== "string") return null;
  return TIME.test(start) && TIME.test(end) ? { days: days as Weekday[], start, end } : null;
}

function pickHours(value: unknown): WorkingHours | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || Object.keys(value).length !== 2 || typeof value.timezone !== "string" || !Array.isArray(value.windows)) return undefined;
  const windows = value.windows.map(pickWindow);
  return windows.every((window) => window !== null) ? { timezone: value.timezone, windows: windows as WorkWindow[] } : undefined;
}

/**
 * Whether these hours are ones the native command accepts (team_settings.rs `valid_working_hours`), so
 * the page can refuse a bad save itself and say why. A team whose hours file is malformed works 24/7
 * (shared/skills/working_hours.py), so a value that is off the shape must never be sent. `null` is 24/7.
 */
export function workingHoursAreValid(hours: WorkingHours | null): boolean {
  if (hours === null) return true;
  if (!isRecord(hours) || typeof hours.timezone !== "string" || !Array.isArray(hours.windows)) return false;
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(hours.timezone) || hours.windows.length > WEEKDAYS.length) return false;
  const seen = new Set<string>();
  return hours.windows.every((window) => {
    if (!isRecord(window) || !Array.isArray(window.days) || window.days.length === 0) return false;
    for (const day of window.days) {
      if (!within(WEEKDAYS, day) || seen.has(day)) return false;
      seen.add(day);
    }
    return typeof window.start === "string" && typeof window.end === "string" && TIME.test(window.start) && TIME.test(window.end) && window.start !== window.end;
  });
}

function pickRoles(value: unknown): RoleModels | null {
  if (!isRecord(value)) return null;
  const roles: RoleModels = {};
  for (const [role, entry] of Object.entries(value)) {
    if (!within(ROLES, role) || !isRecord(entry) || !Object.keys(entry).every((key) => key === "model" || key === "effort")) return null;
    if (entry.model !== undefined && !within(MODEL_CLASSES, entry.model)) return null;
    if (entry.effort !== undefined && !within(EFFORTS, entry.effort)) return null;
    roles[role] = { ...(entry.model !== undefined ? { model: entry.model } : {}), ...(entry.effort !== undefined ? { effort: entry.effort } : {}) };
  }
  return roles;
}

function sameList(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

const MODEL_NAME = /^[A-Za-z0-9._-]{1,40}$/;

/** The `effective` block of a read: all ten roles in the closed shape, or null («not available»). */
function pickEffective(value: unknown): EffectiveModels | null {
  if (!isRecord(value)) return null;
  const out: Partial<EffectiveModels> = {};
  for (const role of ROLES) {
    const entry = value[role];
    if (!isRecord(entry) || !within(MODEL_CLASSES, entry.model) || !within(EFFORTS, entry.effort) ||
        typeof entry.modelName !== "string" || !MODEL_NAME.test(entry.modelName) || (entry.from !== "config" && entry.from !== "default")) {
      return null;
    }
    out[role] = { model: entry.model, modelName: entry.modelName, effort: entry.effort, from: entry.from };
  }
  return out as EffectiveModels;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const USAGE_MAX = 1000;
const RESET_MAX = 4_102_444_800;

/** The `quiet` block of a read: each fact kept only if whole, none required; null when none is left. */
function pickQuiet(value: unknown): QuietReading | null {
  if (!isRecord(value)) return null;
  const quiet: QuietReading = {};
  const budget = value.budget;
  if (isRecord(budget) && Object.keys(budget).length === 2) {
    const { usagePct, resetAtUnix } = budget;
    if (typeof usagePct === "number" && Number.isFinite(usagePct) && usagePct >= 0 && usagePct <= USAGE_MAX &&
        (resetAtUnix === null || (typeof resetAtUnix === "number" && Number.isInteger(resetAtUnix) && resetAtUnix >= 1 && resetAtUnix <= RESET_MAX))) {
      quiet.budget = { usagePct, resetAtUnix };
    }
  }
  if (typeof value.containment === "boolean") quiet.containment = value.containment;
  if (typeof value.providerReady === "boolean") quiet.providerReady = value.providerReady;
  return Object.keys(quiet).length > 0 ? quiet : null;
}

/** The `burst` block of a read in its closed shape, or null («not known»). */
function pickBurst(value: unknown): Burst | null {
  if (!isRecord(value)) return null;
  if (value.active === false) return Object.keys(value).length === 1 ? { active: false } : null;
  if (value.active === true && Object.keys(value).length === 3 && typeof value.until === "string" && TIMESTAMP.test(value.until) &&
      typeof value.untilLocal === "string" && TIME.test(value.untilLocal)) {
    return { active: true, until: value.until, untilLocal: value.untilLocal };
  }
  return null;
}

/** Whether this is a time of day the native command accepts for a burst («03:00»; not «3:00», not «24:00»). */
export function burstTimeIsValid(until: string): boolean {
  return TIME.test(until);
}

/** The reply of the native command as the page uses it; anything off the closed shape is `team_settings_unavailable`. */
export function pickTeamSettings(reply: unknown): TeamSettingsResult {
  const unavailable: TeamSettingsResult = { ok: false, error: "team_settings_unavailable" };
  if (!isRecord(reply)) return unavailable;
  if (reply.ok === false) {
    return { ok: false, error: typeof reply.error === "string" && KNOWN_ERRORS.has(reply.error) ? (reply.error as TeamSettingsError) : "other" };
  }
  const hours = pickHours(reply.working_hours);
  const roles = pickRoles(reply.role_models);
  const lists = reply.lists;
  if (reply.ok !== true || (reply.target !== "local" && reply.target !== "vps") || typeof reply.connectionKey !== "string" || !reply.connectionKey ||
      hours === undefined || roles === null || !isRecord(lists) ||
      !sameList(lists.roles, ROLES) || !sameList(lists.models, MODEL_CLASSES) || !sameList(lists.efforts, EFFORTS) ||
      !sameList(lists.weekdays, WEEKDAYS) || lists.min_window_hours !== MIN_WINDOW_HOURS) {
    return unavailable;
  }
  const burst = pickBurst(reply.burst);
  const quiet = pickQuiet(reply.quiet);
  const provider = reply.provider === "codex" || reply.provider === "claude" || reply.provider === "kimi" ? reply.provider : null;
  return {
    ok: true,
    settings: {
      target: reply.target,
      connectionKey: reply.connectionKey,
      workingHours: hours,
      roleModels: roles,
      effective: pickEffective(reply.effective),
      provider,
      classApplies: typeof reply.classApplies === "boolean" ? reply.classApplies : null,
      ...(burst ? { burst } : {}),
      ...(quiet ? { quiet } : {}),
    },
  };
}

type Call = (request: Record<string, unknown>) => Promise<unknown>;
const nativeCall: Call = (request) => invoke<unknown>(COMMAND, { request });

export async function readTeamSettings(call: Call = nativeCall): Promise<TeamSettingsResult> {
  try {
    return pickTeamSettings(await call({ op: "read" }));
  } catch {
    return { ok: false, error: "team_settings_unavailable" };
  }
}

/** One write, whole or not at all; the result is what the box holds afterwards. */
export async function writeTeamSettings(patch: TeamSettingsPatch, connectionKey: string, call: Call = nativeCall): Promise<TeamSettingsResult> {
  const settings: Record<string, unknown> = {};
  if (patch.workingHours !== undefined) settings.working_hours = patch.workingHours;
  if (patch.roleModels !== undefined) settings.role_models = patch.roleModels;
  try {
    return pickTeamSettings(await call({ op: "write", settings, connectionKey }));
  } catch {
    return { ok: false, error: "team_settings_unavailable" };
  }
}

/** Work flat out until HH:MM (the next time the team's clock reads it, 15 minutes to 12 hours from now); the result is what the box holds afterwards. */
export async function startBurst(until: string, connectionKey: string, call: Call = nativeCall): Promise<TeamSettingsResult> {
  try {
    return pickTeamSettings(await call({ op: "burst_start", until, connectionKey }));
  } catch {
    return { ok: false, error: "team_settings_unavailable" };
  }
}

/** End the burst now: the usual hours back and the burn revoked. */
export async function stopBurst(connectionKey: string, call: Call = nativeCall): Promise<TeamSettingsResult> {
  try {
    return pickTeamSettings(await call({ op: "burst_stop", connectionKey }));
  } catch {
    return { ok: false, error: "team_settings_unavailable" };
  }
}
