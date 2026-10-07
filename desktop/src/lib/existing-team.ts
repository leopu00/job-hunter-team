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

export interface ExistingTeamProgress {
  stage: "preparing" | "runtime" | "container" | "provider" | "team";
  message: string;
}

export interface ExistingTeamBridge {
  probe(host: ExistingTeamVpsHost): Promise<SshHostKeyProbe>;
  confirm(host: ExistingTeamVpsHost, probe: SshHostKeyProbe): Promise<void>;
  connect(request: ExistingTeamRequest, onProgress: (progress: ExistingTeamProgress) => void): Promise<ExistingTeamConnectionResult>;
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
    code === "existing_team_identity_mismatch" || code === "account_team_mismatch";
}
