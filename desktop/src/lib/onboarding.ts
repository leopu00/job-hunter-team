import type { SupabaseClient, User } from "@supabase/supabase-js";

export type WorkMode = "remote" | "hybrid" | "onsite" | "flexible";

export interface OnboardingProfileDraft {
  fullName: string;
  targetRole: string;
  location: string;
  experienceYears: number;
  skills: string[];
  languages: string[];
  workMode: WorkMode;
  notes: string;
}

export interface OnboardingAccount { displayName: string | null }

export type ExecutionHost =
  | { kind: "local" }
  | { kind: "vps"; address: string; user: string; port: number; keyPath: string };

export type SubscriptionProvider = "claude" | "codex" | "kimi";

export interface OnboardingSubmission {
  profile: OnboardingProfileDraft;
  host: ExecutionHost;
  provider: SubscriptionProvider;
}

export type CollectionStage = "profile" | "host" | "provider";
export type OperationalStage = "runtime" | "provider-login" | "team-start" | "assistant";
export type OnboardingRuntimeStage = CollectionStage | OperationalStage;

export type OnboardingRuntimeState =
  | { status: "collecting"; stage: CollectionStage }
  | { status: "working"; stage: OperationalStage; message: string }
  | { status: "action-required"; stage: "provider-login" | "assistant"; message: string }
  | { status: "failed"; stage: OnboardingRuntimeStage; message: string }
  | { status: "ready" };

/** Facts independently re-read from the selected runtime host. */
export interface OnboardingRuntimeSnapshot {
  runtimeInstalled: boolean;
  containerRunning: boolean;
  providerConfigured: boolean;
  providerAuthenticated: boolean;
  assistantRunning: boolean;
  captainRunning: boolean;
  profileReady: boolean;
  assistantWelcomed: boolean;
  directChatReady: boolean;
}

/** UI boundary: no Supabase, IPC, secrets or routing enter the component. */
export interface OnboardingFlowProps {
  account: OnboardingAccount;
  initialDraft?: OnboardingProfileDraft;
  runtime: OnboardingRuntimeState;
  onSubmit: (submission: OnboardingSubmission) => Promise<void>;
  onRuntimeAction: (stage: "provider-login" | "assistant") => Promise<void>;
  onRetry: () => Promise<void>;
}

export type OnboardingGateState =
  | { phase: "loading" }
  | {
      phase: "required";
      account: OnboardingAccount;
      initialDraft?: OnboardingProfileDraft;
      runtime: OnboardingRuntimeState;
    }
  | { phase: "ready" }
  | { phase: "error"; message: string };

export interface OnboardingMarkerStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type OnboardingMilestones = {
  vps_setup_completed_at?: string | null;
  profile_configured_at?: string | null;
  first_team_run_at?: string | null;
};

type ProfileRow = {
  user_id?: string | null;
  name?: string | null;
  email?: string | null;
  target_role?: string | null;
  location?: string | null;
  experience_years?: number | null;
  seniority_target?: string | null;
  skills?: unknown;
  languages?: unknown;
  location_preferences?: unknown;
  positioning?: unknown;
};

const MARKER_PREFIX = "jht.desktop.onboarding.";
const MARKER_VALUE = "subscription-v1";
const WORK_MODES = new Set<WorkMode>(["remote", "hybrid", "onsite", "flexible"]);
const STATE_ERROR = "Non riesco a verificare la configurazione dell’account. Riprova.";

function markerKey(userId: string): string { return `${MARKER_PREFIX}${userId}`; }
function clean(value: string): string { return value.trim().replace(/\s+/g, " "); }
function unique(values: string[]): string[] { return [...new Set(values.map(clean).filter(Boolean))]; }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>) : {};
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") return item;
      const row = record(item);
      const language = row.language ?? row.lingua;
      return typeof language === "string" ? language : "";
    }).map(clean).filter(Boolean);
  }
  return Object.values(record(value))
    .flatMap((item) => Array.isArray(item) ? item : [])
    .filter((item): item is string => typeof item === "string")
    .map(clean).filter(Boolean);
}

function profileSkills(row: ProfileRow): string[] { return stringList(row.skills); }
function profileLanguages(row: ProfileRow): string[] { return stringList(row.languages); }
function profileSeniority(row: ProfileRow): string | null {
  if (typeof row.seniority_target === "string" && clean(row.seniority_target)) {
    return clean(row.seniority_target);
  }
  const value = record(row.positioning).seniority_target;
  return typeof value === "string" && clean(value) ? clean(value) : null;
}
function profileWorkMode(row: ProfileRow): WorkMode {
  const first = Array.isArray(row.location_preferences) ? record(row.location_preferences[0]).type : undefined;
  const nested = record(record(row.positioning).preferences).work_mode;
  const value = typeof first === "string" ? first : nested;
  return typeof value === "string" && WORK_MODES.has(value as WorkMode)
    ? value as WorkMode : "flexible";
}
function profileNotes(row: ProfileRow): string {
  const value = record(row.positioning).free_notes;
  return typeof value === "string" ? value : "";
}

export function isOnboardingProfileReady(row: ProfileRow | null): boolean {
  return Boolean(row && clean(row.name ?? "") && clean(row.email ?? "") &&
    clean(row.target_role ?? "") && clean(row.location ?? "") &&
    Number.isInteger(row.experience_years) && (row.experience_years ?? -1) >= 0 &&
    profileSeniority(row) && profileSkills(row).length >= 2 && profileLanguages(row).length >= 1);
}

function draftFromRow(row: ProfileRow | null): OnboardingProfileDraft | undefined {
  if (!row) return undefined;
  return {
    fullName: row.name ?? "", targetRole: row.target_role ?? "", location: row.location ?? "",
    experienceYears: Number.isInteger(row.experience_years) ? row.experience_years ?? 0 : 0,
    skills: profileSkills(row), languages: profileLanguages(row),
    workMode: profileWorkMode(row), notes: profileNotes(row),
  };
}

function displayName(user: User): string | null {
  const metadata = record(user.user_metadata);
  for (const value of [metadata.full_name, metadata.name]) {
    if (typeof value === "string" && clean(value)) return clean(value);
  }
  return null;
}

function markerPresent(store: OnboardingMarkerStore, userId: string): boolean {
  try { return store.getItem(markerKey(userId)) === MARKER_VALUE; } catch { return false; }
}

export async function loadOnboardingGate(
  client: SupabaseClient, user: User, store: OnboardingMarkerStore = localStorage,
): Promise<OnboardingGateState> {
  if (markerPresent(store, user.id)) return { phase: "ready" };
  const [milestonesResult, profileResult] = await Promise.all([
    client.from("user_onboarding_state")
      .select("vps_setup_completed_at, profile_configured_at, first_team_run_at")
      .eq("user_id", user.id).maybeSingle(),
    client.from("candidate_profiles")
      .select("user_id,name,email,target_role,location,experience_years,seniority_target,skills,languages,location_preferences,positioning")
      .eq("user_id", user.id).maybeSingle(),
  ]);
  if (milestonesResult.error || profileResult.error) return { phase: "error", message: STATE_ERROR };
  const milestones = milestonesResult.data as OnboardingMilestones | null;
  const profile = profileResult.data as ProfileRow | null;
  const profileReady = isOnboardingProfileReady(profile);
  if (profileReady && milestones?.first_team_run_at) return { phase: "ready" };
  return {
    phase: "required", account: { displayName: displayName(user) },
    initialDraft: draftFromRow(profile),
    runtime: { status: "collecting", stage: profileReady ? "host" : "profile" },
  };
}

export type OnboardingSaveErrorCode = "invalid-profile" | "profile-write-failed" |
  "profile-verify-failed" | "runtime-not-ready" | "marker-failed";
export class OnboardingSaveError extends Error {
  constructor(readonly code: OnboardingSaveErrorCode) { super(code); this.name = "OnboardingSaveError"; }
}

function seniorityFor(years: number): string {
  if (years < 2) return "entry"; if (years < 5) return "mid";
  if (years < 10) return "senior"; return "lead";
}
function normalizeDraft(draft: OnboardingProfileDraft): OnboardingProfileDraft {
  return { ...draft, fullName: clean(draft.fullName), targetRole: clean(draft.targetRole),
    location: clean(draft.location), skills: unique(draft.skills), languages: unique(draft.languages),
    notes: draft.notes.trim() };
}
function validDraft(draft: OnboardingProfileDraft, email: string): boolean {
  return Boolean(draft.fullName && draft.targetRole && draft.location &&
    Number.isInteger(draft.experienceYears) && draft.experienceYears >= 0 && draft.experienceYears <= 80 &&
    draft.skills.length >= 2 && draft.languages.length >= 1 &&
    WORK_MODES.has(draft.workMode) && clean(email));
}
function verifiedDraft(row: ProfileRow | null, draft: OnboardingProfileDraft, user: User): boolean {
  return Boolean(row?.user_id === user.id && isOnboardingProfileReady(row) &&
    clean(row.name ?? "") === draft.fullName && clean(row.email ?? "") === clean(user.email ?? "") &&
    clean(row.target_role ?? "") === draft.targetRole && clean(row.location ?? "") === draft.location &&
    row.experience_years === draft.experienceYears &&
    draft.skills.every((skill) => profileSkills(row).includes(skill)) &&
    draft.languages.every((language) => profileLanguages(row).includes(language)) &&
    profileWorkMode(row) === draft.workMode);
}

export async function saveOnboardingProfile(
  client: SupabaseClient, user: User, input: OnboardingProfileDraft,
): Promise<OnboardingProfileDraft> {
  const draft = normalizeDraft(input);
  const email = user.email ?? "";
  if (!validDraft(draft, email)) throw new OnboardingSaveError("invalid-profile");
  const seniority = seniorityFor(draft.experienceYears);
  const payload = {
    user_id: user.id, name: draft.fullName, email: clean(email), location: draft.location,
    target_role: draft.targetRole, experience_years: draft.experienceYears,
    seniority_target: seniority, skills: { primary: draft.skills },
    languages: draft.languages.map((language) => ({ language, level: "not_specified" })),
    job_titles: [draft.targetRole], location_preferences: [{ type: draft.workMode }],
    positioning: { seniority_target: seniority, preferences: { work_mode: draft.workMode },
      ...(draft.notes ? { free_notes: draft.notes } : {}) },
  };
  const written = await client.from("candidate_profiles").upsert(payload, { onConflict: "user_id" });
  if (written.error) throw new OnboardingSaveError("profile-write-failed");
  const reread = await client.from("candidate_profiles")
    .select("user_id,name,email,target_role,location,experience_years,seniority_target,skills,languages,location_preferences,positioning")
    .eq("user_id", user.id).maybeSingle();
  const row = reread.data as ProfileRow | null;
  if (reread.error || !verifiedDraft(row, draft, user)) throw new OnboardingSaveError("profile-verify-failed");
  return draft;
}

export function isOnboardingRuntimeReady(snapshot: OnboardingRuntimeSnapshot): boolean {
  return Boolean(snapshot.runtimeInstalled && snapshot.containerRunning &&
    snapshot.providerConfigured && snapshot.providerAuthenticated &&
    snapshot.assistantRunning && snapshot.captainRunning &&
    snapshot.profileReady && snapshot.assistantWelcomed && snapshot.directChatReady);
}

export function runtimeStateFromSnapshot(snapshot: OnboardingRuntimeSnapshot): OnboardingRuntimeState {
  if (isOnboardingRuntimeReady(snapshot)) return { status: "ready" };
  if (!snapshot.runtimeInstalled || !snapshot.containerRunning || !snapshot.providerConfigured) {
    return { status: "failed", stage: "runtime", message: "Il runtime non ha completato la preparazione." };
  }
  if (!snapshot.providerAuthenticated) {
    return { status: "action-required", stage: "provider-login", message: "Accedi con l’abbonamento scelto." };
  }
  if (!snapshot.assistantRunning || !snapshot.captainRunning) {
    return { status: "failed", stage: "team-start", message: "Il team non è ancora operativo." };
  }
  if (snapshot.profileReady && snapshot.assistantWelcomed && !snapshot.directChatReady) {
    return { status: "failed", stage: "assistant", message: "La chat diretta non è ancora raggiungibile." };
  }
  return { status: "action-required", stage: "assistant",
    message: snapshot.profileReady ? "Completa la presentazione con l’Assistente." : "Completa il profilo con l’Assistente." };
}

export function markOnboardingReady(
  userId: string, snapshot: OnboardingRuntimeSnapshot, store: OnboardingMarkerStore = localStorage,
): void {
  if (!isOnboardingRuntimeReady(snapshot)) throw new OnboardingSaveError("runtime-not-ready");
  try {
    store.setItem(markerKey(userId), MARKER_VALUE);
    if (!markerPresent(store, userId)) throw new Error("marker was not persisted");
  } catch { throw new OnboardingSaveError("marker-failed"); }
}
