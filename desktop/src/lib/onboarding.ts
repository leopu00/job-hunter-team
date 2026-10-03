import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { DesktopPlatform } from "./desktop-platform";

export interface OnboardingAccount {
  displayName: string | null;
  identity?: "google" | "local";
}
export interface ExistingTeamHint { teamId: string; status: "available" }

export type ExecutionHost =
  | { kind: "local" }
  | { kind: "vps"; address: string; user: string; port: number; keyPath: string };

export type SubscriptionProvider = "claude" | "codex" | "kimi";

export interface OnboardingSubmission {
  host: ExecutionHost;
  provider: SubscriptionProvider;
}

export type CollectionStage = "host" | "provider";
export type OperationalStage = "ssh-host-key" | "runtime" | "container" | "provider" | "provider-login" | "team-start" | "assistant";
export type OnboardingRuntimeStage = CollectionStage | OperationalStage;

export type OnboardingRuntimeState =
  | { status: "collecting"; stage: CollectionStage }
  | { status: "working"; stage: OperationalStage; message: string }
  | { status: "action-required"; stage: "ssh-host-key" | "provider-login" | "team-start" | "assistant"; message: string }
  | {
      status: "failed";
      stage: OnboardingRuntimeStage;
      title?: string;
      message: string;
      code?: string;
      retryable?: boolean;
    }
  | { status: "ready" };

export interface OnboardingProviderLoginInputRequest {
  id: string;
  label: string;
  description?: string;
  submitLabel?: string;
  secret?: boolean;
  inputMode?: "text" | "numeric";
}

export type OnboardingProviderLoginAction =
  | { kind: "url"; instruction: string; safeUrl: string }
  | { kind: "code"; instruction: string; userCode: string }
  | { kind: "input"; instruction: string; inputRequest: OnboardingProviderLoginInputRequest };

export interface OnboardingProviderLoginState {
  provider: SubscriptionProvider;
  status: "connecting" | "needs_user_action" | "verifying" | "error";
  actions: OnboardingProviderLoginAction[];
  connectionState: "connecting" | "connected" | "disconnected";
  startedAt: number;
  safeErrorMessage?: string;
  exitCode?: number | null;
}

export interface OnboardingSshHostKeyConfirmation {
  algorithm: "ssh-ed25519";
  fingerprint: `SHA256:${string}`;
}

export interface OnboardingActivityEntry {
  id: string;
  invocation: number;
  nativeStage: "engine" | "runtime" | "container" | "provider" | "login" | "team" | "assistant";
  sequence: number;
  stage: OperationalStage;
  name: string;
  description: string;
  elapsedMs: number;
  stageElapsedMs: number;
  updatedAt: number;
  status: "active" | "completed" | "failed";
}

export interface OnboardingActivityState {
  startedAt: number;
  invocation: number;
  lastSequence: number;
  current: OnboardingActivityEntry | null;
  events: OnboardingActivityEntry[];
}

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
  platform: DesktopPlatform;
  runtime: OnboardingRuntimeState;
  activity?: OnboardingActivityState | null;
  onSubmit: (submission: OnboardingSubmission) => Promise<void>;
  onRuntimeAction: (stage: "provider-login" | "team-start" | "assistant") => Promise<void>;
  providerLogin: OnboardingProviderLoginState | null;
  sshHostKey: OnboardingSshHostKeyConfirmation | null;
  onConfirmHostKey: () => Promise<void>;
  onCancelHostKey: () => void;
  onProviderInput: (input: string) => Promise<void>;
  onProviderClose: () => Promise<void>;
  onProviderRestart: () => Promise<void>;
  onRetry: () => Promise<void>;
  onRestart: () => Promise<void>;
  onExitFailure: () => void;
}

export type OnboardingGateState =
  | { phase: "loading" }
  | {
      phase: "required";
      account: OnboardingAccount;
      resumeAvailable: boolean;
      existingTeam?: ExistingTeamHint;
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

type ExistingTeamRow = { id?: string | null };

const MARKER_PREFIX = "jht.desktop.onboarding.";
const MARKER_VALUE = "subscription-v1";
const MARKER_STARTED = "subscription-v1-started";
const MARKER_RESTARTED = "subscription-v1-restarted";
const STATE_ERROR = "Non riesco a verificare la configurazione dell’account. Riprova.";

function markerKey(userId: string): string { return `${MARKER_PREFIX}${userId}`; }
function clean(value: string): string { return value.trim().replace(/\s+/g, " "); }
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
export function isOnboardingProfileReady(row: ProfileRow | null): boolean {
  return Boolean(row && clean(row.name ?? "") && clean(row.email ?? "") &&
    clean(row.target_role ?? "") && clean(row.location ?? "") &&
    Number.isInteger(row.experience_years) && (row.experience_years ?? -1) >= 0 &&
    profileSeniority(row) && profileSkills(row).length >= 2 && profileLanguages(row).length >= 1);
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
function markerStarted(store: OnboardingMarkerStore, userId: string): boolean {
  try { return store.getItem(markerKey(userId)) === MARKER_STARTED; } catch { return false; }
}
function markerRestarted(store: OnboardingMarkerStore, userId: string): boolean {
  try { return store.getItem(markerKey(userId)) === MARKER_RESTARTED; } catch { return false; }
}

export async function loadOnboardingGate(
  client: SupabaseClient, user: User, store: OnboardingMarkerStore = localStorage,
): Promise<OnboardingGateState> {
  if (markerPresent(store, user.id)) return { phase: "ready" };
  const started = markerStarted(store, user.id);
  const restarted = markerRestarted(store, user.id);
  const [milestonesResult, profileResult, teamResult] = await Promise.all([
    client.from("user_onboarding_state")
      .select("vps_setup_completed_at, profile_configured_at, first_team_run_at")
      .eq("user_id", user.id).maybeSingle(),
    client.from("candidate_profiles")
      .select("user_id,name,email,target_role,location,experience_years,seniority_target,skills,languages,location_preferences,positioning")
      .eq("user_id", user.id).maybeSingle(),
    client.from("cloud_sync_tokens")
      .select("id")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (milestonesResult.error || profileResult.error || teamResult.error) return { phase: "error", message: STATE_ERROR };
  const milestones = milestonesResult.data as OnboardingMilestones | null;
  const profile = profileResult.data as ProfileRow | null;
  const team = teamResult.data as ExistingTeamRow | null;
  const profileReady = isOnboardingProfileReady(profile);
  if (!started && !restarted && profileReady && milestones?.first_team_run_at) return { phase: "ready" };
  return {
    phase: "required", account: { displayName: displayName(user), identity: "google" },
    resumeAvailable: started,
    ...(milestones?.vps_setup_completed_at && typeof team?.id === "string" && clean(team.id)
      ? { existingTeam: { teamId: clean(team.id), status: "available" as const } }
      : {}),
    runtime: { status: "collecting", stage: "host" },
  };
}

/** Local profiles have no cloud milestones: only their device-local marker can admit Shell. */
export function loadLocalOnboardingGate(
  profileId: string,
  localDisplayName: string,
  store: OnboardingMarkerStore = localStorage,
): OnboardingGateState {
  const markerId = `local:${profileId}`;
  if (markerPresent(store, markerId)) return { phase: "ready" };
  return {
    phase: "required",
    account: { displayName: clean(localDisplayName), identity: "local" },
    resumeAvailable: markerStarted(store, markerId),
    runtime: { status: "collecting", stage: "host" },
  };
}

export type OnboardingSaveErrorCode = "runtime-not-ready" | "marker-failed";
export class OnboardingSaveError extends Error {
  constructor(readonly code: OnboardingSaveErrorCode) { super(code); this.name = "OnboardingSaveError"; }
}

/** Technical facts needed to expose the real Assistant chat without claiming profile completion. */
export function isOnboardingAssistantReachable(snapshot: OnboardingRuntimeSnapshot): boolean {
  return Boolean(snapshot.runtimeInstalled && snapshot.containerRunning &&
    snapshot.providerConfigured && snapshot.providerAuthenticated &&
    snapshot.assistantRunning && snapshot.captainRunning && snapshot.directChatReady);
}

export function isOnboardingRuntimeReady(snapshot: OnboardingRuntimeSnapshot): boolean {
  return isOnboardingAssistantReachable(snapshot) && snapshot.profileReady;
}

export function runtimeStateFromSnapshot(snapshot: OnboardingRuntimeSnapshot): OnboardingRuntimeState {
  if (isOnboardingRuntimeReady(snapshot)) return { status: "ready" };
  if (!snapshot.runtimeInstalled) {
    return { status: "failed", stage: "runtime", message: "Il runtime non ha completato la preparazione." };
  }
  if (!snapshot.containerRunning) {
    return { status: "failed", stage: "container", message: "Il container non risulta attivo." };
  }
  if (!snapshot.providerConfigured) {
    return { status: "failed", stage: "provider", message: "Il provider non ha completato la preparazione." };
  }
  if (!snapshot.providerAuthenticated) {
    return { status: "action-required", stage: "provider-login", message: "Accedi con l’abbonamento scelto." };
  }
  if (!snapshot.assistantRunning || !snapshot.captainRunning) {
    return { status: "failed", stage: "team-start", message: "Il team non è ancora operativo." };
  }
  if (snapshot.profileReady && !snapshot.directChatReady) {
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

/** Prevents an interrupted new 0.4 flow from being mistaken for a legacy completed account. */
export function markOnboardingStarted(
  userId: string, store: OnboardingMarkerStore = localStorage,
): void {
  try {
    if (markerPresent(store, userId)) return;
    store.setItem(markerKey(userId), MARKER_STARTED);
    if (!markerStarted(store, userId)) throw new Error("marker was not persisted");
  } catch { throw new OnboardingSaveError("marker-failed"); }
}

/** Clears only the renderer's onboarding checkpoint; native runtime and credentials are untouched. */
export function resetOnboardingMarker(
  userId: string,
  store: OnboardingMarkerStore = localStorage,
): void {
  try {
    store.setItem(markerKey(userId), MARKER_RESTARTED);
    if (!markerRestarted(store, userId)) throw new Error("marker was not reset");
  } catch {
    throw new OnboardingSaveError("marker-failed");
  }
}
