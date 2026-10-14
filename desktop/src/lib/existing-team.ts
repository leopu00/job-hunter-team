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
}

export type { SshHostKeyProbe };

export type ExistingTeamConnectionResult = OnboardingRuntimeSnapshot;

export interface ExistingTeamReadOnlyConnectionResult {
  snapshot: OnboardingRuntimeSnapshot;
  readiness: boolean;
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
}

export interface ExistingTeamRegisterResult {
  outcome: "registered" | "already_registered";
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
  "existing_team_identity_mismatch",
  "existing_team_not_active",
  "existing_team_unavailable",
  "existing_team_runtime_candidate_required",
  "existing_team_runtime_candidate_invalid",
  "existing_team_runtime_candidate_mismatch",
  "existing_team_runtime_candidate_exists",
  "existing_team_runtime_candidate_conflict",
  "existing_team_saved_incomplete",
  "existing_team_runtime_already_selected",
  "existing_team_container_not_found",
  "existing_team_not_found",
  "existing_team_ambiguous",
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

export function isTerminalExistingTeamError(code: string): boolean {
  return code === "host_key_changed" || code === "host_key_mismatch" ||
    code === "existing_team_identity_mismatch" || code === "account_team_mismatch" ||
    code === "existing_team_ambiguous" || code === "existing_team_image_unattested" ||
    code === "existing_team_too_many_containers";
}
