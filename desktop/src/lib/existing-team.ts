import { Channel, invoke } from "@tauri-apps/api/core";
import type { ExecutionHost, OnboardingRuntimeSnapshot } from "./onboarding";
import {
  confirmOnboardingSshHostKey,
  probeOnboardingSshHostKey,
  type SshHostKeyProbe,
} from "./onboarding-runtime";

export type ExistingTeamVpsHost = Extract<ExecutionHost, { kind: "vps" }>;

export interface ExistingTeamRequest {
  teamId: string;
  host: ExistingTeamVpsHost;
  /**
   * The chat's «Collega il team»: the same full connection, which the native side allows only for
   * the host and team this profile saved (`existing_team_reconfirm_setup` otherwise).
   */
  reconfirm?: boolean;
  /**
   * Only for `discover`, after an `existing_team_ambiguous` that listed the team's containers: the
   * one the person picked. The native side accepts it only if it still answers as the team.
   */
  containerId?: string;
}

/** One running container that answers as the team, when more than one does. */
export interface ExistingTeamContainerChoice {
  containerId: string;
  name: string | null;
  /** RFC 3339, as the VPS reported it. */
  startedAt: string | null;
  ociRevision: string;
  digest: string;
  readiness: boolean;
}

/** What the chat's confirmation shows: the saved host and team and the key pinned for that host. */
export interface ExistingTeamReconfirmSummary {
  teamId: string;
  host: ExistingTeamVpsHost;
  fingerprint: string;
}

export type { SshHostKeyProbe };

export type ExistingTeamConnectionResult = OnboardingRuntimeSnapshot;

export interface ExistingTeamReadOnlyConnectionResult {
  snapshot: OnboardingRuntimeSnapshot;
  readiness: boolean;
  /**
   * Which connection this is, for what the view keeps between reads (the shared
   * positions read): one opaque value the native side derives from the account
   * scope and the saved target (host, team and container), for a first opening
   * and for a reopening alike.
   */
  connectionKey?: string | null;
  /**
   * The start-up reopening gave the full connection back: the person confirmed it in an earlier run, the
   * native record is this very connection and recent, and every check of the reopening passed. Only the
   * native side sets it; the view then opens in full and says so in a fixed row.
   */
  fullLink?: boolean;
}

export interface ExistingTeamProgress {
  stage: "preparing" | "runtime" | "container" | "provider" | "team";
  message: string;
}

/**
 * What the VPS declares about the container of the team, shown before anything
 * is saved. Everything here was reported by the server; none of it is verified
 * independently by the app.
 */
export interface ExistingTeamReceipt {
  teamId: string;
  hostAddress: string;
  hostPort: number;
  sshFingerprint: string | null;
  containerId: string;
  imageId: string;
  platformImageId: string;
  ociRevision: string;
  digest: string;
  candidateSha256: string;
  /** Whether the assistant session is up; informative. */
  readiness: boolean;
  /**
   * Present when the team was updated: the runtime of the connection this profile saved, which the
   * confirmation replaces. Same host, same pinned key, same team; only the runtime differs.
   */
  previous?: { imageId: string; ociRevision: string; digest: string };
}

export interface ExistingTeamRegisterResult {
  /** `restored`: a saved selection got back the candidate it was made from. `rebound`: an updated team's saved connection was replaced. */
  outcome: "registered" | "already_registered" | "restored" | "rebound";
}

export interface ExistingTeamBridge {
  probe(host: ExistingTeamVpsHost): Promise<SshHostKeyProbe>;
  confirm(host: ExistingTeamVpsHost, probe: SshHostKeyProbe): Promise<void>;
  connect(request: ExistingTeamRequest, onProgress: (progress: ExistingTeamProgress) => void): Promise<ExistingTeamConnectionResult>;
  connectReadOnly(request: ExistingTeamRequest): Promise<ExistingTeamReadOnlyConnectionResult>;
  /**
   * Reopens the read-only view of the team this profile already saved. The native
   * side takes host and team from the saved target and checks the pin and the
   * team's identity again; it refuses (candidate or selection missing) before
   * any network call. Nothing is started.
   */
  reopen(): Promise<ExistingTeamReadOnlyConnectionResult>;
  /** Reads what the VPS declares about the team's container. Writes nothing. */
  discover(request: ExistingTeamRequest): Promise<ExistingTeamReceipt>;
  /** Saves the target the person was shown. Host and team come from the native receipt. */
  register(candidateSha256: string): Promise<ExistingTeamRegisterResult>;
  /** Reads what the chat's confirmation shows, from what this profile saved. Grants nothing. */
  reconfirmSummary(): Promise<ExistingTeamReconfirmSummary>;
}

export const existingTeamBridge: ExistingTeamBridge = {
  probe(host) {
    return probeOnboardingSshHostKey(host);
  },
  confirm(host, probe) {
    return confirmOnboardingSshHostKey(host, probe);
  },
  connect(request, onProgress) {
    const channel = new Channel<ExistingTeamProgress>();
    channel.onmessage = onProgress;
    return invoke<ExistingTeamConnectionResult>("onboarding_existing_team_connect", {
      request,
      onProgress: channel,
    });
  },
  connectReadOnly(request) {
    return invoke<ExistingTeamReadOnlyConnectionResult>("onboarding_existing_team_readonly_connect", { request });
  },
  reopen() {
    return invoke<ExistingTeamReadOnlyConnectionResult>("onboarding_existing_team_reopen");
  },
  discover(request) {
    return invoke<ExistingTeamReceipt>("onboarding_existing_team_discover", { request });
  },
  register(candidateSha256) {
    return invoke<ExistingTeamRegisterResult>("onboarding_existing_team_register", {
      request: { candidateSha256, confirmed: true },
    });
  },
  reconfirmSummary() {
    return invoke<ExistingTeamReconfirmSummary>("existing_team_reconfirm_summary");
  },
};

/** Codes the existing-team flow shows; error-catalog.test.ts checks each has a catalog entry. */
export const EXISTING_TEAM_ERROR_CODES: ReadonlySet<string> = new Set([
  "host_key_unavailable",
  "host_key_missing",
  "host_key_changed",
  "host_key_mismatch",
  "host_key_confirmation_invalid",
  "host_key_unwritable",
  "permissions_failed",
  "not_vps",
  "invalid_host",
  "invalid_user",
  "invalid_key_path",
  "key_unavailable",
  "invalid_key",
  "invalid_port",
  "invalid_team_id",
  "existing_team_vps_required",
  "existing_team_reconfirm_setup",
  "window_not_allowed",
  "existing_team_identity_mismatch",
  "existing_team_not_active",
  "existing_team_unavailable",
  // The saved target no longer matches what the VPS runs (the team was updated, or it is off): the dialog offers to rebind it.
  "existing_team_runtime_changed",
  // The direct chat the connection opens after the team answers (direct_chat.rs): its own codes
  // reach the dialog, not «unknown». A tunnel the app cannot open is not a team that cannot be reached.
  "tunnel_start_failed",
  "tunnel_verify_failed",
  "tunnel_unavailable",
  "tunnel_path_unavailable",
  "existing_team_assistant_unverified",
  "existing_team_runtime_candidate_required",
  "existing_team_runtime_candidate_invalid",
  "existing_team_runtime_candidate_mismatch",
  "existing_team_runtime_candidate_exists",
  "existing_team_runtime_candidate_conflict",
  "existing_team_saved_incomplete",
  "existing_team_saved_selection_mismatch",
  "existing_team_runtime_already_selected",
  "existing_team_container_not_found",
  "existing_team_not_found",
  "existing_team_ambiguous",
  "existing_team_choice_gone",
  "invalid_container_choice",
  "existing_team_image_unattested",
  "existing_team_too_many_containers",
  "existing_team_discovery_timeout",
  "existing_team_target_changed",
  "existing_team_receipt_required",
  "existing_team_register_not_confirmed",
  "account_scope_changed",
  "account_team_mismatch",
  "ssh_unavailable",
  "ssh_auth_failed",
  "snapshot_failed",
  "container_unavailable",
  "operation_in_progress",
]);

export function existingTeamErrorCode(error: unknown): string {
  if (typeof error === "string") return EXISTING_TEAM_ERROR_CODES.has(error) ? error : "unknown";
  if (!error || typeof error !== "object") return "unknown";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && EXISTING_TEAM_ERROR_CODES.has(code) ? code : "unknown";
}

/**
 * Why a connected team cannot be chatted with yet, as a code the dialog knows: the direct chat's
 * own one (a tunnel the app could not open) when it gave one, else the Assistant not verified.
 */
export function directChatFailureCode(chat: { state: string; code?: string }): string {
  return chat.state !== "ready" && chat.code && EXISTING_TEAM_ERROR_CODES.has(chat.code)
    ? chat.code
    : "existing_team_assistant_unverified";
}

export function isTerminalExistingTeamError(code: string): boolean {
  return code === "host_key_changed" || code === "host_key_mismatch" ||
    code === "existing_team_identity_mismatch" || code === "account_team_mismatch" ||
    code === "existing_team_ambiguous" || code === "existing_team_image_unattested" ||
    code === "existing_team_too_many_containers" || code === "existing_team_saved_selection_mismatch";
}

const CHOICE_ID = /^[0-9a-f]{64}$/;
const CHOICE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const CHOICE_STARTED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const CHOICE_REVISION = /^[0-9a-f]{40}$/;
const CHOICE_DIGEST = /^sha256:[0-9a-f]{64}$/;

function containerChoice(value: unknown): ExistingTeamContainerChoice | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const name = v.name ?? null;
  const startedAt = v.startedAt ?? null;
  if (typeof v.containerId !== "string" || !CHOICE_ID.test(v.containerId)) return null;
  if (name !== null && (typeof name !== "string" || !CHOICE_NAME.test(name))) return null;
  if (startedAt !== null && (typeof startedAt !== "string" || !CHOICE_STARTED.test(startedAt))) return null;
  if (typeof v.ociRevision !== "string" || !CHOICE_REVISION.test(v.ociRevision)) return null;
  if (typeof v.digest !== "string" || !CHOICE_DIGEST.test(v.digest)) return null;
  if (typeof v.readiness !== "boolean") return null;
  return { containerId: v.containerId, name, startedAt, ociRevision: v.ociRevision, digest: v.digest, readiness: v.readiness };
}

/**
 * When the container was started, in ms, or null: not read, or Docker's never-started time (year 1).
 * Those sort last and show no date.
 */
export function containerStartTime(choice: ExistingTeamContainerChoice): number | null {
  const at = choice.startedAt ? Date.parse(choice.startedAt) : Number.NaN;
  return Number.isFinite(at) && at > Date.UTC(2000, 0, 1) ? at : null;
}

/**
 * The containers an `existing_team_ambiguous` listed, newest first, or null: any other error, or a
 * list that is not two to four valid and distinct containers (then the dialog shows the refusal).
 */
export function ambiguousContainerChoices(error: unknown): ExistingTeamContainerChoice[] | null {
  if (existingTeamErrorCode(error) !== "existing_team_ambiguous") return null;
  const raw = (error as { choices?: unknown }).choices;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 4) return null;
  const choices = raw.map(containerChoice);
  if (choices.some((choice) => choice === null)) return null;
  const valid = choices as ExistingTeamContainerChoice[];
  if (new Set(valid.map((choice) => choice.containerId)).size !== valid.length) return null;
  return [...valid].sort((a, b) => {
    const [ta, tb] = [containerStartTime(a), containerStartTime(b)];
    if (ta === null || tb === null) return ta === tb ? 0 : ta === null ? 1 : -1;
    return tb - ta;
  });
}
