import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ExecutionHost } from "./onboarding";
import {
  confirmOnboardingSshHostKey,
  probeOnboardingSshHostKey,
  type SshHostKeyProbe,
} from "./onboarding-runtime";

export type VpsProfileImportHost = Extract<ExecutionHost, { kind: "vps" }>;

export interface ProfileImportSnapshot {
  sourceValid: boolean;
  reviewClear: boolean;
  sourceStable: boolean;
  targetWasAbsent: boolean;
  targetValid: boolean;
  receiptVerified: boolean;
}

export interface ProfileImportBridge {
  probe(host: VpsProfileImportHost): Promise<SshHostKeyProbe>;
  confirm(
    host: VpsProfileImportHost,
    probe: Pick<SshHostKeyProbe, "algorithm" | "fingerprint">,
  ): Promise<void>;
  importProfile(host: VpsProfileImportHost): Promise<ProfileImportSnapshot>;
}

export function profileImportErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null &&
    typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "unknown";
}

export function verifiedProfileImportSnapshot(value: ProfileImportSnapshot): boolean {
  return Boolean(value.sourceValid && value.reviewClear && value.sourceStable &&
    value.targetValid && value.receiptVerified);
}

async function importProfile(host: VpsProfileImportHost): Promise<ProfileImportSnapshot> {
  if (!isTauri()) throw { code: "desktop_only" };
  return invoke<ProfileImportSnapshot>("profile_import_vps_to_local", { host });
}

export const profileImportBridge: ProfileImportBridge = {
  probe: probeOnboardingSshHostKey,
  confirm: confirmOnboardingSshHostKey,
  importProfile,
};
