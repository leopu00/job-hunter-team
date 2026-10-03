import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ExecutionHost,
  OnboardingRuntimeSnapshot,
  OnboardingSubmission,
} from "./onboarding";

export interface OnboardingNativeProgress {
  stage: "preparing" | "runtime" | "container" | "provider" | "team";
  message: string;
}

export type OnboardingInteractiveEvent =
  | { kind: "output"; text: string }
  | { kind: "exit"; code: number | null };

export interface SshHostKeyProbe {
  status: "pinned" | "confirmation_required";
  algorithm: "ssh-ed25519";
  fingerprint: `SHA256:${string}`;
}

function desktopOnly(): never { throw { code: "desktop_only" }; }

export async function probeOnboardingSshHostKey(host: ExecutionHost): Promise<SshHostKeyProbe> {
  if (!isTauri()) desktopOnly();
  return invoke<SshHostKeyProbe>("onboarding_ssh_host_key_probe", { host });
}

export async function confirmOnboardingSshHostKey(
  host: ExecutionHost,
  probe: Pick<SshHostKeyProbe, "algorithm" | "fingerprint">,
): Promise<void> {
  if (!isTauri()) desktopOnly();
  await invoke("onboarding_ssh_host_key_confirm", {
    host,
    algorithm: probe.algorithm,
    fingerprint: probe.fingerprint,
  });
}

export async function prepareOnboardingRuntime(
  submission: OnboardingSubmission,
  pairingToken: string | null,
  onProgress: (progress: OnboardingNativeProgress) => void,
): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  const channel = new Channel<OnboardingNativeProgress>();
  channel.onmessage = onProgress;
  return invoke("onboarding_prepare", { submission, pairingToken, onProgress: channel });
}

export async function startOnboardingProviderLogin(
  host: ExecutionHost,
  onEvent: (event: OnboardingInteractiveEvent) => void,
): Promise<string> {
  if (!isTauri()) desktopOnly();
  const channel = new Channel<OnboardingInteractiveEvent>();
  channel.onmessage = onEvent;
  const result = await invoke<{ sessionId: string }>("onboarding_provider_login", { host, onEvent: channel });
  return result.sessionId;
}

export async function sendOnboardingProviderInput(sessionId: string, input: string): Promise<void> {
  if (!isTauri()) desktopOnly();
  await invoke("onboarding_provider_login_input", { sessionId, input });
}

export async function closeOnboardingProviderLogin(sessionId: string): Promise<void> {
  if (!isTauri()) desktopOnly();
  await invoke("onboarding_provider_login_close", { sessionId });
}

export async function startOnboardingTeam(
  host: ExecutionHost,
  onProgress: (progress: OnboardingNativeProgress) => void,
): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  const channel = new Channel<OnboardingNativeProgress>();
  channel.onmessage = onProgress;
  return invoke("onboarding_team_start", { host, onProgress: channel });
}

export async function readOnboardingSnapshot(host: ExecutionHost): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  return invoke("onboarding_snapshot", { host });
}

/** Re-reads the privately persisted native host without exposing it to the webview. */
export async function resumeOnboardingSnapshot(): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  return invoke("onboarding_resume_snapshot");
}

/** Starts only missing team sessions from the account-scoped persisted host. */
export async function resumeOnboardingTeamStart(): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  return invoke("onboarding_resume_team_start");
}

export async function openOnboardingAssistant(host: ExecutionHost): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  return invoke("onboarding_assistant_open", { host });
}
